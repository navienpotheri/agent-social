import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { tomlValue } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeCodexFixture, makeFixture, type Fixture } from "./fixture.ts";

const HUMAN = "did:web:example.com:users:navien";
const AGENT = "did:web:example.com:agents:billing-coder";

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

const harnessOf = (pkg: string) => JSON.parse(readFileSync(join(pkg, "harness", "harness.json"), "utf8"));
const fakeCodex = (extra: NodeJS.ProcessEnv = {}) => ({
  ASP_CODEX_BIN: process.execPath, ASP_CODEX_SCRIPT: fileURLToPath(new URL("./fake-codex.mjs", import.meta.url)), ...extra,
});

/** The -c overrides in the arguments codex was launched with, parsed back from TOML. */
function overrides(args: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  args.forEach((a, i) => {
    if (args[i - 1] !== "-c") return;
    const eq = a.indexOf("=");
    out[a.slice(0, eq)] = plain(parseToml(`v = ${a.slice(eq + 1)}`).v);
  });
  return out;
}

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test("tomlValue writes one-line TOML that parses back", () => {
  const v = { a: "multi\nline \"quoted\" \\ text", list: ["x", "y"], n: 3, b: false, "X-Team": "T" };
  assert.doesNotMatch(tomlValue(v), /\n/);
  assert.deepEqual(plain(parseToml(`v = ${tomlValue(v)}`).v), v);
});

