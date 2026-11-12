import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { signerFromSeed, randomSeed } from "@agent-social/asp-core";
import { createGateway, type Gateway } from "@agent-social/asp-package";
import { priceView, spendCmd, standingNote } from "../src/spend.ts";

// DK4: the agent sees its balance, its standing and the price of a service inside its loop. The reads are the real ones (spend.ts) over a fake log; the gateway is the real gateway; the fake agent talks to it
// over HTTP like a runtime does: it lists and calls the tools of the `asp` MCP server, then makes a model request, and a fake provider records what it was sent.
const AGENT = "did:web:example.com:agents:learner";
const ACADEMY = "did:web:asp.local:academy";
const split = { treasury_permille: 100, burn_permille: 100, payees: [{ account: ACADEMY, permille: 800 }] };
const LIST = { id: "list-1", body: { version: 1, effective_from: "2026-11-02T00:00:00Z", job_tax_permille: 20, items: [
  { service: "academy.exam.sit", institution: ACADEMY, price: 30, split, class: "standard" },
  { service: "academy.foundations.first", institution: ACADEMY, price: 10, split, class: "essential" },
] } };
const NEXT = { id: "list-2", body: { version: 2, effective_from: "2026-11-20T00:00:00Z", job_tax_permille: 20, items: [{ service: "academy.exam.sit", institution: ACADEMY, price: 35, split, class: "standard" }] } };
const MANDATE = { id: "m1", type: "asp.mandate/v0.2", issuer: "did:web:example.com:users:sponsor", subject: AGENT, issued_at: "2026-11-01T00:00:00Z", body: { expires: "2027-01-01T00:00:00Z", institution_spend: [{ institution: "academy", cap: { value: 60, unit: "credit" }, period: "month" }] } };
const SPENT = { id: "p1", type: "asp.purchase/v0.2", issuer: AGENT, issued_at: "2026-11-03T10:00:00Z", body: { institution: ACADEMY, amount: { value: 30, unit: "credit" } } };

const fakeLog = (tier: number, balance: number, purchases: unknown[] = []) => ({
  log: { mandatesOf: async () => [MANDATE], purchasesBy: async () => purchases, priceLists: async () => [LIST, NEXT], balance: async () => balance, reputationOf: async () => ({ tier, slashCount: 0, strikes: 0 }) },
  append: async () => ({ id: "x", seq: 1 }),
});
const opts = (log: unknown, out: (l: string) => void = () => undefined) => ({ log: log as never, io: { out }, now: () => "2026-11-12T12:00:00Z", flags: { by: AGENT, mandate: "m1" }, signerFor: () => signerFromSeed(AGENT + "#key-1", randomSeed()) as never });

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

async function provider() {
  const seen: any[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    seen.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen };
}
const rpc = async (url: string, method: string, params?: unknown) => ((await (await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as any).result;

async function run(log: ReturnType<typeof fakeLog>) {
  const up = await provider();
  const lines = async (f: (out: (l: string) => void) => Promise<number>) => { const out: string[] = []; await f((l) => out.push(l)); return out.join("\n"); };
  const society = {
    standing: async () => [`credits: ${await log.log.balance()}`, await lines((out) => spendCmd(AGENT, [], opts(log, out)))].join("\n"),
    price: (service: string | undefined) => priceView(service, opts(log)),
  };
  const note = await standingNote(opts(log));
  const g = createGateway({ openaiUpstream: `${up.url}/v1`, scopes: ["repo.read"], mcp: { asp: { society } }, lawContext: note });
  const port = await g.listen();
  gateways.push(g);
  const base = `http://127.0.0.1:${port}`;
  return { base, up, note, call: async (name: string, args: unknown) => (await rpc(`${base}/mcp/asp`, "tools/call", { name, arguments: args })).content[0].text as string };
}

test("a fake agent reads its balance and the price of a course through the tools, and the standing note is in the request the model receives", async () => {
  const w = await run(fakeLog(1, 120, [SPENT]));
  const tools = ((await rpc(`${w.base}/mcp/asp`, "tools/list")).tools as { name: string }[]).map((t) => t.name);
  assert.ok(tools.includes("asp_standing") && tools.includes("asp_price"));
  assert.ok(!tools.includes("asp_buy"), "no key in this run, so no buying");

  assert.match(await w.call("asp_standing", {}), /credits: 120/);
  const price = await w.call("asp_price", { service: "academy.exam.sit" });
  assert.match(price, /academy\.exam\.sit\s+30\s+standard/, "the price in force");
  assert.match(price, /treasury 100, burn 100/, "how the price is split");
  assert.match(price, /announced: version 2 takes effect 2026-11-20/, "the change that is coming");
  assert.match(price, /for you: 120 credits; tier 1; standard item/);
  assert.match(price, /budget: 30 of 60 left this month for academy/, "what the Mandate's budget has left for it");
  assert.match(price, /after one purchase you would have 90 credits/);
  assert.match(price, /Only asp_buy spends your credits; every other tool call costs you none/, "the cost of the other actions");
  const list = await w.call("asp_price", {});
  assert.match(list, /academy\.exam\.sit[\s\S]*academy\.foundations\.first/, "with no service, the whole list");

  // The note is in the system context of the model request, within 200 characters, from the log.
  assert.ok(w.note.length <= 200, `${w.note.length} characters`);
  assert.match(w.note, /^Credits 120 .*Tier 1, 0 slashes, 0 strikes\. Budget left: academy 30\/month/);
  await fetch(`${w.base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "start" }] }) });
  const sent = w.up.seen.at(-1) as { messages: { role: string; content: string }[] };
  assert.equal(sent.messages[0].role, "system");
  assert.equal(sent.messages[0].content, w.note, "the model is told the standing note");
});

test("the price tells the agent what it cannot do: a tier 0 agent sees a standard item is closed, an item outside the Mandate needs the sponsor, a short balance says by how much", async () => {
  const w = await run(fakeLog(0, 12));
  const exam = await w.call("asp_price", { service: "academy.exam.sit" });
  assert.match(exam, /a tier 0 agent may buy only essential or remedial items/);
  assert.match(exam, /18 short of one purchase/);
  const first = await w.call("asp_price", { service: "academy.foundations.first" });
  assert.match(first, /essential item/);
  assert.match(first, /needs no budget line/);
  assert.match(first, /after one purchase you would have 2 credits/);
  assert.match(await w.call("asp_price", { service: "academy.nope" }), /no service or institution named academy\.nope/);
  const noBudget = fakeLog(1, 100);
  noBudget.log.mandatesOf = async () => [{ ...MANDATE, body: { expires: "2027-01-01T00:00:00Z", institution_spend: [{ institution: "shops", cap: { value: 40, unit: "credit" }, period: "month" }] } }];
  assert.match(await (await run(noBudget)).call("asp_price", { service: "academy.exam.sit" }), /your Mandate's institution_spend does not cover this: ask your sponsor to widen it/);
});

test("the note stays within 200 characters however long the budget is", async () => {
  const log = fakeLog(2, 123456);
  log.log.mandatesOf = async () => [{ ...MANDATE, body: { expires: "2027-01-01T00:00:00Z", institution_spend: ["academy", "shops", "market", "courts", "registry", "clinic"].map((i) => ({ institution: i, cap: { value: 50, unit: "credit" }, period: "month" })) } }];
  const note = await standingNote(opts(log));
  assert.equal(note.length, 200);
  assert.match(note, /\.\.\.$/);
});
