import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createLogServer } from "@agent-social/asp-log";
import { AgentReporter, Keystore, LocalLog, MandateRefusal } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function setup(scopes: string[]) {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "A hosted agent"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Work", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s]), ...(scopes.some((s) => s.startsWith("web.")) ? ["--network-host", "docs.example.org"] : [])]);
  // The hosted agent reaches the log through a service; it holds only its own key.
  const handle = await LocalLog.open(f.aspHome);
  const server = createLogServer({ handle, tenants: [], noAuth: true });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const signer = new Keystore(f.aspHome).forDid(CODER)!;
  const reporter = AgentReporter.remote({ url, agent: CODER, signer, contract });
  return { f, contract, reporter, handle };
}

test("a hosted agent checks the live Mandate itself, is refused out of scope, and signs its own Action as self_reported", async () => {
  const { contract, reporter, handle } = await setup(["repo.read", "web.read"]);
  assert.deepEqual((await reporter.mandate()).scopes, ["repo.read", "web.read"]);
  assert.equal(await reporter.allowed("repo.read"), true);
  assert.equal(await reporter.allowed("repo.push"), false);

  assert.equal(await reporter.guard("repo.read", () => "read it", { artifact: { uri: "asp://tool-call/read", sha256: "sha256:" + "a".repeat(64) } }), "read it");
  let ran = false;
  await assert.rejects(reporter.guard("repo.push", () => { ran = true; }), (e: Error) => e instanceof MandateRefusal && /repo\.push is not granted/.test(e.message));
  assert.equal(ran, false, "a refused call is not run");

  const res = await reporter.flush("answered the customer");
  assert.ok(res?.id);
  const action = (await handle.log.get(res!.id))!.record.body as any;
  assert.deepEqual(action.scopes_used, ["repo.read"]);
  assert.deepEqual(action.blocked_attempts, [{ scope: "repo.push", count: 1 }]);
  assert.equal(action.assurance, "self_reported");
  assert.equal(action.contract, contract);
  assert.equal(await reporter.flush(), undefined, "nothing new to say");
});

test("the log still refuses a self-reported Action that claims a scope the Mandate does not grant, and a hosted agent cannot report on a job that has ended", async () => {
  const { f, contract, reporter } = await setup(["repo.read"]);
  reporter.note("repo.push"); // the agent claims it used a scope it was never given (or forgot to ask)
  await assert.rejects(reporter.flush(), /repo\.push|scope|Mandate/i);

  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", ALICE, "--escrow-released", "0", "--bond-slashed", "0", "--bond-returned", "200", "--pro-rata", "0"]);
  // The service's log was opened before the settlement; a fresh handle sees it. The guard reads the live state each time.
  const handle = await LocalLog.open(f.aspHome);
  const server = createLogServer({ handle, tenants: [], noAuth: true });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const after = AgentReporter.remote({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, agent: CODER, signer: new Keystore(f.aspHome).forDid(CODER)!, contract });
  await assert.rejects(after.guard("repo.read", () => "x"), (e: Error) => e instanceof MandateRefusal && /not running/.test(e.message));
});
