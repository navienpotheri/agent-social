import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveScopes, findProjectDataDir, frontmatter, projectSlug, resolveSecrets, scanForSecrets, stripSecrets, toEnvRefs, treeHash,
} from "../src/index.ts";

test("frontmatter reads scalars, inline lists and block lists", () => {
  const fm = frontmatter("---\nname: fix-flaky\ndescription: \"Fix it\"\npaths:\n  - src/**\n  - 'tests/**'\ntools: [Read, Grep]\n---\nbody");
  assert.deepEqual(fm, { name: "fix-flaky", description: "Fix it", paths: ["src/**", "tests/**"], tools: ["Read", "Grep"] });
  assert.deepEqual(frontmatter("no frontmatter"), {});
});

test("secrets: literals become placeholders, env references keep their name, resolution reports what is missing", () => {
  const names = new Set<string>();
  const env = stripSecrets({ API_KEY: "abc", TOKEN: "${GH_TOKEN}", "db-url": "postgres://x" }, names);
  assert.deepEqual(env, { API_KEY: { $secret: "API_KEY" }, TOKEN: { $secret: "GH_TOKEN" }, "db-url": { $secret: "DB_URL" } });
  assert.deepEqual([...names].sort(), ["API_KEY", "DB_URL", "GH_TOKEN"]);
  assert.deepEqual(toEnvRefs(env), { API_KEY: "${API_KEY}", TOKEN: "${GH_TOKEN}", "db-url": "${DB_URL}" });
  assert.deepEqual(resolveSecrets(env, { API_KEY: "1", GH_TOKEN: "2" }), { values: { API_KEY: "1", TOKEN: "2" }, missing: ["DB_URL"] });
});

test("secret scan reports kind and location only", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-scan-"));
  writeFileSync(join(dir, "a.md"), `ok\nkey = "sk-ant-${"x".repeat(30)}"\n`);
  writeFileSync(join(dir, "b.md"), "-----BEGIN OPENSSH PRIVATE KEY-----\n");
  writeFileSync(join(dir, "c.md"), "use ${GITHUB_TOKEN} from the env\n");
  assert.deepEqual(scanForSecrets(dir), [
    { file: "a.md", line: 2, kind: "Anthropic API key" },
    { file: "b.md", line: 1, kind: "private key" },
  ]);
});

test("permission rules map to coarse ASP scopes", () => {
  assert.deepEqual(
    deriveScopes(["Read", "Edit", "Bash(pnpm test:*)", "Bash(git push:*)", "Bash(gh pr create:*)", "Bash(ls)", "WebFetch", "mcp__github__create_issue", "Skill"]),
    ["mcp.github.create_issue", "pr.open", "repo.push", "repo.read", "repo.write", "shell.exec", "tests.run", "tool.skill", "web.read"],
  );
});

test("network-bound shell commands map to shell.network, not shell.exec", () => {
  assert.deepEqual(
    deriveScopes(["Bash(curl https://example.com:*)", "Bash(ssh user@host:*)", "Bash(ls)"]),
    ["shell.exec", "shell.network"],
  );
  assert.deepEqual(deriveScopes(["Bash(wget http://internal:*)"]), ["shell.network"]);
  assert.deepEqual(deriveScopes(["Bash(echo hi | nc 10.0.0.1 80:*)"]), ["shell.network"]);
  assert.deepEqual(deriveScopes(["PowerShell(Invoke-WebRequest -Uri https://example.com:*)"]), ["shell.network"]);
  // A bare URL in the argument (e.g. curl-less fetch scripts) is still caught.
  assert.deepEqual(deriveScopes(["Bash(python fetch.py https://example.com/data:*)"]), ["shell.network"]);
});

test("Claude Code project slugs, with a prefix fallback for truncated long paths", () => {
  assert.equal(projectSlug("C:\\Users\\me\\repo"), "C--Users-me-repo");
  assert.equal(projectSlug("/home/me/my.repo"), "-home-me-my-repo");
  const claude = mkdtempSync(join(tmpdir(), "asp-claude-"));
  const long = "C:\\" + "very-long-directory-name\\".repeat(8) + "repo";
  const truncated = projectSlug(long).slice(0, 200) + "-abc123";
  mkdirSync(join(claude, "projects", truncated), { recursive: true });
  assert.deepEqual(findProjectDataDir(claude, long), { dir: join(claude, "projects", truncated), fuzzy: true });
  assert.deepEqual(findProjectDataDir(claude, "C:\\other"), { fuzzy: false });
});

test("tree hashes depend on paths and contents only", () => {
  const a = mkdtempSync(join(tmpdir(), "asp-tree-"));
  const b = mkdtempSync(join(tmpdir(), "asp-tree-"));
  for (const d of [a, b]) { mkdirSync(join(d, "x")); writeFileSync(join(d, "x", "f.txt"), "hi"); }
  assert.equal(treeHash(a), treeHash(b));
  writeFileSync(join(b, "x", "g.txt"), "");
  assert.notEqual(treeHash(a), treeHash(b));
});
