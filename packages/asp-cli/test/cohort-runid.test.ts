// Row ENG119: the intermittent BAD_SIGNATURE (operator#key-1). Cause: a run is named by its start time to the second, so two runs started in the same second into one output folder shared a society folder and a log; the second
// world appended its operator's passport, signed with a new key, to the first world's log and the log refused it. A run whose name is taken now gets a numbered suffix. It can only happen when two runs share an output
// folder and start in the same second (a script or a test); a person's single run, or two runs in different folders, cannot meet it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

test("two runs started in the same second into one folder get different run folders and both complete", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-runid-out-")), home: mkdtempSync(join(tmpdir(), "asp-runid-home-")), agents: 1, model: "stand-in", provider: standInProvider(() => "silent", { latencyMs: 4 }), staggerMs: 0, budgetUsd: 2, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 10, io: { out: () => undefined }, now: () => Date.UTC(2026, 10, 24, 10, 0, 0) } as CohortOptions;
  const a = await runCohort(o), b = await runCohort(o), c = await runCohort(o);
  const dirs = readdirSync(o.out).filter((d) => d.startsWith("cohort-")).sort();
  assert.deepEqual(dirs, ["cohort-20261124T100000Z", "cohort-20261124T100000Z-2", "cohort-20261124T100000Z-3"]);
  assert.equal(new Set([a.dir, b.dir, c.dir]).size, 3);
});
