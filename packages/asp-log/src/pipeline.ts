/**
 * The paper-to-mechanism pipeline (docs/lenses/pipeline.md; register row DK80, mechanism registry in part DK89). Pure functions: intake (a licence statement, a source credit, no reused code of unknown licence, and an
 * injection gate: imported text is data, never instructions), the cohort assignment by a seeded rule over the agent id, the experiment on a simulated society (control against treatment, the same agents and the same seed),
 * and the decision by a rule fixed before the run. **The experiments here are simulations: the effect a mechanism is given is an assumption standing for the paper's claim, so a decision says whether the pipeline
 * machinery works, never whether a paper's claim holds.** A mechanism the API cohort cannot run is deferred, not tested. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { lensRecalibration, simulateSociety } from "./telemetry.ts";

export interface MechanismEntry {
  id: string; kind: "communication" | "memory" | "planning" | "belief" | "rule"; paper: string; cite: string; claim: string; source_credit: string;
  licence: { status: string; code_reused: boolean }; flag: string; requires: { runtime: "api" | "open-weight" }; lens: string; cells: string[];
  simulation: { skill_boost: number; note: string };
  rule: { metric: "median_efficiency"; min_delta: number; kill_delta: number; min_agents_per_arm: number };
}

/** The shapes that read as an instruction to a reader (an agent): imported text that matches any of them is refused at intake as data that tries to act. */
const INSTRUCTION_SHAPES = [/ignore (all |any |the )?(previous|prior|above) (instructions|rules)/i, /\byou (must|should) (now|immediately)\b/i, /\bsystem prompt\b/i, /\bdisregard\b.*\b(rules|instructions|code)\b/i, /\bexfiltrate\b/i, /<\s*script\b/i];

/** What is wrong with an intake entry, or nothing: a source credit, a licence statement, no code of unknown licence reused, and no instruction in the text. */
export function intakeProblems(m: MechanismEntry): string[] {
  const out: string[] = [];
  if (!m.cite || m.cite.length < 10) out.push(`${m.id}: no citation`);
  if (!m.source_credit) out.push(`${m.id}: no source credit`);
  if (!m.licence?.status) out.push(`${m.id}: no licence statement`);
  if (m.licence?.status === "unknown" && m.licence.code_reused) out.push(`${m.id}: code of an unknown licence is reused`);
  if (!m.flag.startsWith("mechanism.")) out.push(`${m.id}: the flag is mechanism.<name>`);
  for (const [field, text] of [["claim", m.claim], ["cite", m.cite], ["note", m.simulation?.note ?? ""]] as const) for (const re of INSTRUCTION_SHAPES) if (re.test(text)) out.push(`${m.id}: ${field} reads as an instruction (${re}): imported text is data, never instructions`);
  return out;
}

/** The hash of the decision rule, carried by every decision record so a rule cannot change after the data are in. */
export const ruleHash = (rule: MechanismEntry["rule"]): string => `sha256:${createHash("sha256").update(JSON.stringify(rule, Object.keys(rule).sort())).digest("hex")}`;

/** The arm of an agent for a mechanism: a seeded hash, so no one picks cohorts by hand. */
export const armOf = (agent: string, mechanism: string, seed: number): "control" | "treatment" => (parseInt(createHash("sha256").update(`${seed}|${mechanism}|${agent}`).digest("hex").slice(0, 8), 16) % 2 === 0 ? "control" : "treatment");

export interface Decision {
  mechanism: string; paper: string; cite: string; source_credit: string; licence: { status: string; code_reused: boolean }; flag: string; lens: string; cells: string[];
  rule: MechanismEntry["rule"]; rule_sha256: string; seed: number; simulated: true; note: string;
  measures: { control: number | null; treatment: number | null; delta: number | null; agents_per_arm: { control: number; treatment: number } } | null;
  decision: "adopt" | "tune" | "kill" | "deferred"; reason: string;
}

const TRUTH = { P1: 1, P2: 0, P3: 0, P4: 0, P5: 0 } as const;
const PRIOR = { P1: 0.2, P2: 0.1, P3: 0.1, P4: 0.7, P5: 0.3 };
const LR = { P1: 196, P2: 1, P3: 1, P4: 0.35, P5: 1 };

/**
 * Runs one mechanism through the pipeline on a simulated society: 120 agents are split by `armOf`, the treatment arm gets the mechanism's simulation parameter, the lens of belief recalibration is computed for each
 * arm, and the rule fixed in advance decides. A mechanism that needs open-weight models is deferred without a run.
 */
