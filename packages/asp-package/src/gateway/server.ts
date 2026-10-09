/**
 * The ASP gateway, P0 spike (docs/gateway-design.md): a local proxy for the OpenAI-compatible chat API and the
 * Anthropic Messages API. Every reply is read for the tool calls the model asks for; calls the Mandate does not
 * allow are removed from the reply BEFORE the agent receives it, so the agent never sees a call it may not make.
 *
 * P0 limits: replies are fetched whole from the provider (a client that asked for a stream gets one synthesized
 * from the whole reply); other paths (for example /v1/responses) pass through unjudged and are counted as
 * unjudged requests; approval gates, MCP and the Action's assurance field come in later phases.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { judge, type KnownBadRef, type ToolCall } from "./judge.ts";

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
  knownBad?: KnownBadRef[];
  /** Blocked calls in one run that read as probing and stop the run (default 3). */
  maxStrikes?: number;
  /** Stops the run when input plus output tokens pass this. */
  tokenCap?: number;
  fetch?: typeof fetch;
  /** Called for every judged call. */
  onCall?: (e: { tool: string; scope: string; allowed: boolean; reason?: string }) => void;
  onStop?: (reason: string) => void;
}

export interface GatewaySummary {
  requests: number;
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
  summary(): GatewaySummary;
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
  const tokens = { input: 0, output: 0 };
  let requests = 0, unjudged = 0, strikes = 0;
  let stopped: string | undefined;

  const stop = (reason: string) => { if (!stopped) { stopped = reason; opts.onStop?.(reason); } };

