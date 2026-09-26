/** A fake Claude Code project and home directory, so tests never read the real ~/.claude. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { projectSlug } from "@agent-social/asp-package";

function put(path: string, content: string | object) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

export interface Fixture {
  root: string;
  project: string;
  home: string;
  aspHome: string;
}

export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "asp-fixture-"));
  const project = join(root, "payments-service");
  const home = join(root, "home");
  const aspHome = join(root, "asp-home");
  const c = join(project, ".claude");

  put(join(project, "CLAUDE.md"), "# Payments service\n\nRun migrations before tests.\nNever skip or delete a test.\n");
  put(join(project, "AGENTS.md"), "Use pnpm, not npm.\n");
  put(join(c, "rules", "testing.md"), "---\npaths:\n  - \"tests/**\"\n---\nPrefer table-driven tests.\n");
  put(join(c, "skills", "fix-flaky", "SKILL.md"), "---\nname: fix-flaky\ndescription: Reproduce and fix a flaky test by running it 50 times\n---\nRun the test 50 times, find the race, fix it.\n");
  put(join(c, "skills", "fix-flaky", "repeat.sh"), "#!/bin/sh\nfor i in $(seq 50); do \"$@\" || exit 1; done\n");
  put(join(c, "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Reviews diffs for skipped tests\ntools: Read, Grep\n---\nReview the diff.\n");
  put(join(c, "commands", "ship.md"), "---\ndescription: Open a PR\n---\nOpen a PR with the change.\n");
  put(join(c, "settings.json"), {
    permissions: { allow: ["Read", "Bash(pnpm test:*)", "Bash(gh pr create:*)"], deny: ["Bash(git push --force:*)"] },
    hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "pnpm lint" }] }] },
    env: { API_BASE: "https://payments.internal.example", GITHUB_TOKEN: "${GITHUB_TOKEN}" },
  });
  put(join(c, "settings.local.json"), { permissions: { allow: ["Edit"] }, model: "claude-sonnet-5" });
  put(join(project, ".mcp.json"), { mcpServers: { github: { command: "npx", args: ["-y", "github-mcp"], env: { GITHUB_TOKEN: "not-a-real-token-value" } } } });

  const data = join(home, ".claude", "projects", projectSlug(project));
  put(join(data, "memory", "MEMORY.md"), "- [Migrations first](migrations.md) — run migrations before tests\n");
  put(join(data, "memory", "migrations.md"), "---\nname: migrations-first\n---\nThe payments repo needs `pnpm migrate` before `pnpm test`.\n");
  const lines = [
    { type: "user", timestamp: "2026-09-20T10:00:00Z", version: "2.1.300", message: { role: "user", content: "fix the flaky refund test" } },
    { type: "assistant", timestamp: "2026-09-20T10:00:05Z", version: "2.1.300", message: { model: "claude-sonnet-5", content: [{ type: "tool_use", name: "Bash", input: {} }, { type: "tool_use", name: "Read", input: {} }], usage: { output_tokens: 120 } } },
    { type: "user", timestamp: "2026-09-20T10:00:09Z", version: "2.1.300", message: { role: "user", content: [{ type: "tool_result", is_error: true, content: "boom" }] } },
    { type: "assistant", timestamp: "2026-09-20T10:01:00Z", version: "2.1.300", message: { model: "claude-sonnet-5", content: [{ type: "tool_use", name: "Bash", input: {} }], usage: { output_tokens: 80 } } },
  ];
  put(join(data, "11111111-2222.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  // User scope: only captured with --include-user. ~/.claude.json also holds a (fake) OAuth token that must never be captured.
  put(join(home, ".claude", "CLAUDE.md"), "Answer tersely.\n");
  put(join(home, ".claude", "skills", "fix-flaky", "SKILL.md"), "---\nname: fix-flaky\ndescription: user copy\n---\nuser version\n");
  put(join(home, ".claude.json"), {
    oauthAccount: { accessToken: "fake-oauth-token-must-not-leak" },
    mcpServers: { notes: { type: "http", url: "https://notes.example/mcp", headers: { Authorization: "Bearer-less-fake" } } },
  });
  return { root, project, home, aspHome };
}

/** A fake Codex project and home: AGENTS.md, .agents/skills, .codex/config.toml, hooks, rules, rollouts. */
export function makeCodexFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "asp-codex-fixture-"));
  const project = join(root, "billing-api");
  const home = join(root, "home");
  const aspHome = join(root, "asp-home");

  put(join(project, "AGENTS.md"), "# Billing API\n\nUse pnpm. Run `pnpm test` before every commit.\n");
  put(join(project, ".agents", "skills", "bump-deps", "SKILL.md"), "---\nname: bump-deps\ndescription: Upgrade dependencies one at a time and run tests after each\n---\nUpgrade one dependency, test, commit.\n");
  put(join(project, ".codex", "config.toml"), [
    'model = "gpt-6-sol"',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    "",
    "[mcp_servers.linear]",
    'command = "npx"',
    'args = ["-y", "linear-mcp"]',
    'env = { LINEAR_API_KEY = "lin_not_a_real_value" }',
    'env_vars = ["LINEAR_WORKSPACE"]',
    "",
    "[mcp_servers.docs]",
    'url = "https://docs.example/mcp"',
    'bearer_token_env_var = "DOCS_TOKEN"',
    'env_http_headers = { "X-Team" = "DOCS_TEAM" }',
    "",
  ].join("\n"));
  put(join(project, ".codex", "hooks.json"), { hooks: { Stop: [{ hooks: [{ type: "command", command: "pnpm lint" }] }] } });
  put(join(project, ".codex", "rules", "default.rules"), 'prefix_rule(pattern = ["git", "push"], decision = "prompt")\n');

  const codexHome = join(home, ".codex");
  put(join(codexHome, "AGENTS.md"), "Be concise.\n");
  put(join(codexHome, "memories", "memory_summary.md"), "Prefers small PRs.\n");
  const rollout = (cwd: string, id: string) => [
    { timestamp: "2026-09-21T09:00:00Z", type: "session_meta", payload: { id, cwd, cli_version: "0.157.1" } },
    { timestamp: "2026-09-21T09:00:01Z", type: "turn_context", payload: { model: "gpt-6-sol" } },
    { timestamp: "2026-09-21T09:00:02Z", type: "event_msg", payload: { type: "user_message", message: "bump lodash" } },
    { timestamp: "2026-09-21T09:00:05Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: "{}" } },
    { timestamp: "2026-09-21T09:00:06Z", type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: "{}" } },
    { timestamp: "2026-09-21T09:00:07Z", type: "event_msg", payload: { type: "mcp_tool_call_end", invocation: { server: "linear", tool: "create_issue" }, result: { Err: "x" } } },
    { timestamp: "2026-09-21T09:00:08Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { output_tokens: 321 } } } },
    { timestamp: "2026-09-21T09:00:09Z", type: "event_msg", payload: { type: "agent_message", message: "done" } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n";
  put(join(codexHome, "sessions", "2026", "09", "21", "rollout-2026-09-21T09-00-00-aaa.jsonl"), rollout(project, "aaa"));
  put(join(codexHome, "sessions", "2026", "09", "21", "rollout-2026-09-21T10-00-00-bbb.jsonl"), rollout(join(root, "other-repo"), "bbb"));
  return { root, project, home, aspHome };
}
