import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

test("asp runtimes prints the support matrix: every runtime asp run starts, how it is reached, and the evidence; and each run command still knows its install hint", async () => {
  const f = makeFixture();
  const out: string[] = [], err: string[] = [];
  const code = await main(["runtimes"], { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
  assert.equal(code, 0, err.join("\n"));
  const text = out.join("\n");
  assert.match(text, /^runtime\s+reach\s+assurance\s+evidence\s+row\s+what was tried/);
  for (const name of ["claude-code", "codex", "goose", "antigravity", "openhands"]) assert.match(text, new RegExp(`^${name}\\s`, "m"), name);
  assert.match(text, /^codex\s+gateway\s+gateway_enforced\s+live\s+UC-11/m);
  assert.match(text, /^antigravity\s+hook\s+hook_enforced\s+partial\s+UC-13/m);
  assert.match(text, /not claimed until a row says so/);
  // The runtime table now comes from the descriptors: a tool that is not installed still gets its own install hint.
  const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: "asp-no-such-tool-for-test" };
  const o2: string[] = [], e2: string[] = [];
  await main(["run", "claude-code", "--local", "--prompt", "x", "--project", f.root], { out: (l) => o2.push(l), err: (l) => e2.push(l), env, cwd: f.root } as Io);
  assert.match(o2.join("\n") + e2.join("\n"), /Install Claude Code \(https:\/\/claude\.com\/claude-code\)/);
});
