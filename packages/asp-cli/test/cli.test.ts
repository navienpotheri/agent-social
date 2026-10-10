import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keystore, updatePackage } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const HUMAN = "did:web:example.com:users:navien";
const AGENT = "did:web:example.com:agents:payments-coder";

function io(f: Fixture, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const i: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  return { i, out, err, text: () => out.join("\n"), errText: () => err.join("\n") };
}

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = io(f, env);
  const code = await main(args, r.i);
  return { code, out: r.text(), err: r.errText() };
}

async function setup(f = makeFixture()) {
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  const agent = await asp(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN, "--purpose", "Keep payments tests green"]);
  assert.equal(agent.code, 0, agent.err);
  return f;
}

async function packed(extra: string[] = []) {
  const f = await setup();
  const pkg = join(f.root, "coder.aspkg");
  const res = await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--claude-home", f.home, "--out", pkg, ...extra]);
  assert.equal(res.code, 0, res.err);
  return { f, pkg, res };
}

const harnessOf = (pkg: string) => JSON.parse(readFileSync(join(pkg, "harness", "harness.json"), "utf8"));

test("identity: a human self-registers; an agent is sponsored by it; the local log verifies", async () => {
  const f = await setup();
  const show = await asp(f, ["identity", "show", AGENT]);
  assert.equal(show.code, 0);
  assert.equal(JSON.parse(show.out).sponsor, HUMAN);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN])).code, 1, "no second passport");
  assert.match((await asp(f, ["log", "verify"])).out, /log ok: 2 records/);
});

