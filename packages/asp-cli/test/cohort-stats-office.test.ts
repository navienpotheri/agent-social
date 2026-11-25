// The statistics office (owner decision): a read-only tool and report section: a job price index (first reading 100), the volume of work, the agents without work, Gini and top-three share of credits, organisations' share (none yet) and a shadow policy rate that is computed and never applied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gini, shadowRate, statsOf } from "../src/cohort/stats.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("Gini and the shadow rate are plain arithmetic", () => {
  assert.equal(gini([5, 5, 5, 5]), 0);
  assert.ok(Math.abs(gini([0, 0, 0, 10]) - 0.75) < 1e-9);
  assert.equal(shadowRate(100, 20), 2);
  assert.equal(shadowRate(110, 40), 2 + 5 + 5);
});
test("stats_look counts from the log: the first reading of the price index is 100, agents without work are counted, nothing is changed by looking", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-stats-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const before = await w.api.market!.balance(a);
    const t = (await runTool(w.api, a, all, "stats_look", {})).text;
    assert.match(t, /^Statistics office \(counted from the log; read only; mock credits\)\. Jobs open \d+, mean budget [\d.]+, price index 100 \(first reading = 100\)\./);
    assert.match(t, /2 of 2 agents have no accepted delivery yet/);
    assert.match(t, /organisations hold 0% of the simulation credits of the organisation ledger\. Shadow policy rate [-\d.]+% \(.*never applied/);
    const s = await statsOf(w.api);
    assert.equal(s!.agents, 2); assert.equal(s!.priceIndex, 100);
    assert.equal(await w.api.market!.balance(a), before, "looking costs nothing");
  } finally { await w.close(); }
});
