/**
 * The model driver of the society cohort (register row DK1801; docs/society-models-run.md): one agent's loop against the Anthropic Messages API THROUGH a gateway, so the per-agent dollar cap, the token cap, the loop
 * breaker, the refusals and the run log apply to every call the model makes. The society's tools are declared to the model as `mcp__society__<name>`; the gateway judges the scope `mcp.society.<name>` and removes a
 * call outside that set before the loop sees it; the loop runs each call it is handed with the tool's `run`, and sends the result back.
 *
 * What the loop adds to the gateway: a limit of turns and of wall-clock time for the agent, a bounded retry of the provider's own 429, 529 and 5xx (and of a connection that could not be made), a time limit for each tool,
 * a cut of each tool result, a clean stop on an AbortSignal (the in-flight call is aborted), and an outcome that says why the agent stopped and what it cost, from the gateway's own count of the replies' usage.
 * It never reads, holds or logs a provider key: the key lives in the gateway (see runner.ts).
 */

export interface SocietyTool {
  /** 1 to 40 characters of a-z 0-9 _ ; the model sees it as `mcp__society__<name>`. */
  name: string;
  description: string;
  /** A JSON Schema object (type: "object"). */
  input_schema: Record<string, unknown>;
  /** Runs one call for one agent. It must not throw: a failure is { ok: false, text }. */
  /** True for a tool that suspends the agent (rest, wait_for): it is not cut by the tool time limit, and `ctx.signal` ends it when the run stops. */
  suspends?: boolean;
  run(args: Record<string, unknown>, ctx: { agent: string; turn: number; now: () => string; signal: AbortSignal }): Promise<SocietyToolResult>;
}
export interface SocietyToolResult {
  ok: boolean; text: string;
  /** Why the tool refused (a rule name), for the trace. */
  refused?: string;
  /** The agent chose to stop: the loop ends after this turn. */
  end?: boolean;
  /** The agent woke from a suspension: the conversation so far is dropped and `text` (the delta observation) starts a new one, so a long life does not grow the context. */
  reset?: boolean;
  /** The agent left for good (voluntary, permanent for the run): the loop ends with the stop reason "left" and this reason. */
  leave?: string;
}
/** Token economy (ENG15): what keeps a long life from costing the person who runs it more than it must. */
export interface Economy {
  /** Mark the static prefix (the tool list and the briefing) for the provider's prompt cache, so each turn reads it at a tenth of the price. Default true. */
  cache: boolean;
  /** Exchanges (a reply and its tool results) of the conversation kept; older ones are dropped and the agent's rolling summary stands in for them. Default 6. */
  historyTurns: number;
  /** If one request's whole input (uncached, cache read and cache write) passes this many tokens, the history is dropped to the opening and the summary before the next call. Default 24000. */
  maxInputPerCall: number;
}
export const DEFAULT_ECONOMY: Economy = { cache: true, historyTurns: 6, maxInputPerCall: 24_000 };
/** The version-0 behaviour, kept for the baseline the tests compare against: no cache marks, the whole history, no per-call ceiling. */
export const LEGACY_ECONOMY: Economy = { cache: false, historyTurns: 1_000_000, maxInputPerCall: Number.MAX_SAFE_INTEGER };

export interface SocietyToolSet {
  /** The agent's own past in a few lines (kept by the engine); put after the opening when older exchanges are dropped. */
  summary?(agent: string): string | undefined;
  tools: SocietyTool[];
  /** The system text for this agent. No goal is given. */
  system(agent: string): string;
  /** The first user message of the loop. */
  opening(agent: string): string;
}

export interface AgentLimits { usd: number; maxTokens: number; maxTurns: number; wallClockMs: number; maxResultChars: number }
export const DEFAULT_LIMITS: AgentLimits = { usd: 0.4, maxTokens: 400_000, maxTurns: 60, wallClockMs: 30 * 60_000, maxResultChars: 4000 };

