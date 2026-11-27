// From the repeat-refusal analysis (section 59.2): after an offer on a taken job the refusal adds how many jobs are open; on the second and later times an agent meets the same refusal it adds how many times. True lines; the refusal itself is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("a refusal met again says how many times; an offer on a taken job says how many jobs are open", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-rl-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    const jobs = JSON.parse((await call(a, "look_jobs")).text.split("\n\n")[0]!.replace(/^\[source[^\]]*\]\s*/, "")).result as { job: string; budget: number; purpose?: string }[];
    const j = jobs.find((x) => !/Partner job/.test(x.purpose ?? ""))!;
    assert.equal((await call(a, "offer_on_job", { job: j.job, price: j.budget, plan: "I will do it" })).ok, true);
    const r1 = await call(b, "offer_on_job", { job: j.job, price: j.budget, plan: "I will too" });
    assert.equal(r1.ok, false);
    assert.match(r1.text, /(open now that you can do|That job was taken; \d+ jobs? (is|are) open to you \(look_jobs\)\.)/, "the refusal says which jobs are open: its own line when it has two others, otherwise this one");
    assert.doesNotMatch(r1.text, /times this run/, "the first time is not counted aloud");
    const r2 = await call(b, "offer_on_job", { job: j.job, price: j.budget, plan: "I will too" });
    assert.match(r2.text, /You have met this refusal \(market_refused\) 2 times this run\./);
    const r3 = await call(a, "offer_on_job", { job: j.job, price: j.budget, plan: "again" });
    assert.doesNotMatch(r3.text, /times this run/, "counted per agent");
  } finally { await w.close(); }
});
