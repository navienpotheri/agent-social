/**
 * The access experiment (ENG75, groundwork: the harness and the report; nothing here claims anything). Do field cards, courses and accreditation make agents better? It is not known, and nothing compares agents with
 * access to them against agents without. This module is the controlled comparison: agents assigned AT RANDOM (from a seed, exactly half) to access or no access on the same seed world; a FIXED held-out outcome measure, the
 * same jobs given the same way before and after, scored by the house's own checkers (a check on the delivery, not a judgement); and, for accreditation, the two ways the owner asked for: whether accredited agents do
 * better on the same jobs, and whether others prefer them (hired more often, paid more). Every figure carries its spread between repeat runs (ENG72) when one is given, and a difference smaller than the spread is not
 * called a difference. A few agents in one run is one draw: the report says what it cannot tell and no claim about agents in general is made.
 *
 * What is built: the assignment, the tool switch for the arms, the battery and its scoring, the comparison of change (after minus before) between the arms, the accreditation measures from the trace, the report. What is
 * left: the battery given to real agents (each agent answers the held-out jobs through its own gateway before and after), a Registrar-attested accreditation that can be switched on and off by itself, and the real run.
 */
import { createHash } from "node:crypto";
import { assignArms } from "@agent-social/asp-package";
import { HOUSE_JOBS, type HouseJob } from "./house-jobs.ts";
import { spreadOf, type Spread } from "./repeat.ts";
import type { TraceEvent } from "./types.ts";

export type Resource = "cards" | "courses" | "accreditation";
export const RESOURCES: readonly Resource[] = ["cards", "courses", "accreditation"];
/** The tools each resource switches. Accreditation has no tool of its own in this build: an agent without courses cannot earn one (the cards and the accreditation flow are lane-society-2's to extend this table). */
export const ACCESS_TOOLS: Record<Resource, readonly string[]> = {
  cards: ["inspect", "field_answer"],
  courses: ["look_courses", "course_enrol", "course_sit", "my_progress"],
  accreditation: [],
};
export type AccessArm = "access" | "control";

export function parseResources(v: string | undefined): Resource[] {
  if (v === undefined || v === "all") return [...RESOURCES];
  const out = v.split(",").map((x) => x.trim()).filter(Boolean);
  for (const r of out) if (!(RESOURCES as readonly string[]).includes(r)) throw new Error(`--access names cards, courses and accreditation (any of them, or all); ${r} is none of those`);
  if (!out.length) throw new Error("--access names at least one of cards, courses, accreditation");
  return [...new Set(out)] as Resource[];
}

/** Which agents get the resources: exactly half, from a hash of the seed and the agent's id (so the same seed gives the same split on the same society). */
export function assignAccess(ids: readonly string[], seed: string | number): Map<string, AccessArm> {
  const arms = assignArms(ids, `access:${seed}`, "half");
  return new Map(ids.map((id) => [id, arms.get(id) === "writeback" ? "access" : "control"] as const));
}
/** The tool names a control agent does not get, given the resources that the experiment switches. */
export const hiddenTools = (resources: readonly Resource[]): Set<string> => new Set(resources.flatMap((r) => ACCESS_TOOLS[r]));

// ---- the fixed held-out outcome measure ----------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The held-out battery: the same house jobs for every agent, before and after, chosen from the seed (the solo jobs; a partner job needs two agents). */
export function chooseBattery(seed: string | number, size = 8, pool: readonly HouseJob[] = HOUSE_JOBS): HouseJob[] {
  const solo = pool.filter((j) => !j.partner);
  const ranked = solo.map((j) => ({ j, h: createHash("sha256").update(`battery:${seed}:${j.purpose}`).digest("hex") })).sort((a, b) => (a.h < b.h ? -1 : 1));
  return ranked.slice(0, Math.min(size, solo.length)).map((x) => x.j);
}
/** What an agent is asked: the job as the house states it. */
export const promptOf = (j: HouseJob): string => `${j.purpose}. The house accepts it if: ${j.criterion}. Write your delivery.`;
export type AnswerFn = (agent: string, job: HouseJob, prompt: string, phase: "before" | "after") => Promise<string>;
export interface BatteryScore { agent: string; phase: "before" | "after"; passed: number; total: number; score: number; failures: { job: string; why: string }[]; ms: number }

