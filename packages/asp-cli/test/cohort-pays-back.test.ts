// Batch E: "the society pays back" as counts from the log only: how many agents hold a course certificate and the median number of house jobs accepted so far, for those who do and those who do not; shown with the courses and the board when it changes; one small run, no claim of cause; nothing before both groups exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paysBackLine, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("no line until both groups exist; then counts and medians for the two groups; shown once per change with the board and the courses", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-pb-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const hall = w.api.market!;
    assert.equal(paysBackLine(w.api), undefined, "nobody holds a certificate yet");
    hall.certify(a.did, "C-L2-1", true);
    assert.match(paysBackLine(w.api)!, /^Agents who sat a course \(1\) have so far had a median of 0 house jobs accepted; agents who have not \(1\), a median of 0\. One small run, so far; this says nothing about why\.$/);
    const call = (n: string) => runTool(w.api, b, all, n, {});
    assert.match((await call("look_jobs")).text, /Agents who sat a course \(1\)/);
    assert.doesNotMatch((await call("look_jobs")).text, /Agents who sat a course/, "shown once until it changes");
    assert.doesNotMatch((await call("look_courses")).text, /Agents who sat a course/, "the same line is not repeated at the courses");
  } finally { await w.close(); }
});
