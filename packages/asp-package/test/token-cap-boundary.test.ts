// Boundary of the per-run token cap (mutation review, 2026-11-22): a run that has used exactly its cap is refused its next model call; a run one token under it is not.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, type Gateway } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

async function setup(cap: number) {
  let calls = 0;
  const up = createServer((req, res) => { req.resume(); req.on("end", () => { calls++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 6, completion_tokens: 4 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] })); }); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const g = createGateway({ openaiUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}/v1`, scopes: ["repo.read"], tokenCap: cap });
  gateways.push(g);
  const port = await g.listen();
  const ask = async () => (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "x" }] }) })).status;
  return { ask, calls: () => calls };
}

test("ten tokens used of a cap of ten: the next call is refused and no provider call is made", async () => {
  const s = await setup(10);
  assert.equal(await s.ask(), 200);
  assert.equal(await s.ask(), 429);
  assert.equal(s.calls(), 1);
});

test("ten tokens used of a cap of eleven: the next call is made", async () => {
  const s = await setup(11);
  assert.equal(await s.ask(), 200);
  assert.equal(await s.ask(), 200);
  assert.equal(s.calls(), 2);
});