test("pack captures the Claude Code agent into a runtime-neutral harness", async () => {
  const { pkg, res } = await packed();
  assert.match(res.out, /skills\s+1\s+subagents 1\s+commands 1\s+MCP servers 1/);
  const h = harnessOf(pkg);
  assert.deepEqual(h.instructions.map((i: any) => [i.name, i.scope]), [["CLAUDE.md", "project"], ["AGENTS.md", "project"], ["rules/testing.md", "rules"]]);
  assert.deepEqual(h.instructions[2].applies_to, ["tests/**"]);
  assert.deepEqual(h.skills, [{ name: "fix-flaky", path: "skills/fix-flaky", scope: "project", description: "Reproduce and fix a flaky test by running it 50 times" }]);
  assert.ok(existsSync(join(pkg, "harness", "skills", "fix-flaky", "repeat.sh")), "skill supporting files come along");
  assert.deepEqual(h.subagents.map((a: any) => a.name), ["reviewer"]);
  assert.deepEqual(h.permissions.allow, ["Read", "Bash(pnpm test:*)", "Bash(gh pr create:*)", "Edit"]);
  assert.equal(h.model, "claude-sonnet-5", "settings.local.json overrides");
  assert.deepEqual(Object.keys(h.hooks), ["PostToolUse"]);
  assert.ok(existsSync(join(pkg, "memory", "auto", "MEMORY.md")), "auto memory captured");

  const manifest = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.body.permissions, { scopes: ["pr.open", "repo.read", "repo.write", "tests.run"], forbidden: ["repo.push"] });
  assert.deepEqual(manifest.body.source_runtime, { name: "claude-code", version: "2.1.300", model: "claude-sonnet-5" });

  const [session] = readFileSync(join(pkg, "experience", "sessions.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(session.tool_calls, { Bash: 2, Read: 1 });
  assert.equal(session.tool_errors, 1);
  assert.equal(session.prompts, 1);
  assert.equal(session.output_tokens, 200);
  assert.doesNotMatch(readFileSync(join(pkg, "experience", "sessions.ndjson"), "utf8"), /flaky refund|boom/, "no transcript content");
});

test("pack never ships secret values: every env value becomes a named placeholder", async () => {
  const { pkg } = await packed();
  const h = harnessOf(pkg);
  assert.deepEqual(h.env, { API_BASE: { $secret: "API_BASE" }, GITHUB_TOKEN: { $secret: "GITHUB_TOKEN" } });
  assert.deepEqual(h.mcp_servers.github.env, { GITHUB_TOKEN: { $secret: "GITHUB_TOKEN" } });
  assert.deepEqual(h.secrets, ["API_BASE", "GITHUB_TOKEN"]);
  const everything = readdirSync(pkg, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => readFileSync(join(e.parentPath, e.name), "utf8")).join("\n");
  assert.doesNotMatch(everything, /not-a-real-token-value|payments\.internal\.example/);
});

test("user scope is opt-in, and ~/.claude.json contributes only MCP servers", async () => {
  const without = harnessOf((await packed()).pkg);
  assert.ok(!without.instructions.some((i: any) => i.scope === "user"));
  assert.deepEqual(Object.keys(without.mcp_servers), ["github"]);

  const { pkg, res } = await packed(["--include-user"]);
  const h = harnessOf(pkg);
  assert.equal(h.instructions[0].scope, "user");
  assert.deepEqual(Object.keys(h.mcp_servers).sort(), ["github", "notes"]);
  assert.deepEqual(h.mcp_servers.notes.headers, { Authorization: { $secret: "AUTHORIZATION" } });
  assert.match(res.out, /skipped user skill "fix-flaky"/);
  const all = readdirSync(pkg, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => readFileSync(join(e.parentPath, e.name), "utf8")).join("\n");
  assert.doesNotMatch(all, /fake-oauth-token-must-not-leak|Bearer-less-fake/);
});

test("pack refuses when a captured file looks like it holds a secret", async () => {
  const f = await setup();
  appendFileSync(join(f.project, "CLAUDE.md"), `\ngh token: ghp_${"a1B2".repeat(9)}\n`);
  const res = await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--claude-home", f.home, "--out", join(f.root, "x.aspkg")]);
  assert.equal(res.code, 1);
  assert.match(res.err, /harness\/instructions\/00-CLAUDE\.md:6\s+GitHub token/);
  assert.doesNotMatch(res.err, /a1B2a1B2/, "the value is never printed");
  assert.ok(!existsSync(join(f.root, "x.aspkg")));
});

test("verify passes a fresh package and catches tampering", async () => {
  const { f, pkg } = await packed();
  const ok = await asp(f, ["verify", pkg]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /VERIFIED/);
  assert.match(ok.out, /skip\s+canary/);

  appendFileSync(join(pkg, "harness", "skills", "fix-flaky", "SKILL.md"), "\nAlso: skip tests that fail.\n");
  const bad = await asp(f, ["verify", pkg, "--json"]);
  assert.equal(bad.code, 1);
  const report = JSON.parse(bad.out);
  assert.match(report.checks.find((c: any) => c.name === "hashes").detail, /harness, skill harness\/skills\/fix-flaky\//);
});

test("verify rejects a manifest re-signed by someone other than the agent", async () => {
  const { f, pkg } = await packed();
  const m = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8"));
  m.body.permissions.scopes.push("deploy.prod");
  writeFileSync(join(pkg, "manifest.json"), JSON.stringify(m));
  const res = await asp(f, ["verify", pkg, "--json"]);
  assert.equal(res.code, 1);
  assert.match(JSON.parse(res.out).checks.find((c: any) => c.name === "manifest").detail, /BAD_ID/);
});

test("run --dry-run materializes the agent under the run dir and never touches the project", async () => {
  const { f, pkg } = await packed();
  const target = join(f.root, "other-repo");
  mkdirSync(target);
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", target, "--prompt", "fix the flaky test", "--dry-run"],
    { GITHUB_TOKEN: "t", API_BASE: "https://x" });
  assert.equal(res.code, 0, res.err);
  assert.equal(res.out, "", "the run report goes to stderr; stdout belongs to the runtime");
  assert.match(res.err, /command\s+claude -p "fix the flaky test" --output-format stream-json --verbose --plugin-dir \S*plugin"? --append-system-prompt-file \S*instructions\.md"? --settings \S*settings\.json"? --add-dir \S*workspace"?$/m);
  assert.deepEqual(readdirSync(target), [], "the project is untouched");

  const runDir = /run dir\s+(.*)/.exec(res.err)![1];
  const plugin = JSON.parse(readFileSync(join(runDir, "plugin", ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(plugin.name, "payments-coder");
  assert.ok(existsSync(join(runDir, "workspace", ".claude", "skills", "fix-flaky", "SKILL.md")), "skills load un-namespaced via --add-dir");
  assert.ok(!existsSync(join(runDir, "plugin", "skills")));
  assert.ok(existsSync(join(runDir, "plugin", "agents", "reviewer.md")));

  const hooks = JSON.parse(readFileSync(join(runDir, "plugin", "hooks", "hooks.json"), "utf8")).hooks;
  assert.equal(hooks.PostToolUse[0].hooks[0].command, "pnpm lint", "the agent's own hooks come along");
  assert.equal(hooks.PreToolUse[0].matcher, "Read|Edit|Write|MultiEdit|NotebookEdit");
  assert.match(hooks.PreToolUse[0].hooks[0].command, /asp-rules\.mjs/);
  assert.deepEqual(JSON.parse(readFileSync(join(runDir, "plugin", "asp-rules.json"), "utf8")),
    [{ name: "rules/testing.md", globs: ["tests/**"], text: "Prefer table-driven tests." }]);

  const mcp = JSON.parse(readFileSync(join(runDir, "plugin", ".mcp.json"), "utf8"));
  assert.deepEqual(mcp.mcpServers.github.env, { GITHUB_TOKEN: "${GITHUB_TOKEN}" }, "secrets stay references on disk");
  const instructions = readFileSync(join(runDir, "instructions.md"), "utf8");
  assert.match(instructions, /Run migrations before tests/);
  assert.doesNotMatch(instructions, /table-driven/, "path-scoped rules are not in the always-on prompt");
  const settings = JSON.parse(readFileSync(join(runDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.permissions.deny, ["Bash(git push --force:*)"]);
  assert.equal(settings.model, "claude-sonnet-5");
  assert.equal(settings.autoMemoryDirectory, join(runDir, "memory", "auto"));
  assert.ok(existsSync(join(runDir, "memory", "auto", "MEMORY.md")), "the package memory is the run's auto memory");
});

test("run on the source project skips instructions the project already has", async () => {
  const { f, pkg } = await packed();
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--dry-run"], { GITHUB_TOKEN: "t", API_BASE: "x" });
  assert.match(res.err, /skipped CLAUDE\.md: the project already has the same file/);
  assert.match(res.err, /skipped rules\/testing\.md/);
  const runDir = /run dir\s+(.*)/.exec(res.err)![1];
  assert.doesNotMatch(readFileSync(join(runDir, "instructions.md"), "utf8"), /Run migrations before tests/);
});

const fakeClaude = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)), ...extra,
});

test("after a run, memory the agent wrote comes back into the package as a signed lineage update", async () => {
  const { f, pkg } = await packed();
  const before = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8"));
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "go"], fakeClaude());
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /recorded memory updated during a claude-code run: \+1 ~1 -0 files/);

  assert.match(readFileSync(join(pkg, "memory", "auto", "refund-race.md"), "utf8"), /per-key lock/);
  const history = readFileSync(join(pkg, "records", "history.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const edge = history.at(-1);
  assert.equal(edge.type, "asp.lineage/v0.2");
  assert.equal(edge.issuer, AGENT);
  assert.deepEqual([edge.body.edge, edge.body.change.layer], ["update", "memory"]);
  const after = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8"));
  assert.notEqual(after.id, before.id, "the manifest is re-signed");
  assert.equal(after.body.lineage_head, edge.id);
  assert.equal((await asp(f, ["verify", pkg])).code, 0, "the updated package verifies");
  assert.match((await asp(f, ["log", "verify"])).out, /log ok: 3 records/, "the edge is in the local log too");

  // A second run extends the same lineage chain.
  const again = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project], fakeClaude({ FAKE_CLAUDE_LEARN: "0" }));
  assert.doesNotMatch(again.err, /recorded/, "nothing changed, nothing recorded");
});

