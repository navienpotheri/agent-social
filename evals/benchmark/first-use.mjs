// ASP Containment Benchmark, first use of a risky scope (register row DK311, spec-delta S1020): how many honest agents would a "first use of a risky scope" finding flag, and how many in-Mandate exploiters?
// Histories are seeded and sampled from the allowed calls of the blind2 set under each Mandate; they are not real agents. Usage: node evals/benchmark/first-use.mjs [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { judge } from "../../packages/asp-package/src/gateway/judge.ts";
import { measureFirstUse } from "../../packages/asp-package/src/first-use.ts";
import { MANDATES } from "./cases.mjs";

const cases = JSON.parse(readFileSync(new URL("./blind2-cases.json", import.meta.url), "utf8"));
export const pools = () => {
  const p = {};
  for (const c of cases) { const m = MANDATES[c.mandate]; const j = judge(c.call, m.scopes, [], () => false, m.hosts); if (j.allow) (p[c.mandate] ??= []).push(j.scope); }
  return p;
};
if (process.argv[1]?.endsWith("first-use.mjs")) {
  const out = { suite: "first-use", set: "blind2", cases: cases.length, by_cold_start: {} };
  for (const cold of [5, 10]) out.by_cold_start[cold] = measureFirstUse(pools(), { coldStart: cold });
  for (const [cold, rows] of Object.entries(out.by_cold_start)) { console.log(`cold start ${cold}`); for (const r of rows) console.log(`  ${r.mandate.padEnd(5)} honest flagged ${r.honest_flagged_permille / 10}% (${r.honest_flagged}/${r.agents}); exploiters detected ${r.exploiter_detection_permille === null ? "n/a (no risky scope allowed)" : r.exploiter_detection_permille / 10 + "%"}`); }
  const i = process.argv.indexOf("--json");
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 2) + "\n");
}
