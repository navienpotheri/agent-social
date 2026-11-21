// Row DK1769: a cap across all of one sponsor's agents (asp budget set --agent sponsor:<did> --monthly-tokens n): the runs of two agents of one sponsor share it, and the run that would pass it is refused with the sponsor
// named; another sponsor is not affected. Fake agent and provider; fake keys.
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

async function runningContract(f: Fixture, agent: string, first: boolean) {
  if (first) { await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]); await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]); await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "3000"]); }
  await ok(f, ["identity", "new", "--kind", "agent", "--did", agent, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["credits", "grant", "--to", agent, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", agent, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", agent, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", agent, "--scopes", "repo.read"]);
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
const gw = (f: Fixture, contract: string, upstream: string, by = CODER) =>
  asp(f, ["gateway", "--contract", contract, "--by", by, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT]);

const SECOND = "did:web:example.com:agents:reviewer";

test("two agents of one sponsor share the sponsor's monthly cap: the run that would pass it is refused with the sponsor named", async () => {
  const f = makeFixture();
  const c1 = await runningContract(f, CODER, true);
  const c2 = await runningContract(f, SECOND, false);
  const upstream = await provider();
  await ok(f, ["budget", "set", "--agent", `sponsor:${ALICE}`, "--monthly-tokens", "25"]);
  assert.equal((await gw(f, c1, upstream, CODER)).code, 0);
  assert.equal((await gw(f, c2, upstream, SECOND)).code, 0);
  const third = await gw(f, c1, upstream, CODER);
  assert.equal(third.code, 0, "ten tokens are left; the run is capped by them");
  const fourth = await gw(f, c2, upstream, SECOND);
  assert.notEqual(fourth.code, 0);
  assert.match(fourth.err, /the sponsor's cap across all their agents \(did:web:example\.com:users:alice\): the monthly token cap for sponsor:did:web:example\.com:users:alice is 25/);
});

test("without a sponsor cap nothing is refused, and a cap on another sponsor does not touch this one", async () => {
  const f = makeFixture();
  const c1 = await runningContract(f, CODER, true);
  const upstream = await provider();
  await ok(f, ["budget", "set", "--agent", "sponsor:did:web:example.com:users:someone-else", "--monthly-tokens", "5"]);
  for (let i = 0; i < 4; i++) { const r = await gw(f, c1, upstream, CODER); assert.equal(r.code, 0, r.err); }
});
