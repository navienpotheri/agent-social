// DK185 (bank-insurer.md 13.2, 14; BI-15 to BI-17): the Insurer's experience rating, credit-cycle rule and premium holidays, as pure drivers and a replayable simulation over a ledger that enforces the floor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cyclePermille, experiencePermille, holiday, quotePremium, simulateInsurer } from "../src/index.ts";

test("the experience factor: clean runs lower the premium by 2 % each up to 20 %, a strike adds 10 %, a claim adds 20 %, within 80 % and 150 %", () => {
  assert.equal(experiencePermille({ cleanRuns90: 0, strikes30: 0, claims90: 0 }), 1000);
  assert.equal(experiencePermille({ cleanRuns90: 5, strikes30: 0, claims90: 0 }), 900);
  assert.equal(experiencePermille({ cleanRuns90: 40, strikes30: 0, claims90: 0 }), 800, "never below 80 %");
  assert.equal(experiencePermille({ cleanRuns90: 0, strikes30: 2, claims90: 1 }), 1400);
  assert.equal(experiencePermille({ cleanRuns90: 0, strikes30: 9, claims90: 9 }), 1500, "never above 150 %");
});

test("the credit-cycle rule: cover costs more as the reserve nears its floor and less when it is plentiful", () => {
  assert.equal(cyclePermille(500, 500), 1250);
  assert.equal(cyclePermille(599, 500), 1250);
  assert.equal(cyclePermille(600, 500), 1000);
  assert.equal(cyclePermille(1500, 500), 1000);
  assert.equal(cyclePermille(1501, 500), 900);
});

test("a premium holiday is a seeded draw of about one month in twelve and never when the reserve is thin; the same seed gives the same months", () => {
  const months = Array.from({ length: 240 }, (_, i) => `m${i}`);
  const rich = months.filter((m) => holiday("seed-a", m, 5000, 500));
  assert.ok(rich.length >= 8 && rich.length <= 40, `${rich.length} of 240`);
  assert.deepEqual(rich, months.filter((m) => holiday("seed-a", m, 5000, 500)), "replays");
  assert.notDeepEqual(rich, months.filter((m) => holiday("seed-b", m, 5000, 500)));
  assert.equal(months.filter((m) => holiday("seed-a", m, 900, 500)).length, 0, "a reserve under 3 times the floor never gives a holiday");
  const m = rich[0];
  assert.equal(quotePremium(10, { cleanRuns90: 0, strikes30: 0, claims90: 0 }, 5000, 500, "seed-a", m), 5, "a holiday halves the premium");
  assert.equal(quotePremium(1, { cleanRuns90: 99, strikes30: 0, claims90: 0 }, 5000, 500, "seed-a", m), 1, "never below 1 credit");
});

test("simulation: with the drivers on and off, over 24 months and 40 holders, the reserve is never negative and no sale leaves it under the floor; a claim is paid down to the reserve; the run replays from its seed", () => {
  for (const drivers of [false, true]) {
    for (const reserve of [600, 1500]) {
      const a = simulateInsurer({ seed: "sim-1", months: 24, holders: 40, reserve, drivers });
      assert.ok(a.minReserve >= 0, `drivers ${drivers}, reserve ${reserve}: minimum ${a.minReserve}`);
      assert.equal(a.salesUnderFloor, 0);
      assert.ok(a.sales > 0);
      assert.deepEqual(simulateInsurer({ seed: "sim-1", months: 24, holders: 40, reserve, drivers }), a, "same seed, same run");
      assert.notEqual(simulateInsurer({ seed: "sim-2", months: 24, holders: 40, reserve, drivers }).trace, a.trace);
    }
  }
});

test("simulation: a thin reserve refuses sales at the floor, and experience rating makes the clean holders' premium per clean job fall at least 15 % against the table while the dirty holders pay more than the clean", () => {
  const thin = simulateInsurer({ seed: "thin", months: 12, holders: 40, reserve: 400, drivers: true });
  assert.ok(thin.refusedByFloor > 0, "a sale that would leave the reserve under the floor is refused");
  assert.equal(thin.salesUnderFloor, 0);
  const on = simulateInsurer({ seed: "rated", months: 24, holders: 40, reserve: 1500, drivers: true });
  assert.ok(on.premiumPerCleanJob.clean <= 40 * 0.85, `clean holders pay ${on.premiumPerCleanJob.clean} per clean job against the table 40`);
  assert.ok(on.premiumPerCleanJob.dirty > on.premiumPerCleanJob.clean, "dirty holders pay more per clean job than clean ones");
});
