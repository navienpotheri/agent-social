/**
 * The lens learning loop, end to end on simulated learners (register row DK1750; docs/institutions/lens-learning-loop.md). One paper, "writing and evolving evals" (course C-L11-1, lenses L11, L12, L2), is traced
 * through nine stages with the real parts of the platform wherever they exist:
 *
 *   1 intake      a paper becomes a testable property BEFORE any course exists: the claim, what would falsify it, the measure, the pre-registered pass mark, power, looks and the kill rule (`intakeProblems`, `intakeHash`)
 *   2 course      the catalogue's card and its engine (`evolving-evals`): practice tasks the learner sees, held-out tasks from a seed it does not control
 *   3 sitting     the learner sits the course: five runs on five seeds from an anchor, all must meet the gate (`sit`)
 *   4 gate        the lesson an eval suite becomes goes through the lesson gate (evidence, invariants, replay) and the paper-derived additions (provenance, no regression on the agent's existing eval, thresholds fixed in advance)
 *   5 write-back  one signed change in the agent's lineage, with its predecessor, so it can be listed and rolled back
 *   6 follow-up   retention at 7 and 30 days, a drift check, and an ablation (remove the lesson, measure)
 *   7 A/B         cohort against control by the published hash of the agent id, a pre-registered pass mark, a sample size from power, looks fixed in advance (no peeking), the effect with its interval
 *   8 decision    adopt, continue, inconclusive or kill, and a signed kill record that switches the lens off
 *   9 limits      said in the readout: the learners are scripted and the world is a toy
 *
 * The learners are scripted (no model is involved, nothing changes model weights, credits are accounting entries and not money). The behaviour change is real in the sense that it is measured on held-out cases by the
 * course's own engine, and a null run (nobody learns) shows no effect. A real model-agent run is postponed with the other live runs (register row DK1759). Pure and deterministic: the same seed gives the same readout.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { b64urlDecode, b64urlEncode, publicKeyFromSeed, signBytes, verifyBytes } from "@agent-social/asp-core";
import { auditLesson, type HeldOutTask } from "@agent-social/asp-package";
import { armOf } from "@agent-social/asp-log";
import { loadCatalogue, type CourseCard } from "./lens-courses/catalogue.ts";
import { engineIds, sit } from "./lens-courses/index.ts";
import { REPLAY_TASKS } from "./lens-courses/writeback.ts";
import { copierSuite, doNothingSuite, flagAllSuite, honestSuite, overfitterSuite, practiceFor, runSuite, suiteLesson, type EvalSuite } from "./lens-courses/evolving-evals.ts";

export const LOOP_SCOPE = "Scripted learners on a toy world, scored by the course's own engine on held-out cases: no real model, nothing changes model weights, credits are accounting entries and not money. A run with real model agents is postponed (register row DK1759) and would add: real variation in what an agent writes, real cost, and the drift of a real runtime.";

// ---------------------------------------------------------------- 1. intake: a paper becomes a testable property

export interface Prereg {
  /** The smallest mean lift (permille of the held-out score) that counts as success. */
  min_effect_permille: number;
  /** The two-sided significance level in permille (50 is 5 %), shared out across the looks. */
  alpha_permille: 50 | 100 | 10;
  /** The power in permille the sample size is chosen for (800, 900 or 950). */
  power_permille: 800 | 900 | 950;
  /** The standard deviation of a learner's lift the sample size assumes, in permille. */
  sd_permille: number;
  /** The agents per arm at each look, ascending; the last is the planned sample. A decision at any other number is refused. */
  looks: number[];
  /** The days the retention is measured at, and the share of the lift that must remain at the last of them (permille). */
  retention_days: [number, number];
  retention_floor_permille: number;
  /** The kill rule: most regressions (tasks passed without the lesson that fail with it) a cohort may show, in permille of the held-out cases, and the mean lift below which the lens is switched off. */
  kill: { regression_max_permille: number; lift_below_permille: number };
}
export interface Intake {
  id: string;
  paper: string;
  lens: string;
  /** The behaviour change the paper claims, in one or two sentences, in our words. */
  claim: string;
  /** What result would show the claim false. */
  falsifier: string;
  /** What is measured, on what, and by which engine. */
  measure: string;
  course: string;
  prereg: Prereg;
}

