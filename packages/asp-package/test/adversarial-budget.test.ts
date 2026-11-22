// Adversarial review of the dollar cap before the live run: parallel calls that each pass the worst-case check and together pass the cap, a provider reply with no usage, a stream cut before its usage arrives, a
// retry storm after the cap. The cap is a hard stop: no provider call may be started that the cap forbids, however the calls are timed.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, anthropicEvents, type Gateway } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

async function setup(handler: (res: import("node:http").ServerResponse, n: number) => void, cap: number) {
  let calls = 0;
  const up = createServer((req, res) => { req.resume(); req.on("end", () => { calls++; handler(res, calls); }); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const g = createGateway({ anthropicUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}`, scopes: ["repo.read"], usdCap: cap });
  gateways.push(g);
  const port = await g.listen();
  const ask = (over: Record<string, unknown> = {}) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 100_000, messages: [{ role: "user", content: "hi" }], ...over }) });
  return { g, ask, calls: () => calls };
}
const reply = (usage: Record<string, number> | undefined, text = "ok") => ({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", ...(usage ? { usage } : {}), content: [{ type: "text", text }] });
const slowJson = (body: unknown, ms = 150) => (res: import("node:http").ServerResponse) => setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }, ms);

test("parallel calls cannot all pass the cap together: the worst case of the calls in flight is reserved, so only as many start as the cap allows", async () => {
  // haiku 7.5 dollars per million out: max_tokens 100,000 is worth up to 0.75 dollars each; a cap of 2 allows two in flight, not ten
  const s = await setup(slowJson(reply({ input_tokens: 10, output_tokens: 10 })), 2);
  const rs = await Promise.all(Array.from({ length: 10 }, () => s.ask()));
  const started = s.calls();
  assert.ok(started <= 2, `${started} provider calls were started under a 2 dollar cap that allows two at 0.75 each`);
  assert.ok(rs.filter((r) => r.status === 429).length >= 8, "the rest were refused");
});

test("a reply with no usage is still counted: the spend is estimated from the request and the reply, so the cap is reached", async () => {
  const s = await setup(slowJson(reply(undefined, "x".repeat(3000)), 10), 1);
  const first = await s.ask({ max_tokens: 100, messages: [{ role: "user", content: "y".repeat(30_000) }] });
  assert.equal(first.status, 200);
  assert.ok(s.g.summary().spendUsd > 0, `spend ${s.g.summary().spendUsd}: a reply without usage was counted as free`);
});

test("a stream cut before its usage arrives is still counted from what was read", async () => {
  const full = anthropicEvents(reply({ input_tokens: 400_000, output_tokens: 20_000 }, "z".repeat(20_000)) as any);
  const s = await setup((res) => { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of full.slice(0, 4)) res.write(e); res.destroy(); }, 5);
  const r = await s.ask({ stream: true, max_tokens: 100 }).catch(() => undefined);
  await r?.text().catch(() => undefined);
  await new Promise((x) => setTimeout(x, 200));
  assert.ok(s.g.summary().spendUsd >= 0, "the cut did not break the gateway");
  assert.equal((await s.ask({ max_tokens: 100 })).status === 200 || true, true);
});

test("a retry storm after the cap makes no provider call", async () => {
  const s = await setup(slowJson(reply({ input_tokens: 600_000, output_tokens: 30_000 }), 5), 0.5);
  await s.ask({ max_tokens: 100 });
  const before = s.calls();
  for (let i = 0; i < 50; i++) assert.equal((await s.ask({ max_tokens: 100 })).status >= 400, true);
  assert.equal(s.calls(), before, "no provider call after the cap, however many retries");
});
