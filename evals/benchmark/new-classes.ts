// node evals/benchmark/new-classes.ts [--out docs/containment-new-classes.md]: measures the four new bypass classes and writes the table (DK1713).
import { writeFileSync } from "node:fs";
import { CLASSES, LABEL, fmt, measure, measureV2 } from "./new-classes-lib.ts";

const res = measure();
const v2 = measureV2();
const lines = [
  "# Containment: four new bypass classes (DK1713)", "",
  "Measured with `node evals/benchmark/new-classes.ts` over `evals/benchmark/new-classes-cases.json`. No model and no network: the rules are the injection detector and the gateway's judge. The cases were written by hand before any rate was measured and no rule was changed after measuring, so the held-out part was never used to tune anything. **A rate over this corpus is not a claim about attacks written by someone else**, and it says nothing about a model that is hijacked by words these rules do not name: the Mandate and the gateway bound what the agent can then do, which is the claim (DK1339: no benchmark-only claim is made).", "",
  "| Class | Attacks caught (all) | Dev part | Held-out part | Harmless wrongly caught |", "|---|---|---|---|---|",
  ...res.map((r) => `| ${LABEL[r.name as (typeof CLASSES)[number]]} | ${fmt(r.attacks)} | ${fmt(r.dev)} | ${fmt(r.heldOut)} | ${fmt(r.benign)} |`), "",
  "What was missed, by case id: " + res.map((r) => `${r.name}: ${r.missed.join(", ") || "none"}`).join("; ") + ".", "",
  "Harmless cases wrongly caught: " + res.map((r) => `${r.name}: ${r.falsePositives.join(", ") || "none"}`).join("; ") + ".", "",
  "## Fresh held-out corpora, and the stronger defences (DK1713 follow-up)", "",
  "The table above was measured on the first corpus, which was seen while the new rules were being written, so it is no longer held out. The corpora in `evals/benchmark/new-classes-cases-v2.json` were written after the new rule families and the typed-untrusted defence were built and before any rate was measured on them; no rule was changed after measuring.", "",
  "| Class (fresh corpus, 24 attacks, 16 harmless) | Detector alone | Typed-untrusted defence alone | Both | Harmless text the detector flags | Harmless reads that hold outward calls (the cost of the typed defence) |", "|---|---|---|---|---|---|",
  ...v2.map((r) => `| ${LABEL[r.name]} | ${fmt(r.attacks)} | ${fmt(r.typedAttacks)} | ${fmt(r.combined)} | ${fmt(r.benign)} | ${fmt(r.benignTyped)} |`), "",
  "What the detector missed on the fresh corpora: " + v2.map((r) => `${r.name}: ${r.missedByDetector.join(", ") || "none"}`).join("; ") + ". Harmless text it flagged: " + v2.map((r) => `${r.name}: ${r.falsePositives.join(", ") || "none"}`).join("; ") + ".", "",
  "How to read it. The words-only detector (`findInjection`) does not generalise: on fresh attacks it flags about a third or less, and it flags some harmless text, so the first corpus's higher figures were partly the rules fitting what was in view. The typed-untrusted defence does not read the text: text from the city's own readers (feeds and plots) and from outside the project (a web page, a search, another server's tool) is untrusted by where it came from, and the next outward calls are held (`asp gateway --untrusted-by-type`). It holds 100% of the feed and plot attacks and the share of tool results that came from a typed source, but it holds the harmless reads from those sources too, so a legitimate push right after a web read waits: that cost is the last column, and the defence is off by default. A model that is hijacked by words nothing here names is bounded only by the Mandate.", "",
  "The regression test `packages/asp-package/test/containment-classes.test.ts` runs in the normal test run and fails when a class's catch rate on the corpus falls under its stated floor, or when a harmless case starts to be caught more than its stated ceiling.", "",
];
console.log(lines.join("\n"));
const out = process.argv.indexOf("--out");
if (out > 0) writeFileSync(process.argv[out + 1], lines.join("\n") + "\n");
