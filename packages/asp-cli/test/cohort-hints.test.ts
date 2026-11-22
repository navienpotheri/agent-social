// Row ENG69: two neutral true lines in the first observation (learning is possible here, with my_progress; there is more here than the first look shows), only when the run has something to find (markers or the tour);
// no reward is promised and nothing says to look for anything; a variant without the lines can be run on the same seed and the report says which was run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const LINE = "About this place: learning is possible here, and my_progress shows what you have learned. There is more here than the first look shows.";

test("the two lines are in the first observation only when markers or the tour are on, once, with no promise and no instruction; a variant without them is possible", async () => {
  for (const [opts, shown] of [[{ markers: "s" }, true], [{ expedition: true }, true], [{}, false]] as const) {
    const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-hint-")), ...opts });
    try {
      const a = await w.enrol(0, "agent-01");
      await w.api.market!.enrolStandalone(a);
      const first = await runTool(w.api, a, all, "look_map", {});
      assert.equal(first.text.includes(LINE), shown, JSON.stringify(opts));
      if (shown) {
        assert.equal(first.text.split("About this place").length - 1, 1);
        assert.doesNotMatch(LINE, /reward|bearn|bpay|credit|you (will|must|should)|look for|find the|hunt/i, "no promise and no instruction");
        assert.ok(!(await runTool(w.api, a, all, "look_charters", {})).text.includes("About this place"), "once, not in every observation");
        w.api.hintLines = false;
        const b = await w.enrol(1, "agent-02");
        await w.api.market!.enrolStandalone(b);
        assert.ok(!(await runTool(w.api, b, all, "look_map", {})).text.includes("About this place"), "the variant without the lines");
      }
    } finally { await w.close(); }
  }
});

test("every claim in the lines is true in the run: my_progress exists and shows what was recorded, and something is there to find (a card or a tour stop); the report names the variant", async () => {
  const mk = (extra: Partial<CohortOptions>): CohortOptions => ({ out: mkdtempSync(join(tmpdir(), "asp-hint-out-")), home: mkdtempSync(join(tmpdir(), "asp-hint-home-")), agents: 1, model: "stand-in", provider: standInProvider(() => "learner", { latencyMs: 3 }), budgetUsd: 2, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 20, io: { out: () => undefined }, ...extra } as CohortOptions);
  const on = await runCohort(mk({ markers: "seed-h" }));
  const off = await runCohort(mk({ markers: "seed-h", noHints: true }));
  assert.match(readFileSync(on.markdownPath, "utf8"), /Briefing variant: the two lines about learning and about more to find \(ENG69\) were shown in the first observation; compare two runs on the same seed/);
  assert.match(readFileSync(off.markdownPath, "utf8"), /were left out in the first observation/);
  assert.ok(on.report.perAgent[0]!.tools["my_progress"] >= 1);
  // without something to find the variant line is not printed
  const plain = await runCohort(mk({}));
  assert.doesNotMatch(readFileSync(plain.markdownPath, "utf8"), /Briefing variant: the two lines/);
});
