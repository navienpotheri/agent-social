import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** A model provider that always asks for one allowed and one disallowed tool call. */
async function provider() {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 7, completion_tokens: 3 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } },
        { id: "b", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git push origin main" }) } },
      ] } }],
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}

// A stand-in agent: any program that calls an OpenAI-compatible API at OPENAI_BASE_URL and reports which tool calls it was given.
const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) });
const j = await r.json();
const m = j.choices[0].message;
console.log("AGENT GOT:" + JSON.stringify((m.tool_calls ?? []).map((t) => t.function.name)));
console.log("AGENT SAW:" + (m.content ?? ""));
`;

test("asp gateway: any command runs under the Mandate; the disallowed call never reaches it and the Action records the facts", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT]);
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /allowed {2}read_file -> repo\.read/);
  assert.match(run.err, /REFUSED {2}bash -> repo\.push: the scope repo\.push is not granted/);
  // The stand-in agent's own output goes straight to the terminal, not through io; the Action in the log is the evidence.
  const verify = await ok(f, ["log", "verify"]);
  assert.match(verify.out, /log ok/);

  // The Action carries what happened: repo.read used, one blocked repo.push attempt.
  const { LocalLog } = await import("@agent-social/asp-package");
  const local = await LocalLog.open(f.aspHome);
  const action = (await local.log.since(0, 500)).filter((x) => x.record.type === "asp.action/v0.2").at(-1)!.record.body as any;
  assert.deepEqual(action.scopes_used, ["repo.read"]);
  assert.deepEqual(action.blocked_attempts, [{ scope: "repo.push", count: 1 }]);
  assert.match(action.summary, /ASP gateway/);
});

test("asp gateway refuses a contract that is not running, and needs an upstream", async () => {
  const f = makeFixture();
  const missing = await asp(f, ["gateway", "--contract", "sha256:" + "0".repeat(64), "--by", CODER, "--openai-upstream", "http://127.0.0.1:1/v1", "--", process.execPath, "-e", "0"]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /not Running|not in the log/);
  const none = await asp(f, ["gateway", "--contract", "x", "--by", CODER, "--", process.execPath, "-e", "0"]);
  assert.equal(none.code, 2);
});

// ---- P1: gates, live revoke, assurance ----
const SHELL_AGENT = `
import { writeFileSync } from "node:fs";
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [] }) });
const j = await r.json();
const m = j.choices[0].message;
writeFileSync(process.env.AGENT_OUT, "GOT:" + JSON.stringify((m.tool_calls ?? []).map((t) => t.function.name)) + " SAW:" + (m.content ?? ""));
`;
async function shellProvider() {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "s1", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "node deploy.js" }) } }] } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}
const outFile = () => join(mkdtempSync(join(tmpdir(), "gw-out-")), "agent.txt");

async function answerWhenAsked(f: Fixture, id: string, verdict: string) {
  const extra = verdict === "corrected" ? ["--correction", "not that command"] : [];
  const { LocalLog } = await import("@agent-social/asp-package");
  for (let i = 0; i < 400; i++) {
    const local = await LocalLog.open(f.aspHome);
    if ((await local.log.chainInfo(id))?.state === "Checkpoint") return asp(f, ["market", "resolve", "--contract", id, "--by", ALICE, "--verdict", verdict, ...extra]);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("no Checkpoint appeared");
}

test("asp gateway holds a gated call for the principal's signed answer: approved reaches the agent, refused does not, and neither is a strike", async () => {
  const upstream = await shellProvider();
  for (const verdict of ["approved", "corrected"]) {
    const f = makeFixture();
    const contract = await runningContract(f, ["repo.read", "shell.exec"], ["--gate", "shell.exec"]);
    const out = outFile();
    const [run] = await Promise.all([
      asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--approval-wait", "20", "--", process.execPath, "--input-type=module", "-e", SHELL_AGENT], { AGENT_OUT: out, ASP_APPROVAL_POLL_MS: "100" }),
      answerWhenAsked(f, contract, verdict),
    ]);
    assert.equal(run.code, 0, run.err);
    assert.match(run.err, /APPROVAL NEEDED {2}shell\.exec: node deploy\.js/);
    const got = readFileSync(out, "utf8");
    if (verdict === "approved") {
      assert.match(got, /^GOT:\["bash"\]/);
      assert.match(run.err, /approval granted for shell\.exec/);
    } else {
      assert.match(got, /^GOT:\[\] SAW:\[ASP\] The action "bash" was not run: .*needs the principal's approval and it was not given/);
      assert.match(run.err, /approval refused for shell\.exec/);
    }
    assert.doesNotMatch(run.err, /stopped {2}/, "a gate is not probing");
  }
});

test("asp gateway stops the agent when the contract is revoked mid-run, and records gateway_enforced on the Action", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const out = outFile();
  const LOOP = `
import { writeFileSync } from "node:fs";
for (let i = 0; i < 100; i++) {
  const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [] }) });
  if (r.status === 403) { writeFileSync(process.env.AGENT_OUT, "STOPPED after " + i + " requests: " + (await r.json()).error.message); process.exit(0); }
  await new Promise((r) => setTimeout(r, 150));
}
writeFileSync(process.env.AGENT_OUT, "NEVER STOPPED");
`;
  const revoke = (async () => {
    await new Promise((r) => setTimeout(r, 1200));
    return asp(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", ALICE, "--escrow-released", "0", "--bond-slashed", "0", "--bond-returned", "200", "--pro-rata", "0"]);
  })();
  const [run, settled] = await Promise.all([
    asp(f, ["gateway", "--contract", contract, "--by", CODER, "--max-strikes", "1000", "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", LOOP], { AGENT_OUT: out, ASP_GATEWAY_POLL_MS: "200", ASP_GATEWAY_FLUSH_MS: "300" }),
    revoke,
  ]);
  assert.equal(settled.code, 0, settled.err);
  assert.match(readFileSync(out, "utf8"), /^STOPPED after \d+ requests: ASP gateway: this run was stopped \(the contract is now Settled\)/);
  assert.match(run.err, /stopped {2}the contract is now Settled/);
  // Actions were reported while it ran, so the evidence from before the revoke is in the log; each says how strongly it was enforced.
  const { LocalLog } = await import("@agent-social/asp-package");
  const local = await LocalLog.open(f.aspHome);
  const actions = (await local.log.since(0, 500)).filter((x) => x.record.type === "asp.action/v0.2");
  assert.equal((actions.at(-1)!.record.body as any).assurance, "gateway_enforced");
});
