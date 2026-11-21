// DK1471 (docs/gateway-design.md section 9): the gateway enforces a fleet's Mandate template for a member whose Mandate record is wider (made before the template), picks up an amendment at the next
// run, applies the member's own narrowing, and refuses the next model call when a node on its path is over its token budget. The refusals are in `asp runs`. Fake keys and a stand-in provider only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ORG = "did:web:example.com:orgs:acme", ALICE = "did:web:example.com:users:alice", BANK = "did:web:example.com:bank", CODER = "did:web:example.com:agents:acme-coder";
const FLEET = `${ORG}:fleets:coders`;
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

const TEMPLATE = { purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 1000, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 2 }, learning: { scope: "memory", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true };

/** A provider that asks for one read (the template allows it) and one push (the Mandate record allows it, the template does not). */
async function provider() {
  let calls = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    calls++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 7, completion_tokens: 3 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } },
        { id: "b", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git push origin main" }) } },
      ] } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, calls: () => calls };
}
const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) });
console.log("AGENT STATUS:" + r.status);
`;

async function setup() {
  const f = makeFixture();
  for (const d of [ORG, ALICE, BANK]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
  await ok(f, ["fleet", "declare", "--org", ORG, "--name", "Coders", "--purpose", "ship code"]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ORG, "--fleet", FLEET, "--purpose", "Fix the flaky test"]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2040-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2040-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  // The Mandate record is made before the fleet has a template, and is wider than the template will be.
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--scopes", "repo.push"]);
  return { f, contract };
}
const template = async (f: Fixture, over: Record<string, unknown>) => {
  const file = join(f.root, "template.json");
  writeFileSync(file, JSON.stringify({ ...TEMPLATE, ...over }));
  await ok(f, ["fleet", "template", "set", "--did", FLEET, "--file", file]);
};
const run = async (f: Fixture, contract: string, upstream: string) => asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT]);

test("DK1471: a call outside the fleet's template is refused naming the template, though the member's Mandate record is wider; an amendment is picked up at the next run; a narrowing applies", async () => {
  const { f, contract } = await setup();
  const up = await provider();
  // Before the template exists the Mandate record is all there is: the push is allowed.
  const before = await run(f, contract, up.url);
  assert.equal(before.code, 0, before.err);
  assert.match(before.err, /allowed {2}bash -> repo\.push/);
  // The template allows repo.read only: the push is refused for this member, naming the template.
  await template(f, { scopes: ["repo.read"] });
  const r1 = await run(f, contract, up.url);
  assert.equal(r1.code, 0, r1.err);
  assert.match(r1.err, /ceiling {2}fleet Mandate template .*version 1 bounds this member: repo\.push is in its Mandate record but outside the template/);
  assert.match(r1.err, /allowed {2}read_file -> repo\.read/);
  assert.match(r1.err, /REFUSED {2}bash -> repo\.push: the scope repo\.push is outside the fleet Mandate template .*version 1, which bounds this member whatever its Mandate record says/);
  assert.match(r1.err, /Article 6/);
  // The refusal is in the run log, which the Action commits to, and `asp run` lists REFUSED lines in `asp runs` (the same lines this test reads from the gateway's output).
  const log = /run log {2}(\S.*)$/m.exec(r1.err)?.[1]?.trim();
  assert.ok(log && existsSync(log), "the run log is on this machine");
  assert.match(readFileSync(log!, "utf8"), /outside the fleet Mandate template/);
  assert.match(readFileSync(log!, "utf8"), /"fleet_ceiling"/);
  // An amendment (version 2) allows the push: the next run picks it up.
  await template(f, { scopes: ["repo.read", "repo.push"] });
  const r2 = await run(f, contract, up.url);
  assert.match(r2.err, /allowed {2}bash -> repo\.push/);
  assert.doesNotMatch(r2.err, /REFUSED/);
  // The member narrows its own Mandate: the push is refused again, by the template as narrowed.
  const nf = join(f.root, "narrow.json");
  writeFileSync(nf, JSON.stringify({ scopes: ["repo.read"] }));
  await ok(f, ["fleet", "narrow", "--member", CODER, "--file", nf]);
  const r3 = await run(f, contract, up.url);
  assert.match(r3.err, /REFUSED {2}bash -> repo\.push: the scope repo\.push is outside the fleet Mandate template/);
  assert.match(r3.err, /allowed {2}read_file -> repo\.read/);
});

test("DK1471: a node over its token budget refuses the next model call, and the refusal is in the run's summary", async () => {
  const { f, contract } = await setup();
  await template(f, { scopes: ["repo.read", "repo.push"] });
  await ok(f, ["fleet", "node", "set", "--did", FLEET, "--node", "root", "--kind", "fleet", "--name", "Acme", "--owner", ORG, "--tokens", "5"]);
  const up = await provider();
  // The first run is within the budget when it starts, and reports 10 tokens: over 5.
  const r1 = await run(f, contract, up.url);
  assert.equal(r1.code, 0, r1.err);
  assert.doesNotMatch(r1.err, /REFUSED {2}model request/);
  assert.equal(up.calls(), 1);
  const r2 = await run(f, contract, up.url);
  assert.match(r2.err, /ceiling {2}node root of fleet .* has used 10 tokens of its 5 this month/);
  assert.match(r2.err, /REFUSED {2}model request -> model\.tokens: ASP gateway: the next model call is refused: node root/);
  assert.equal(up.calls(), 1, "the provider was not called: the model request never left the gateway");
  // Raising the budget lets the next run through.
  await ok(f, ["fleet", "node", "set", "--did", FLEET, "--node", "root", "--kind", "fleet", "--name", "Acme", "--owner", ORG, "--tokens", "5000"]);
  const r3 = await run(f, contract, up.url);
  assert.doesNotMatch(r3.err, /REFUSED {2}model request/);
  assert.equal(up.calls(), 2);
});
