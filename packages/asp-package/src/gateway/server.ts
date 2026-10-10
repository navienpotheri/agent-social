/**
 * The ASP gateway, P0 spike (docs/gateway-design.md): a local proxy for the OpenAI-compatible chat API and the
 * Anthropic Messages API. Every reply is read for the tool calls the model asks for; calls the Mandate does not
 * allow are removed from the reply BEFORE the agent receives it, so the agent never sees a call it may not make.
 *
 * P1: streams are relayed live (text as it arrives, each tool call held until complete, judged, then forwarded or
 * dropped); calls on gated scopes are held for the principal's signed answer, or refused when forbidden. Other paths
 * (for example /v1/responses) pass through unjudged and are counted as unjudged requests.
 * P2: MCP at /mcp/<name>: the `asp` server (memory and commons tools) and a judging proxy for each of the agent's MCP servers.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { lastUserText, replyText, toolResultsIn, type RunRecorder } from "./runlog.ts";
import { commandOf, judge, type KnownBadRef, type ToolCall } from "./judge.ts";
import { anthropicEvents, callOfItem, openaiChunks, relayAnthropicStream, relayOpenaiStream, relayResponsesStream, responsesEvents } from "./stream.ts";
import { aspHandler, handleRpc, proxyHandler, type AspToolsOptions, type McpHandler, type McpUpstream } from "./mcp.ts";

export interface GatewayOptions {
  /** Base URL of the OpenAI-compatible API, up to and including /v1 (for example https://api.openai.com/v1). */
  openaiUpstream?: string;
  /** Origin of the Anthropic API (for example https://api.anthropic.com). */
  anthropicUpstream?: string;
  /** Replaces the client's credentials when set, so the agent never holds the provider key. */
  openaiKey?: string;
  anthropicKey?: string;
  /** The live Mandate's scopes. */
  scopes: string[];
  /** The hosts the Mandate's network scopes may reach (`network.hosts`); absent means no host limit. */
  hosts?: string[];
  /** Keeps the run log (gap E2): requests, replies, tool calls and how the run ended, redacted, on this machine. */
  runLog?: RunRecorder;
  knownBad?: KnownBadRef[];
  /** Blocked calls in one run that read as probing and stop the run (default 3). */
  maxStrikes?: number;
  /**
   * The Mandate's irreversible policy: calls on these granted scopes are held for the principal's answer (mode "ask",
   * through request and decision files in approvalsDir, the same protocol the pre-call hooks use) or refused (mode "deny").
   */
  gate?: { scopes: string[]; mode: "ask" | "deny"; waitSeconds: number; approvalsDir?: string };
  /** MCP endpoints on the gateway: the agent's memory and commons tools, and proxies for its other MCP servers. */
  mcp?: { asp?: AspToolsOptions; upstreams?: Record<string, McpUpstream> };
  /** Stops the run when input plus output tokens pass this. */
  tokenCap?: number;
  fetch?: typeof fetch;
  /** Called for every judged call. */
  onCall?: (e: { tool: string; scope: string; allowed: boolean; reason?: string }) => void;
  onStop?: (reason: string) => void;
}

/** What one interval of a run cost and which models ran: the Action's `metrics` field. */
export interface ActionMetrics {
  models: { name: string; provider?: string }[];
  requests: number;
  tool_calls: number;
  tokens_in: number;
  tokens_out: number;
  seconds: number;
}

export interface GatewaySummary {
  requests: number;
  /** Tool calls the gateway judged. Zero means the agent never used structured tool calls through it, so nothing could have been enforced. */
  toolCalls: number;
  unjudgedRequests: number;
  tokens: { input: number; output: number };
  scopesUsed: string[];
  blocked: { scope: string; count: number }[];
  artifacts: { uri: string; sha256: string }[];
  strikes: number;
  stopped?: string;
}

