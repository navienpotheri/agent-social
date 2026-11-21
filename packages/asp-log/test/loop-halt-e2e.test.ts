// DK1230 (S1422), end to end: a scripted agent loops behind the real gateway under a Mandate whose limits come from the log; at the cap the gateway halts the run and the halt is signed into the log by the agent's key; from then on the
// agent's purchases under that Mandate are refused, so its credits stop draining. Real gateway, real log, fake keys.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { kit, mk, refusedBy } from "./society-kit.ts";
import { createGateway, type Gateway } from "../../asp-package/src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

test("a looping scripted agent is halted at the Mandate's cap, the halt is a signed log record, and its credits stop draining", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("e2e-sponsor", 10);
  const a = await k.agent("e2e-agent", sponsor, { funds: 400 });
  const mandate = await k.openMandate(a);
  const contract = ((await k.log.get(mandate))!.record.body as { contract: string }).contract;
  // the scripted agent: every model reply asks for the same tool call, and between replies it "spends" a credit at the Registry while it is allowed to
  const up = createServer(async (req, res) => { for await (const _ of req) void _; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 0 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "Read", arguments: JSON.stringify({ file_path: "same.txt" }) } }] } }] })); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const upUrl = `http://127.0.0.1:${(up.address() as { port: number }).port}`;
  const limit = 6;
  const signed: Promise<unknown>[] = [];
  const g = createGateway({
    openaiUpstream: `${upUrl}/v1`, anthropicUpstream: upUrl, scopes: ["repo.read"], maxStrikes: 100,
    loop: { equivalentCalls: limit, onHalt: (h: { reason: string; detail: string; count: number; limit: number; tool: string }) => { signed.push(k.log.append(mk("run_halt", a, { contract, agent: a.did, reason: h.reason, detail: h.detail, count: h.count, limit: h.limit, tool: h.tool }, null, { subject: contract }))); } },
  } as never);
  const port = await g.listen(); gateways.push(g);
  let drained = 0, iterations = 0;
  for (let i = 0; i < 40; i++) {
    iterations++;
    const reply = await (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) })).json() as { choices?: { message: { tool_calls?: unknown[] } }[] };
    await Promise.all(signed);
    if (!reply.choices?.[0]?.message?.tool_calls?.length) { if (await k.log.runHaltOf(contract)) break; continue; }
    // the agent acts on the call: it spends a credit under its Mandate
    if (!(await refusedBy(k.buy(a, "registry.name.claim", 10, { mandate })))) drained += 10;
  }
  assert.equal(iterations, limit, "the loop ran to the cap and the run stopped there (the reply that carried the 6th call was already refused)");
  assert.equal(drained, (limit - 1) * 10, "five equivalent calls ran and each cost 10 credits");
  const halt = await k.log.runHaltOf(contract);
  assert.ok(halt, "the halt is in the log");
  const rec = (await k.log.get(halt!))!.record as unknown as { issuer: string; body: { reason: string; limit: number } };
  assert.deepEqual([rec.issuer, rec.body.reason, rec.body.limit], [a.did, "equivalent_calls", limit], "signed by the agent's own key");
  const balance = await k.log.balance(a.did);
  assert.equal(await refusedBy(k.buy(a, "registry.name.claim", 10, { mandate })), "run_halted");
  assert.equal(await k.log.balance(a.did), balance, "credits stop draining");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
