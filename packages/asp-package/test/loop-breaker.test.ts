// DK1230 (S1422): the loop breaker on a real gateway. A scripted agent that repeats one call is halted at the Mandate's limit, the run stops, the halt is reported once for signing; an agent that repeats a call under varying arguments,
// or repeats a few calls a few times each, is not halted; a chain of spawns beyond the depth and a spent daily token cap halt too. The log's enforcement (a halted run buys nothing) is tested in packages/asp-log/test/run-halt.test.ts.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, type Gateway } from "../src/index.ts";
import { GatewayBreaker, type GatewayHalt } from "../src/agent-guards.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

/** An upstream whose every reply is one tool call chosen by `next(n)`, with `tokens` tokens of usage. */
async function upstream(next: (n: number) => { name: string; args: Record<string, unknown> }, tokens = 2) {
  let n = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) void _;
    const c = next(n++);
    const reply = { id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: tokens, completion_tokens: 0 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "", tool_calls: [{ id: `call_${n}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] };
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const post = (url: string) => fetch(`${url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) }).then((r) => r.json() as Promise<any>);
const gateway = async (up: string, loop: Record<string, unknown>) => {
  const halts: GatewayHalt[] = [], stops: string[] = [];
  const g = createGateway({ openaiUpstream: `${up}/v1`, anthropicUpstream: up, scopes: ["repo.read", "repo.write"], maxStrikes: 100, onStop: (r: string) => stops.push(r), loop: { ...loop, onHalt: (h: GatewayHalt) => halts.push(h) } } as never);
  const port = await g.listen(); gateways.push(g);
  return { url: `http://127.0.0.1:${port}`, halts, stops, g };
};
const ranCall = (r: any) => (r.choices?.[0]?.message?.tool_calls?.length ?? 0) > 0;
const saidHalt = (r: any) => String(r.choices?.[0]?.message?.content ?? r.error?.message ?? "");

test("a scripted agent that repeats one call is halted at the limit, the run stops, the halt is told once and every later call is refused with the reason", async () => {
  const up = await upstream(() => ({ name: "Read", args: { file_path: "notes.txt" } }));
  const { url, halts, stops } = await gateway(up, { equivalentCalls: 5 });
  const results = [];
  for (let i = 0; i < 9; i++) results.push(await post(url));
  const ran = results.map(ranCall);
  assert.deepEqual(ran.slice(0, 4), [true, true, true, true], "the first four equivalent calls run");
  assert.ok(ran.slice(4).every((x) => !x), "from the fifth on nothing runs");
  assert.match(saidHalt(results[4]), /halted by the loop breaker: Read was called 5 times with the same arguments.*loop_limits\.equivalent_calls 5.*does not resume/);
  assert.equal(halts.length, 1, "the halt is reported once, for signing");
  assert.deepEqual([halts[0].reason, halts[0].count, halts[0].limit, halts[0].tool], ["equivalent_calls", 5, 5, "Read"]);
  assert.ok(stops.some((s) => /loop breaker/.test(s)), "the run is stopped, so a runtime that obeys it ends");
});

test("an agent that repeats a call under varying arguments, or a few calls a few times each, is not halted", async () => {
  const files = ["a.ts", "b.ts", "c.ts"];
  const up = await upstream((n) => ({ name: "Read", args: { file_path: n < 20 ? `src/file-${n}.ts` : files[n % 3] } }));
  const { url, halts } = await gateway(up, { equivalentCalls: 5 });
  const results = [];
  for (let i = 0; i < 29; i++) results.push(await post(url));
  assert.ok(results.every(ranCall), "every call ran: twenty different files, then three files three times each");
  assert.equal(halts.length, 0);
});

test("a chain of spawns beyond the depth halts on the fourth in a row, and a call in between resets the chain", async () => {
  // (the breaker runs before the rules, so it counts spawn calls whatever the Mandate's scopes say about them)
  let up = await upstream((n) => ({ name: n === 2 ? "Read" : "Task", args: { prompt: `agent ${n}` } }));
  let r = await gateway(up, { depth: 3 });
  for (let i = 0; i < 8; i++) await post(r.url);
  assert.equal(r.halts.length, 1);
  assert.deepEqual([r.halts[0].reason, r.halts[0].count, r.halts[0].limit, r.halts[0].tool], ["depth", 4, 3, "Task"], "Task, Task, Read (resets), Task, Task, Task, then the fourth in a row halts");
  up = await upstream((n) => ({ name: n % 3 === 2 ? "Read" : "Task", args: { n } }));
  r = await gateway(up, { depth: 3 });
  for (let i = 0; i < 12; i++) await post(r.url);
  assert.equal(r.halts.length, 0, "two spawns and a read, again and again: never beyond the depth");
});

test("the daily token cap halts the run when the tokens the gateway relayed pass it", async () => {
  const up = await upstream((n) => ({ name: "Read", args: { file_path: `f${n}` } }), 40);
  const { url, halts, stops } = await gateway(up, { dailyTokens: 100 });
  const ran = []; for (let i = 0; i < 6; i++) ran.push(ranCall(await post(url)));
  assert.equal(ran[0], true);
  assert.ok(ran.slice(3).every((x) => !x), "past the cap nothing runs");
  assert.deepEqual([halts.length, halts[0].reason, halts[0].limit], [1, "token_cap", 100]);
  assert.ok(halts[0].count > 100, "the count is the tokens relayed, past the cap");
  assert.ok(stops.some((x) => /loop breaker/.test(x)));
});

test("without limits nothing is counted, and the breaker's own arithmetic is the same as the gateway's", () => {
  const none = new GatewayBreaker({});
  for (let i = 0; i < 50; i++) assert.equal(none.check("Read", { a: 1 }, 1e9), null);
  const b = new GatewayBreaker({ equivalentCalls: 3 });
  assert.equal(b.check("Read", { a: 1, b: 2 }, 0), null);
  assert.equal(b.check("Read", { b: 2, a: 1 }, 0), null, "argument order does not matter");
  assert.equal(b.check("Read", { a: 1, b: 2 }, 0)?.reason, "equivalent_calls", "the third equivalent call halts");
  assert.equal(b.check("Write", { x: 1 }, 0)?.reason, "equivalent_calls", "once halted, every call is refused");
});

test("the limits of a run are the Mandate's and the fleet ceiling's, whichever is lower, and a limit nobody states is absent", async () => {
  const { loopLimitsFrom } = await import("../src/agent-guards.ts");
  assert.deepEqual(loopLimitsFrom({}), {});
  assert.deepEqual(loopLimitsFrom({ loop_limits: { equivalent_calls: 8, depth: 3 }, token_budget: { per_day: 300000 } }), { equivalentCalls: 8, depth: 3, dailyTokens: 300000 });
  assert.deepEqual(loopLimitsFrom({ loop_limits: { equivalent_calls: 8 } }, { loop_limits: { equivalent_calls: 5, depth: 2 }, token_budget: { per_day: 100000 } }), { equivalentCalls: 5, depth: 2, dailyTokens: 100000 }, "the ceiling is lower, or the only one that states it");
  assert.deepEqual(loopLimitsFrom({ loop_limits: { equivalent_calls: 4 } }, { loop_limits: { equivalent_calls: 9 } }), { equivalentCalls: 4 });
});

test("a near-repeat loop (a counter in a URL) escapes the exact rule and is halted by the near rule at its limit on the real gateway", async () => {
  const up = await upstream((n) => ({ name: "Read", args: { file_path: `https://api.example.com/items/${1000 + n}/status` } }));
  const { url, halts } = await gateway(up, { equivalentCalls: 8, nearRepeats: 12 });
  const ran = []; for (let i = 0; i < 16; i++) ran.push(ranCall(await post(url)));
  assert.equal(ran.slice(0, 11).every(Boolean), true, "eleven near-equal calls run");
  assert.ok(ran.slice(11).every((x) => !x), "the twelfth and every later one is refused");
  assert.deepEqual([halts[0].reason, halts[0].count, halts[0].limit], ["near_repeat", 12, 12]);
});