test("pack --runtime codex captures AGENTS.md, skills, config, MCP, hooks, rules and this project's sessions", async () => {
  const f = makeCodexFixture();
  const { pkg, res } = await packFrom(f, "codex");
  assert.match(res.out, /packed .* from codex/);
  assert.match(res.out, /sessions\s+1 indexed/, "only sessions whose cwd is this project");
  const h = harnessOf(pkg);
  assert.deepEqual(h.instructions.map((i: any) => [i.name, i.scope]), [["AGENTS.md", "project"]]);
  assert.deepEqual(h.skills.map((s: any) => [s.name, s.description]), [["bump-deps", "Upgrade dependencies one at a time and run tests after each"]]);
  assert.equal(h.model, "gpt-6-sol");
  assert.deepEqual(h.runtime_specific.codex, { approval_policy: "on-request", sandbox_mode: "workspace-write", rules: ["codex/rules/default.rules"] });
  assert.deepEqual(h.mcp_servers.linear.env, { LINEAR_API_KEY: { $secret: "LINEAR_API_KEY" }, LINEAR_WORKSPACE: { $secret: "LINEAR_WORKSPACE" } });
  assert.deepEqual(h.mcp_servers.docs.headers, { "X-Team": { $secret: "DOCS_TEAM" } });
  assert.equal(h.mcp_servers.docs.bearer_token_env_var, "DOCS_TOKEN");
  assert.deepEqual(h.secrets, ["DOCS_TEAM", "DOCS_TOKEN", "LINEAR_API_KEY", "LINEAR_WORKSPACE"]);
  assert.deepEqual(Object.keys(h.hooks), ["Stop"]);
  assert.ok(!existsSync(join(pkg, "memory", "codex")), "global Codex memories need --include-user");
  const all = readdirSync(pkg, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => readFileSync(join(e.parentPath, e.name), "utf8")).join("\n");
  assert.doesNotMatch(all, /lin_not_a_real_value/);

  const [s] = readFileSync(join(pkg, "experience", "sessions.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([s.session, s.runtime, s.runtime_version, s.prompts, s.assistant_turns, s.output_tokens, s.tool_errors],
    ["aaa", "codex", "0.157.1", 1, 1, 321, 1]);
  assert.deepEqual(s.tool_calls, { shell: 1, apply_patch: 1, "mcp__linear__create_issue": 1 });
  assert.equal((await asp(f, ["verify", pkg])).code, 0);
});

test("--include-user adds the Codex home's AGENTS.md and (global) memories", async () => {
  const f = makeCodexFixture();
  const { pkg, res } = await packFrom(f, "codex", ["--include-user"]);
  const h = harnessOf(pkg);
  assert.deepEqual(h.instructions.map((i: any) => i.scope), ["user", "project"]);
  assert.ok(existsSync(join(pkg, "memory", "codex", "memory_summary.md")));
  assert.match(res.out, /shared across all projects/);
});

test("a Claude Code agent runs on Codex: everything it carries reaches developer_instructions and -c overrides", async () => {
  const f = makeFixture();
  const { pkg } = await packFrom(f, "claude-code");
  const target = join(f.root, "billing-api");
  const res = await asp(f, ["run", pkg, "--backend", "codex", "--project", f.project, "--prompt", "fix the flaky test", "--dry-run"], fakeCodex());
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /on codex \(last ran on claude-code\)/);
  assert.match(res.err, /a real run would record the backend swap claude-code -> codex/);
  assert.match(res.err, /missing secrets: API_BASE, GITHUB_TOKEN/);
  assert.match(res.err, /not using the packed model claude-sonnet-5/);
  assert.match(res.err, /hooks are not carried to Codex yet/);
  void target;
  const command = /command\s+(.*)/.exec(res.err)![1];
  assert.match(command, / exec --json -C \S+ -s workspace-write --add-dir \S+memory"? /);

  // The exact arguments, from a real launch of the fake codex.
  const argsFile = join(f.root, "codex-args.json");
  const live = await asp(f, ["run", pkg, "--backend", "codex", "--project", f.project, "--prompt", "fix the flaky test", "--no-write-back"],
    fakeCodex({ GITHUB_TOKEN: "t", API_BASE: "x", FAKE_CODEX_ARGS: argsFile, FAKE_CODEX_LEARN: "0" }));
  assert.equal(live.code, 0, live.err);
  const args: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.equal(args.at(-1), "fix the flaky test");
  const o = overrides(args);
  const dev = o.developer_instructions as string;
  assert.match(dev, /## CLAUDE\.md\n\n# Payments service/, "CLAUDE.md is not native to Codex, so it is carried");
  assert.match(dev, /## rules\/testing\.md \(applies only when working on files matching tests\/\*\*\)/);
  assert.match(dev, /- fix-flaky: Reproduce and fix a flaky test by running it 50 times \(file: \S+\/agent\/skills\/fix-flaky\/SKILL\.md\)/);
  assert.match(dev, /- \/ship: Open a PR \(file: \S+\/agent\/commands\/ship\.md\)/);
  assert.match(dev, /- reviewer: Reviews diffs for skipped tests/);
  assert.match(dev, /- Never: Bash\(git push --force:\*\)/);
  assert.match(dev, /Migrations first/, "memory index");
  assert.match(res.err, /skipped AGENTS\.md: Codex already loads the project's copy/);
  assert.deepEqual(o["mcp_servers.github.env_vars"], ["GITHUB_TOKEN"], "secrets by name only");
  assert.equal(o["mcp_servers.github.command"], "npx");
  assert.ok(!args.some((a) => a.includes("not-a-real-token-value")));
});

test("after a real Codex run: the move and the new memory are signed into the package", async () => {
  const f = makeFixture();
  const { pkg } = await packFrom(f, "claude-code");
  const env = fakeCodex({ GITHUB_TOKEN: "t", API_BASE: "x" });
  const res = await asp(f, ["run", pkg, "--backend", "codex", "--project", f.project, "--prompt", "go", "--model", "gpt-6-sol"], env);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /recorded runtime claude-code -> codex/);
  assert.match(res.err, /recorded memory updated during a codex run: \+1 ~1 -0 files/);
  assert.match(readFileSync(join(pkg, "memory", "auto", "codex-sandbox.md"), "utf8"), /pnpm install/);
  assert.equal((await asp(f, ["verify", pkg])).code, 0);

  const next = await asp(f, ["run", pkg, "--backend", "codex", "--project", f.project, "--dry-run"], env);
  assert.doesNotMatch(next.err, /last ran on/, "Codex is now the current runtime");
  const back = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--dry-run"], env);
  assert.match(back.err, /on claude-code \(last ran on codex\)/);
});

test("pack --runtime codex, run on Claude Code: Codex skills and AGENTS.md come across", async () => {
  const f = makeCodexFixture();
  const { pkg } = await packFrom(f, "codex");
  const other = join(f.root, "other-repo");
  const res = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", other, "--dry-run"], {
    LINEAR_API_KEY: "a", LINEAR_WORKSPACE: "b", DOCS_TOKEN: "c", DOCS_TEAM: "d",
  });
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /not using the packed model gpt-6-sol/);
  const runDir = /run dir\s+(.*)/.exec(res.err)![1];
  assert.ok(existsSync(join(runDir, "workspace", ".claude", "skills", "bump-deps", "SKILL.md")));
  assert.match(readFileSync(join(runDir, "instructions.md"), "utf8"), /Run `pnpm test` before every commit/);
});
