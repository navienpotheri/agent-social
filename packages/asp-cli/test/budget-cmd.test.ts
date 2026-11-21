// Row US2 (spec-delta S1454): `asp budget set|show` and `asp forecast --contract`: a standing cap for each agent kept by every run, warnings as a run starts and ends, the monthly cap refusing a run with the cap named,
// a flag on a run winning over the stored daily cap, and the job forecast. Fake agent and provider; fake keys.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function runningContract(f: Fixture, scopes: string[]) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s])]);
  return contract;
}

/** A model provider whose every reply uses 10 tokens. */
async function provider() {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 7, completion_tokens: 3 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } }] } }],
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}

const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) });
await r.json();
`;
const gw = (f: Fixture, contract: string, upstream: string, extra: string[] = []) =>
  asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, ...extra, "--", process.execPath, "--input-type=module", "-e", AGENT]);

test("a standing monthly cap set once is kept by every run: warnings as a run starts and ends, the run that reaches it is capped, the next is refused with the cap named", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const set = await ok(f, ["budget", "set", "--agent", CODER, "--monthly-tokens", "25", "--warn-at", "50"]);
  assert.match(set.out, /monthly cap 25 tokens.*warning at 50%.*Every run of this agent keeps to it/);
  // Each run spends 10 tokens. Run 1 ends at 10 (40%): no warning. Run 2 starts at 40% (below 50) and ends at 20 (80%): a warning as it ends.
  const r1 = await gw(f, contract, upstream);
  assert.equal(r1.code, 0, r1.err);
  assert.doesNotMatch(r1.err, /^ {2}warning {2}/m);
  const r2 = await gw(f, contract, upstream);
  assert.equal(r2.code, 0, r2.err);
  assert.equal((r2.err.match(/^ {2}warning {2}/gm) ?? []).length, 1, "one warning, as it ends: " + r2.err);
  assert.match(r2.err, /warning\s+did:web:example\.com:agents:coder has used 80% of its monthly cap: 20 of 25 tokens, 5 left/);
  // Run 3 starts with the warning, is allowed (5 left), and ends over the cap
  const r3 = await gw(f, contract, upstream);
  assert.equal(r3.code, 0, r3.err);
  assert.match(r3.err, /warning\s+.*has used 80% of its monthly cap/, "told as it starts");
  assert.match(r3.err, /warning\s+.*has reached its monthly cap: 30 of 25 tokens/, "and when it ends over the cap");
  // Run 4 is refused with the cap named
  const r4 = await gw(f, contract, upstream);
  assert.notEqual(r4.code, 0);
  assert.match(r4.err, /monthly token cap for did:web:example\.com:agents:coder is 25 and 30 are spent in \d{4}-\d{2} \(UTC\)/);
  assert.match(r4.err, /asp budget set --agent did:web:example\.com:agents:coder --monthly-tokens <n>/);
  assert.match((await ok(f, ["wakes", "--agent", CODER])).out, /1 refused \(monthly_tokens\)/);
  // show tells where it stands
  const show = await ok(f, ["budget", "show", "--agent", CODER]);
  assert.match(show.out, /month\s+30 tokens of 25 \(120%\); at this pace [\d,]+ by the end of \d{4}-\d{2}, OVER the cap/);
  assert.match(show.out, /credits\s+0 spent this month on the society's services/);
  assert.match(show.out, /WARNING\s+.*reached its monthly cap/);
  assert.match(show.out, /Tokens, never a price/);
  const json = JSON.parse((await ok(f, ["budget", "show", "--agent", CODER, "--json"])).out);
  assert.equal(json[0].tokensMonth, 30); assert.equal(json[0].budget.monthlyTokens, 25); assert.equal(json[0].projectedOver, true);
  // raising the cap lets it run again
  await ok(f, ["budget", "set", "--agent", CODER, "--monthly-tokens", "1000"]);
  assert.equal((await gw(f, contract, upstream)).code, 0);
  // the file is the person's, in the home, and holds no secret
  const file = join(f.aspHome, "budgets.json");
  assert.ok(existsSync(file));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { [CODER]: { monthlyTokens: 1000, warnPercent: 50 } });
});

test("a standing daily cap is kept by every run, and a flag on a run wins for that run", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  await ok(f, ["budget", "set", "--agent", CODER, "--daily-tokens", "15"]);
  assert.equal((await gw(f, contract, upstream)).code, 0);
  assert.equal((await gw(f, contract, upstream)).code, 0, "10 spent, 5 left: it runs, capped");
  const refused = await gw(f, contract, upstream);
  assert.notEqual(refused.code, 0, "no flag on the run: the stored cap refuses it");
  assert.match(refused.err, /daily token ceiling for did:web:example\.com:agents:coder is 15/);
  const flagged = await gw(f, contract, upstream, ["--daily-tokens", "1000"]);
  assert.equal(flagged.code, 0, "a flag on this run wins over the stored cap");
  await ok(f, ["budget", "set", "--agent", CODER, "--daily-tokens", "off"]);
  assert.equal((await gw(f, contract, upstream)).code, 0);
  assert.match((await ok(f, ["budget", "show"])).out, /no agent has a standing budget yet/);
});

test("budget set and show say what to type, refuse nonsense and change nothing, and an agent with no budget is not capped", async () => {
  const f = makeFixture();
  const bad = async (args: string[], re: RegExp) => { const r = await asp(f, args); assert.notEqual(r.code, 0, args.join(" ")); assert.match(r.err, re, args.join(" ")); };
  await bad(["budget", "set"], /asp budget set --agent <did>/);
  await bad(["budget", "set", "--agent", CODER], /name a cap to set/);
  await bad(["budget", "set", "--agent", CODER, "--daily-tokens", "0"], /whole number, at least 1/);
  await bad(["budget", "set", "--agent", CODER, "--daily-tokens", "ten"], /whole number, at least 1/);
  await bad(["budget", "set", "--agent", CODER, "--warn-at", "100"], /1 to 99/);
  await bad(["budget", "set", "--agent", CODER, "--daily-tokens", "500", "--monthly-tokens", "100"], /above the monthly cap of 100/);
  await bad(["budget", "frobnicate"], /asp budget set \| show/);
  assert.equal(existsSync(join(f.aspHome, "budgets.json")), false, "nothing was written");
  assert.match((await ok(f, ["budget", "show"])).out, /no agent has a standing budget yet: asp budget set --agent/);
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  for (let i = 0; i < 3; i++) assert.equal((await gw(f, contract, upstream)).code, 0, "no budget, no cap");
});

test("asp forecast --contract says what is at stake in credits for one job and what a session of its performer has used; an unknown contract is refused", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const out = (await ok(f, ["forecast", "--contract", contract])).out;
  assert.match(out, new RegExp(`job ${contract.slice(0, 15)}: ${CODER} for ${ALICE}, Running`));
  assert.match(out, /price\s+1,000 credits/);
  assert.match(out, /at stake\s+1,000 credits in escrow \(paid by did:web:example\.com:users:alice\) and 200 as the performer's bond.*returned if the job is delivered and accepted, the bond slashed if it is lost/);
  assert.match(out, /no finished session of coder on this machine in the last 14 days to forecast tokens from/);
  assert.match(out, /Tokens, never a price.*Credits are accounting entries, not money/);
  const bad = await asp(f, ["forecast", "--contract", "sha256:" + "0".repeat(64)]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /is not a contract in the log/);
});
