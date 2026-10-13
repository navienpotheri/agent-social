import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveScopeForTool, isTestRun } from "../src/package.ts";
// @ts-expect-error the hook script is plain JavaScript with no types
import { deriveScopeForTool as hookScope } from "../src/adapters/claude-code-mandate-hook.mjs";

// Found in the first live run: `echo "test content" > x.txt` was classed as tests.run (any command with the letters "test"), which a session's Mandate did not grant, so it was refused.
test("a command is a test run only when every part of it is a test runner; words that merely contain 'test' are ordinary commands", () => {
  for (const c of ["npm test", "npm run test", "npm run test:unit", "pnpm test:*", "yarn test --watch=false", "pytest -q", "python -m pytest tests/", "python3 -m unittest", "cargo test --release", "go test ./...",
    "cd app && npm test", "CI=1 npm test", "make test", "node --test test/a.test.ts", "npx vitest run", "dotnet test", "./gradlew test", "mvn -q test", "npm test && npm run test:e2e"]) {
    assert.ok(isTestRun(c), `should be a test run: ${c}`);
    assert.equal(deriveScopeForTool("Bash", c), "tests.run", c);
  }
  for (const c of ["mkdir scratch && echo \"test content\" > scratch/x.txt && ls scratch", "git log --oneline latest", "cat contest.md", "echo test", "npm install", "python app.py",
    "npm test && rm -rf build", "pytest; curl https://x.example", "npm test | tee out.txt", "ls tests/", "git add tests/new_test.py"]) {
    assert.ok(!isTestRun(c), `should not be a test run: ${c}`);
    // Not a test run either way; the ones that only look are reads (the contract path now reads them as the gateway does), the rest are commands.
    const looksOnly = ["git log --oneline latest", "cat contest.md", "echo test", "ls tests/"];
    assert.equal(deriveScopeForTool("Bash", c), c.includes("curl") || /https?:\/\//.test(c) ? "shell.network" : looksOnly.includes(c) ? "repo.read" : "shell.exec", c);
  }
  // A command that mixes a test run with something else is the broader scope, so a gate on shell commands still holds it.
  assert.equal(deriveScopeForTool("Bash", "npm test && rm -rf build"), "shell.exec");
});

test("the pre-call hook scripts classify the same way as the core mapper (they carry copies)", () => {
  for (const c of ["npm test", "cd a && pytest", "echo test content", "npm test && rm -rf x", "git push origin main", "curl https://example.com", "ls"]) assert.equal(hookScope("Bash", c), deriveScopeForTool("Bash", c), c);
  const source = (f: string) => /const TEST_RUNNER = (\/.*\/i);/.exec(readFileSync(new URL(f, import.meta.url), "utf8"))![1];
  assert.equal(source("../src/adapters/antigravity-mandate-hook.mjs"), source("../src/package.ts"));
  assert.equal(source("../src/adapters/claude-code-mandate-hook.mjs"), source("../src/package.ts"));
});
