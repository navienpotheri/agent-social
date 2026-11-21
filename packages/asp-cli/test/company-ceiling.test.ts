// Row DK1341 (spec-delta S1456): the company's own compute spending ceiling. `asp budget set --agent company --monthly-tokens n` caps what the operator's house agents may spend together; the run that would pass it is refused, the
// warning says so on the way, and an agent that is not a house agent is not counted. Fake agent and provider; fake keys.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createRecord } from "@agent-social/asp-core";
import { Keystore, openLog } from "@agent-social/asp-package";
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
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000", "--by", ALICE, "--reason", "bootstrap"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200", "--by", ALICE, "--reason", "bootstrap"]);
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


/** Marks the agent as a house agent: a passport update that adds the label, signed by its sponsor (the operator). */
async function makeHouse(f: Fixture) {
  const log = await openLog(f.aspHome, {});
  const head = (await log.log.passport(CODER))!.head;
  const body = { ...((await log.log.get(head))!.record.body as Record<string, unknown>), house: true };
  await log.append(createRecord({ type: "passport", issuer: ALICE, subject: CODER, prev: head, body, issued_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }, new Keystore(f.aspHome).forDid(ALICE)!));
}

test("the company ceiling stops a house agent's spending: it is warned on the way, the run that would pass the ceiling is refused with the ceiling named, and the page's spend check sees it", async () => {
  const before = process.env.ASP_OPERATOR_DID;
  process.env.ASP_OPERATOR_DID = ALICE;
  try {
    const f = makeFixture();
    const contract = await runningContract(f, ["repo.read"]);
    await makeHouse(f);
    assert.match((await ok(f, ["house", "list"])).out, /1 house agent/);
    const upstream = await provider();
    await ok(f, ["budget", "set", "--agent", "company", "--monthly-tokens", "25", "--warn-at", "50"]);
    const r1 = await gw(f, contract, upstream);
    assert.equal(r1.code, 0, r1.err);
    const r2 = await gw(f, contract, upstream);
    assert.equal(r2.code, 0, r2.err);
    assert.match(r2.err, /warning\s+the company's house agents has used 40% of its monthly cap|warning\s+the company's house agents has used 80% of its monthly cap/);
    const r3 = await gw(f, contract, upstream);
    assert.equal(r3.code, 0, r3.err);
    assert.match(r3.err, /warning\s+the company's house agents has reached its monthly cap: 30 of 25 tokens/);
    const r4 = await gw(f, contract, upstream);
    assert.notEqual(r4.code, 0, "the ceiling stops the spending");
    assert.match(r4.err, /refused\s+the company's compute ceiling: the monthly token cap for company is 25 and 30 are spent/);
    assert.match(r4.err, /asp budget set --agent company --monthly-tokens <n>/);
    // the operator raises it on purpose, and it runs again
    await ok(f, ["budget", "set", "--agent", "company", "--monthly-tokens", "1000"]);
    assert.equal((await gw(f, contract, upstream)).code, 0);
  } finally { if (before === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = before; }
});

test("an agent that is not a house agent is not counted against the company's ceiling", async () => {
  const before = process.env.ASP_OPERATOR_DID;
  process.env.ASP_OPERATOR_DID = ALICE;
  try {
    const f = makeFixture();
    const contract = await runningContract(f, ["repo.read"]);
    const upstream = await provider();
    await ok(f, ["budget", "set", "--agent", "company", "--monthly-tokens", "5"]);
    for (let i = 0; i < 3; i++) assert.equal((await gw(f, contract, upstream)).code, 0, "a real person's agent is not the company's spending");
    assert.match((await ok(f, ["wakes", "--agent", "company"])).out, /no wake|^$/);
  } finally { if (before === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = before; }
});