export type StopReason = "finished" | "usd_cap" | "token_cap" | "max_turns" | "wall_clock" | "stopped" | "provider_error" | "loop_breaker" | "gateway_stopped" | "left";
export interface AgentOutcome {
  agent: string; turns: number; toolCalls: number; refused: number;
  tokens: { input: number; output: number }; usd: number;
  stopped: StopReason; detail?: string; runLog?: string;
}
export type DriverEvent =
  | { kind: "compact"; agent: string; turn: number; why: "history" | "ceiling" }
  | { kind: "turn"; agent: string; turn: number; usd: number; tokens: number; cacheRead?: number; cacheWrite?: number; /** This reply's own token counts. */ input?: number; output?: number }
  | { kind: "tool"; agent: string; turn: number; tool: string; ok: boolean; refused: boolean }
  | { kind: "text"; agent: string; turn: number; text: string }
  | { kind: "retry"; agent: string; status: number; waitMs: number; attempt: number }
  | { kind: "end"; agent: string; outcome: AgentOutcome };

/** What the loop reads back from the gateway that serves it (the runner supplies it). */
export interface GatewayView { spendUsd: number; tokens: { input: number; output: number }; refused: number; stopped?: string; runLog?: string }

export interface RunAgentOptions {
  agent: string;
  toolset: SocietyToolSet;
  model: string;
  gatewayUrl: string;
  limits?: Partial<AgentLimits>;
  economy?: Partial<Economy>;
  signal: AbortSignal;
  observe?: () => GatewayView;
  onEvent?: (e: DriverEvent) => void;
  /** Injected for tests: how to wait, and the clock. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  /** The gateway's host header is not needed; extra headers are not sent. Max tokens of one reply. */
  replyTokens?: number;
  /** How long one tool may run. */
  toolTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const PREFIX = "mcp__society__";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
export const MAX_RETRIES = 4;

const defaultSleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) return resolve();
  const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); resolve(); };
  signal.addEventListener("abort", onAbort, { once: true });
});

/** The wait before retry number `attempt` (1-based): the provider's retry-after when it gave one, else 2, 4, 8, 16 seconds; never more than a minute. */
export function retryWaitMs(attempt: number, retryAfter: string | null): number {
  const asked = retryAfter ? Number(retryAfter) : NaN;
  const ms = Number.isFinite(asked) && asked >= 0 ? asked * 1000 : 2000 * 2 ** (attempt - 1);
  return Math.min(ms, 60_000);
}

/** Why the gateway refused a model call, from its own wording (the provider's errors never start with "ASP gateway"). */
export function gatewayStopReason(message: string): StopReason | undefined {
  if (!/^ASP gateway/.test(message)) return undefined;
  if (/dollar|usd|estimated spend/i.test(message)) return "usd_cap";
  if (/tokens|token ceiling|token cap/i.test(message)) return "token_cap";
  if (/loop|same arguments|near repeat|depth/i.test(message)) return "loop_breaker";
  return "gateway_stopped";
}

interface Block { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }

