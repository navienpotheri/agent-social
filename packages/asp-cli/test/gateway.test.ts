import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("asp gateway: a Mandate that names hosts lets a fetch reach only those, and a tier 1 Mandate for web.read without hosts is refused by the log", async () => {
  const f = makeFixture();
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "a", type: "function", function: { name: "web_fetch", arguments: JSON.stringify({ url: "https://docs.example.org/guide" }) } },
        { id: "b", type: "function", function: { name: "web_fetch", arguments: JSON.stringify({ url: "https://login.victim.example/admin" }) } },
      ] } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const upstream = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  // Without hosts the log refuses the Mandate for a tier 1 agent.
  const nohosts = makeFixture();
  await assert.rejects(runningContract(nohosts, ["web.read"]), /must name the hosts it may reach/);
  const contract = await runningContract(f, ["web.read"], ["--network-host", "docs.example.org"]);
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT]);
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /allowed {2}web_fetch -> web.read/);
  assert.match(run.err, /REFUSED {2}web_fetch -> web.read: the host login.victim.example is not one this job's Mandate allows \(docs\.example\.org\)/);
  const { LocalLog } = await import("@agent-social/asp-package");
  const action = (await (await LocalLog.open(f.aspHome)).log.since(0, 500)).filter((x) => x.record.type === "asp.action/v0.2").at(-1)!.record.body as any;
  assert.deepEqual(action.scopes_used, ["web.read"]);
  assert.deepEqual(action.blocked_attempts, [{ scope: "web.read", count: 1 }]);
});

test("asp gateway keeps a redacted, hash-chained run log; the Action commits to it; asp run-log shows and verifies it", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const LEAKY = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "tiny-model", messages: [{ role: "user", content: "read notes.txt; my key is sk-ant-api03-abcdefghijklmnopqrstuvwx" }] }) });
await r.json();
`;
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", LEAKY]);
  assert.equal(run.code, 0, run.err);
  const logPath = /run log {2}(\S+run-log\.ndjson)/.exec(run.err)![1];
  const raw = readFileSync(logPath, "utf8");
  assert.ok(!raw.includes("sk-ant-api03"), "the key the agent put in its prompt is not in the run log");
  const shown = await ok(f, ["run-log", "show", logPath]);
  assert.match(shown.out, /model_request +tiny-model \(chat\.completions\) asked: "read notes\.txt; my key is \[redacted\]"/);
  assert.match(shown.out, /tool_call +allowed read_file -> repo\.read/);
  assert.match(shown.out, /tool_call +REFUSED bash -> repo\.push/);
  assert.match(shown.out, /run_end +exit 0; 1 request\(s\), 2 tool call\(s\), 1 blocked, \d+ secret-like value\(s\) masked/);
  // The Action committed to the run log, and the log checks out against it.
  const verified = await ok(f, ["run-log", "verify", logPath, "--contract", contract]);
  assert.match(verified.out, /run log ok: \d+ event\(s\)/);
  assert.match(verified.out, /Action\(s\)? commitment|commitment\(s\) match/);
  assert.doesNotMatch(verified.out, /does not match|fewer events/);
  // A change to the file is caught.
  writeFileSync(logPath, raw.replace("read_file", "write_file"));
  const tampered = await asp(f, ["run-log", "verify", logPath, "--contract", contract]);
  assert.equal(tampered.code, 1);
  assert.match(tampered.out, /run log NOT ok/);
  // --no-run-log turns it off.
  const off = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--no-run-log", "--", process.execPath, "--input-type=module", "-e", AGENT]);
  assert.doesNotMatch(off.err, /run log {2}/);
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
  if (i === 2) writeFileSync(process.env.AGENT_STARTED, "up");
  if (r.status === 403) { writeFileSync(process.env.AGENT_OUT, "STOPPED after " + i + " requests: " + (await r.json()).error.message); process.exit(0); }
  await new Promise((r) => setTimeout(r, 150));
}
writeFileSync(process.env.AGENT_OUT, "NEVER STOPPED");
`;
  // Revoke once the agent is really running (it has made three requests), not after a fixed wait: how long the gateway takes to start depends on the machine's load.
  const started = join(mkdtempSync(join(tmpdir(), "gw-started-")), "started");
  const revoke = (async () => {
    for (let waited = 0; !existsSync(started); waited += 50) {
      if (waited > 60_000) throw new Error("the agent never got going");
      await new Promise((r) => setTimeout(r, 50));
    }
    return asp(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", ALICE, "--escrow-released", "0", "--bond-slashed", "0", "--bond-returned", "200", "--pro-rata", "0"]);
  })();
  const [run, settled] = await Promise.all([
    asp(f, ["gateway", "--contract", contract, "--by", CODER, "--max-strikes", "1000", "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", LOOP], { AGENT_OUT: out, AGENT_STARTED: started, ASP_GATEWAY_POLL_MS: "200", ASP_GATEWAY_FLUSH_MS: "300" }),
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
  // Each Action carries its own interval's metrics: the model that ran, and counts that add up across Actions to the requests made (the upstream reports 7 in and 3 out per request).
  const metrics = actions.map((x) => (x.record.body as any).metrics);
  assert.ok(metrics.every(Boolean), "every gateway Action has metrics");
  assert.ok(metrics.some((m) => m.models.some((x: any) => x.name === "m")), "the model name is recorded");
  const requests = metrics.reduce((n, m) => n + m.requests, 0);
  assert.ok(requests >= 2);
  const reported = { in: metrics.reduce((n, m) => n + m.tokens_in, 0), out: metrics.reduce((n, m) => n + m.tokens_out, 0) };
  assert.equal(reported.in * 3, reported.out * 7, "only whole replies are counted");
  // A settled job takes no more Actions, so replies that finished after the last Action was recorded before the revoke are missing from the Actions (how many depends on how far the reports lagged); the run log has every reply.
  const { readRunLog } = await import("@agent-social/asp-package");
  const logged = readRunLog(/run log {2}(\S+run-log\.ndjson)/.exec(run.err)![1]).events.filter((e) => e.kind === "model_reply").map((e) => e.data as any);
  assert.ok(logged.length >= 2);
  assert.equal(logged.reduce((n, d) => n + d.tokens_in, 0), 7 * logged.length);
  assert.ok(reported.in >= 7 && reported.in <= 7 * logged.length, "the Actions hold at least the first reply and never more than the run log");
});

// ---- P2: MCP and memory ----
const MCP_AGENT = `
import { writeFileSync } from "node:fs";
const rpc = async (server, method, params) => (await (await fetch(process.env.ASP_GATEWAY_URL + "/mcp/" + server, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json());
const cfg = JSON.parse((await import("node:fs")).readFileSync(process.env.ASP_MCP_CONFIG, "utf8"));
const out = { servers: Object.keys(cfg.mcpServers) };
out.init = (await rpc("asp", "initialize", { protocolVersion: "2025-06-18" })).result.instructions.includes("asp_memory_list");
out.saved = (await rpc("asp", "tools/call", { name: "asp_memory_write", arguments: { name: "deploy-order", description: "migrate before deploy", content: "Run migrations before deploying." } })).result.content[0].text;
out.echo = (await rpc("fake", "tools/call", { name: "echo", arguments: { x: 1 } })).result.content[0].text;
const dep = (await rpc("fake", "tools/call", { name: "deploy", arguments: {} })).result;
out.deployRefused = dep.isError === true && dep.content[0].text.includes("was not run");
writeFileSync(process.env.AGENT_OUT, JSON.stringify(out));
`;

test("asp gateway serves the agent's memory over MCP, writes it back to the package as a signed lineage update, and judges its other MCP servers", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["mcp.fake.echo"]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const upstream = await provider();
  const out = outFile();
  const fake = new URL("../../asp-package/test/fake-mcp-server.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--package", pkg, "--openai-upstream", upstream, "--mcp", `fake=stdio:"${process.execPath}" "${fake}"`, "--", process.execPath, "--input-type=module", "-e", MCP_AGENT], { AGENT_OUT: out });
  assert.equal(run.code, 0, run.err);
  const got = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(got.servers, ["asp", "fake"]);
  assert.equal(got.init, true);
  assert.equal(got.saved, "Saved deploy-order.md.");
  assert.equal(got.echo, 'echo ran with {"x":1}');
  assert.equal(got.deployRefused, true);

  // What it saved is in the package, signed, as a lineage update; the package still verifies.
  assert.match(readFileSync(join(pkg, "memory", "auto", "deploy-order.md"), "utf8"), /Run migrations before deploying/);
  assert.match(readFileSync(join(pkg, "memory", "auto", "MEMORY.md"), "utf8"), /\[deploy-order\]\(deploy-order\.md\) - migrate before deploy/);
  assert.match(run.err, /memory updated during a gateway run: \+\d+/);
  assert.equal((await asp(f, ["verify", pkg])).code, 0);

  // The Action: the echo was used, the deploy was a blocked attempt, assurance says how it was enforced.
  const { LocalLog } = await import("@agent-social/asp-package");
  const local = await LocalLog.open(f.aspHome);
  const action = (await local.log.since(0, 500)).filter((x) => x.record.type === "asp.action/v0.2").at(-1)!.record.body as any;
  assert.deepEqual(action.scopes_used, ["mcp.fake.echo"]);
  assert.deepEqual(action.blocked_attempts, [{ scope: "mcp.fake.deploy", count: 1 }]);
  assert.equal(action.assurance, "gateway_enforced");
});

