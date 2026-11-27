/**
 * The paper-to-mechanism pipeline's decisions (docs/lenses/pipeline.md; register row DK80). Reads docs/lenses/mechanisms.json, checks each entry at intake, runs each mechanism through the simulated experiment
 * and writes docs/lenses/decisions/<id>.json and docs/lenses/decisions.md. Run with `npm run pipeline`; a test fails when the files are out of date. The experiments are simulations: see pipeline.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { intakeProblems, runMechanism, type Decision, type MechanismEntry } from "../packages/asp-log/src/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PIPELINE_SEED = 11;
export const loadMechanisms = (): MechanismEntry[] => (JSON.parse(readFileSync(join(ROOT, "docs/lenses/mechanisms.json"), "utf8")) as { mechanisms: MechanismEntry[] }).mechanisms;

export function decisions(): Decision[] {
  const ms = loadMechanisms();
  const bad = ms.flatMap(intakeProblems);
  if (bad.length) throw new Error(`intake refused: ${bad.join("; ")}`);
  return ms.map((m) => runMechanism(m, PIPELINE_SEED));
}
export const decisionFile = (d: Decision): string => JSON.stringify(d, null, 2) + "\n";
export function summary(ds: Decision[]): string {
  return [
    "# Pipeline decisions", "",
    "**Generated** from `docs/lenses/mechanisms.json` by `npm run pipeline` (conformance/generate-pipeline-decisions.ts). Do not edit by hand. Register row DK80; the method is [pipeline.md](pipeline.md).", "",
    "**Every experiment is a simulation.** The effect a mechanism is given is an assumption standing for the paper's claim, so a decision here says the pipeline machinery works (intake, flag, seeded cohorts, lens measure, a rule fixed before the run), never that a paper's claim holds. No code from any paper is reused; every licence is `unknown`.", "",
    "| Mechanism | Paper | Kind | Control | Treatment | Delta | Decision | Rule hash |", "|---|---|---|---|---|---|---|---|",
    ...ds.map((d) => `| ${d.mechanism} | ${d.paper} | ${d.flag.replace("mechanism.", "")} | ${d.measures?.control ?? "n/a"} | ${d.measures?.treatment ?? "n/a"} | ${d.measures?.delta ?? "n/a"} | **${d.decision}** | ${d.rule_sha256.slice(0, 15)} |`),
    "", ...ds.map((d) => `- **${d.mechanism}** (${d.paper}): ${d.reason}`), "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ds = decisions();
  mkdirSync(join(ROOT, "docs/lenses/decisions"), { recursive: true });
  for (const d of ds) writeFileSync(join(ROOT, `docs/lenses/decisions/${d.mechanism}.json`), decisionFile(d));
  writeFileSync(join(ROOT, "docs/lenses/decisions.md"), summary(ds));
  console.log(`wrote ${ds.length} decisions: ${ds.map((d) => `${d.mechanism}=${d.decision}`).join(", ")}`);
}
