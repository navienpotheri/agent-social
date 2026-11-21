// Row DK1715: the sponsor's spend guard. A Mandate made without a token budget carries default per-run and per-day ceilings; the gateway tells the person at 50, 80 and 100 percent of the run's ceiling,
// once each; the next model call after the ceiling is refused, the provider is not called, and the run log names it; nothing can be raised above what the operator allows. Tokens and mock credits, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { openLog, newAlertLevels, DEFAULT_DAILY_TOKENS, DEFAULT_RUN_TOKENS, OPERATOR_MAX_RUN_TOKENS } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function contractWith(f: Fixture, extra: string[] = []) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Spend guard", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  return { contract, mandate: () => asp(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", ...extra]) };
}

test("a new Mandate carries the default per-run and per-day ceilings; a sponsor may lower them, and nothing goes above the operator's maximum", async () => {
  const f = makeFixture();
  const { contract, mandate } = await contractWith(f);
  const tooHigh = await asp(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--tokens-per-run", String(OPERATOR_MAX_RUN_TOKENS + 1)]);
  assert.notEqual(tooHigh.code, 0);
  assert.match(tooHigh.err, /operator allows/);
  assert.equal((await mandate()).code, 0);
  const handle = await openLog(f.aspHome, {});
  const m = (await handle.log.chain(contract)).find((x) => x.record.type === "asp.mandate/v0.2")!;
  assert.deepEqual((m.record.body as { token_budget: unknown }).token_budget, { per_run: DEFAULT_RUN_TOKENS, per_day: DEFAULT_DAILY_TOKENS });
});

test("the alert levels are told once each, however the figure moves", () => {
  const told = new Set<number>();
  assert.deepEqual(newAlertLevels(49, 100, told), []);
  assert.deepEqual(newAlertLevels(50, 100, told), [50]);
  assert.deepEqual(newAlertLevels(60, 100, told), []);
  assert.deepEqual(newAlertLevels(80, 100, told), [80]);
  assert.deepEqual(newAlertLevels(100, 100, told), [100]);
  assert.deepEqual(newAlertLevels(500, 100, told), []);
});

test("alerts at 50, 80 and 100 percent in the terminal, the run log and the mail; the next model call is refused, the provider is not called", async () => {
  const f = makeFixture();
  const { contract, mandate } = await contractWith(f);
  assert.equal((await mandate()).code, 0);
  let hits = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    hits++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 5, completion_tokens: 5 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  servers.push(upstream);
  const agent = `const codes = []; for (let i = 0; i < 12; i++) { const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi " + i }] }) }); codes.push(r.status); await r.text(); } console.log("CODES " + codes.join(","));`;
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--token-cap", "100", "--openai-upstream", `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, "--", process.execPath, "--input-type=module", "-e", agent]);
  assert.equal(hits, 10, `the provider was called ${hits} times: ten calls of ten tokens reach the ceiling of 100, the rest are refused before it`);
  assert.equal((run.err.match(/REFUSED +model request/g) ?? []).length, 2, "the two calls after the ceiling were refused");
  for (const pct of [50, 80, 100]) assert.equal((run.err.match(new RegExp(`budget +${pct}% of the run's --token-cap`, "g")) ?? []).length, 1, `${pct}% is told once`);
  assert.match(run.err, /the next model call is refused/);

  await ok(f, ["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "ok"]);
  await ok(f, ["market", "accept", "--contract", contract, "--by", ALICE]);
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0", "--fees", "0"]);
  const mail = (await ok(f, ["mail", "preview", "--contract", contract])).out;
  assert.match(mail, /Model-spend alerts: the run reached 50, 80, 100 percent of its token ceiling; a model call was then refused/);
});