/** Gives an agent the battery: each delivery is scored by the house's own check (passed = the check finds nothing to refuse). */
export async function runBattery(agent: string, phase: "before" | "after", battery: readonly HouseJob[], answer: AnswerFn, now: () => number = Date.now): Promise<BatteryScore> {
  const t0 = now();
  let passed = 0;
  const failures: BatteryScore["failures"] = [];
  for (const j of battery) {
    const text = await answer(agent, j, promptOf(j), phase);
    const why = j.check(text);
    if (why === null) passed++; else failures.push({ job: j.purpose.slice(0, 60), why });
  }
  return { agent, phase, passed, total: battery.length, score: battery.length ? Math.round((passed / battery.length) * 1e4) / 1e4 : 0, failures, ms: now() - t0 };
}

// ---- accreditation, two ways, from the trace ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface AccreditationFigures {
  accredited: number; others: number;
  /** Way 1: jobs delivered and accepted, for the accredited and the others, for each agent. */
  deliveredPerAgent: { accredited: number; others: number };
  /** Way 2: do others prefer them: offers accepted by posters (a hire), and the mean price, for each agent. */
  hiredPerAgent: { accredited: number; others: number };
  meanPaid: { accredited: number | null; others: number | null };
}
/** An agent is accredited in a run when the society says so: an `accredited` trace event (the Academy's flow, lane-society-2's, emits it when a course is passed and attested). */
export function accreditedIn(events: TraceEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (e.t === "accredited") out.add(e.agent);
  return out;
}

export function accreditationOf(events: TraceEvent[], accredited: ReadonlySet<string>): AccreditationFigures {
  const ids = [...new Set(events.filter((e) => e.t === "agent").map((e) => (e as { agent: string }).agent))];
  const didOf = new Map(events.filter((e): e is Extract<TraceEvent, { t: "agent" }> => e.t === "agent").map((e) => [e.did, e.agent]));
  const acc = ids.filter((a) => accredited.has(a)), oth = ids.filter((a) => !accredited.has(a));
  const delivered = (set: string[]) => events.filter((e) => e.t === "tool" && e.tool === "deliver_job" && e.ok && set.includes(e.agent)).length;
  const hires = events.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool" && e.tool === "accept_offer" && e.ok && !!e.targetAuthor);
  const hiredOf = (set: string[]) => hires.filter((e) => set.includes(didOf.get(e.targetAuthor!) ?? ""));
  const paid = (set: string[]) => { const xs = hiredOf(set).map((e) => Number((e as unknown as { price?: number }).price)).filter((x) => Number.isFinite(x)); return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null; };
  const per = (n: number, set: string[]) => (set.length ? Math.round((n / set.length) * 100) / 100 : 0);
  return {
    accredited: acc.length, others: oth.length,
    deliveredPerAgent: { accredited: per(delivered(acc), acc), others: per(delivered(oth), oth) },
    hiredPerAgent: { accredited: per(hiredOf(acc).length, acc), others: per(hiredOf(oth).length, oth) },
    meanPaid: { accredited: paid(acc), others: paid(oth) },
  };
}

// ---- the comparison ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface ArmOutcome { agents: number; before: number | null; after: number | null; change: number | null; changes: number[]; jobsAccepted: number; refusals: number }
export interface ExperimentReport {
  resources: Resource[];
  arms: Partial<Record<AccessArm, ArmOutcome>>;
  /** Change (after minus before) in the access arm minus the same in the control, in the battery score (0 to 1). */
  difference: number | null;
  /** The spread between repeat runs (ENG72) of that difference, if one was measured; absent: none. */
  spread: number | null;
  reading: string;
  accreditation: AccreditationFigures | undefined;
  cannotTell: string[];
}
export const EXPERIMENT_CANNOT_TELL = [
  "whether the same agents would do the same in another run: one run is one draw, and the spread between repeat runs (ENG72) is needed to call a difference real",
  "anything about agents in general: these are a few agents of one model on one local society",
  "which resource made the difference when more than one was switched together",
  "whether the held-out jobs are as hard as the jobs the agents meet in the Market, or whether the checkers (a few cues on a delivery) measure quality",
  "whether an agent that did better would also do better at jobs of another kind",
];