test("an agent that never uses structured tool calls through the gateway is reported as gateway_observed, not enforced", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const plain = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "I will edit the file in my own format." } }] }));
  });
  await new Promise<void>((r) => plain.listen(0, "127.0.0.1", r));
  servers.push(plain);
  const upstream = `http://127.0.0.1:${(plain.address() as { port: number }).port}/v1`;
  const CALL = `await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) }).then((r) => r.json());`;
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", CALL]);
  assert.equal(run.code, 0, run.err);
  const { LocalLog } = await import("@agent-social/asp-package");
  const local = await LocalLog.open(f.aspHome);
  // No scopes were used and nothing was blocked, so the exit Action is only reported when there is something to say; the summary line shows the rule.
  const actions = (await local.log.since(0, 500)).filter((x) => x.record.type === "asp.action/v0.2");
  for (const a of actions) assert.notEqual((a.record.body as any).assurance, "gateway_enforced");
});

test("the provider key the gateway holds never reaches the agent's environment, and --sandbox says why it cannot run where bubblewrap is missing", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const out = outFile();
  const PEEK = `import { writeFileSync } from "node:fs"; writeFileSync(process.env.AGENT_OUT, JSON.stringify({ key: process.env.MY_PROVIDER_KEY ?? null, placeholder: process.env.OPENAI_API_KEY ?? null }));`;
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--openai-key-env", "MY_PROVIDER_KEY", "--", process.execPath, "--input-type=module", "-e", PEEK], { MY_PROVIDER_KEY: "sk-real-provider-key", AGENT_OUT: out });
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), { key: null, placeholder: "asp-gateway" });
  if (process.platform !== "linux") {
    const sb = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--sandbox", "--sandbox-backend", "bwrap", "--", process.execPath, "-e", "0"]);
    assert.notEqual(sb.code, 0);
    assert.match(sb.err, /--sandbox: the sandbox level needs Linux/);
  }
});
