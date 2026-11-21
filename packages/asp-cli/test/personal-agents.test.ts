// DK1364: the personal-agent runtimes a person may bring in, each tested on ASP's side of its path with a stand-in. This proves the protocol side only: no real product was run, so no runtime is listed as live
// and the docs and the site list none. Fake keys; mock credits.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogServer } from "@agent-social/asp-log";
import { AgentReporter, Keystore, LocalLog, MandateRefusal, PERSONAL_AGENTS, firstMinute } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:coder", BANK = "did:web:example.com:bank";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const root = fileURLToPath(new URL("../../..", import.meta.url));

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
async function runningContract(f: Fixture, scopes: string[]) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "A personal agent"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Work", "--budget", "1000", "--deadline", "2040-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2040-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s])]);
  return contract;
}

test("the list is honest: every way claims only what it can give, a stand-in row names a test that exists, nothing is live, and the docs and the site list no runtime by name as supported", () => {
  for (const a of PERSONAL_AGENTS) {
    if (a.way === "gateway") assert.deepEqual([a.assurance, a.preventsCalls], ["gateway_enforced", true], `${a.name}: behind the gateway a call is removed before the agent sees it`);
    else assert.deepEqual([a.assurance, a.preventsCalls], ["runtime_observed", false], `${a.name}: a hosted agent is observed, nothing is prevented`);
    assert.notEqual(a.evidence.level, "live", `${a.name}: no real run is recorded`);
    if (a.evidence.level === "stand-in") assert.ok(existsSync(join(root, a.evidence.test)), `${a.name}: ${a.evidence.test} exists`);
    assert.ok(firstMinute(a).join("\n").includes(a.evidence.level === "live" ? "evidence live" : "no real run is recorded") || a.evidence.level === "none", `${a.name}: the first minute says what is not verified`);
  }
  assert.ok(PERSONAL_AGENTS.some((a) => a.way === "cannot-be-wrapped"), "a runtime that cannot be wrapped is listed as such");
  for (const f of ["README.md", "site/llms.txt", "docs/commands.md"]) {
    const text = readFileSync(join(root, f), "utf8");
    for (const a of PERSONAL_AGENTS) assert.ok(!new RegExp(`supported[^.\\n]*${a.title.split(" ")[0]}`, "i").test(text), `${f} does not say ${a.title} is supported`);
  }
});

test("asp runtimes personal lists them with the way and the evidence, prints each one's first minute, and refuses a name it does not know", async () => {
  const f = makeFixture();
  const list = await ok(f, ["runtimes", "personal"]);
  for (const a of PERSONAL_AGENTS) assert.match(list.out, new RegExp(`${a.name} +${a.way} +${a.assurance} +evidence ${a.evidence.level}`));
  assert.match(list.out, /Only a runtime with a live row is listed in the docs and on the site; none is yet/);
  assert.match((await ok(f, ["runtimes", "personal", "openclaw"])).out, /behind the gateway.*\n.*asp join[\s\S]*asp gateway --contract/);
  assert.match((await ok(f, ["runtimes", "personal", "manus"])).out, /through the front door[\s\S]*asp enrol --service[\s\S]*self-report SDK/);
  assert.match((await ok(f, ["runtimes", "personal", "instinct"])).out, /cannot be wrapped/);
  assert.notEqual((await asp(f, ["runtimes", "personal", "nope"])).code, 0);
});

const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) });
await r.json();
`;
test("the gateway path, for each local agent: a stand-in that sets its model endpoint to the gateway has its tool call outside the Mandate removed before it sees it", async () => {
  const provider = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 5, completion_tokens: 2 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
      { id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } },
      { id: "b", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git push origin main" }) } }] } }] }));
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  servers.push(provider);
  const upstream = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
  for (const a of PERSONAL_AGENTS.filter((x) => x.way === "gateway")) {
    const f = makeFixture();
    const contract = await runningContract(f, ["repo.read"]);
    const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT]);
    assert.equal(run.code, 0, `${a.name}: ${run.err}`);
    assert.match(run.err, /allowed {2}read_file -> repo\.read/, a.name);
    assert.match(run.err, /REFUSED {2}bash -> repo\.push/, `${a.name}: the push is refused before the agent sees it`);
  }
});

test("the front-door path, for each hosted agent: it reads its live Mandate, is refused out of scope, and signs its own Action as self_reported, which the log records", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const handle = await LocalLog.open(f.aspHome);
  const server = createLogServer({ handle, tenants: [], noAuth: true });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const signer = new Keystore(f.aspHome).forDid(CODER)!;
  for (const a of PERSONAL_AGENTS.filter((x) => x.way === "front-door")) {
    const reporter = AgentReporter.remote({ url, agent: CODER, signer, contract });
    assert.equal(await reporter.guard("repo.read", () => `${a.name} read it`), `${a.name} read it`);
    await assert.rejects(reporter.guard("repo.push", () => undefined), (e: Error) => e instanceof MandateRefusal);
    const res = await reporter.flush(`a stand-in for ${a.title} answered the customer`);
    assert.ok(res?.id, `${a.name}: the Action is in the log`);
  }
  const actions = (await handle.log.since(0, 1000)).filter((s) => s.record.type === "asp.action/v0.2" && (s.record.body as { contract?: string }).contract === contract);
  assert.equal(actions.length, PERSONAL_AGENTS.filter((x) => x.way === "front-door").length);
  assert.ok(actions.every((s) => (s.record.body as { assurance?: string }).assurance === "self_reported"), "the weakest level, said as such");
});