export function experimentReport(o: { resources: Resource[]; arms: Map<string, AccessArm>; scores: BatteryScore[]; events?: TraceEvent[]; spread?: number }): ExperimentReport {
  const arms: ExperimentReport["arms"] = {};
  const jobsBy = (ids: string[]) => (o.events ?? []).filter((e) => e.t === "tool" && e.tool === "deliver_job" && e.ok && ids.includes(e.agent)).length;
  const refBy = (ids: string[]) => (o.events ?? []).filter((e) => e.t === "tool" && !e.ok && !!e.refused && ids.includes(e.agent)).length;
  for (const arm of ["access", "control"] as const) {
    const ids = [...o.arms].filter(([, a]) => a === arm).map(([id]) => id);
    if (!ids.length) continue;
    const pick = (phase: "before" | "after") => ids.map((id) => o.scores.find((s) => s.agent === id && s.phase === phase)?.score);
    const b = pick("before"), a = pick("after");
    const both = ids.map((_, i) => (b[i] !== undefined && a[i] !== undefined ? [b[i]!, a[i]!] as const : undefined)).filter((x): x is readonly [number, number] => !!x);
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1e4) / 1e4 : null);
    const changes = both.map(([x, y]) => Math.round((y - x) * 1e4) / 1e4);
    arms[arm] = { agents: ids.length, before: mean(both.map(([x]) => x)), after: mean(both.map(([, y]) => y)), change: mean(changes), changes, jobsAccepted: jobsBy(ids), refusals: refBy(ids) };
  }
  const ca = arms.access?.change, cc = arms.control?.change;
  const difference = ca !== null && ca !== undefined && cc !== null && cc !== undefined ? Math.round((ca - cc) * 1e4) / 1e4 : null;
  const spread = o.spread ?? null;
  const reading = difference === null ? "There is nothing to compare: the battery was not given to both arms, before and after."
    : spread === null ? "No spread between repeat runs has been measured for this setup (ENG72), so this difference is not called a difference: one run is one draw."
    : Math.abs(difference) <= spread ? `The difference (${difference}) is no larger than the spread between repeat runs (${spread}): it is not called a difference.`
    : `The difference (${difference}) is larger than the spread between repeat runs (${spread}). It is still a comparison of a few agents on one society, not a claim about agents in general.`;
  const accreditation = o.events ? accreditationOf(o.events, accreditedIn(o.events)) : undefined;
  return { resources: o.resources, arms, difference, spread, reading, accreditation, cannotTell: EXPERIMENT_CANNOT_TELL };
}

/** The spread of a difference from several repeat runs' differences (ENG72). */
export const spreadOfDifferences = (diffs: number[]): Spread => spreadOf(diffs);

export function renderExperiment(r: ExperimentReport): string {
  const names = (["access", "control"] as const).filter((k) => r.arms[k]);
  const num = (x: number | null) => (x === null ? "n/a" : String(x));
  const rows = [
    "## Does access help? (a controlled comparison, not a claim)", "",
    `Agents were assigned at random (from the seed, exactly half) to access, or no access, to: ${r.resources.join(", ")}; the same society for both. The outcome is a fixed held-out battery of house text jobs with checkable acceptance, given the same way before and after.`, "",
    `| | ${names.map((k) => (k === "access" ? "Access" : "No access")).join(" | ")} |`, `|---|${names.map(() => "---|").join("")}`,
  ];
  const line = (label: string, f: (x: ArmOutcome) => string) => rows.push(`| ${label} | ${names.map((k) => f(r.arms[k]!)).join(" | ")} |`);
  line("Agents", (x) => String(x.agents));
  line("Battery score before (checker passes, 0 to 1)", (x) => num(x.before));
  line("Battery score after", (x) => num(x.after));
  line("Change (after minus before)", (x) => num(x.change));
  line("Jobs delivered and accepted in the run", (x) => String(x.jobsAccepted));
  line("Calls refused in the run", (x) => String(x.refusals));
  rows.push("", `**Difference in the change between the arms:** ${num(r.difference)}${r.spread !== null ? ` (spread between repeat runs ${r.spread})` : ""}. ${r.reading}`, "");
  if (r.accreditation) {
    const a = r.accreditation;
    rows.push("**Accreditation, two ways** (an agent is accredited when a course it sat was passed):", `- Do accredited agents do better on the same jobs? Jobs delivered and accepted for each agent: accredited ${a.deliveredPerAgent.accredited} (${a.accredited} agents), others ${a.deliveredPerAgent.others} (${a.others} agents).`,
      `- Do others prefer them? Hired (an offer of theirs accepted) for each agent: accredited ${a.hiredPerAgent.accredited}, others ${a.hiredPerAgent.others}; mean price paid: accredited ${num(a.meanPaid.accredited)}, others ${num(a.meanPaid.others)}.`, "");
  }
  rows.push("**What this cannot tell you:**", ...r.cannotTell.map((x) => `- ${x}`), "");
  return rows.join("\n");
}
