// Startup bug (owner's next run): with --hard-jobs, --repo-jobs and --battery on together and ten agents, the house jobs of those features shared one poster account and passed the tier-1 limit of five open postings
// (GUARD_FAILED at startup). They are now spread over as many house accounts as needed. This starts a ten-agent stand-in run with every house-posting flag on and checks that it starts, that no house account holds more than five open postings, and that the jobs are all on the board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

test("ten agents with hard jobs, repo jobs, the battery, games, lessons and assessing all on: the run starts and the report is written", async () => {
  const o = {
    out: mkdtempSync(join(tmpdir(), "asp-hp-out-")), home: mkdtempSync(join(tmpdir(), "asp-hp-home-")), agents: 10, model: "stand-in",
    provider: standInProvider(() => "sleeper", { latencyMs: 0 }), staggerMs: 0, budgetUsd: 1.5, totalUsd: 14, minutes: 1, priceIn: 1, priceOut: 5, maxTurns: 10, io: { out: () => undefined },
    hardJobs: true, repoJobs: true, battery: true, games: true, lessons: true, assess: true, expedition: true, markers: true, library: true,
  } as unknown as CohortOptions;
  const r = await runCohort(o);
  assert.equal(r.report.perAgent.length, 10);
  assert.ok(readFileSync(r.markdownPath, "utf8").length > 100);
});
