/**
 * Live check against the installed Codex CLI, with no model call: materializes a Claude Code agent for
 * Codex, then asks Codex to render the prompt it would send (`codex debug prompt-input`) and to list the
 * MCP servers (`codex mcp list --json`) with the adapter's exact -c overrides.
 *
 *   node packages/asp-cli/scripts/codex-live-check.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codex, resolveCodexCommand, type Harness } from "@agent-social/asp-package";
import { main } from "../src/cli.ts";
import { makeFixture } from "../test/fixture.ts";

const f = makeFixture();
const env = { ASP_HOME: f.aspHome };
const io = { out: () => {}, err: (l: string) => console.error(l), env, cwd: f.root };
const human = "did:web:example.com:users:check";
const agent = "did:web:example.com:agents:check-coder";
await main(["identity", "new", "--kind", "human", "--did", human], io);
await main(["identity", "new", "--kind", "agent", "--did", agent, "--sponsor", human], io);
const pkg = join(f.root, "check.aspkg");
if (await main(["pack", "--runtime", "claude-code", "--agent", agent, "--project", f.project, "--user-home", f.home, "--out", pkg], io)) process.exit(1);

const harness = JSON.parse(readFileSync(join(pkg, "harness", "harness.json"), "utf8")) as Harness;
const plan = await codex.materialize({
  pkgDir: pkg, harness, project: f.project, runDir: mkdtempSync(join(tmpdir(), "asp-codex-run-")), agentName: "check-coder",
  env: { ...process.env, GITHUB_TOKEN: "t", API_BASE: "x" }, sourceRuntime: "claude-code",
});
const overrides = plan.args.flatMap((a, i) => (plan.args[i - 1] === "-c" ? ["-c", a] : []));
const { command, prefix } = resolveCodexCommand(process.env);
const codexRun = (...args: string[]) => spawnSync(command, [...prefix, ...args], { cwd: f.project, encoding: "utf8", env: { ...process.env, ...plan.env } });

const prompt = codexRun("debug", "prompt-input", ...overrides, "hello");
if (prompt.status !== 0) { console.error(prompt.stderr); process.exit(1); }
const text = (JSON.parse(prompt.stdout) as any[]).map((i) => (i.content ?? []).map((c: any) => c.text ?? "").join("\n")).join("\n");
const checks: [string, boolean][] = [
  ["developer instructions reach the model", text.includes("You are running as the ASP agent check-coder")],
  ["CLAUDE.md content is carried", text.includes("Run migrations before tests.")],
  ["skill listed with its file", /fix-flaky: Reproduce and fix a flaky test.*agent\/skills\/fix-flaky\/SKILL\.md/.test(text)],
  ["memory index present", text.includes("Migrations first")],
  ["principal's limits stated", text.includes("Never: Bash(git push --force:*)")],
];
const mcp = codexRun("mcp", "list", "--json", ...overrides);
const servers = mcp.status === 0 ? (JSON.parse(mcp.stdout) as any[]) : [];
const gh = servers.find((s) => s.name === "github");
checks.push(["MCP server accepted, secret passed by name", !!gh && JSON.stringify(gh.transport.env_vars) === '["GITHUB_TOKEN"]']);

for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