export function runMechanism(m: MechanismEntry, seed: number, n = 120): Decision {
  const base = { mechanism: m.id, paper: m.paper, cite: m.cite, source_credit: m.source_credit, licence: m.licence, flag: m.flag, lens: m.lens, cells: m.cells, rule: m.rule, rule_sha256: ruleHash(m.rule), seed, simulated: true as const, note: m.simulation.note };
  if (m.requires.runtime !== "api") return { ...base, measures: null, decision: "deferred", reason: `needs ${m.requires.runtime} models with white-box access, which the API cohort cannot give: no experiment was run (DK90)` };
  const ids = Array.from({ length: n }, (_, i) => `sim-agent-${String(i + 1).padStart(2, "0")}`);
  const arm = ids.map((id) => armOf(id, m.id, seed));
  const society = simulateSociety(seed, n, { truth: TRUTH, prior: PRIOR, eventRef: "WE-0412", skillBoost: (i) => (arm[i] === "treatment" ? m.simulation.skill_boost : 0) });
  const lens = lensRecalibration(society.flatMap((a) => a.digests), "WE-0412", TRUTH, LR);
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const eff = (which: "control" | "treatment") => median(lens.agents.filter((a) => arm[ids.indexOf(a.agent)] === which).map((a) => a.efficiency).filter((x): x is number => x !== null));
  const c = eff("control"), t = eff("treatment");
  const counts = { control: arm.filter((a) => a === "control").length, treatment: arm.filter((a) => a === "treatment").length };
  const delta = c !== null && t !== null ? Math.round((t - c) * 1000) / 1000 : null;
  const measures = { control: c, treatment: t, delta, agents_per_arm: counts };
  if (delta === null || Math.min(counts.control, counts.treatment) < m.rule.min_agents_per_arm) return { ...base, measures, decision: "tune", reason: `too few agents in an arm (need ${m.rule.min_agents_per_arm}): the rule cannot decide, the run is widened` };
  if (delta >= m.rule.min_delta) return { ...base, measures, decision: "adopt", reason: `the treatment arm's median update efficiency is ${delta} above control, at or over the ${m.rule.min_delta} the rule fixed before the run (simulated: this shows the pipeline works, not that the paper's claim holds)` };
  if (delta <= m.rule.kill_delta) return { ...base, measures, decision: "kill", reason: `the treatment arm is ${delta} against control, at or under the ${m.rule.kill_delta} kill threshold fixed before the run` };
  return { ...base, measures, decision: "tune", reason: `the difference ${delta} is between the kill (${m.rule.kill_delta}) and adopt (${m.rule.min_delta}) thresholds: tune and rerun` };
}

/**
 * The rule that decides between two mechanisms (DK1758, DK89), fixed here before any run and carried by every comparison by its hash: a mechanism must first be adopted by its own rule; of two adopted the larger
 * measured difference wins and a tie is a tie; a mechanism that is tuned, killed or deferred never wins; when neither is adopted there is no winner. Nothing about the order of the arguments counts.
 */
export const COMPARISON_RULE = { id: "head-to-head-v1", adopt_first: true, larger_delta_wins: true, tie_is_a_tie: true, deferred_never_wins: true } as const;
export const comparisonRuleHash = (): string => `sha256:${createHash("sha256").update(JSON.stringify(COMPARISON_RULE, Object.keys(COMPARISON_RULE).sort())).digest("hex")}`;

export interface Comparison {
  rule: typeof COMPARISON_RULE; rule_sha256: string; seed: number; agents: number; simulated: true;
  a: Decision; b: Decision; winner: string | null; reason: string;
}

/**
 * Two mechanisms on the same simulated society: the same agents and the same seed, each through `runMechanism` on its own, then the comparison rule above. Swapping one mechanism for another leaves the other's
 * decision exactly as it was, because each run reads only its own entry, the seed and the agents; a mechanism that needs white-box models is deferred and not run. A simulation: it shows that the registry can swap,
 * try and compare, never that either paper's claim holds.
 */
export function compareMechanisms(a: MechanismEntry, b: MechanismEntry, seed: number, n = 120): Comparison {
  if (a.id === b.id) throw new Error(`a mechanism is not compared with itself (${a.id})`);
  const da = runMechanism(a, seed, n), db = runMechanism(b, seed, n);
  const base = { rule: COMPARISON_RULE, rule_sha256: comparisonRuleHash(), seed, agents: n, simulated: true as const, a: da, b: db };
  const ok = (d: Decision) => d.decision === "adopt" && d.measures?.delta !== null && d.measures?.delta !== undefined;
  if (!ok(da) && !ok(db)) return { ...base, winner: null, reason: `neither is adopted by its own rule (${a.id}: ${da.decision}, ${b.id}: ${db.decision}), so there is no winner` };
  if (ok(da) && !ok(db)) return { ...base, winner: a.id, reason: `${a.id} is adopted and ${b.id} is ${db.decision}` };
  if (!ok(da) && ok(db)) return { ...base, winner: b.id, reason: `${b.id} is adopted and ${a.id} is ${da.decision}` };
  const [x, y] = [da.measures!.delta!, db.measures!.delta!];
  if (x === y) return { ...base, winner: null, reason: `both are adopted with the same measured difference (${x}): a tie` };
  return { ...base, winner: x > y ? a.id : b.id, reason: `both are adopted; the measured difference is ${x} for ${a.id} and ${y} for ${b.id}, and the larger wins` };
}
