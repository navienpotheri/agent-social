import { createHash } from "node:crypto";
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
/** What a request sends that decides how the model answers, as the run records it (ENG70): only max_tokens is sent; sampling and thinking are the provider's own defaults, which the run does not set and so cannot state. */
export const REQUEST_SETTINGS = { max_tokens: 1024, temperature: "not sent (the provider's default)", top_p: "not sent", top_k: "not sent", thinking: "not sent (the model's own default)" } as const;
export const sha16 = (x: string): string => createHash("sha256").update(x).digest("hex").slice(0, 16);

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
  /** Exchanges (a reply and its tool results) of the conversation kept; older ones are dropped and the agent's rolling summary stands in for them. Default 6. The history is cut back to this only when it has grown by half as many again (at least two): every cut drops the thinking blocks (a thinking block is valid only after the exact prefix it was made after), so cutting every turn would throw reasoning away every turn. */
  historyTurns: number;
  /** If one request's whole input (uncached, cache read and cache write) passes this many tokens, the history is dropped to the opening and the summary before the next call. Default 24000. */
  maxInputPerCall: number;
}
export const DEFAULT_ECONOMY: Economy = { cache: true, historyTurns: 6, maxInputPerCall: 24_000 };
/** The version-0 behaviour, kept for the baseline the tests compare against: no cache marks, the whole history, no per-call ceiling. */
export const LEGACY_ECONOMY: Economy = { cache: false, historyTurns: 1_000_000, maxInputPerCall: Number.MAX_SAFE_INTEGER };

