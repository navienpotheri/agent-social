import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const HUMAN = "did:web:example.com:users:navien";
const AGENT = "did:web:example.com:agents:coder";

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function packed(f = makeFixture()) {
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN])).code, 0);
  const pkg = join(f.root, "fleet.aspkg");
  const res = await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(res.code, 0, res.err);
  return { f, pkg };
}

const fakeClaude = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude-fleet.mjs", import.meta.url)), ...extra,
});

test("orchestrate runs one node per task, in parallel, each under its own delegated node key", async () => {
  const { f, pkg } = await packed();
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project,
    "--task", "fix the flaky refund test", "--task", "add retry to the webhook handler"], fakeClaude());
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /orchestrating 2 task\(s\)/);
  assert.match(res.err, /node 1 {2}fix the flaky refund test/);
  assert.match(res.err, /node 2 {2}add retry to the webhook handler/);
  assert.match(res.err, /2\/2 node\(s\) succeeded/);
  assert.match(res.err, /recorded consolidated fleet memory from 2\/2 node\(s\)/);

  // Each node's own lesson made it into the package, plus the identities and two node grants.
  assert.match(readFileSync(join(pkg, "memory", "auto", "fix-the-flaky-refund-test.md"), "utf8"), /Learned from: fix the flaky refund test/);
  assert.match(readFileSync(join(pkg, "memory", "auto", "add-retry-to-the-webhook-handler.md"), "utf8"), /Learned from: add retry to the webhook handler/);
  const memoryIndex = readFileSync(join(pkg, "memory", "auto", "MEMORY.md"), "utf8");
  assert.match(memoryIndex, /lesson for "fix the flaky refund test"/);
  assert.match(memoryIndex, /lesson for "add retry to the webhook handler"/);

  // Node grants are bookkeeping for this run; they go in the local log, not the portable package history.
  const localRecords = readFileSync(join(f.aspHome, "log.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l).record);
  const nodes = localRecords.filter((r) => r.type === "asp.node/v0.2");
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every((n) => n.issuer === AGENT && n.body.node.startsWith(`${AGENT}#node-`)));

  const history = readFileSync(join(pkg, "records", "history.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const edge = history.at(-1);
  assert.equal(edge.type, "asp.lineage/v0.2");
  assert.equal(edge.body.change.layer, "memory");

  assert.equal((await asp(f, ["verify", pkg])).code, 0);
  assert.match((await asp(f, ["log", "verify"])).out, /log ok: 5 records/, "2 passports + 2 node grants + 1 memory edge");
});

test("nodes that write the same path with different content are kept side by side, not overwritten", async () => {
  const { f, pkg } = await packed();
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project,
    "--task", "task A", "--task", "task B"], fakeClaude());
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /node 2's auto[\\/]shared\.md differs from an earlier node's; kept separately as auto[\\/]shared\.node2\.md/);
  assert.match(readFileSync(join(pkg, "memory", "auto", "shared.md"), "utf8"), /Shared note: task A/);
  assert.match(readFileSync(join(pkg, "memory", "auto", "shared.node2.md"), "utf8"), /Shared note: task B/);
});

test("identical content from different nodes is deduplicated, not duplicated", async () => {
  const { f, pkg } = await packed();
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project,
    "--task", "same task", "--task", "same task"], fakeClaude());
  assert.equal(res.code, 0, res.err);
  assert.doesNotMatch(res.err, /kept separately/);
  assert.ok(!existsSync(join(pkg, "memory", "auto", "shared.node2.md")));
  const index = readFileSync(join(pkg, "memory", "auto", "MEMORY.md"), "utf8");
  assert.equal(index.match(/lesson for "same task"/g)?.length, 1, "one line, not two");
});

test("a failing node doesn't block consolidating the ones that succeeded", async () => {
  const { f, pkg } = await packed();
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project,
    "--task", "good task", "--task", "bad task"], fakeClaude({ FAKE_FLEET_FAIL_MATCH: "bad", FAKE_FLEET_FAIL_EXIT: "3" }));
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /node 2 {2}FAILED {2}exited with code 3/);
  assert.match(res.err, /1\/2 node\(s\) succeeded; failed: 2/);
  assert.ok(existsSync(join(pkg, "memory", "auto", "good-task.md")));
  assert.ok(!existsSync(join(pkg, "memory", "auto", "bad-task.md")));
});

test("when every node fails, nothing is consolidated and the run fails", async () => {
  const { f, pkg } = await packed();
  const before = readFileSync(join(pkg, "manifest.json"), "utf8");
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--task", "x"],
    fakeClaude({ FAKE_FLEET_FAIL_MATCH: "x", FAKE_FLEET_FAIL_EXIT: "1" }));
  assert.equal(res.code, 1);
  assert.match(res.err, /no node completed successfully; nothing consolidated/);
  assert.equal(readFileSync(join(pkg, "manifest.json"), "utf8"), before);
});

test("--dry-run plans every node without spawning, signing, or writing anything back", async () => {
  const { f, pkg } = await packed();
  const before = readFileSync(join(pkg, "manifest.json"), "utf8");
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project,
    "--task", "one", "--task", "two", "--task", "three", "--dry-run"], fakeClaude());
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /3\/3 node\(s\) succeeded/, "dry-run reports a plan for every node");
  assert.equal(readFileSync(join(pkg, "manifest.json"), "utf8"), before);
  assert.match((await asp(f, ["log", "verify"])).out, /log ok: 2 records/, "only the two identities; no node records minted in dry-run");
});

test("orchestrate respects --max-parallel and still completes every task", async () => {
  const { f, pkg } = await packed();
  const tasks = ["a", "b", "c", "d", "e"].flatMap((t) => ["--task", `task ${t}`]);
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--max-parallel", "2", ...tasks], fakeClaude());
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /5\/5 node\(s\) succeeded/);
  for (const t of ["a", "b", "c", "d", "e"]) assert.ok(existsSync(join(pkg, "memory", "auto", `task-${t}.md`)));
});

test("missing secrets fail every node without spawning anything", async () => {
  const { f, pkg } = await packed();
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--task", "x"]);
  assert.equal(res.code, 1);
  assert.match(res.err, /node 1 {2}FAILED {2}missing secrets: API_BASE, GITHUB_TOKEN/);
});

test("--task is required, and an unknown backend is a usage error", async () => {
  const { f, pkg } = await packed();
  assert.equal((await asp(f, ["orchestrate", pkg, "--backend", "claude-code"])).code, 2);
  assert.equal((await asp(f, ["orchestrate", pkg, "--backend", "nope", "--task", "x"])).code, 2);
});
