import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { anthropicEvents, createGateway, openaiChunks, responsesEvents, GatewayTelemetry, type Gateway } from "../src/index.ts";
import type { ConsentView } from "@agent-social/asp-log";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

/** A fake model provider: answers every call with the next canned reply and records what it was sent. */
async function fakeUpstream(replies: unknown[]) {
  const seen: { path: string; headers: Record<string, unknown>; body: any }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    seen.push({ path: req.url ?? "", headers: req.headers, body: text ? JSON.parse(text) : undefined });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    const r: any = reply;
    if (seen.at(-1)!.body?.stream === true && (r.choices || r.content || r.output)) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const e of r.choices ? openaiChunks(r) : r.output ? responsesEvents(r) : anthropicEvents(r)) res.write(e);
      res.end();
      return;
    }
    const out = JSON.stringify(reply);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(out);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen };
}

const openaiToolReply = (calls: { name: string; args: unknown }[], content: string | null = null) => ({
  id: "chatcmpl-1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 10, completion_tokens: 5 },
  choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content, tool_calls: calls.map((c, i) => ({ id: `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }],
});
async function gateway(upstream: { url: string }, extra: Record<string, unknown> = {}) {
  const g = createGateway({ openaiUpstream: `${upstream.url}/v1`, anthropicUpstream: upstream.url, scopes: ["repo.read", "shell.exec"], ...extra });
  const port = await g.listen();
  gateways.push(g);
  return { g, url: `http://127.0.0.1:${port}` };
}

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const AT = "2026-11-21T12:00:00Z";
const consent = (over: Partial<ConsentView> = {}): ConsentView => ({ signals: ["plan_trace", "sub_agent_graph"], purposes: ["own_use"], from: "2026-11-01T00:00:00Z", until: "2026-12-31T00:00:00Z", revoked: false, agentCountersigned: true, mandateSignals: ["plan_trace"], ...over });
const calls = [{ name: "repo_read", args: { path: "a.txt" } }, { name: "Task", args: { prompt: "never recorded" } }, { name: "repo_read", args: { path: "b.txt" } }];
const run = async (t: GatewayTelemetry | undefined) => {
  const up = await fakeUpstream([openaiToolReply(calls)]);
  const { g, url } = await gateway(up, { scopes: ["repo.read", "agent.spawn"], ...(t ? { telemetry: t } : {}) });
  await (await post(`${url}/v1/chat/completions`, { model: "m", messages: [] })).json();
  return g.summary();
};

test("DK241: a gateway run whose Mandate lists one signal collects exactly that signal, from the calls it judged, and no other", async () => {
  const t = new GatewayTelemetry(consent(), () => AT);
  const s = await run(t);
  assert.equal(s.telemetry.status, "telemetry: on");
  assert.deepEqual(s.telemetry.signals, { plan_trace: 3 }, "three judged calls, one plan_trace entry each, and nothing else");
  assert.deepEqual(t.collector.calls, ["plan_trace", "plan_trace", "plan_trace"], "the source of sub_agent_graph was never read, though the consent names it and a Task call was made");
  const e = (t.collector.entries.plan_trace as { step: number; tool: string }[]);
  assert.deepEqual(e.map((x) => x.step), [1, 2, 3]);
  assert.ok(!JSON.stringify(t.collector.entries).includes("never recorded") && !JSON.stringify(t.collector.entries).includes("a.txt"), "arguments and text are never collected");
});

test("DK241: with both signals listed in the Mandate and named by the consent, a call that starts a sub-agent also gives a sub_agent_graph entry", async () => {
  const t = new GatewayTelemetry(consent({ mandateSignals: ["plan_trace", "sub_agent_graph"] }), () => AT);
  const s = await run(t);
  assert.deepEqual(s.telemetry.signals, { plan_trace: 3, sub_agent_graph: 1 });
});

test("DK241: a run with no consent, a Mandate with no telemetry field, a revoked, uncountersigned or out-of-date consent, or a young person's tenant says telemetry: off and reads no source", async () => {
  for (const [name, t] of Object.entries({
    "no tap": undefined,
    "no consent": new GatewayTelemetry(undefined, () => AT),
    "the Mandate lists nothing": new GatewayTelemetry(consent({ mandateSignals: [] }), () => AT),
    "no telemetry field in the Mandate": new GatewayTelemetry(consent({ mandateSignals: undefined }), () => AT),
    "revoked": new GatewayTelemetry(consent({ revoked: true }), () => AT),
    "not countersigned by the agent": new GatewayTelemetry(consent({ agentCountersigned: false }), () => AT),
    "expired": new GatewayTelemetry(consent({ until: "2026-11-02T00:00:00Z" }), () => AT),
    "a young person's tenant": new GatewayTelemetry(consent({ minorTenant: true }), () => AT),
    "the consent does not name the listed signal": new GatewayTelemetry(consent({ signals: ["calibration"] }), () => AT),
  }) as [string, GatewayTelemetry | undefined][]) {
    const s = await run(t);
    assert.equal(s.telemetry.status, "telemetry: off", name);
    assert.deepEqual(s.telemetry.signals, {}, name);
    if (t) assert.deepEqual(t.collector.calls, [], `${name}: no source was called`);
  }
});

test("DK241: the signals a gateway cannot see from calls (reasoning, beliefs, predictions...) are never collected even when listed and consented", async () => {
  const t = new GatewayTelemetry(consent({ signals: ["reasoning_trace", "belief_state", "calibration", "plan_trace"], mandateSignals: ["reasoning_trace", "belief_state", "calibration", "plan_trace"] }), () => AT);
  const s = await run(t);
  assert.deepEqual(Object.keys(s.telemetry.signals), ["plan_trace"]);
});
