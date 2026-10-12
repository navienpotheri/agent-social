import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: plain .mjs without type declarations
import { globToRegExp } from "../src/adapters/claude-code-rules-hook.mjs";

const HOOK = fileURLToPath(new URL("../src/adapters/claude-code-rules-hook.mjs", import.meta.url));

test("globs: ** spans directories, * stays in one segment, braces alternate", () => {
  const cases: [string, string, boolean][] = [
    ["tests/**", "tests/a.ts", true],
    ["tests/**", "tests/unit/deep/a.ts", true],
    ["tests/**", "src/tests/a.ts", false],
    ["src/**/*.ts", "src/a.ts", true],
    ["src/**/*.ts", "src/api/v1/a.ts", true],
    ["src/**/*.ts", "src/a.tsx", false],
    ["*.md", "README.md", true],
    ["*.md", "docs/README.md", false],
    ["src/*.{ts,tsx}", "src/a.tsx", true],
    ["src/?.ts", "src/ab.ts", false],
  ];
  for (const [glob, path, want] of cases) assert.equal(globToRegExp(glob).test(path), want, `${glob} vs ${path}`);
});

test("the hook injects a matching rule once per session, and nothing otherwise", () => {
  const plugin = mkdtempSync(join(tmpdir(), "asp-plugin-"));
  mkdirSync(join(plugin, "scripts"));
  copyFileSync(HOOK, join(plugin, "scripts", "asp-rules.mjs"));
  writeFileSync(join(plugin, "asp-rules.json"), JSON.stringify([{ name: "rules/testing.md", globs: ["tests/**"], text: "Prefer table-driven tests." }]));
  const project = mkdtempSync(join(tmpdir(), "asp-project-"));
  const call = (file: string, session = "s1") => {
    const r = spawnSync(process.execPath, [join(plugin, "scripts", "asp-rules.mjs")], {
      input: JSON.stringify({ session_id: session, cwd: project, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: join(project, file) } }),
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout ? JSON.parse(r.stdout) : undefined;
  };

  assert.equal(call("src/app.ts"), undefined);
  const first = call("tests/refund.test.ts");
  assert.equal(first.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(first.hookSpecificOutput.additionalContext, /Rule rules\/testing\.md \(applies to tests\/\*\*\):\n\nPrefer table-driven tests\./);
  assert.equal(call("tests/other.test.ts"), undefined, "already injected in this session");
  assert.ok(call("tests/other.test.ts", "s2"), "a new session gets it again");
});
