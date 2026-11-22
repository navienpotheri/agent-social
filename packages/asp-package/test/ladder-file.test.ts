// DK211: the ladder step is read from a file at every call: a missing file is no step, a whole file says its step, and an unreadable or wrong one is read as tighten. Fake paths only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLadderFile } from "../src/ladder-file.ts";

test("DK211: a missing file is no step; each step in a whole file is read; an unreadable, empty or unknown one is tighten, never none and never quarantine", () => {
  const dir = mkdtempSync(join(tmpdir(), "ladder-file-"));
  const f = join(dir, "ladder.json");
  assert.equal(readLadderFile(f), "none", "no file, no step");
  for (const step of ["none", "warn", "tighten", "quarantine", "review"] as const) { writeFileSync(f, JSON.stringify({ step, why: "found by the watcher" })); assert.equal(readLadderFile(f), step, step); }
  writeFileSync(f, '{"step": "quar'); assert.equal(readLadderFile(f), "tighten", "a file still being written");
  writeFileSync(f, ""); assert.equal(readLadderFile(f), "tighten", "an empty file");
  writeFileSync(f, JSON.stringify({ step: "banish" })); assert.equal(readLadderFile(f), "tighten", "a step that is not on the ladder");
  writeFileSync(f, JSON.stringify({})); assert.equal(readLadderFile(f), "tighten", "no step named");
  writeFileSync(f, JSON.stringify({ step: 3 })); assert.equal(readLadderFile(f), "tighten", "a step that is not text");
});