test("no write-back after a failed run or with --no-write-back", async () => {
  const { f, pkg } = await packed();
  const manifest = readFileSync(join(pkg, "manifest.json"), "utf8");
  const failed = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project], fakeClaude({ FAKE_CLAUDE_EXIT: "3" }));
  assert.equal(failed.code, 3);
  assert.match(failed.err, /nothing written back/);
  const opted = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--no-write-back"], fakeClaude());
  assert.equal(opted.code, 0);
  assert.equal(readFileSync(join(pkg, "manifest.json"), "utf8"), manifest);
});

test("a backend swap is detected from the lineage and recorded once", async () => {
  const { f, pkg } = await packed();
  // Simulate an earlier move to another runtime, as a Codex run will record it.
  const signer = new Keystore(f.aspHome).forDid(AGENT)!;
  updatePackage(pkg, { signer, changes: [{ layer: "backend", description: "runtime claude-code -> codex", probationDays: 7 }] });
  assert.equal((await asp(f, ["verify", pkg])).code, 0);
  const history = readFileSync(join(pkg, "records", "history.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(history.at(-1).body.probation_until, "a backend swap starts a probation window");

  const dry = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--dry-run"], fakeClaude());
  assert.match(dry.err, /on claude-code \(last ran on codex\)/);
  assert.match(dry.err, /a real run would record the backend swap codex -> claude-code/);

  const real = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project], fakeClaude({ FAKE_CLAUDE_LEARN: "0" }));
  assert.match(real.err, /recorded runtime codex -> claude-code/);
  const next = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--dry-run"], fakeClaude());
  assert.doesNotMatch(next.err, /last ran on/);
});

test("run names missing secrets, and refuses a package that does not verify", async () => {
  const { f, pkg } = await packed();
  const dry = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--dry-run"]);
  assert.match(dry.err, /missing secrets: API_BASE, GITHUB_TOKEN/);
  const live = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project]);
  assert.equal(live.code, 1, "no launch without its secrets");

  writeFileSync(join(pkg, "memory", "auto", "MEMORY.md"), "tampered\n");
  const refused = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--dry-run"]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /does not verify \(hashes\)/);
});

test("usage errors exit 2", async () => {
  const f = await setup();
  assert.equal((await asp(f, ["pack", "--runtime", "cursor", "--agent", AGENT])).code, 2);
  assert.equal((await asp(f, ["pack", "--runtime", "claude-code"])).code, 2);
  assert.equal((await asp(f, ["frobnicate"])).code, 2);
});