export interface Gateway {
  server: Server;
  listen(port?: number, host?: string): Promise<number>;
  /** Listens on a Unix socket instead, for an agent in a sandbox with no network (a relay forwards to it). */
  listenUnix(path: string): Promise<void>;
  summary(): GatewaySummary;
  /** What happened since the last drain (scopes used, blocked attempts, fingerprints), and starts a new interval, so Actions can be reported while the run goes on. */
  drain(): { scopesUsed: string[]; blocked: { scope: string; count: number }[]; artifacts: { uri: string; sha256: string }[]; metrics: ActionMetrics; /** When the gateway last saw a request or a tool call, for a late report (S80). */ lastActivityAt: string };
  /** Refuses every further request (the contract was revoked, killed or settled). */
  stop(reason: string): void;
  close(): Promise<void>;
}

const refusalText = (calls: { name: string; reason: string }[]) =>
  calls.map((c) => `[ASP] The action "${c.name}" was not run: ${c.reason}. Continue without it.`).join("\n");

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : { input: v }; } catch { return { input: raw }; }
}

export function createGateway(opts: GatewayOptions): Gateway {
  const f = opts.fetch ?? fetch;
  const maxStrikes = opts.maxStrikes ?? 3;
  const used = new Set<string>();
  const blocked = new Map<string, number>();
  const artifacts = new Map<string, { uri: string; sha256: string }>();
  const pendingUsed = new Set<string>();
  const pendingBlocked = new Map<string, number>();
  const pendingArtifacts = new Map<string, { uri: string; sha256: string }>();
  const tokens: { input: number; output: number; text: string } = { input: 0, output: 0, text: "" };
  const rec = opts.runLog;
  let lastActivity = Date.now();
  const seenResults = new Set<string>();
  /** Records a model request in the run log and returns where the token counts stood, so the reply can be recorded with its own figures. */
  const beginModelCall = (api: string, body: any) => {
    // The answers to earlier tool calls arrive in the next request; each is kept once (a request carries the whole history).
    if (rec) for (const r of toolResultsIn(body)) if (!seenResults.has(r.id || r.text.slice(0, 80))) { seenResults.add(r.id || r.text.slice(0, 80)); rec.event("tool_result", { id: r.id, text: r.text }); }
    rec?.event("model_request", { api, model: body?.model, stream: body?.stream === true, prompt: lastUserText(body), tools: Array.isArray(body?.tools) ? body.tools.length : 0 });
    tokens.text = "";
    return { input: tokens.input, output: tokens.output, at: Date.now() };
  };
  const endModelCall = (snap: { input: number; output: number; at: number }, text: string) => {
    rec?.event("model_reply", { tokens_in: tokens.input - snap.input, tokens_out: tokens.output - snap.output, ms: Date.now() - snap.at, text });
    tokens.text = "";
  };
  // Totals at the last drain, and the models seen since, so each Action carries its own interval's figures.
  const last = { requests: 0, toolCalls: 0, input: 0, output: 0, at: Date.now() };
  const modelsSeen = new Map<string, { name: string; provider?: string }>();
  const noteModel = (name: unknown, upstream: string | undefined) => {
    if (typeof name !== "string" || !name) return;
    let provider: string | undefined;
    try { provider = upstream ? new URL(upstream).host : undefined; } catch { /* not a URL */ }
    modelsSeen.set(`${provider ?? ""}|${name}`, { name, ...(provider ? { provider } : {}) });
  };
  let requests = 0, unjudged = 0, strikes = 0, toolCalls = 0;
  let stopped: string | undefined;

  const stop = (reason: string) => { if (!stopped) { stopped = reason; rec?.event("stopped", { reason }); opts.onStop?.(reason); } };

  /** Holds a gated call until the principal answers (a decision file), or the wait runs out, which is a refusal. */
  async function askPrincipal(call: ToolCall, scope: string): Promise<{ approved: boolean; reason?: string }> {
    const g = opts.gate!;
    const dir = g.approvalsDir!;
    mkdirSync(dir, { recursive: true });
    const id = String(call.id ?? randomUUID()).replace(/[^A-Za-z0-9_-]/g, "_");
    const summary = commandOf(call.args) ?? JSON.stringify(call.args);
    const tmp = join(dir, `${id}.request.tmp`);
    writeFileSync(tmp, JSON.stringify({ id, tool: call.name, scope, summary: summary.length > 2000 ? summary.slice(0, 2000) + "..." : summary, requested_at: new Date().toISOString() }));
    renameSync(tmp, join(dir, `${id}.request.json`));
    const decisionFile = join(dir, `${id}.decision.json`);
    const deadline = Date.now() + g.waitSeconds * 1000;
    while (Date.now() < deadline && !stopped) {
      if (existsSync(decisionFile)) {
        let d: { approved?: boolean; reason?: string } | undefined;
        try { d = JSON.parse(readFileSync(decisionFile, "utf8")); } catch { d = undefined; } // half written: read it again on the next poll
        if (d) return d.approved === true ? { approved: true } : { approved: false, reason: d.reason };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { approved: false, reason: stopped ? "the run was stopped" : `no answer within ${g.waitSeconds} seconds` };
  }

  /** Judges one call; records it. Returns the refusal reason when it is refused. */
  async function decide(call: ToolCall): Promise<string | undefined> {
    toolCalls++;
    lastActivity = Date.now();
    const j = judge(call, opts.scopes, opts.knownBad ?? [], (name) => !!opts.mcp?.asp && name.startsWith("mcp__asp__"), opts.hosts);
    let allow = j.allow;
    let reason = j.reason;
    let strike = true;
    // A gate is not a violation: a forbidden or unanswered call is refused without a strike.
    if (allow && j.scope && opts.gate?.scopes.includes(j.scope)) {
      strike = false;
      if (opts.gate.mode === "deny") { allow = false; reason = `the scope ${j.scope} is forbidden by this job's irreversible policy`; }
      else if (!opts.gate.approvalsDir) { allow = false; reason = `the scope ${j.scope} needs the principal's approval and this run cannot ask for it`; }
      else {
        const a = await askPrincipal(call, j.scope);
        if (!a.approved) { allow = false; reason = `the scope ${j.scope} needs the principal's approval and it was not given${a.reason ? `: ${a.reason}` : ""}`; }
      }
    }
    opts.onCall?.({ tool: call.name, scope: j.scope, allowed: allow, ...(reason ? { reason } : {}) });
    rec?.event("tool_call", { tool: call.name, scope: j.scope, allowed: allow, ...(reason ? { reason } : {}), ...(opts.gate?.scopes.includes(j.scope) ? { gated: true } : {}), input: commandOf(call.args) ?? JSON.stringify(call.args) });
    if (allow) {
      if (j.scope) { used.add(j.scope); pendingUsed.add(j.scope); }
      if (j.artifact) { artifacts.set(`${j.artifact.uri}#${j.artifact.sha256}`, j.artifact); pendingArtifacts.set(`${j.artifact.uri}#${j.artifact.sha256}`, j.artifact); }
      return undefined;
    }
    if (strike) {
      blocked.set(j.scope, (blocked.get(j.scope) ?? 0) + 1);
      pendingBlocked.set(j.scope, (pendingBlocked.get(j.scope) ?? 0) + 1);
      strikes++;
      if (strikes >= maxStrikes) stop(`${strikes} blocked attempts in one run read as probing`);
    }
    return reason ?? "outside the Mandate";
  }

  function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers });
    res.end(text);
  }
  const stoppedBody = (style: "openai" | "anthropic") => style === "openai"
    ? { error: { message: `ASP gateway: this run was stopped (${stopped})`, type: "asp_stopped", code: "asp_stopped" } }
    : { type: "error", error: { type: "permission_error", message: `ASP gateway: this run was stopped (${stopped})` } };

  async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  function upstreamHeaders(req: IncomingMessage, key: string | undefined, style: "openai" | "anthropic"): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    for (const k of ["authorization", "x-api-key", "anthropic-version", "anthropic-beta", "openai-organization", "openai-beta", "user-agent"]) {
      const v = req.headers[k];
      if (typeof v === "string") h[k] = v;
    }
    if (key) {
      delete h.authorization; delete h["x-api-key"];
      if (style === "openai") h.authorization = `Bearer ${key}`; else h["x-api-key"] = key;
    }
    if (style === "anthropic" && !h["anthropic-version"]) h["anthropic-version"] = "2023-06-01";
    return h;
  }

  // ---------- OpenAI-compatible chat completions ----------
  async function openaiChat(req: IncomingMessage, res: ServerResponse, rawBody: Buffer) {
    const body = JSON.parse(rawBody.toString("utf8"));
    const wantsStream = body.stream === true;
    noteModel(body.model, opts.openaiUpstream);
    const snap = beginModelCall("chat.completions", body);
    if (!wantsStream) body.stream = false;
    if (wantsStream) body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
    const up = await f(`${opts.openaiUpstream!.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: upstreamHeaders(req, opts.openaiKey, "openai"), body: JSON.stringify(body) });
    if (wantsStream && up.ok && (up.headers.get("content-type") ?? "").includes("text/event-stream") && up.body) {
      await relayOpenaiStream(up.body, res, decide, tokens);
      endModelCall(snap, tokens.text);
      if (tokenCapHit()) stop("token cap reached");
      return;
    }
    const text = await up.text();
    if (!up.ok) { rec?.event("model_error", { status: up.status, body: text.slice(0, 300) }); res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" }); res.end(text); return; }
    const reply = JSON.parse(text);
    tokens.input += reply.usage?.prompt_tokens ?? 0;
    tokens.output += reply.usage?.completion_tokens ?? 0;
    endModelCall(snap, replyText(reply));
    const refused: { name: string; reason: string }[] = [];
    for (const choice of reply.choices ?? []) {
      const msg = choice.message;
      if (!msg || !Array.isArray(msg.tool_calls)) continue;
      const kept: unknown[] = [];
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name ?? "";
        const reason = await decide({ id: tc.id, name, args: parseArgs(tc.function?.arguments) });
        if (reason) refused.push({ name, reason }); else kept.push(tc);
      }
      if (kept.length !== msg.tool_calls.length) {
        if (kept.length) msg.tool_calls = kept; else { delete msg.tool_calls; if (choice.finish_reason === "tool_calls") choice.finish_reason = "stop"; }
        const note = refusalText(refused);
        msg.content = msg.content ? `${msg.content}\n${note}` : note;
      }
    }
    if (tokenCapHit()) stop("token cap reached");
    if (!wantsStream) return json(res, 200, reply);
    sse(res, openaiChunks(reply));
  }


  // ---------- OpenAI Responses (current Codex) ----------
  async function openaiResponses(req: IncomingMessage, res: ServerResponse, rawBody: Buffer) {
    const body = JSON.parse(rawBody.toString("utf8"));
    const wantsStream = body.stream === true;
    noteModel(body.model, opts.openaiUpstream);
    const snap = beginModelCall("responses", body);
    const up = await f(`${opts.openaiUpstream!.replace(/\/$/, "")}/responses`, { method: "POST", headers: upstreamHeaders(req, opts.openaiKey, "openai"), body: JSON.stringify(body) });
    if (wantsStream && up.ok && (up.headers.get("content-type") ?? "").includes("text/event-stream") && up.body) {
      await relayResponsesStream(up.body, res, decide, tokens);
      endModelCall(snap, tokens.text);
      if (tokenCapHit()) stop("token cap reached");
      return;
    }
    const text = await up.text();
    if (!up.ok) { rec?.event("model_error", { status: up.status, body: text.slice(0, 300) }); res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" }); res.end(text); return; }
    const reply = JSON.parse(text);
    tokens.input += reply.usage?.input_tokens ?? 0;
    tokens.output += reply.usage?.output_tokens ?? 0;
    endModelCall(snap, replyText(reply));
    if (Array.isArray(reply.output)) {
      const kept: any[] = [];
      const refused: { name: string; reason: string }[] = [];
      for (const item of reply.output) {
        if (!["function_call", "local_shell_call", "custom_tool_call"].includes(item?.type)) { kept.push(item); continue; }
        const call = callOfItem(item);
        const reason = await decide(call);
        if (reason) refused.push({ name: call.name, reason }); else kept.push(item);
      }
      if (refused.length) {
        kept.push({ id: "msg_asp_0", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", annotations: [], text: refused.map((c) => `[ASP] The action "${c.name}" was not run: ${c.reason}. Continue without it.`).join("\n") }] });
        reply.output = kept;
      }
    }
    if (tokenCapHit()) stop("token cap reached");
    if (!wantsStream) return json(res, 200, reply);
    sse(res, responsesEvents(reply));
  }

  // ---------- Anthropic Messages ----------
  async function anthropicMessages(req: IncomingMessage, res: ServerResponse, rawBody: Buffer) {
    const body = JSON.parse(rawBody.toString("utf8"));
    const wantsStream = body.stream === true;
    noteModel(body.model, opts.anthropicUpstream);
    const snap = beginModelCall("messages", body);
    if (!wantsStream) body.stream = false;
    const up = await f(`${opts.anthropicUpstream!.replace(/\/$/, "")}/v1/messages`, { method: "POST", headers: upstreamHeaders(req, opts.anthropicKey, "anthropic"), body: JSON.stringify(body) });
    if (wantsStream && up.ok && (up.headers.get("content-type") ?? "").includes("text/event-stream") && up.body) {
      await relayAnthropicStream(up.body, res, decide, tokens);
      endModelCall(snap, tokens.text);
      if (tokenCapHit()) stop("token cap reached");
      return;
    }
    const text = await up.text();
    if (!up.ok) { rec?.event("model_error", { status: up.status, body: text.slice(0, 300) }); res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" }); res.end(text); return; }
    const reply = JSON.parse(text);
    tokens.input += reply.usage?.input_tokens ?? 0;
    tokens.output += reply.usage?.output_tokens ?? 0;
    endModelCall(snap, replyText(reply));
    if (Array.isArray(reply.content)) {
      const refused: { name: string; reason: string }[] = [];
      const kept: any[] = [];
      for (const b of reply.content) {
        if (b?.type !== "tool_use") { kept.push(b); continue; }
        const reason = await decide({ id: b.id, name: b.name, args: parseArgs(b.input) });
        if (reason) refused.push({ name: b.name, reason }); else kept.push(b);
      }
      if (refused.length) {
        kept.push({ type: "text", text: refusalText(refused) });
        reply.content = kept;
        if (!kept.some((b: any) => b.type === "tool_use") && reply.stop_reason === "tool_use") reply.stop_reason = "end_turn";
      }
    }
    if (tokenCapHit()) stop("token cap reached");
    if (!wantsStream) return json(res, 200, reply);
    sse(res, anthropicEvents(reply), true);
  }

  function sse(res: ServerResponse, events: string[], _anthropic = false) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    for (const e of events) res.write(e);
    res.end();
  }

  const tokenCapHit = () => opts.tokenCap !== undefined && tokens.input + tokens.output > opts.tokenCap;

  /** Anything else is passed through unjudged (and counted), so an agent's other calls keep working. */
  async function passthrough(req: IncomingMessage, res: ServerResponse, rawBody: Buffer, style: "openai" | "anthropic") {
    unjudged++;
    const base = style === "openai" ? opts.openaiUpstream : opts.anthropicUpstream;
    if (!base) return json(res, 404, { error: { message: "ASP gateway: no upstream is configured for this API" } });
    const origin = style === "openai" ? base.replace(/\/v1\/?$/, "") : base.replace(/\/$/, "");
    const up = await f(origin + (req.url ?? "/"), { method: req.method, headers: upstreamHeaders(req, style === "openai" ? opts.openaiKey : opts.anthropicKey, style), ...(rawBody.length && req.method !== "GET" ? { body: new Uint8Array(rawBody) } : {}) });
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/octet-stream", "content-length": buf.length });
    res.end(buf);
  }

  // ---------- MCP ----------
  const mcpHandlers = new Map<string, McpHandler>();
  if (opts.mcp?.asp) mcpHandlers.set("asp", aspHandler(opts.mcp.asp));
  for (const [name, up] of Object.entries(opts.mcp?.upstreams ?? {})) mcpHandlers.set(name, proxyHandler(name, up, (tool, args) => decide({ name: tool, args })));

  async function mcpRoute(req: IncomingMessage, res: ServerResponse, name: string, rawBody: Buffer) {
    const h = mcpHandlers.get(name);
    if (!h) return json(res, 404, { error: { message: `ASP gateway: no MCP server called ${name}` } });
    if (req.method === "DELETE") { res.writeHead(200); res.end(); return; }
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
    let msg: unknown;
    try { msg = JSON.parse(rawBody.toString("utf8")); } catch { return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
    const sent = Array.isArray(msg) ? msg : [msg];
    const answers = (await Promise.all(sent.map((m) => handleRpc(m, h)))).filter((x) => x !== undefined);
    if (rec) for (const m of sent as any[]) {
      if (m?.method !== "tools/call") continue;
      const a = (answers as any[]).find((x) => x?.id === m.id);
      const text = Array.isArray(a?.result?.content) ? a.result.content.map((c: any) => c?.text ?? "").join("\n") : a?.error?.message ?? "";
      rec.event("mcp_call", { server: name, tool: m.params?.name, input: JSON.stringify(m.params?.arguments ?? {}), result: text, ...(a?.result?.isError || a?.error ? { error: true } : {}) });
    }
    if (!answers.length) { res.writeHead(202); res.end(); return; }
    return json(res, 200, Array.isArray(msg) ? answers : answers[0]);
  }

  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && path === "/asp/health") return json(res, 200, { ok: true });
      if (req.method === "GET" && path === "/asp/summary") return json(res, 200, summary());
      const style: "openai" | "anthropic" = path.startsWith("/v1/messages") || path.startsWith("/messages") ? "anthropic" : "openai";
      if (stopped) return json(res, 403, stoppedBody(style));
      requests++;
      lastActivity = Date.now();
      const rawBody = await readBody(req);
      if (path.startsWith("/mcp/")) return await mcpRoute(req, res, path.slice("/mcp/".length), rawBody);
      if (req.method === "POST" && /\/chat\/completions$/.test(path) && opts.openaiUpstream) return await openaiChat(req, res, rawBody);
      if (req.method === "POST" && /\/responses$/.test(path) && opts.openaiUpstream) return await openaiResponses(req, res, rawBody);
      if (req.method === "POST" && /\/v1\/messages$/.test(path) && opts.anthropicUpstream) return await anthropicMessages(req, res, rawBody);
      return await passthrough(req, res, rawBody, path.includes("/messages") || path.startsWith("/v1/complete") ? "anthropic" : "openai");
    } catch (e) {
      if (!res.headersSent) json(res, 502, { error: { message: `ASP gateway: ${(e as Error).message}` } });
      else res.end();
    }
  });

  function summary(): GatewaySummary {
    return {
      requests, toolCalls, unjudgedRequests: unjudged, tokens: { input: tokens.input, output: tokens.output },
      scopesUsed: [...used].sort(),
      blocked: [...blocked].map(([scope, count]) => ({ scope, count })),
      artifacts: [...artifacts.values()],
      strikes, ...(stopped ? { stopped } : {}),
    };
  }

  return {
    server,
    listenUnix: (path) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(path, () => resolve()); }),
    listen: (port = 0, host = "127.0.0.1") => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => resolve((server.address() as { port: number }).port)); }),
    summary, stop,
    drain: () => {
      const now = Date.now();
      const metrics: ActionMetrics = { models: [...modelsSeen.values()], requests: requests - last.requests, tool_calls: toolCalls - last.toolCalls, tokens_in: tokens.input - last.input, tokens_out: tokens.output - last.output, seconds: Math.round((now - last.at) / 1000) };
      Object.assign(last, { requests, toolCalls, input: tokens.input, output: tokens.output, at: now });
      modelsSeen.clear();
      const out = { scopesUsed: [...pendingUsed].sort(), blocked: [...pendingBlocked].map(([scope, count]) => ({ scope, count })), artifacts: [...pendingArtifacts.values()], metrics, lastActivityAt: new Date(lastActivity).toISOString().replace(/\.\d{3}Z$/, "Z") };
      pendingUsed.clear(); pendingBlocked.clear(); pendingArtifacts.clear();
      return out;
    },
    close: () => new Promise((resolve) => { for (const u of Object.values(opts.mcp?.upstreams ?? {})) u.close(); server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