  /** Judges one call; records it. Returns the refusal reason when it is refused. */
  function decide(call: ToolCall): string | undefined {
    const j = judge(call, opts.scopes, opts.knownBad ?? []);
    opts.onCall?.({ tool: call.name, scope: j.scope, allowed: j.allow, ...(j.reason ? { reason: j.reason } : {}) });
    if (j.allow) {
      if (j.scope) used.add(j.scope);
      if (j.artifact) artifacts.set(`${j.artifact.uri}#${j.artifact.sha256}`, j.artifact);
      return undefined;
    }
    blocked.set(j.scope, (blocked.get(j.scope) ?? 0) + 1);
    strikes++;
    if (strikes >= maxStrikes) stop(`${strikes} blocked attempts in one run read as probing`);
    return j.reason ?? "outside the Mandate";
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
    body.stream = false;
    delete body.stream_options;
    const up = await f(`${opts.openaiUpstream!.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: upstreamHeaders(req, opts.openaiKey, "openai"), body: JSON.stringify(body) });
    const text = await up.text();
    if (!up.ok) { res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" }); res.end(text); return; }
    const reply = JSON.parse(text);
    tokens.input += reply.usage?.prompt_tokens ?? 0;
    tokens.output += reply.usage?.completion_tokens ?? 0;
    const refused: { name: string; reason: string }[] = [];
    for (const choice of reply.choices ?? []) {
      const msg = choice.message;
      if (!msg || !Array.isArray(msg.tool_calls)) continue;
      const kept: unknown[] = [];
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name ?? "";
        const reason = decide({ id: tc.id, name, args: parseArgs(tc.function?.arguments) });
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

  function openaiChunks(reply: any): string[] {
    const out: string[] = [];
    const base = { id: reply.id, object: "chat.completion.chunk", created: reply.created, model: reply.model };
    const choice = reply.choices?.[0] ?? { message: {}, finish_reason: "stop" };
    const m = choice.message ?? {};
    out.push(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", ...(m.content ? { content: m.content } : { content: "" }) }, finish_reason: null }] })}\n\n`);
    (m.tool_calls ?? []).forEach((tc: any, i: number) => {
      out.push(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function?.name, arguments: tc.function?.arguments ?? "" } }] }, finish_reason: null }] })}\n\n`);
    });
    out.push(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? "stop" }], ...(reply.usage ? { usage: reply.usage } : {}) })}\n\n`);
    out.push("data: [DONE]\n\n");
    return out;
  }

  // ---------- Anthropic Messages ----------
  async function anthropicMessages(req: IncomingMessage, res: ServerResponse, rawBody: Buffer) {
    const body = JSON.parse(rawBody.toString("utf8"));
    const wantsStream = body.stream === true;
    body.stream = false;
    const up = await f(`${opts.anthropicUpstream!.replace(/\/$/, "")}/v1/messages`, { method: "POST", headers: upstreamHeaders(req, opts.anthropicKey, "anthropic"), body: JSON.stringify(body) });
    const text = await up.text();
    if (!up.ok) { res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" }); res.end(text); return; }
    const reply = JSON.parse(text);
    tokens.input += reply.usage?.input_tokens ?? 0;
    tokens.output += reply.usage?.output_tokens ?? 0;
    if (Array.isArray(reply.content)) {
      const refused: { name: string; reason: string }[] = [];
      const kept = reply.content.filter((b: any) => {
        if (b?.type !== "tool_use") return true;
        const reason = decide({ id: b.id, name: b.name, args: parseArgs(b.input) });
        if (reason) { refused.push({ name: b.name, reason }); return false; }
        return true;
      });
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

  function anthropicEvents(reply: any): string[] {
    const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    const out: string[] = [];
    out.push(ev("message_start", { type: "message_start", message: { id: reply.id, type: "message", role: "assistant", model: reply.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: reply.usage?.input_tokens ?? 0, output_tokens: 0 } } }));
    (reply.content ?? []).forEach((b: any, i: number) => {
      if (b.type === "tool_use") {
        out.push(ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }));
        out.push(ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input ?? {}) } }));
      } else if (b.type === "thinking") {
        out.push(ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "thinking", thinking: "" } }));
        out.push(ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "thinking_delta", thinking: b.thinking ?? "" } }));
        if (b.signature) out.push(ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "signature_delta", signature: b.signature } }));
      } else if (b.type === "text") {
        out.push(ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }));
        out.push(ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text ?? "" } }));
      } else {
        out.push(ev("content_block_start", { type: "content_block_start", index: i, content_block: b }));
      }
      out.push(ev("content_block_stop", { type: "content_block_stop", index: i }));
    });
    out.push(ev("message_delta", { type: "message_delta", delta: { stop_reason: reply.stop_reason ?? "end_turn", stop_sequence: reply.stop_sequence ?? null }, usage: { output_tokens: reply.usage?.output_tokens ?? 0 } }));
    out.push(ev("message_stop", { type: "message_stop" }));
    return out;
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

  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && path === "/asp/health") return json(res, 200, { ok: true });
      if (req.method === "GET" && path === "/asp/summary") return json(res, 200, summary());
      const style: "openai" | "anthropic" = path.startsWith("/v1/messages") || path.startsWith("/messages") ? "anthropic" : "openai";
      if (stopped) return json(res, 403, stoppedBody(style));
      requests++;
      const rawBody = await readBody(req);
      if (req.method === "POST" && /\/chat\/completions$/.test(path) && opts.openaiUpstream) return await openaiChat(req, res, rawBody);
      if (req.method === "POST" && /\/v1\/messages$/.test(path) && opts.anthropicUpstream) return await anthropicMessages(req, res, rawBody);
      return await passthrough(req, res, rawBody, path.includes("/messages") || path.startsWith("/v1/complete") ? "anthropic" : "openai");
    } catch (e) {
      if (!res.headersSent) json(res, 502, { error: { message: `ASP gateway: ${(e as Error).message}` } });
      else res.end();
    }
  });

  function summary(): GatewaySummary {
    return {
      requests, unjudgedRequests: unjudged, tokens: { ...tokens },
      scopesUsed: [...used].sort(),
      blocked: [...blocked].map(([scope, count]) => ({ scope, count })),
      artifacts: [...artifacts.values()],
      strikes, ...(stopped ? { stopped } : {}),
    };
  }

  return {
    server,
    listen: (port = 0, host = "127.0.0.1") => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => resolve((server.address() as { port: number }).port)); }),
    summary, stop,
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