const canon = (x: unknown): string => Array.isArray(x) ? `[${x.map(canon).join(",")}]` : x && typeof x === "object" ? `{${Object.keys(x as object).sort().map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(x);
const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
export const intakeHash = (i: Intake): string => sha(canon(i));
const INSTRUCTION_SHAPE = /\b(ignore|disregard|override)\b[^.\n]{0,30}\b(previous|prior|above|instructions|rules)\b/i;

/** What is wrong with an intake record. A property is stated, falsifiable and fixed BEFORE any course exists; text that reads as an instruction is refused (a paper is data, never a command). */
export function intakeProblems(i: Intake, courses: readonly Pick<CourseCard, "id">[]): string[] {
  const out: string[] = [];
  const text = (k: string, v: string, min: number) => { if (typeof v !== "string" || v.trim().length < min) out.push(`${k} is stated in at least ${min} characters`); else if (INSTRUCTION_SHAPE.test(v)) out.push(`${k} reads as an instruction to an agent: a paper is data, not a command`); };
  text("claim", i.claim, 40); text("falsifier", i.falsifier, 30); text("measure", i.measure, 20);
  if (i.falsifier && i.claim && i.falsifier.trim() === i.claim.trim()) out.push("the falsifier is not the claim again: say what result would show it false");
  if (!i.paper) out.push("the paper is named");
  if (!courses.some((c) => c.id === i.course)) out.push(`${i.course} is not a course in the catalogue`);
  const p = i.prereg;
  if (!(p.min_effect_permille > 0)) out.push("the smallest effect that counts is above 0");
  if (!(p.sd_permille > 0)) out.push("the assumed standard deviation is above 0");
  if (!p.looks.length || p.looks.some((n, k) => !Number.isInteger(n) || n < 4 || (k > 0 && n <= p.looks[k - 1]!))) out.push("the looks are ascending whole numbers of agents per arm, at least 4 each");
  if (p.retention_days[0] >= p.retention_days[1]) out.push("the retention days ascend");
  if (!(p.retention_floor_permille >= 0 && p.retention_floor_permille <= 1000)) out.push("the retention floor is a share of the lift between 0 and 1000 permille");
  if (!(p.kill.regression_max_permille >= 0)) out.push("the kill rule names the most regressions a cohort may show");
  return out;
}

/** The intakes the registry holds (docs/lenses/intakes.json), by id. */
export const INTAKES_FILE = fileURLToPath(new URL("../../../docs/lenses/intakes.json", import.meta.url));
export function loadIntakes(file = INTAKES_FILE): Intake[] { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { intakes: Intake[] }).intakes : []; }
/** What bars a course card on its intake (DK1751): a card that names an intake names one the registry holds, with the hash of the plan as it stands, and for the course the intake names. A card with no intake is not refused here: `lens publish` refuses it unless the operator states why (a course written before the rule). */
export function cardIntakeProblems(card: Pick<CourseCard, "id" | "intake">, intakes: readonly Intake[]): string[] {
  if (!card.intake) return [];
  const i = intakes.find((x) => x.id === card.intake!.id);
  if (!i) return [`${card.id} names the intake ${card.intake.id}, which the registry does not hold`];
  const out: string[] = [];
  if (intakeHash(i) !== card.intake.sha256) out.push(`${card.id} names the intake ${i.id} with the hash ${card.intake.sha256.slice(0, 19)}, but the plan as it stands hashes to ${intakeHash(i).slice(0, 19)}: a plan changed after the course was linked to it is a different intake`);
  if (i.course !== card.id) out.push(`the intake ${i.id} is for the course ${i.course}, not ${card.id}`);
  return out;
}

// ---------------------------------------------------------------- statistics, fixed in advance

/** The standard normal distribution function (Abramowitz and Stegun 7.1.26 on erf). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
/** The z that leaves `p` of the normal in one tail (bisection; exact to 1e-9). */
export function zUpper(p: number): number { let lo = 0, hi = 10; for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (1 - normCdf(mid) > p) lo = mid; else hi = mid; } return (lo + hi) / 2; }

/** Agents per arm for a two-sample comparison of means: 2 (z(alpha/2) + z(beta))^2 sd^2 / effect^2, rounded up. */
export function sampleSizePerArm(p: Pick<Prereg, "min_effect_permille" | "alpha_permille" | "power_permille" | "sd_permille">): number {
  const za = zUpper(p.alpha_permille / 2000), zb = zUpper(1 - p.power_permille / 1000);
  return Math.ceil(2 * ((za + zb) * p.sd_permille / p.min_effect_permille) ** 2);
}
/** The critical z at each look: the significance level is shared out evenly across the looks (Bonferroni, conservative), so looking early costs power and never buys false confidence. */
export const criticalZ = (p: Pick<Prereg, "alpha_permille" | "looks">): number => zUpper(p.alpha_permille / 2000 / p.looks.length);

/** A decision is refused at any number of agents the plan did not name: peeking is not a look. */
export function lookRefusal(p: Pick<Prereg, "looks">, nPerArm: number): string | null {
  return p.looks.includes(nPerArm) ? null : `${nPerArm} agents per arm is not a pre-registered look (${p.looks.join(", ")}): a result read at any other time is not a decision`;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => (xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1)) : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;
export interface Effect { n_cohort: number; n_control: number; difference: number; se: number; z: number; ci: [number, number]; level_permille: number }
/** The difference in mean lift (cohort minus control) with its standard error, z and the interval at the look's critical z. */
export function effectOf(cohort: number[], control: number[], zCrit: number, alphaPermille: number): Effect {
  const se = Math.sqrt(sd(cohort) ** 2 / Math.max(1, cohort.length) + sd(control) ** 2 / Math.max(1, control.length));
  const diff = mean(cohort) - mean(control);
  return { n_cohort: cohort.length, n_control: control.length, difference: r1(diff), se: r1(se), z: se === 0 ? (diff === 0 ? 0 : Math.sign(diff) * 99) : r1(diff / se), ci: [r1(diff - zCrit * se), r1(diff + zCrit * se)], level_permille: Math.round((1000 - alphaPermille) * 10) / 10 };
}

// ---------------------------------------------------------------- learners, the gate and the memory

export interface Memory { lessons: { id: string; text: string; suite: EvalSuite }[]; lineage: LineageEntry[] }
export interface LineageEntry { n: number; change: "add" | "remove"; lesson: string; sha256: string; course: string; paper: string; intake: string; evidence: string; day: number; prev: string | null }
export const lineageHash = (e: LineageEntry): string => sha(canon(e));

/** The suites the learners write on their own, before any course: the kinds of habit a population has. */
type Habit = "nothing" | "copier" | "overfitter" | "flag_all" | "self_taught";
const HABITS: [Habit, number][] = [["nothing", 30], ["copier", 25], ["overfitter", 25], ["flag_all", 10], ["self_taught", 10]];
const draw = (key: string): number => parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) / 0x1_0000_0000;
function habitOf(id: string, seed: number): Habit { let u = draw(`habit|${seed}|${id}`) * 100; for (const [h, w] of HABITS) { if (u < w) return h; u -= w; } return "nothing"; }
function habitSuite(h: Habit, practice: ReturnType<typeof practiceFor>): EvalSuite {
  switch (h) { case "copier": return copierSuite(practice); case "overfitter": return overfitterSuite(practice); case "flag_all": return flagAllSuite(); case "self_taught": return honestSuite(); default: return doNothingSuite(); }
}
/** Whether a learner who sat the course writes the general suite (the course worked on it) or keeps its habit (it did not). The null run turns this off for everyone. */
const learns = (id: string, seed: number, pLearnPermille: number): boolean => draw(`learn|${seed}|${id}`) * 1000 < pLearnPermille;

export interface Gate { admitted: boolean; reasons: string[]; extras: { provenance: boolean; no_regression: boolean; thresholds_fixed: boolean } }
/** The lesson gate for a paper-derived lesson: the REAL gate of asp-package (evidence, invariants, conflicts, replay) with its paper option (DK1754): the lesson names the paper, the course and the intake hash it came from, the new suite does not lose ground on the agent's existing eval, and the thresholds in force are those the intake fixed in advance. */
export async function paperGate(lesson: { id: string; text: string }, evidenceRun: string, intake: Intake, before: number, after: number, thresholdsHash: string): Promise<Gate> {
  const v = await auditLesson({ id: lesson.id, text: lesson.text, evidence: [{ kind: "run", ref: evidenceRun }], source: "course" }, { existing: [], heldOut: REPLAY_TASKS as HeldOutTask[], minHeldOut: 3, isOwnRun: (r) => r === evidenceRun, paper: { paper: intake.paper, course: intake.course, intakeSha256: intakeHash(intake), thresholdsSha256: thresholdsHash, score: { before, after } } });
  const has = (rule: string) => v.reasons.some((r) => r.rule === rule);
  return { admitted: v.admitted, reasons: v.reasons.map((r) => `${r.rule}: ${r.reason}`), extras: { provenance: !has("provenance_missing"), no_regression: !has("existing_eval_regressed"), thresholds_fixed: !has("thresholds_moved") } };
}

// ---------------------------------------------------------------- the run

export interface LearnerRow {
  id: string; arm: "cohort" | "control"; habit: Habit;
  before: number; after: number; lift: number;
  sat: boolean; passed: boolean; admitted: boolean; gate_reasons: string[];
  day7: number | null; day30: number | null; drift: "none" | "memory emptied" | "a broad rule added"; flag: "ok" | "lift lost" | "regressed" | "lift lost and regressed";
  ablated: number | null; lineage: LineageEntry[];
}
export interface LookRow { n_per_arm: number; effect: Effect; z_crit: number; verdict: "adopt" | "continue" | "inconclusive" | "kill"; why: string }
export interface KillRecord { intake: string; lens: string; reason: string; at: string; seed_key: string }
export interface Readout {
  scope: string; seed: number; null_run: boolean; intake: Intake; intake_sha256: string;
  planned_n_per_arm: number; sample_size_from_power: number; z_crit: number;
  learners: LearnerRow[];
  cohort: { n: number; sat: number; passed: number; admitted: number };
  looks: LookRow[];
  decision: "adopt" | "inconclusive" | "kill"; reason: string;
  retention: { day0: number; day7: number; day30: number; share_kept_permille: number; floor_permille: number; flagged: number };
  ablation: { n: number; with_lesson: number; without_lesson: number; effect: number };
  regressions: number;
  kill: (KillRecord & { sig: string }) | null;
  limits: string[];
}

/** The standing intake of the worked example: writing and evolving evals. */
export function evalsIntake(over: Partial<Prereg> = {}): Intake {
  return {
    id: "lens-evals-1", paper: "P24, P25, P17", lens: "L11-self-improving-harness", course: "C-L11-1",
    claim: "An agent that turns the failures it sees into a small suite of code graders, and checks the suite against labels it never sees, keeps a skill that finds faulty answers on cases it has not seen.",
    falsifier: "The cohort that took the course catches no more faulty answers on held-out cases than the control, or the gain is gone by day 30, or the suite fails good answers more often than it did before.",
    measure: "The course engine's held-out score (the least of catch rate, one minus twice the false-fail rate, and kappa, in permille) of the suite the agent holds, on audit seeds the course never used.",
    prereg: { min_effect_permille: 150, alpha_permille: 50, power_permille: 800, sd_permille: 400, looks: [56, 112], retention_days: [7, 30], retention_floor_permille: 600, kill: { regression_max_permille: 100, lift_below_permille: 0 }, ...over },
  };
}

const auditSeeds = (seed: number, tag: string, id: string, k = 3) => Array.from({ length: k }, (_, j) => `loop|${seed}|${tag}|${id}|${j}`);
const score = (suite: EvalSuite, seeds: string[]): number => Math.round(mean(seeds.map((s) => runSuite(suite, s).score_permille)));

export interface LoopOptions { seed?: number; agents?: number; nullRun?: boolean; pLearnPermille?: number; /** For tests: the suite a learner who learns writes (the honest one by default). */ writes?: EvalSuite; intake?: Intake; /** The key (32 bytes) the kill record is signed with; a fixed test key by default. */ killSeed?: Uint8Array }

export async function runLoop(o: LoopOptions = {}): Promise<Readout> {
  const seed = o.seed ?? 1;
  let intake = o.intake ?? evalsIntake();
  // a smaller run (--agents) scales the plan down before anything is measured: the looks that fit, or one look at the whole sample; the scaled plan is what is fixed and hashed
  if (o.agents !== undefined) { const per = Math.max(4, Math.floor(o.agents / 2)); const fit = intake.prereg.looks.filter((x) => x <= per); intake = { ...intake, prereg: { ...intake.prereg, looks: fit.length ? fit : [per] } }; }
  const cat = loadCatalogue(engineIds());
  const problems = intakeProblems(intake, cat.courses);
  if (problems.length) throw new Error(`the intake is refused: ${problems.join("; ")}`);
  const card = cat.courses.find((c) => c.id === intake.course)!;
  const p = intake.prereg;
  const n = Math.max(...p.looks), perArm = o.agents !== undefined ? Math.max(2, Math.floor(o.agents / 2)) : n;
  const pLearn = o.nullRun ? 0 : (o.pLearnPermille ?? 800);
  const zc = criticalZ(p);
  const ihash = intakeHash(intake);
  // the population: ids are assigned to arms by the published hash until each arm has perArm agents; no one picks a cohort by hand
  const cohortIds: string[] = [], controlIds: string[] = [];
  for (let i = 0; cohortIds.length < perArm || controlIds.length < perArm; i++) { const id = `learner-${String(i).padStart(3, "0")}`; const a = armOf(id, intake.id, seed); if (a === "treatment" && cohortIds.length < perArm) cohortIds.push(id); else if (a === "control" && controlIds.length < perArm) controlIds.push(id); }
  const rows: LearnerRow[] = [];
  let regressions = 0, evaluated = 0;
  for (const [arm, ids] of [["cohort", cohortIds], ["control", controlIds]] as const) {
    for (const [idx, id] of ids.entries()) {
      const habit = habitOf(id, seed);
      const practice = practiceFor(`practice|${seed}|${id}`);
      const mine = habitSuite(habit, practice);
      const memory: Memory = { lessons: [], lineage: [] };
      const beforeSeeds = auditSeeds(seed, "before", id), afterSeeds = auditSeeds(seed, "after", id), d7 = auditSeeds(seed, "day7", id), d30 = auditSeeds(seed, "day30", id), abl = auditSeeds(seed, "ablate", id);
      const before = score(mine, beforeSeeds);
      let current: EvalSuite = mine, passed = false, admitted = false, sat = false;
      let gateReasons: string[] = [];
      let drift: LearnerRow["drift"] = "none";
      if (arm === "cohort") {
        sat = true;
        const written = learns(id, seed, pLearn) ? (o.writes ?? honestSuite()) : mine;
        const sitting = sit(card, written, id, 1, `anchor|${seed}|${idx}`);
        passed = sitting.passed;
        if (passed) {
          const lesson = suiteLesson(written);
          const textWithProvenance = `${lesson.text}\n(source: course ${intake.course}, paper ${intake.paper}, intake ${ihash.slice(0, 19)})`;
          const gate = await paperGate({ id: lesson.id, text: textWithProvenance }, `action:${id}:sitting`, intake, before, score(written, beforeSeeds), ihash);
          admitted = gate.admitted; gateReasons = gate.reasons;
          if (admitted) {
            memory.lessons.push({ id: lesson.id, text: textWithProvenance, suite: written });
            const entry: LineageEntry = { n: 1, change: "add", lesson: lesson.id, sha256: sha(textWithProvenance), course: intake.course, paper: intake.paper, intake: ihash, evidence: `action:${id}:sitting`, day: 0, prev: null };
            memory.lineage.push(entry);
            current = written;
          }
        } else gateReasons = sitting.runs.find((r) => !r.passed)?.failures.slice(0, 1) ?? ["the sitting missed the gate"];
      }
      const after = score(current, afterSeeds);
      // follow-up: what the agent holds at day 7 and 30; a memory emptied at day 10 and a broad rule added at day 20 happen to some, by a fixed draw (the Clinic's drift check reads them)
      const at7 = current; let at30 = current;
      if (arm === "cohort" && admitted) {
        const u = draw(`drift|${seed}|${id}`);
        if (u < 0.1) { drift = "memory emptied"; at30 = mine; }
        else if (u < 0.15) { drift = "a broad rule added"; at30 = { grader: { kind: "code" }, graders: [...(current.graders ?? []), ...flagAllSuite().graders] }; }
      }
      const s7 = score(at7, d7), s30 = score(at30, d30);
      let ablated: number | null = null;
      if (arm === "cohort" && admitted) {
        const without = score(mine, abl), withL = score(lastSuite(memory), abl);
        ablated = withL - without;
        // regressions: held-out cases the old suite got right and the new one gets wrong, on the audit seeds of the day-0 check
        const r = regressionCount(mine, current, afterSeeds); regressions += r.regressions; evaluated += r.cases;
      }
      const lift = after - before, l30 = s30 - before;
      const lost = arm === "cohort" && admitted && l30 < lift * 0.5, dropped = arm === "cohort" && admitted && s30 < after - 150;
      const flag: LearnerRow["flag"] = lost && dropped ? "lift lost and regressed" : lost ? "lift lost" : dropped ? "regressed" : "ok";
      rows.push({ id, arm, habit, before, after, lift, sat, passed, admitted, gate_reasons: gateReasons, day7: s7 - before, day30: l30, drift, flag, ablated, lineage: memory.lineage });
    }
  }
  const lifts = (arm: "cohort" | "control", upto: number) => rows.filter((r) => r.arm === arm).slice(0, upto).map((r) => r.lift);
  // the looks, in order; the plan stops at the first look whose rule says adopt or kill
  const regressionPermille = evaluated ? Math.round((regressions / evaluated) * 1000) : 0;
  const looks: LookRow[] = [];
  let decision: Readout["decision"] = "inconclusive", reason = "";
  const days = (arm: "cohort" | "control", f: (r: LearnerRow) => number) => mean(rows.filter((r) => r.arm === arm).map(f));
  const lastLook = p.looks[p.looks.length - 1]!;
  for (const nn of p.looks) {
    if (nn > perArm) break;
    const refusal = lookRefusal(p, nn); if (refusal) throw new Error(refusal);
    const e = effectOf(lifts("cohort", nn), lifts("control", nn), zc, p.alpha_permille / p.looks.length);
    const keptNow = e.difference > 0 ? Math.round((mean(rows.filter((r) => r.arm === "cohort").slice(0, nn).map((r) => r.day30 ?? 0)) - days("control", (r) => r.day30 ?? 0)) / e.difference * 1000) : 0;
    let verdict: LookRow["verdict"], why: string;
    if (e.difference <= p.kill.lift_below_permille && e.z <= -zc) { verdict = "kill"; why = `the cohort scores below the control (z ${e.z} at critical ${r1(zc)})`; }
    else if (regressionPermille > p.kill.regression_max_permille) { verdict = "kill"; why = `${regressionPermille} permille of held-out cases regress with the lesson, above the ${p.kill.regression_max_permille} the kill rule allows`; }
    else if (e.ci[0] > 0 && e.difference >= p.min_effect_permille && keptNow >= p.retention_floor_permille) { verdict = "adopt"; why = `the lift ${e.difference} permille is at least the ${p.min_effect_permille} pre-registered, its interval (${e.ci[0]} to ${e.ci[1]}) excludes 0 at the corrected level, and ${keptNow / 10}% of it is kept at day ${p.retention_days[1]}`; }
    else if (nn < lastLook) { verdict = "continue"; why = `not decided at ${nn} per arm (lift ${e.difference}, interval ${e.ci[0]} to ${e.ci[1]}): the plan goes on to the next look`; }
    else { verdict = "inconclusive"; why = `at the planned sample the lift ${e.difference} (interval ${e.ci[0]} to ${e.ci[1]}) does not meet the pre-registered mark of ${p.min_effect_permille} with its interval above 0 and ${p.retention_floor_permille / 10}% retained: nothing is claimed`; }
    looks.push({ n_per_arm: nn, effect: e, z_crit: r1(zc), verdict, why });
    if (verdict === "adopt" || verdict === "kill") { decision = verdict; reason = why; break; }
    if (verdict === "inconclusive") { decision = "inconclusive"; reason = why; }
  }
  if (!reason) reason = looks[looks.length - 1]?.why ?? "no look was reached";
  const cohortRows = rows.filter((r) => r.arm === "cohort");
  const day0 = r1(days("cohort", (r) => r.lift) - days("control", (r) => r.lift));
  const day7 = r1(days("cohort", (r) => r.day7 ?? 0) - days("control", (r) => r.day7 ?? 0));
  const day30 = r1(days("cohort", (r) => r.day30 ?? 0) - days("control", (r) => r.day30 ?? 0));
  const ab = cohortRows.filter((r) => r.ablated !== null);
  const abl = { n: ab.length, with_lesson: Math.round(mean(ab.map((r) => r.after))), without_lesson: Math.round(mean(ab.map((r) => r.after - (r.ablated ?? 0)))), effect: Math.round(mean(ab.map((r) => r.ablated ?? 0))) };
  const killSeed = o.killSeed ?? new Uint8Array(32).fill(7);
  const kill = decision === "kill" ? signKill({ intake: ihash, lens: intake.lens, reason, at: "end of the readout", seed_key: b64urlEncode(publicKeyFromSeed(killSeed)) }, killSeed) : null;
  return {
    scope: LOOP_SCOPE, seed, null_run: !!o.nullRun, intake, intake_sha256: ihash, planned_n_per_arm: perArm, sample_size_from_power: sampleSizePerArm(p), z_crit: r1(zc), learners: rows,
    cohort: { n: cohortRows.length, sat: cohortRows.filter((r) => r.sat).length, passed: cohortRows.filter((r) => r.passed).length, admitted: cohortRows.filter((r) => r.admitted).length },
    looks, decision, reason,
    retention: { day0, day7, day30, share_kept_permille: day0 > 0 ? Math.round((day30 / day0) * 1000) : 0, floor_permille: p.retention_floor_permille, flagged: cohortRows.filter((r) => r.flag !== "ok").length },
    ablation: abl, regressions: regressionPermille, kill,
    limits: [
      ...(perArm < sampleSizePerArm(p) ? [`underpowered: ${perArm} agents per arm is below the ${sampleSizePerArm(p)} the pre-registered power asks for, so a failure to find an effect here says little and a found effect is read with that in mind`] : []),
      "the learners are scripted and the world is a toy: a decision here says the loop works from intake to decision, never that the paper's claim holds for a real model agent",
      "the effect is real in this sense: it is measured on held-out cases by the course's own engine, and a null run shows none",
      "the interval uses a normal approximation and a Bonferroni share of the significance level over the looks: conservative, not exact",
      "retention and drift are modelled by a fixed draw (a memory emptied at day 10, a broad rule added at day 20), not observed from a runtime",
    ],
  };
}

/** Rolls a lesson back out of memory: one more signed change in the lineage (a removal that names the entry it undoes), never an edit of history. */
export function rollbackLesson(m: Memory, lessonId: string, day: number): LineageEntry | undefined {
  const i = m.lessons.findIndex((l) => l.id === lessonId);
  if (i < 0) return undefined;
  const last = m.lineage[m.lineage.length - 1];
  const entry: LineageEntry = { n: (last?.n ?? 0) + 1, change: "remove", lesson: lessonId, sha256: sha(m.lessons[i]!.text), course: last?.course ?? "", paper: last?.paper ?? "", intake: last?.intake ?? "", evidence: "rollback", day, prev: last ? lineageHash(last) : null };
  m.lessons.splice(i, 1); m.lineage.push(entry);
  return entry;
}
const lastSuite = (m: Memory): EvalSuite => m.lessons[m.lessons.length - 1]!.suite;

/** Held-out cases the old suite got right that the new one gets wrong, over the audit seeds. */
function regressionCount(old: EvalSuite, now: EvalSuite, seeds: string[]): { regressions: number; cases: number } {
  let regressions = 0, cases = 0;
  for (const s of seeds) {
    const a = runSuite(old, s).measures, b = runSuite(now, s).measures;
    const goodA = Number(a.good ?? 0) - Math.round((Number(a.false_fail_permille ?? 0) / 1000) * Number(a.good ?? 0));
    const goodB = Number(b.good ?? 0) - Math.round((Number(b.false_fail_permille ?? 0) / 1000) * Number(b.good ?? 0));
    regressions += Math.max(0, goodA - goodB); cases += Number(a.good ?? 0);
  }
  return { regressions, cases };
}

// ---------------------------------------------------------------- the kill switch

const killBytes = (k: KillRecord) => new TextEncoder().encode("asp-lens-kill:v1:" + canon(k));
export function signKill(k: KillRecord, seed: Uint8Array): KillRecord & { sig: string } { return { ...k, sig: b64urlEncode(signBytes(killBytes(k), seed)) }; }
export function verifyKill(k: KillRecord & { sig: string }, publicKey: Uint8Array): boolean { const { sig, ...rest } = k; try { return verifyBytes(b64urlDecode(sig), killBytes(rest), publicKey); } catch { return false; } }
/** Whether a lens may still teach: not while a kill record for its intake carries a valid signature from the key that switches lenses off. */
export function lensIsLive(intake: Intake, kills: readonly (KillRecord & { sig: string })[], publicKey: Uint8Array): { live: boolean; why: string } {
  const h = intakeHash(intake);
  const k = kills.find((x) => x.intake === h && verifyKill(x, publicKey));
  return k ? { live: false, why: `switched off by a signed kill record: ${k.reason}` } : { live: true, why: "no valid kill record for this intake" };
}

// ---------------------------------------------------------------- the readout in words

export function formatReadout(r: Readout): string {
  const L: string[] = [];
  const pct = (x: number) => `${r1(x / 10)}%`;
  L.push(`Lens learning loop: ${r.intake.paper} (${r.intake.lens}), course ${r.intake.course}${r.null_run ? "  [NULL RUN: nobody learns, so no effect should show]" : ""}`);
  L.push(`  ${r.scope}`);
  L.push(`  intake ${r.intake_sha256.slice(0, 19)}: ${r.intake.claim}`);
  L.push(`  would be false if: ${r.intake.falsifier}`);
  L.push(`  fixed in advance: the smallest effect ${r.intake.prereg.min_effect_permille} permille, alpha ${r.intake.prereg.alpha_permille / 10}%, power ${r.intake.prereg.power_permille / 10}%, looks at ${r.intake.prereg.looks.join(" and ")} per arm, retention at day ${r.intake.prereg.retention_days.join(" and ")} (at least ${r.intake.prereg.retention_floor_permille / 10}% of the lift kept); sample size from power: ${r.sample_size_from_power} per arm, planned ${r.planned_n_per_arm}`);
  L.push(`  cohort ${r.cohort.n}: ${r.cohort.sat} sat, ${r.cohort.passed} passed the gate of the course, ${r.cohort.admitted} were admitted to memory by the lesson gate; control ${r.learners.filter((x) => x.arm === "control").length} (arms assigned by the published hash of the agent id)`);
  for (const lk of r.looks) L.push(`  look at ${lk.n_per_arm} per arm: lift ${lk.effect.difference} permille (se ${lk.effect.se}, z ${lk.effect.z}, interval ${lk.effect.ci[0]} to ${lk.effect.ci[1]} at ${r1(lk.effect.level_permille / 10)}%: the ${100 - r.intake.prereg.alpha_permille / 10}% level shared over ${r.intake.prereg.looks.length} looks) -> ${lk.verdict}: ${lk.why}`);
  L.push(`  retention: lift ${r.retention.day0} at day 0, ${r.retention.day7} at day 7, ${r.retention.day30} at day 30 (${r.retention.share_kept_permille / 10}% kept, floor ${r.retention.floor_permille / 10}%); the drift check flagged ${r.retention.flagged} of ${r.cohort.admitted}`);
  L.push(`  ablation (the lesson removed): score ${pct(r.ablation.with_lesson)} with it, ${pct(r.ablation.without_lesson)} without, so the lesson accounts for ${r.ablation.effect} permille (${r.ablation.n} agents)`);
  L.push(`  regressions: ${r.regressions / 10}% of held-out good answers newly flagged (kill rule: above ${r.intake.prereg.kill.regression_max_permille / 10}%)`);
  L.push(`  DECISION: ${r.decision}. ${r.reason}`);
  if (r.kill) L.push(`  kill record signed (${r.kill.sig.slice(0, 16)}...): the lens is switched off for this intake`);
  for (const l of r.limits) L.push(`  limit: ${l}`);
  return L.join("\n");
}