export interface SocietyToolSetExit {
  /** A turn with text and no tool call is not an exit: if the toolset offers this, the agent rests until the next event and the text it returns (the delta observation) starts a new conversation. Returning undefined ends the agent as before. */
  idle?(agent: string, text: string, signal: AbortSignal): Promise<string | undefined>;
}
export interface SocietyToolSet extends SocietyToolSetExit {
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
  | { kind: "provenance_change"; agent: string; turn: number; what: "model_snapshot" | "tool_definition" | "tool_added" | "tool_removed"; name: string; from?: string; to?: string }
  | { kind: "thinking_dropped"; agent: string; turn: number; blocks: number; why: "compaction" | "provider_400" }
  | { kind: "turn"; agent: string; turn: number; usd: number; tokens: number; cacheRead?: number; cacheWrite?: number; /** The provider's returned model snapshot, a hash of its response id, a hash of the tool definitions sent, and the size of the thinking returned (counts, never the text). */ snapshot?: string; idHash?: string; toolsHash?: string; thinkingBlocks?: number; thinkingChars?: number; /** This reply's own token counts. */ input?: number; output?: number }
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
  /** Called with every model request as sent (system, tools, messages after fold and cache marks, max_tokens) and the reply, for `--record-prompts`: local files only, no key. */
  recordTurn?: (e: { turn: number; at: string; request: unknown; reply: unknown }) => void;
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

/**
 * A thinking block is valid only in the conversation that produced it: the provider checks it against the whole prefix it was generated after (the tools, the briefing and every message before it). So a history that is
 * trimmed or rewritten must not keep the thinking blocks of the turns that follow the change: they are all dropped together (every assistant turn keeps its text and its tool calls, and loses only its thinking blocks),
 * never edited and never kept in part. Returns how many blocks were dropped.
 */
export function dropThinkingBlocks(messages: { role: "user" | "assistant"; content: unknown }[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const kept = (m.content as { type?: string }[]).filter((b) => !(b?.type === "thinking" || b?.type === "redacted_thinking"));
    const dropped = (m.content as unknown[]).length - kept.length;
    if (!dropped) continue;
    n += dropped;
    m.content = kept.length ? kept : [{ type: "text", text: "(no text)" }];
  }
  return n;
}
/** The provider's refusal of a thinking block that does not belong to the conversation it is sent in. */
export const THINKING_BINDING_RE = /signature.{0,40}thinking block|thinking.{0,80}bound to a different conversation|block_binding/i;

interface Block { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }

/**
 * The cache breakpoint on the growing history (a third mark, after the tools and the briefing): the last block of the last message is marked for the provider's cache, so that the next request reads everything up to
 * here from the cache instead of sending it as fresh input. A copy is made for the request; `messages` itself is never marked, so a mark never stays behind on an older message (the provider allows four). With the cache off
 * nothing is marked. The gateway's token guard counts a response's `input_tokens` and `output_tokens` only: cache reads and cache writes are reported apart and are not counted against it.
 */
export function withHistoryBreakpoint(messages: { role: "user" | "assistant"; content: unknown }[], cache: boolean): { role: "user" | "assistant"; content: unknown }[] {
  if (!cache || !messages.length) return messages;
  const out = messages.slice();
  const last = out[out.length - 1]!;
  // a plain-text message (the opening) is left as it is: changing its form would change what a thinking block of a later reply is bound to
  if (Array.isArray(last.content) && last.content.length) {
    const blocks = last.content.slice() as Array<Record<string, unknown>>;
    const k = blocks.length - 1;
    if (blocks[k]!.type === "thinking" || blocks[k]!.type === "redacted_thinking") return out; // a thinking block is never marked or changed
    blocks[k] = { ...blocks[k], cache_control: { type: "ephemeral" } };
    out[out.length - 1] = { ...last, content: blocks };
  }
  return out;
}

export async function runAgent(o: RunAgentOptions): Promise<AgentOutcome> {
  const limits = { ...DEFAULT_LIMITS, ...(o.limits ?? {}) };
  const sleep = o.sleep ?? defaultSleep, now = o.now ?? Date.now, doFetch = o.fetchImpl ?? fetch;
  const started = now();
  const eco: Economy = { ...DEFAULT_ECONOMY, ...(o.economy ?? {}) };
  // The definitions are read again for every request: a definition that changed mid-run is sent as it is now and named (ENG70).
  const buildDecl = (): Array<Record<string, unknown>> => o.toolset.tools.map((t) => ({ name: PREFIX + t.name, description: t.description, input_schema: t.input_schema }));
  let decl: Array<Record<string, unknown>> = buildDecl();
  const defHash = (d: Record<string, unknown>) => sha16(JSON.stringify([d.name, d.description, d.input_schema]));
  let lastToolHashes: Map<string, string> | undefined;
  let lastSnapshot: string | undefined;
  // The cache breakpoints: the end of the tool list and the end of the briefing, so the whole static prefix is read from the cache after the first turn.
  const markCache = () => { if (eco.cache && decl.length) decl[decl.length - 1] = { ...decl[decl.length - 1], cache_control: { type: "ephemeral" } }; };
  markCache();
  const byName = new Map(o.toolset.tools.map((t) => [PREFIX + t.name, t]));
  const opening = o.toolset.opening(o.agent);
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: opening }];
  const systemText = o.toolset.system(o.agent);
  const system: unknown = eco.cache ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }] : systemText;
  // What the agent is told again when older exchanges are dropped: the opening and its own rolling summary.
  const reopen = (): string => { const sm = o.toolset.summary?.(o.agent); return sm ? `${opening}\n\nWhat you have done so far (kept for you; the earlier conversation is not repeated):\n${sm}` : opening; };
  // the history mark is switched off for the rest of this agent's life if the provider ever refuses a thinking block as bound to another conversation (the mark would be the suspect): the cost is one retry, never the agent
  let histCache = eco.cache;
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
      // the tool definitions as they are now: hashed, and a changed, added or removed one named
      decl = buildDecl();
      const toolHashes = new Map(decl.map((d) => [String(d.name), defHash(d)]));
      const toolsHash = sha16([...toolHashes].map(([n, h]) => `${n}:${h}`).join("|"));
      if (lastToolHashes) {
        for (const [n, h] of toolHashes) { const before = lastToolHashes.get(n); if (before === undefined) o.onEvent?.({ kind: "provenance_change", agent: o.agent, turn: turns, what: "tool_added", name: n.replace(PREFIX, ""), to: h }); else if (before !== h) o.onEvent?.({ kind: "provenance_change", agent: o.agent, turn: turns, what: "tool_definition", name: n.replace(PREFIX, ""), from: before, to: h }); }
        for (const [n, h] of lastToolHashes) if (!toolHashes.has(n)) o.onEvent?.({ kind: "provenance_change", agent: o.agent, turn: turns, what: "tool_removed", name: n.replace(PREFIX, ""), from: h });
      }
      lastToolHashes = toolHashes;
      markCache();
      let reply: { id?: string; model?: string; content?: Block[]; stop_reason?: string } | undefined;
      let droppedForThisCall = false;
      let sentBody = "";
      for (let attempt = 0; ; attempt++) {
        let res: Response | undefined, networkError = false;
        try {
          res = await doFetch(`${o.gatewayUrl.replace(/\/$/, "")}/v1/messages`, {
            method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" }, signal: wall.signal,
            body: (sentBody = JSON.stringify({ model: o.model, max_tokens: o.replyTokens ?? 1024, system, tools: decl, messages: withHistoryBreakpoint(messages, histCache) })),
          });
        } catch (e) {
          if (wall.signal.aborted) return finish(o.signal.aborted ? "stopped" : "wall_clock");
          networkError = true; void e;
        }
        if (res && res.ok) { reply = (await res.json().catch(() => undefined)) as typeof reply; if (!reply) return finish("provider_error", "the answer was not JSON"); if (o.recordTurn) { try { o.recordTurn({ turn: turns, at: new Date().toISOString(), request: JSON.parse(sentBody), reply }); } catch { /* recording never stops a run */ } } break; }
        const status = res?.status ?? 0;
        const text = res ? await res.text().catch(() => "") : "";
        let message = ""; try { const j = JSON.parse(text) as { error?: { message?: string } }; message = j.error?.message ?? ""; } catch { message = text.slice(0, 200); }
        const why = gatewayStopReason(message);
        if (why) return finish(why, message.slice(0, 200));
        // A thinking block that the provider says belongs to another conversation: drop the thinking blocks of the history once and ask again; the agent is never ended for it.
        if (status === 400 && !droppedForThisCall && THINKING_BINDING_RE.test(message)) {
          droppedForThisCall = true;
          histCache = false;
          const n = dropThinkingBlocks(messages);
          if (n > 0) { o.onEvent?.({ kind: "thinking_dropped", agent: o.agent, turn: turns, blocks: n, why: "provider_400" }); continue; }
        }
        if (!(networkError || RETRY_STATUSES.has(status)) || attempt >= MAX_RETRIES) return finish("provider_error", networkError ? "the provider could not be reached" : `HTTP ${status}${message ? `: ${message.slice(0, 160)}` : ""}`);
        const waitMs = retryWaitMs(attempt + 1, res?.headers.get("retry-after") ?? null);
        o.onEvent?.({ kind: "retry", agent: o.agent, status, waitMs, attempt: attempt + 1 });
        await sleep(waitMs, wall.signal);
        if (wall.signal.aborted) return finish(o.signal.aborted ? "stopped" : "wall_clock");
      }
      const content = Array.isArray(reply?.content) ? reply!.content! : [];
      messages.push({ role: "assistant", content });
      const g = o.observe?.();
      // what the provider says it ran: the snapshot (a change is named), a hash of the response id, and the size of the thinking it returned (counts: the hidden text is never kept)
      const snapshot = typeof reply?.model === "string" ? reply.model : undefined;
      if (snapshot && lastSnapshot && snapshot !== lastSnapshot) o.onEvent?.({ kind: "provenance_change", agent: o.agent, turn: turns, what: "model_snapshot", name: o.model, from: lastSnapshot, to: snapshot });
      if (snapshot) lastSnapshot = snapshot;
      const think = content.filter((b) => b.type === "thinking" || b.type === "redacted_thinking");
      const thinkingChars = think.reduce((n, b) => { const x = b as unknown as { thinking?: unknown; data?: unknown }; return n + (typeof x.thinking === "string" ? x.thinking.length : typeof x.data === "string" ? x.data.length : 0); }, 0);
      const use = (reply as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined)?.usage;
      const cacheRead = Number(use?.cache_read_input_tokens ?? 0), cacheWrite = Number(use?.cache_creation_input_tokens ?? 0);
      o.onEvent?.({ kind: "turn", agent: o.agent, turn: turns, usd: g?.spendUsd ?? 0, tokens: g ? g.tokens.input + g.tokens.output : 0, input: Number(use?.input_tokens ?? 0), output: Number(use?.output_tokens ?? 0), ...(cacheRead ? { cacheRead } : {}), ...(cacheWrite ? { cacheWrite } : {}), ...(snapshot ? { snapshot } : {}), ...(typeof reply?.id === "string" ? { idHash: sha16(reply.id) } : {}), toolsHash, ...(think.length ? { thinkingBlocks: think.length, thinkingChars } : {}) });
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
      if (!results.length) {
        const said = content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join(" ").trim();
        const woke = o.toolset.idle && !o.signal.aborted ? await o.toolset.idle(o.agent, said, wall.signal) : undefined;
        if (woke === undefined || o.signal.aborted) return finish(o.signal.aborted ? "stopped" : "finished", reply?.stop_reason);
        o.onEvent?.({ kind: "compact", agent: o.agent, turn: turns, why: "history" });
        messages.length = 0; messages.push({ role: "user", content: woke });
        continue;
      }
      messages.push({ role: "user", content: results });
      // The history is bounded: a call whose whole input passed the ceiling starts again from the opening and the summary; otherwise the oldest exchanges go and the summary stands in for them.
      if (contextTokens > eco.maxInputPerCall && messages.length > 3) { messages.length = 1; messages[0] = { role: "user", content: reopen() }; o.onEvent?.({ kind: "compact", agent: o.agent, turn: turns, why: "ceiling" }); }
      else if (messages.length > 1 + 2 * (eco.historyTurns + Math.max(2, Math.floor(eco.historyTurns / 2)))) { while (messages.length > 1 + 2 * eco.historyTurns) messages.splice(1, 2); messages[0] = { role: "user", content: reopen() }; { const dropped = dropThinkingBlocks(messages); if (dropped) o.onEvent?.({ kind: "thinking_dropped", agent: o.agent, turn: turns, blocks: dropped, why: "compaction" }); } o.onEvent?.({ kind: "compact", agent: o.agent, turn: turns, why: "history" }); }
      if (leftFor !== undefined) return finish("left", leftFor);
      if (endedByAgent) return finish("finished", "the agent chose to stop");
      if (resetText !== undefined && !o.signal.aborted) { messages.length = 0; messages.push({ role: "user", content: resetText }); continue; }
    }
  } finally {
    clearTimeout(clock);
    o.signal.removeEventListener("abort", onAbort);
  }
}
