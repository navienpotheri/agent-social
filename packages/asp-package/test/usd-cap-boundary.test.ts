// Boundary cases of the dollar cap (mutation review, 2026-11-22): a test that checks the code against its own constants misses `>=` against `>`. Prices here are chosen so every figure is a whole number of dollars:
// the model's output costs $1 a token and its input nothing, so a reply of N output tokens costs exactly $N and a request with max_tokens M can cost up to $M.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, type Gateway } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

async function setup(cap: number) {
  let providerCalls = 0;
  const up = createServer((req, res) => { req.resume(); req.on("end", () => { providerCalls++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 3, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] })); }); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const stops: string[] = [];
  const g = createGateway({ openaiUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}/v1`, scopes: ["repo.read"], usdCap: cap, price: { inPerM: 0, outPerM: 1_000_000 }, onStop: (r) => stops.push(r) });
  gateways.push(g);
  const port = await g.listen();
  const post = async (body: string) => { const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body }); return r.status; };
  const ask = () => post(JSON.stringify({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "x" }] }));
  return { ask, post, g, calls: () => providerCalls, stops };
}

test("a call whose worst case lands exactly on the cap is allowed; the one after it, whose worst case would pass the cap, is refused", async () => {
  const s = await setup(2);
  assert.equal(await s.ask(), 200, "spend 0 + worst 1 = 1, under the cap of 2");
  assert.equal(s.g.summary().spendUsd, 1);
  assert.equal(await s.ask(), 200, "spend 1 + worst 1 = 2 is exactly the cap: allowed");
  assert.equal(s.g.summary().spendUsd, 2);
  assert.equal(await s.ask(), 429, "spend is now the cap");
  assert.equal(s.calls(), 2);
  assert.deepEqual(s.stops, ["dollar cap reached"], "the run stops when the spend has reached the cap, exactly");
});

test("spend exactly at the cap refuses even a request whose worst case cannot be read (nothing is left to spend)", async () => {
  const s = await setup(1);
  assert.equal(await s.ask(), 200);
  assert.equal(s.g.summary().spendUsd, 1);
  assert.equal(await s.post("not json at all"), 429, "spend equals cap: refused, whatever the body");
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.stops, ["dollar cap reached"]);
});

test("one cent below the cap with nothing to reserve is still allowed (the cap is a limit, not a margin)", async () => {
  const s = await setup(2);
  assert.equal(await s.ask(), 200);
  assert.notEqual(await s.post("not json at all"), 429, "spend 1 is below the cap of 2 and the body gives no worst case: not refused for the cap");
});
