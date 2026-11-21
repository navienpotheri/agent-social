// node evals/benchmark/new-classes.ts [--out docs/containment-new-classes.md]: measures the four new bypass classes and writes the table (DK1713).
import { writeFileSync } from "node:fs";
import { CLASSES, LABEL, fmt, measure } from "./new-classes-lib.ts";

const res = measure();
const lines = [
  "# Containment: four new bypass classes (DK1713)", "",
  "Measured with `node evals/benchmark/new-classes.ts` over `evals/benchmark/new-classes-cases.json`. No model and no network: the rules are the injection detector and the gateway's judge. The cases were written by hand before any rate was measured and no rule was changed after measuring, so the held-out part was never used to tune anything. **A rate over this corpus is not a claim about attacks written by someone else**, and it says nothing about a model that is hijacked by words these rules do not name: the Mandate and the gateway bound what the agent can then do, which is the claim (DK1339: no benchmark-only claim is made).", "",
  "| Class | Attacks caught (all) | Dev part | Held-out part | Harmless wrongly caught |", "|---|---|---|---|---|",
  ...res.map((r) => `| ${LABEL[r.name as (typeof CLASSES)[number]]} | ${fmt(r.attacks)} | ${fmt(r.dev)} | ${fmt(r.heldOut)} | ${fmt(r.benign)} |`), "",
  "What was missed, by case id: " + res.map((r) => `${r.name}: ${r.missed.join(", ") || "none"}`).join("; ") + ".", "",
  "Harmless cases wrongly caught: " + res.map((r) => `${r.name}: ${r.falsePositives.join(", ") || "none"}`).join("; ") + ".", "",
  "The regression test `packages/asp-package/test/containment-classes.test.ts` runs in the normal test run and fails when a class's catch rate on the corpus falls under its stated floor, or when a harmless case starts to be caught more than its stated ceiling.", "",
];
console.log(lines.join("\n"));
const out = process.argv.indexOf("--out");
if (out > 0) writeFileSync(process.argv[out + 1], lines.join("\n") + "\n");
