import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toWslPath, wslEnvFor } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, makeOpenHandsFixture, type Fixture } from "./fixture.ts";

const HUMAN = "did:web:example.com:users:navien";
const AGENT = "did:web:example.com:agents:search-coder";

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function packFrom(f: Fixture, runtime: string, extra: string[] = []) {
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN])).code, 0);
  const pkg = join(f.root, "agent.aspkg");
  const res = await asp(f, ["pack", "--runtime", runtime, "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg, ...extra]);
  assert.equal(res.code, 0, res.err);
  return { pkg, res };
}

const fakeOpenHands = (extra: NodeJS.ProcessEnv = {}) => ({
  ASP_OPENHANDS_BIN: process.execPath, ASP_OPENHANDS_SCRIPT: fileURLToPath(new URL("./fake-openhands.mjs", import.meta.url)), ...extra,
});
const harnessOf = (pkg: string) => JSON.parse(readFileSync(join(pkg, "harness", "harness.json"), "utf8"));
const runDirOf = (err: string) => /run dir\s+(.*)/.exec(err)![1];

test("Windows paths map into WSL; WSLENV shares variables untranslated", () => {
  assert.equal(toWslPath("C:\\Users\\me\\.asp\\runs\\x"), "/mnt/c/Users/me/.asp/runs/x");
  assert.equal(toWslPath("D:/work/repo"), "/mnt/d/work/repo");
  assert.equal(toWslPath("\\\\wsl.localhost\\Ubuntu\\home\\me"), "/home/me");
  assert.equal(toWslPath("/home/me/repo"), "/home/me/repo");
  assert.equal(wslEnvFor(["A", "B"], "X/p:A/u"), "X/p:A/u:B/u");
});

test("pack --runtime openhands: context files, skills, microagents, hooks; user MCP and model without the API key", async () => {
  const f = makeOpenHandsFixture();
  const { pkg, res } = await packFrom(f, "openhands", ["--include-user"]);
  assert.match(res.out, /packed .* from openhands/);
  assert.match(res.out, /OpenHands sessions are not indexed yet/);
  const h = harnessOf(pkg);
  assert.deepEqual(h.instructions.map((i: any) => [i.name, i.scope]), [["AGENTS.md", "project"], ["microagents/repo.md", "project"]]);
  assert.deepEqual(h.skills.map((s: any) => s.name).sort(), ["docker", "reindex", "triage"]);
  const docker = h.skills.find((s: any) => s.name === "docker");
  assert.equal(docker.description, "Use when the task mentions: docker, container", "a triggered microagent becomes an on-demand skill");
  assert.match(readFileSync(join(pkg, "harness", "skills", "docker", "SKILL.md"), "utf8"), /triggers: \["docker", "container"\]/);
  assert.equal(h.model, "anthropic/claude-sonnet-5");
  assert.deepEqual(h.mcp_servers.sentry.env, { SENTRY_TOKEN: { $secret: "SENTRY_TOKEN" } });
  assert.deepEqual(Object.keys(h.hooks), ["PostToolUse"]);
  const all = readdirSync(pkg, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => readFileSync(join(e.parentPath, e.name), "utf8")).join("\n");
  assert.doesNotMatch(all, /not-a-real-llm-key|not-a-real-sentry-value/);
  assert.equal((await asp(f, ["verify", pkg])).code, 0);
});

test("a Claude Code agent materialized for OpenHands: a shadow home with its skills, instructions, rules, hooks and MCP", async () => {
  const f = makeFixture();
  const { pkg } = await packFrom(f, "claude-code");
  const res = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "fix the flaky test", "--dry-run"], { GITHUB_TOKEN: "t", API_BASE: "x" });
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /on openhands \(last ran on claude-code\)/);
  assert.match(res.err, /skipped CLAUDE\.md: OpenHands already loads the project's copy/);
  assert.match(res.err, /auto-approves every action/);
  if (process.platform === "win32") assert.match(res.err, /command\s+wsl\.exe -- bash \/mnt\/[a-z]\/\S+\/launch\.sh/);
  const run = runDirOf(res.err);

  assert.ok(existsSync(join(run, "home", ".agents", "skills", "fix-flaky", "SKILL.md")), "skills are native user skills");
  const rule = readFileSync(join(run, "home", ".agents", "skills", "rule-rules-testing", "SKILL.md"), "utf8");
  assert.match(rule, /description: "Rules for files matching tests\/\*\*\. Read before reading or editing such files\."/);
  assert.match(rule, /Prefer table-driven tests/);
  const always = readFileSync(join(run, "home", ".openhands", "microagents", "asp-agent.md"), "utf8");
  assert.doesNotMatch(always, /^---/, "no frontmatter: an always-on microagent");
  assert.doesNotMatch(always, /Run migrations before tests/, "the project's CLAUDE.md loads natively");
  assert.match(always, /- \/ship: Open a PR/);
  assert.match(always, /- Never: Bash\(git push --force:\*\)/);
  assert.match(always, /Migrations first/);
  const hooks = JSON.parse(readFileSync(join(run, "home", ".openhands", "hooks.json"), "utf8")).hooks;
  assert.equal(hooks.PostToolUse[0].matcher, "file_editor", "Claude's Edit maps to OpenHands' file_editor");
  const mcp = JSON.parse(readFileSync(join(run, "mcp.template.json"), "utf8"));
  assert.deepEqual(mcp.mcpServers.github.env, { GITHUB_TOKEN: "${GITHUB_TOKEN}" });

  const launch = readFileSync(join(run, "launch.sh"), "utf8");
  assert.match(launch, /export HOME="\$SHADOW"/);
  assert.match(launch, /case "\$n" in \.agents\|\.openhands\) continue/);
  assert.match(launch, /case "\$n" in microagents\|skills\|hooks\.json\|mcp\.json\|conversations\) continue/);
  assert.match(launch, /SECRETS="\$\(mktemp -d\)"/, "secrets go to a private dir on the Linux filesystem");
  assert.match(launch, /trap 'rm -rf "\$SECRETS"; rm -f "\$SHADOW\/\.openhands\/mcp\.json"' EXIT/);
  assert.match(launch, /ln -sf "\$SECRETS\/mcp\.json" "\$SHADOW\/\.openhands\/mcp\.json"/);
  assert.match(launch, /'--headless' '--json' '-f' '\S+task\.md'/);
  assert.doesNotMatch(launch, /\r/, "LF line endings for bash");
  assert.doesNotMatch(launch + always + JSON.stringify(mcp), /not-a-real-token-value/);
});