export async function runAgent(o: RunAgentOptions): Promise<AgentOutcome> {
  const limits = { ...DEFAULT_LIMITS, ...(o.limits ?? {}) };
  const sleep = o.sleep ?? defaultSleep, now = o.now ?? Date.now, doFetch = o.fetchImpl ?? fetch;
  const started = now();
  const eco: Economy = { ...DEFAULT_ECONOMY, ...(o.economy ?? {}) };
  const decl: Array<Record<string, unknown>> = o.toolset.tools.map((t) => ({ name: PREFIX + t.name, description: t.description, input_schema: t.input_schema }));
  // The cache breakpoints: the end of the tool list and the end of the briefing, so the whole static prefix is read from the cache after the first turn.
  if (eco.cache && decl.length) decl[decl.length - 1] = { ...decl[decl.length - 1], cache_control: { type: "ephemeral" } };
  const byName = new Map(o.toolset.tools.map((t) => [PREFIX + t.name, t]));
  const opening = o.toolset.opening(o.agent);
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: opening }];
  const systemText = o.toolset.system(o.agent);
  const system: unknown = eco.cache ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }] : systemText;
  // What the agent is told again when older exchanges are dropped: the opening and its own rolling summary.
  const reopen = (): string => { const sm = o.toolset.summary?.(o.agent); return sm ? `${opening}\n\nWhat you have done so far (kept for you; the earlier conversation is not repeated):\n${sm}` : opening; };
  let turns = 0, toolCalls = 0, refusedSeen = 0;
  const finish = (stopped: StopReason, detail?: string): AgentOutcome => {
    const g = o.observe?.();
    const outcome: AgentOutcome = { agent: o.agent, turns, toolCalls, refused: Math.max(refusedSeen, g?.refused ?? 0), tokens: g?.tokens ?? { input: 0, output: 0 }, usd: g?.spendUsd ?? 0, stopped, ...(detail ? { detail } : {}), ...(g?.runLog ? { runLog: g.runLog } : {}) };
    o.onEvent?.({ kind: "end", agent: o.agent, outcome });
    return outcome;
  };
  // One abort for everything in flight: the caller's signal, and the wall clock.
  const wall = new AbortController();
  const onAbort = () => wall.abort();
  o.signal.addEventListener("abort", onAbort, { once: true });
  const clock = setTimeout(() => wall.abort("wall_clock"), Math.max(0, limits.wallClockMs));
  try {
    while (true) {
      if (o.signal.aborted) return finish("stopped");
      if (now() - started >= limits.wallClockMs || wall.signal.aborted) return finish(o.signal.aborted ? "stopped" : "wall_clock");
      if (turns >= limits.maxTurns) return finish("max_turns", `${limits.maxTurns} turns`);
      const g0 = o.observe?.();
      if (g0 && g0.tokens.input + g0.tokens.output >= limits.maxTokens) return finish("token_cap", `${limits.maxTokens} tokens`);
      if (g0?.stopped) return finish("gateway_stopped", g0.stopped);
      turns++;
      // The request, with a bounded retry of the provider's own rate limit and overload.
      let reply: { content?: Block[]; stop_reason?: string } | undefined;
      for (let attempt = 0; ; attempt++) {
        let res: Response | undefined, networkError = false;
        try {
          res = await doFetch(`${o.gatewayUrl.replace(/\/$/, "")}/v1/messages`, {
            method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" }, signal: wall.signal,
            body: JSON.stringify({ model: o.model, max_tokens: o.replyTokens ?? 1024, system, tools: decl, messages }),
          });
        } catch (e) {
          if (wall.signal.aborted) return finish(o.signal.aborted ? "stopped" : "wall_clock");
          networkError = true; void e;
        }
        if (res && res.ok) { reply = (await res.json().catch(() => undefined)) as typeof reply; if (!reply) return finish("provider_error", "the answer was not JSON"); break; }
        const status = res?.status ?? 0;
        const text = res ? await res.text().catch(() => "") : "";
        let message = ""; try { const j = JSON.parse(text) as { error?: { message?: string } }; message = j.error?.message ?? ""; } catch { message = text.slice(0, 200); }
        const why = gatewayStopReason(message);
        if (why) return finish(why, message.slice(0, 200));
        if (!(networkError || RETRY_STATUSES.has(status)) || attempt >= MAX_RETRIES) return finish("provider_error", networkError ? "the provider could not be reached" : `HTTP ${status}${message ? `: ${message.slice(0, 160)}` : ""}`);
        const waitMs = retryWaitMs(attempt + 1, res?.headers.get("retry-after") ?? null);
        o.onEvent?.({ kind: "retry", agent: o.agent, status, waitMs, attempt: attempt + 1 });
        await sleep(waitMs, wall.signal);
        if (wall.signal.aborted) return finish(o.signal.aborted ? "stopped" : "wall_clock");
      }
      const content = Array.isArray(reply?.content) ? reply!.content! : [];
      messages.push({ role: "assistant", content });
      const g = o.observe?.();
      const use = (reply as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined)?.usage;
      const cacheRead = Number(use?.cache_read_input_tokens ?? 0), cacheWrite = Number(use?.cache_creation_input_tokens ?? 0);
      o.onEvent?.({ kind: "turn", agent: o.agent, turn: turns, usd: g?.spendUsd ?? 0, tokens: g ? g.tokens.input + g.tokens.output : 0, input: Number(use?.input_tokens ?? 0), output: Number(use?.output_tokens ?? 0), ...(cacheRead ? { cacheRead } : {}), ...(cacheWrite ? { cacheWrite } : {}) });
      const contextTokens = Number(use?.input_tokens ?? 0) + cacheRead + cacheWrite;
      const results: unknown[] = [];
      let refusedThisTurn = 0;
      let endedByAgent = false;
      let leftFor: string | undefined;
      let resetText: string | undefined;
      for (const b of content) {
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          o.onEvent?.({ kind: "text", agent: o.agent, turn: turns, text: b.text });
          // A call the gateway removed is told to the model as text beginning "[ASP]": counted and shown, never run.
          if (/^\[ASP\]/.test(b.text)) { refusedSeen++; refusedThisTurn++; o.onEvent?.({ kind: "tool", agent: o.agent, turn: turns, tool: (/The action "([^"]+)"/.exec(b.text)?.[1] ?? "?"), ok: false, refused: true }); }
        }
        if (b.type !== "tool_use" || !b.id || !b.name) continue;
        toolCalls++;
        const tool = byName.get(b.name);
        let r: SocietyToolResult;
        if (!tool) r = { ok: false, text: `there is no tool named ${b.name}` };
        else {
          const ac = new AbortController();
          const timer = tool.suspends ? undefined : setTimeout(() => ac.abort(), o.toolTimeoutMs ?? 30_000);
          try {
            r = await Promise.race([
              tool.run(b.input ?? {}, { agent: o.agent, turn: turns, now: () => new Date(now()).toISOString(), signal: wall.signal }).catch((e: unknown) => ({ ok: false, text: `the tool failed: ${(e as Error).message}` })),
              new Promise<SocietyToolResult>((resolve) => ac.signal.addEventListener("abort", () => resolve({ ok: false, text: "the tool timed out" }), { once: true })),
            ]);
          } finally { if (timer) clearTimeout(timer); }
        }
        const text = String(r.text ?? "");
        const cut = text.length > limits.maxResultChars ? text.slice(0, limits.maxResultChars) + `\n[cut: ${text.length - limits.maxResultChars} more characters]` : text;
        o.onEvent?.({ kind: "tool", agent: o.agent, turn: turns, tool: tool?.name ?? b.name, ok: !!r.ok, refused: false });
        results.push({ type: "tool_result", tool_use_id: b.id, content: cut, ...(r.ok ? {} : { is_error: true }) });
        if (r.end) endedByAgent = true;
        if (r.leave !== undefined) leftFor = r.leave;
        if (r.reset) resetText = cut;
        if (o.signal.aborted) break;
      }
      // The gateway removed every call of the turn: the model is told so and may go on (the gateway's strikes and the loop breaker stop one that keeps trying).
      if (!results.length && refusedThisTurn) { messages.push({ role: "user", content: "Your call was not run: the gateway refused it (see above). Choose another action, or stop." }); continue; }
      if (!results.length) return finish("finished", reply?.stop_reason);
      messages.push({ role: "user", content: results });
      // The history is bounded: a call whose whole input passed the ceiling starts again from the opening and the summary; otherwise the oldest exchanges go and the summary stands in for them.
      if (contextTokens > eco.maxInputPerCall && messages.length > 3) { messages.length = 1; messages[0] = { role: "user", content: reopen() }; o.onEvent?.({ kind: "compact", agent: o.agent, turn: turns, why: "ceiling" }); }
      else if (messages.length > 1 + 2 * eco.historyTurns) { while (messages.length > 1 + 2 * eco.historyTurns) messages.splice(1, 2); messages[0] = { role: "user", content: reopen() }; o.onEvent?.({ kind: "compact", agent: o.agent, turn: turns, why: "history" }); }
      if (leftFor !== undefined) return finish("left", leftFor);
      if (endedByAgent) return finish("finished", "the agent chose to stop");
      if (resetText !== undefined && !o.signal.aborted) { messages.length = 0; messages.push({ role: "user", content: resetText }); continue; }
    }
  } finally {
    clearTimeout(clock);
    o.signal.removeEventListener("abort", onAbort);
  }
}
