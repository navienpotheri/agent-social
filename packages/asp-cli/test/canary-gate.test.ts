import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const HUMAN = "did:web:example.com:users:navien";
const AGENT = "did:web:example.com:agents:coder";

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root, raw: () => {} };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[], env?: NodeJS.ProcessEnv) => { const r = await asp(f, args, env); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const fake = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)), ...extra,
});
const topics = (pkg: string) => readdirSync(join(pkg, "memory", "auto")).filter((n) => n !== "MEMORY.md");
const lineage = (pkg: string) => readFileSync(join(pkg, "records", "history.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === "asp.lineage/v0.2" && r.body.edge === "update");

test("the canary gates a change: the first becomes the baseline, a regression is blocked with the evidence recorded, and with warn it is written back citing the evidence", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", HUMAN]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);

  // A one-task suite and a stand-in agent that is "confused" by a lesson-* memory file.
  const suite = join(f.root, "suite.json");
  const target = join(f.root, "target.json");
  writeFileSync(suite, JSON.stringify({ name: "gate-test", tasks: [{ id: "answers-ok", prompt: "say ok", trials: 1, checks: [{ kind: "exit_ok" }, { kind: "answer_matches", pattern: "^OK$" }] }] }));
  writeFileSync(target, JSON.stringify({ name: "stub", command: ["{node}", fileURLToPath(new URL("./canary-stub.mjs", import.meta.url)), "{package}", "{prompt}"], gatewayFlags: ["--openai-upstream", "http://127.0.0.1:1/v1"] }));

  const setup = await ok(f, ["canary", "setup", "--agent", AGENT, "--backend", "claude-code", "--target", target, "--suite", suite, "--canary-gate", "block", "--trials", "1"]);
  assert.match(setup.out, /gate block[\s\S]*no baseline yet/);
  const run = (extra: string[] = [], env: NodeJS.ProcessEnv = {}) => asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", ...extra], fake(env));

  // 1. A harmless memory update: the canary runs, there is no baseline, so this run becomes it; the edge cites a certificate.
  const first = await run();
  assert.equal(first.code, 0, first.err);
  assert.match(first.err, /canary {3}no baseline for claude-code yet/);
  assert.match(first.err, /canary {3}canary baseline_set: 1\/1 tasks pass/);
  assert.match(first.err, /recorded memory updated during a claude-code run.*; canary baseline_set: 1\/1 tasks pass/);
  const edge1 = lineage(pkg).at(-1)!.body.change;
  assert.equal(edge1.gates.length, 1);
  const local = await LocalLog.open(f.aspHome);
  const cert = (await local.log.get(edge1.gates[0]))!.record;
  assert.equal(cert.type, "asp.attestation/v0.2");
  assert.equal((cert.body as any).kind, "certificate");
  assert.equal((cert.body as any).verdict, "baseline_set");
  assert.equal((cert.body as any).about, edge1.artifact.sha256, "the certificate is about the memory the edge records");
  assert.equal((cert.body as any).score, 1000);
  assert.match((cert.body as any).skill, /^canary:/);
  assert.equal((await asp(f, ["verify", pkg])).out.match(/canary\s+(.*)/)![1].startsWith("1 of 1 recorded change(s) cite a canary result"), true);

  // 2. A change that confuses the agent: the canary regresses and, with the gate on block, it is not written back.
  const before = topics(pkg).join(",");
  const edgesBefore = lineage(pkg).length;
  const blocked = await run([], { FAKE_CLAUDE_LEARN_FILES: "1" });
  assert.equal(blocked.code, 0, blocked.err);
  assert.match(blocked.err, /canary {3}REGRESSION answers-ok: passed 100% of trials before, 0% now/);
  assert.match(blocked.err, /the change was NOT written back/);
  assert.equal(topics(pkg).join(","), before, "the package's memory is unchanged");
  assert.equal(lineage(pkg).length, edgesBefore, "no lineage edge was recorded");
  const certs = (await (await LocalLog.open(f.aspHome)).log.since(0, 500)).filter((x) => x.record.type === "asp.attestation/v0.2" && (x.record.body as any).kind === "certificate");
  assert.equal(certs.at(-1)!.record.body && (certs.at(-1)!.record.body as any).verdict, "regressed", "the regression is on the record even though the change was refused");

  // 3. The same change with warn: written back, and the edge says what the canary found and cites the certificate.
  const warned = await run(["--canary-gate", "warn"], { FAKE_CLAUDE_LEARN_FILES: "1" });
  assert.equal(warned.code, 0, warned.err);
  assert.match(warned.err, /recorded memory updated during a claude-code run.*; canary regressed: 0\/1 tasks pass/);
  assert.ok(topics(pkg).includes("lesson-00.md"));
  const edge3 = lineage(pkg).at(-1)!.body.change;
  assert.match(edge3.description, /canary regressed/);
  assert.equal(edge3.gates.length, 1);
  assert.equal((await asp(f, ["verify", pkg])).code, 0, "the package still verifies");

  // The evidence is listed with its verdicts.
  const ev = await ok(f, ["canary", "evidence", pkg]);
  assert.match(ev.out, /canary baseline_set, 100% of trials/);
  assert.match(ev.out, /canary regressed, 0% of trials/);

  // --no-canary skips the test.
  const skipped = await run(["--no-canary"], { FAKE_CLAUDE_LEARN_FILES: "2" });
  assert.equal(skipped.code, 0, skipped.err);
  assert.doesNotMatch(skipped.err, /canary/);
  assert.equal(existsSync(join(f.aspHome, "canary")), true);
});

async function setupAgent() {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", HUMAN]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const suite = join(f.root, "suite.json");
  const target = join(f.root, "target.json");
  writeFileSync(suite, JSON.stringify({ name: "gate-test", tasks: [{ id: "answers-ok", prompt: "say ok", trials: 1, checks: [{ kind: "exit_ok" }, { kind: "answer_matches", pattern: "^OK$" }] }] }));
  writeFileSync(target, JSON.stringify({ name: "stub", command: ["{node}", fileURLToPath(new URL("./canary-stub.mjs", import.meta.url)), "{package}", "{prompt}"], gatewayFlags: ["--openai-upstream", "http://127.0.0.1:1/v1"] }));
  return { f, pkg, suite, target };
}

test("setup --package takes the baseline now, so the very first change is compared instead of becoming the baseline", async () => {
  const { f, pkg, suite, target } = await setupAgent();
  const setup = await ok(f, ["canary", "setup", "--agent", AGENT, "--backend", "claude-code", "--target", target, "--suite", suite, "--canary-gate", "block", "--trials", "1", "--package", pkg]);
  assert.match(setup.out, /baseline saved for/);
  const blocked = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi"], fake({ FAKE_CLAUDE_LEARN_FILES: "1" }));
  assert.equal(blocked.code, 0, blocked.err);
  assert.doesNotMatch(blocked.err, /no baseline for/);
  assert.match(blocked.err, /REGRESSION answers-ok/);
  assert.match(blocked.err, /the change was NOT written back/);
  assert.equal(topics(pkg).includes("lesson-00.md"), false, "the first change was already refused");
});

test("asp orchestrate consolidates fleet memory only if the canary allows it", async () => {
  const { f, pkg, suite, target } = await setupAgent();
  await ok(f, ["canary", "setup", "--agent", AGENT, "--backend", "claude-code", "--target", target, "--suite", suite, "--canary-gate", "block", "--trials", "1", "--package", pkg]);
  const edgesBefore = lineage(pkg).length;
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--task", "task one", "--task", "task two"], fake({ FAKE_CLAUDE_LEARN_FILES: "1" }));
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /REGRESSION answers-ok/);
  assert.match(res.err, /the change was NOT written back/);
  assert.equal(lineage(pkg).length, edgesBefore, "no consolidation edge was recorded");
  assert.equal(topics(pkg).includes("lesson-00.md"), false);

  // Without the gate (or with warn) the same consolidation goes through and cites its certificate.
  const warned = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--task", "task one", "--task", "task two", "--canary-gate", "warn"], fake({ FAKE_CLAUDE_LEARN_FILES: "1" }));
  assert.equal(warned.code, 0, warned.err);
  assert.match(warned.err, /recorded consolidated fleet memory.*; canary regressed/);
  assert.equal(lineage(pkg).at(-1)!.body.change.gates.length, 1);
});

