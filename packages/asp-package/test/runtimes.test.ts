import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNTIMES, runtimeByName, supportMatrix } from "../src/runtimes.ts";

test("every runtime descriptor is whole and claims only what its way of being reached can give", () => {
  const names = RUNTIMES.map((r) => r.name);
  assert.equal(new Set(names).size, names.length, "names are unique");
  for (const r of RUNTIMES) {
    assert.ok(r.title && r.installHint.endsWith(","), `${r.name}: a title and an install hint that runs on into the sentence`);
    // A runtime reached by the gateway can reach `gateway_enforced` at most; one held by its own hook, `hook_enforced`; and the wire says which.
    assert.equal(r.assurance, r.reach === "gateway" ? "gateway_enforced" : "hook_enforced", `${r.name}: the level its reach gives`);
    assert.equal(r.wire === "hooked", r.reach === "hook", `${r.name}: a hooked wire is the hook's reach`);
    assert.match(r.evidence.row, /^UC-\d+$/);
    assert.ok(r.evidence.note.length > 10, `${r.name}: says what was tried`);
  }
});

test("the descriptors say what the session table in the CLI said before they existed", () => {
  const was: Record<string, [string, boolean, boolean]> = {
    "claude-code": ["anthropic", false, false], codex: ["openai", true, false], goose: ["openai", true, true], antigravity: ["hooked", true, false], openhands: ["hooked", true, false],
  };
  assert.deepEqual(RUNTIMES.map((r) => r.name).sort(), Object.keys(was).sort());
  for (const [name, [wire, needsPrompt, needsModel]] of Object.entries(was)) {
    const r = runtimeByName(name)!;
    assert.deepEqual([r.wire, r.needsPrompt, r.needsModel], [wire, needsPrompt, needsModel], name);
  }
});

test("the matrix has a row per runtime and a header, and a claim of 'live' evidence points at a testing-map row", () => {
  const lines = supportMatrix();
  assert.equal(lines.length, RUNTIMES.length + 2);
  assert.match(lines[0], /^runtime\s+reach\s+assurance\s+evidence\s+row\s+what was tried$/);
  for (const r of RUNTIMES) assert.ok(lines.some((l) => l.startsWith(r.name) && l.includes(r.evidence.level)), r.name);
});
