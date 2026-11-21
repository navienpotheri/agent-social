// Row DK1476 (spec-delta S1421): the Mandate's own token_budget.per_month is kept by the gateway from the metered tokens: a run that reaches it is capped and the next run is refused with the cap named, with no standing
// cap set. A standing cap that is lower wins. Fake agent and provider; fake keys.
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

async function runningContract(f: Fixture, scopes: string[], extra: string[] = []) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s]), ...extra]);
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

test("the Mandate's per-month token budget is kept by the gateway: the run that reaches it ends, the next is refused with the cap named, and no standing cap was set", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"], ["--tokens-per-month", "25"]);
  const upstream = await provider();
  for (let i = 0; i < 3; i++) { const r = await gw(f, contract, upstream); assert.equal(r.code, 0, r.err); }
  const refused = await gw(f, contract, upstream);
  assert.notEqual(refused.code, 0);
  assert.match(refused.err, /monthly token cap for did:web:example\.com:agents:coder is 25 and 30 are spent/);
});

test("a standing cap that is lower than the Mandate's wins, and without either nothing is refused", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"], ["--tokens-per-month", "1000"]);
  const upstream = await provider();
  await ok(f, ["budget", "set", "--agent", CODER, "--monthly-tokens", "15"]);
  assert.equal((await gw(f, contract, upstream)).code, 0);
  assert.equal((await gw(f, contract, upstream)).code, 0);
  assert.match((await gw(f, contract, upstream)).err, /monthly token cap for .* is 15/);
  const g = makeFixture();
  const c2 = await runningContract(g, ["repo.read"]);
  for (let i = 0; i < 4; i++) assert.equal((await gw(g, c2, upstream)).code, 0);
});