test("memory written back by asp gateway --package is tested too, under the backend name gateway", async () => {
  const { f, pkg, suite, target } = await setupAgent();
  await ok(f, ["canary", "setup", "--agent", AGENT, "--backend", "gateway", "--target", target, "--suite", suite, "--canary-gate", "block", "--trials", "1", "--package", pkg]);
  // A contract and an upstream for the gateway; the "agent" saves a note through the gateway's memory tool, which the stub treats as confusing if it is named lesson-*.
  const { createServer } = await import("node:http");
  const upstream = createServer((req, res) => { req.resume(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] })); });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  try {
    const bank = "did:web:example.com:bank";
    await ok(f, ["identity", "new", "--kind", "human", "--did", bank]);
    await ok(f, ["credits", "grant", "--to", HUMAN, "--amount", "1200"]);
    await ok(f, ["credits", "grant", "--to", AGENT, "--amount", "300"]);
    const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", HUMAN, "--purpose", "gateway canary", "--budget", "1000", "--deadline", "2099-01-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", AGENT, "--intent", intent, "--price", "1000", "--plan", "x", "--eta", "2098-01-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", HUMAN, "--bank", bank, "--intent", intent, "--offer", offer])).out)![1];
    await ok(f, ["market", "bond", "--contract", contract, "--backer", AGENT, "--amount", "200", "--escrow-payer", HUMAN, "--escrow-amount", "1000"]);
    await ok(f, ["market", "mandate", "--contract", contract, "--principal", HUMAN, "--performer", AGENT, "--scopes", "repo.read"]);
    const port = (upstream.address() as { port: number }).port;
    const SAVE = `
      const base = process.env.ASP_GATEWAY_URL + "/mcp/asp";
      const call = (name, args) => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }).then((r) => r.json());
      await call("asp_memory_write", { name: "lesson-00", description: "a lesson", content: "Something that confuses the agent." });`;
    const edgesBefore = lineage(pkg).length;
    const run = await asp(f, ["gateway", "--contract", contract, "--by", AGENT, "--package", pkg, "--openai-upstream", `http://127.0.0.1:${port}/v1`, "--", process.execPath, "--input-type=module", "-e", SAVE]);
    assert.equal(run.code, 0, run.err);
    assert.match(run.err, /REGRESSION answers-ok/);
    assert.match(run.err, /the change was NOT written back/);
    assert.equal(lineage(pkg).length, edgesBefore);
    assert.equal(topics(pkg).includes("lesson-00.md"), false);
  } finally { upstream.close(); }
});
