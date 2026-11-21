// Live-run readiness: --budget-usd is a hard stop. The spend is estimated from tokens and a price table (never a bill); once it reaches the cap, or the next call could pass it, no provider call is made.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, priceFor, costUsd, worstCaseUsd, DEFAULT_PRICE, type Gateway } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

test("prices: a known family has its own, an unknown model is priced high, an override wins, and the worst case counts the largest reply", () => {
  assert.deepEqual(priceFor("claude-haiku-5-5"), { inPerM: 1.5, outPerM: 7.5 });
  assert.deepEqual(priceFor("some-new-model"), DEFAULT_PRICE);
  assert.deepEqual(priceFor("some-new-model", { outPerM: 1 }), { inPerM: 15, outPerM: 1 });
  assert.equal(costUsd(1_000_000, 1_000_000, { inPerM: 1, outPerM: 2 }), 3);
  assert.ok(worstCaseUsd({ max_tokens: 1_000_000, messages: [] }, { inPerM: 0, outPerM: 10 }) >= 10);
});

async function setup(extra: Record<string, unknown>) {
  let providerCalls = 0;
  const up = createServer((req, res) => { req.resume(); req.on("end", () => { providerCalls++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 100_000, completion_tokens: 10_000 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] })); }); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const stops: string[] = [];
  const g = createGateway({ openaiUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}/v1`, scopes: ["repo.read"], onStop: (r) => stops.push(r), ...extra });
  gateways.push(g);
  const port = await g.listen();
  const ask = async () => { const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }) }); return { status: r.status, body: await r.json() as any }; };
  return { ask, g, calls: () => providerCalls, stops };
}

test("the second call is refused once the spend reaches the cap, the provider is not called, the run stops and the summary says why", async () => {
  // one call: 100k in and 10k out at haiku prices ($1.5 and $7.5 per million) is $0.15 + $0.075 = $0.225
  const s = await setup({ usdCap: 0.2, price: {} });
  assert.equal((await s.ask()).status, 200);
  assert.equal(s.g.summary().spendUsd, 0.225);
  const second = await s.ask();
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, "asp_usd_budget");
  assert.match(second.body.error.message, /\$0\.2250 of its \$0\.20 cap/);
  assert.equal(s.calls(), 1, "no provider call after the cap");
  assert.deepEqual(s.stops, ["dollar cap reached"]);
  assert.equal(s.g.summary().usdCap, 0.2);
});

test("a call that could pass the cap is refused before it is made (the worst case counts), and without a cap nothing changes", async () => {
  const tight = await setup({ usdCap: 0.0001 });
  assert.equal((await tight.ask()).status, 429);
  assert.equal(tight.calls(), 0);
  const none = await setup({});
  assert.equal((await none.ask()).status, 200);
  assert.equal((await none.ask()).status, 200);
  assert.equal(none.g.summary().usdCap, undefined);
});

test("prompt-cache tokens are billed apart from input_tokens and counted in the estimate (Claude Code leans on the cache), streamed or not", async () => {
  const { anthropicEvents } = await import("../src/index.ts");
  const reply = { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 100_000 }, content: [{ type: "text", text: "ok" }] };
  for (const stream of [false, true]) {
    const up = createServer((req, res) => { req.resume(); req.on("end", () => { if (stream) { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of anthropicEvents(reply as any)) res.write(e); res.end(); } else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); } }); });
    await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
    const g = createGateway({ anthropicUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}`, scopes: ["repo.read"], usdCap: 5 });
    gateways.push(g);
    const port = await g.listen();
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 50, stream, messages: [{ role: "user", content: "hi" }] }) });
    await r.text();
    // haiku: 1.5 dollars in and 7.5 out per million. 1M cache reads = 0.1 x 1.5 = 0.15; 100k cache writes = 1.25 x 0.1 x 1.5 = 0.1875; 10 in and 10 out are negligible.
    const spend = g.summary().spendUsd;
    assert.ok(Math.abs(spend - 0.3375) < 0.001, `stream ${stream}: spend ${spend}`);
  }
});
