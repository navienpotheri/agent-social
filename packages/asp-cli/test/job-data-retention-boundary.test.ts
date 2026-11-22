// Row JO3 (mutation check, launch-bar-2, 2026-11-22): the retention day of a job's data is settlement plus the days the contract allows, counted in whole days of 86,400 seconds, and deletion is due AT that
// moment, not after it. The older test used 30 days and a clock far from the boundary, so a unit slip (seconds for milliseconds) and the edge (`<` against `<=`) went unnoticed. Fake folder, fake contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobDataDelete } from "../src/job-data.ts";

const term = { retention: "retain_days" as const, retain_days: 2 };
const SETTLED = "2026-11-10T12:00:00Z";
const DUE = "2026-11-12T12:00:00Z";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "jd-home-"));
  const path = join(home, "work");
  mkdirSync(path);
  writeFileSync(join(path, "a.txt"), "x");
  return { home, path };
}
const run = (s: { home: string; path: string }, now: string) => jobDataDelete({ home: s.home, contract: "c1", path: s.path, state: "Settled", settledAt: SETTLED, term, now });

test("the due day is the settlement time plus the whole days of the term, to the second", () => {
  const s = setup();
  const r = run(s, "2026-11-11T12:00:00Z");
  assert.equal(r.ok, true);
  assert.equal(r.line?.kind, "data_retained");
  assert.equal(r.line?.due, DUE, "two days of 86,400 seconds after settlement");
  assert.ok(existsSync(s.path), "nothing is deleted before the day");
});

test("one second before the due moment the copies are kept; at the moment they are deleted", () => {
  const before = setup();
  assert.equal(run(before, "2026-11-12T11:59:59Z").line?.kind, "data_retained");
  assert.ok(existsSync(before.path));
  const at = setup();
  const r = run(at, DUE);
  assert.equal(r.line?.kind, "data_deleted", "deletion is due at the moment itself");
  assert.ok(!existsSync(at.path));
});
