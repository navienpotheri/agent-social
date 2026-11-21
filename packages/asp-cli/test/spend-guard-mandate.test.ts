// Row DK1715, on top of the gateway's alerts and hard stop (spend-guard.test.ts): a new Mandate carries the default per-run and per-day token ceilings, the Mandate's own per-run budget is
// enforced by the gateway, a figure above what the operator allows is refused, and the end mail says when a run reached its ceiling. Tokens, never money; credits are mock.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { DEFAULT_DAY_TOKENS, DEFAULT_RUN_TOKENS, OPERATOR_MAX_RUN_TOKENS } from "../src/spend-guard.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function contractFor(f: Fixture) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Ceiling", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  return contract;
}
const mandate = (f: Fixture, contract: string, extra: string[] = []) => asp(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", ...extra]);
const budgetOf = async (f: Fixture, contract: string) => {
  const h = await openLog(f.aspHome, {});
  return ((await h.log.chain(contract)).find((x) => x.record.type === "asp.mandate/v0.2")!.record.body as { token_budget?: unknown }).token_budget;
};

test("a new Mandate carries the default per-run and per-day ceilings; the sponsor may lower them; a figure above the operator's maximum is refused", async () => {
  const f = makeFixture();
  const contract = await contractFor(f);
  const tooHigh = await mandate(f, contract, ["--tokens-per-run", String(OPERATOR_MAX_RUN_TOKENS + 1)]);
  assert.notEqual(tooHigh.code, 0);
  assert.match(tooHigh.err, /operator allows/);
  assert.equal((await mandate(f, contract)).code, 0);
  assert.deepEqual(await budgetOf(f, contract), { per_run: DEFAULT_RUN_TOKENS, per_day: DEFAULT_DAY_TOKENS });

  const g = makeFixture();
  const c2 = await contractFor(g);
  assert.equal((await mandate(g, c2, ["--tokens-per-run", "5000", "--tokens-per-day", "9000"])).code, 0);
  assert.deepEqual(await budgetOf(g, c2), { per_run: 5000, per_day: 9000 });
});

test("the gateway keeps to the Mandate's per-run budget: the next model call after it is refused, the provider is not called, and the end mail says so", async () => {
  const f = makeFixture();
  const contract = await contractFor(f);
  assert.equal((await mandate(f, contract, ["--tokens-per-run", "30"])).code, 0);
  let hits = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    hits++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 5, completion_tokens: 5 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  servers.push(upstream);
  const agent = `for (let i = 0; i < 5; i++) { const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi " + i }] }) }); await r.text(); }`;
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, "--", process.execPath, "--input-type=module", "-e", agent]);
  assert.match(run.err, /the Mandate's token budget for one run is 30: using it/);
  assert.equal(hits, 3, "three calls of ten tokens reach the Mandate's 30; the other two were refused before the provider");
  assert.match(run.err, /this run has used all 30 tokens of its ceiling/);

  await ok(f, ["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "ok"]);
  await ok(f, ["market", "accept", "--contract", contract, "--by", ALICE]);
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0", "--fees", "0"]);
  const mail = (await ok(f, ["mail", "preview", "--contract", contract])).out;
  assert.match(mail, /Model-spend ceiling: the run reached 50, 80, 100 percent of its token ceiling; a model call was then refused/);
});