test("after a real OpenHands run: the move and the new memory are signed into the package", async () => {
  const f = makeFixture();
  const { pkg } = await packFrom(f, "claude-code");
  const res = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "go"], fakeOpenHands({ GITHUB_TOKEN: "t", API_BASE: "x" }));
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /recorded runtime claude-code -> openhands/);
  assert.match(res.err, /recorded memory updated during a openhands run: \+1 ~1 -0 files/);
  assert.match(readFileSync(join(pkg, "memory", "auto", "openhands-wsl.md"), "utf8"), /inside WSL/);
  assert.equal((await asp(f, ["verify", pkg])).code, 0);
});

test("a ConversationErrorEvent is treated as a failure even though OpenHands exits 0", async () => {
  const f = makeFixture();
  const { pkg } = await packFrom(f, "claude-code");
  const before = readFileSync(join(pkg, "manifest.json"), "utf8");
  const res = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "go"],
    fakeOpenHands({ GITHUB_TOKEN: "t", API_BASE: "x", FAKE_OH_HIDDEN_FAILURE: "invalid x-api-key" }));
  assert.equal(res.code, 1, "a hidden failure fails the run despite exit code 0");
  assert.match(res.err, /openhands reported a failure it did not exit with: AuthenticationError: invalid x-api-key/);
  assert.match(res.err, /openhands failed; nothing written back/);
  assert.doesNotMatch(res.err, /recorded/, "no lineage edge for a run that never actually happened");
  assert.equal(readFileSync(join(pkg, "manifest.json"), "utf8"), before, "the manifest is not re-signed");
  assert.ok(!existsSync(join(pkg, "memory", "auto", "openhands-wsl.md")));
});

test("--model is passed to OpenHands through its environment overrides", async () => {
  const f = makeFixture();
  const { pkg } = await packFrom(f, "claude-code");
  const res = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--model", "anthropic/claude-sonnet-5", "--prompt", "go", "--dry-run"], { GITHUB_TOKEN: "t", API_BASE: "x" });
  assert.match(readFileSync(join(runDirOf(res.err), "launch.sh"), "utf8"), /'--override-with-envs' '--headless'/);
});
