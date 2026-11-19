/**
 * The COHORT DEMO (register rows DK750 and after; docs/lenses/course-template.md): a deterministic, replayable story of about 24 scripted agents on a fresh log. Half of them (the cohort) take one course and the
 * other half (the control) do not. Everything that happens is a signed record: passports (sponsored, key-only and labelled house agents), credits, a job, a service bought, tuition, enrolment, the sitting, the
 * Registrar's completion, and the write-back of the passed lessons through the lesson gate as a learning record on the agent's passport. The held-out score before and after is measured on held-out cases only,
 * and the lift is the cohort's mean change against the control's with a stated statistic. The agents are scripted and the course worlds are toys: no real model is involved, credits are accounting entries, not
 * money, and nothing changes model weights. A live run with real agents is a separate item in docs/live-run-checklist.md.
 */
import { createHash } from "node:crypto";
import { auditLessons } from "@agent-social/asp-package";
import { institutionDid } from "@agent-social/asp-log";
import { Kit, SERVICES, registrar, treasury, type Party } from "./cohort-kit.ts";
import { courseItem, courseSeeds, courseService, loadCatalogue, type CourseCard } from "./catalogue.ts";
import { attestation, engineIds, sit } from "./index.ts";
import * as world from "./reflection.ts";

export const COHORT_COURSE = "C-L2-1";
export const COHORT_SCOPE = "Scripted agents on a toy world: no real model, credits are accounting entries (not money), nothing changes model weights. A live run with real agents is a separate checklist item.";

export type Level = "sponsored" | "key_only" | "house";
export type Script = "honest" | "halfway" | "copier" | "overbroad" | "leaker" | "noop";
export interface AgentStory {
  id: string; handle: string; level: Level; house: boolean; group: "cohort" | "control";
  script?: Script; enrolled: boolean; passed: boolean; completed: boolean; written_back: boolean;
  before: number; after: number; /** change in held-out accuracy (permille) at the sitting: after minus before */ lift: number; regressions: number;
  /** The seed of the held-out cases the before and after were measured on. */ heldout_seed: string;
  lessons: string[]; paid: number; failures: string[];
  other: ("job" | "service" | "game")[];
}
export interface Flow { day: number; kind: "enrol" | "tuition" | "sitting" | "completion" | "learn" | "job" | "purchase" | "game" | "checkup"; from: string; to: string; amount?: number; label: string }
export interface Stat { n_cohort: number; n_control: number; mean_lift_cohort: number; mean_lift_control: number; difference: number; se: number; t: number; method: string }
export interface Story {
  id: string; seed: string; course: string; title: string; price: number; scope: string;
  agents: AgentStory[]; flows: Flow[];
  records: number; head: string; books: string;
  summary: { cohort: number; control: number; completed: number; passed: number; pass_rate_permille: number; before_cohort: number; after_cohort: number; before_control: number; after_control: number; lift: Stat; regressions: number; tuition: number; cost_per_point: number | null };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Held-out score of a memory on the course's held-out cases for a seed: accuracy and the tasks it got right without the memory that it now gets wrong. */
export function heldoutScore(memory: readonly string[], seed: string): { accuracy: number; baseline: number; regressions: number; n: number } {
  const tasks = world.heldoutFor(seed);
  const right = (m: readonly string[]) => tasks.map((t) => world.decide(m, t) === t.correct);
  const a = right(memory), b = right([]);
  const pm = (xs: boolean[]) => Math.round((xs.filter(Boolean).length / xs.length) * 1000);
  return { accuracy: pm(a), baseline: pm(b), regressions: tasks.filter((_, i) => b[i] && !a[i]).length, n: tasks.length };
}

/** A difference in mean change with its standard error (Welch): the t value says how many standard errors the cohort's mean lift sits above the control's. */
export function liftStat(cohort: number[], control: number[]): Stat {
  const v = (xs: number[]) => (xs.length > 1 ? xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1) : 0);
  const se = Math.sqrt(v(cohort) / Math.max(1, cohort.length) + v(control) / Math.max(1, control.length));
  const diff = mean(cohort) - mean(control);
  return { n_cohort: cohort.length, n_control: control.length, mean_lift_cohort: round1(mean(cohort)), mean_lift_control: round1(mean(control)), difference: round1(diff), se: round1(se), t: se === 0 ? (diff === 0 ? 0 : Infinity) : round1(diff / se), method: "difference in mean held-out change (permille), Welch standard error; t = difference / se" };
}

function scriptLessons(script: Script, practice: { failureLog: world.Task[] }, heldService: string): string[] {
  switch (script) {
    case "honest": return world.honestLessons().lessons;
    case "halfway": return world.halfwayLessons().lessons;
    case "copier": return world.copierLessons(practice).lessons;
    case "overbroad": return world.overbroadLessons().lessons;
    case "leaker": return world.leakerLessons(heldService).lessons;
    default: return [];
  }
}

export interface DemoOptions { seed?: string; agents?: number; cohort?: number; /** Every cohort agent writes nothing: the course has no effect, so no lift should show. */ noop?: boolean; /** Replaces the cohort's scripts (for tests). */ scripts?: Script[] }

/** The story and the fresh log it was written to (for tests and the sponsor reports). */
export async function runCohortWithLog(o: DemoOptions = {}): Promise<{ story: Story; k: Kit }> {
  const seed = o.seed ?? "demo";
  const total = o.agents ?? 24, size = o.cohort ?? 12;
  const cat = loadCatalogue(engineIds());
  const card = cat.courses.find((c) => c.id === COHORT_COURSE) as CourseCard;
  if (!card) throw new Error(`${COHORT_COURSE} is not in the catalogue`);
  const k = new Kit();
  const academy = institutionDid("academy");
  const author = await k.agent("cohort-author"), r1 = await k.agent("cohort-rev1"), r2 = await k.agent("cohort-rev2");
  const at = k.tick();
  const std = (service: string, price: number, t: number, b: number, a: number) => ({ service, institution: academy, price, class: "standard", split: { treasury_permille: t, burn_permille: b, payees: [{ account: academy, permille: a }] } });
  (k as unknown as { list: string }).list = await k.put(k.mk("price_list", treasury, { version: 1, effective_from: at, bounds_version: 1, job_tax_permille: 50, items: [std(SERVICES.sitting, 20, 200, 100, 700), std(SERVICES.arena, 10, 100, 50, 850), courseItem(card, author.did)] }, null, { at }));
  const hash = (s: string) => "sha256:" + sha(s);
  const course = await k.put(k.mk("course", author, { course: card.id, title: card.title, skill: card.generator.engine, level: 1, lessons: [hash("lesson")], exercises: hash(card.generator.engine), exercise_count: 1, price_service: courseService(card), author_share_permille: card.teacher.share_permille, reviews: [hash("r1"), hash("r2")], reviewers: [r1.did, r2.did] }, null, { subject: null, cosigners: [registrar] }));

  // the agents: a mix of sponsored, key-only and labelled house agents, in a fixed order; the cohort is the half whose seeded hash sorts first
  const parties: { a: AgentStory; p: Party }[] = [];
  for (let i = 0; i < total; i++) {
    const name = `s${String(i + 1).padStart(2, "0")}`;
    const level: Level = i % 6 === 5 ? "house" : i % 2 === 0 ? "sponsored" : "key_only";
    const p = level === "house" ? await k.houseAgent(name) : level === "key_only" ? await k.keyOnlyAgent(name) : await k.agent(name);
    await k.fund(p, 200);
    parties.push({ p, a: { id: p.did, handle: name, level, house: level === "house", group: "control", enrolled: false, passed: false, completed: false, written_back: false, before: 0, after: 0, lift: 0, regressions: 0, heldout_seed: "", lessons: [], paid: 0, failures: [], other: [] } });
  }
  const order = [...parties].sort((x, y) => sha(`${seed}|${x.a.id}`).localeCompare(sha(`${seed}|${y.a.id}`)));
  const inCohort = new Set(order.slice(0, size).map((x) => x.a.id));
  const scripts: Script[] = o.scripts ?? ["honest", "honest", "honest", "honest", "honest", "honest", "honest", "honest", "halfway", "copier", "overbroad", "leaker"];
  const flows: Flow[] = [];
  const day = () => Math.round((Date.parse(k.now()) - Date.parse("2026-11-01T00:00:00Z")) / 86_400_000);
  const flow = (kind: Flow["kind"], from: string, to: string, label: string, amount?: number) => flows.push({ day: day(), kind, from, to, label, ...(amount !== undefined ? { amount } : {}) });

  // society activity that has nothing to do with the course: a job, a service bought, a game entry
  for (const [i, { a, p }] of parties.entries()) {
    if (i % 3 === 0) { const pr = await k.person(`client-${a.handle}`); await k.acceptedJob(pr, p); a.other.push("job"); flow("job", "market", a.id, "a job settled"); }
    if (i % 4 === 1) { await k.buy(p, SERVICES.sitting, 20); a.other.push("service"); flow("purchase", a.id, "academy", "a service bought", 20); }
    if (i % 5 === 2) { await k.buy(p, SERVICES.arena, 10); a.other.push("game"); flow("game", a.id, "academy", "an arena entry", 10); }
  }

  let idx = 0;
  for (const { a, p } of order.filter((x) => inCohort.has(x.a.id))) {
    a.group = "cohort";
    a.script = o.noop ? "noop" : scripts[idx++ % scripts.length];
    k.addDays(1);
    await k.job(p, 100);
    const tuition = await k.buy(p, courseService(card), card.price);
    a.paid += card.price; a.enrolled = true;
    flow("tuition", a.id, "academy", `tuition for ${card.id}`, card.price);
    const enrolment = await k.put(k.mk("enrolment", p, { course, purchase: tuition }, null, { subject: p.did }));
    flow("enrol", a.id, "academy", `enrolled in ${card.id}`);
    k.addDays(1);
    const head = (await k.log.head()).logHash;
    const seeds = courseSeeds(card.id, p.did, 1, head, card.generator.runs);
    const practice = world.practiceFor(seeds[0]);
    const heldService = world.heldoutFor(seeds[0])[0].service;
    a.lessons = scriptLessons(a.script, practice, heldService);
    const sitting = sit(card, { lessons: a.lessons }, p.did, 1, head);
    a.heldout_seed = seeds[0];
    const sc = heldoutScore(a.lessons, seeds[0]);
    a.before = sc.baseline; a.regressions = sc.regressions;
    flow("sitting", a.id, "registry", `sat ${card.id}: ${sitting.passed ? "passed" : "not passed"}`);
    a.failures = sitting.runs[0]?.failures ?? [];
    const att = attestation(sitting);
    a.passed = att.ok;
    if (att.ok) {
      const run = await k.act(p);
      await k.put(k.mk("completion", registrar, { enrolment, holder: p.did, exercises_passed: 1, run_log_hash: run }, null, { subject: p.did }));
      a.completed = true;
      flow("completion", "registry", a.id, `completion of ${card.id}`);
      // the lessons enter memory through the gate, replayed on the course's own held-out tasks; only an all-admitted set is kept
      const verdicts = await auditLessons(a.lessons.map((text, i) => ({ id: `${card.id.toLowerCase()}-${i + 1}`, text, evidence: [{ kind: "run" as const, ref: run }], source: "course" as const })), { existing: [], heldOut: world.heldOutTasks(seeds[0]), isOwnRun: (id) => id === run, minHeldOut: 3 });
      if (verdicts.every((v) => v.admitted)) {
        await k.learned(p, { uri: `asp://cohort/${seed}/${a.handle}/lessons`, sha256: hash(a.lessons.join("\n")) });
        a.written_back = true;
        flow("learn", a.id, a.id, `${a.lessons.length} lessons written back through the gate`);
      } else a.failures.push(...verdicts.filter((v) => !v.admitted).flatMap((v) => v.reasons.map((r) => r.reason)));
    }
    // the memory after the course: the lessons only when they were written back; otherwise it is unchanged
    if (!a.written_back) a.lessons = [];
    const kept = heldoutScore(a.lessons, seeds[0]);
    a.regressions = kept.regressions;
    a.after = kept.accuracy;
    a.lift = a.after - a.before;
  }
  // the control did nothing: its before and after are the same held-out cases with an empty memory
  for (const { a, p } of parties.filter((x) => !inCohort.has(x.a.id))) {
    a.heldout_seed = courseSeeds(card.id, p.did, 1, "sha256:" + sha(`${seed}|control`), 1)[0];
    const s = heldoutScore([], a.heldout_seed);
    a.before = s.baseline; a.after = s.accuracy; a.lift = a.after - a.before;
  }

  const agents = parties.map((x) => x.a);
  const co = agents.filter((a) => a.group === "cohort"), ct = agents.filter((a) => a.group === "control");
  const tuition = co.reduce((s, a) => s + a.paid, 0);
  const lift = liftStat(co.map((a) => a.lift), ct.map((a) => a.lift));
  const points = (lift.mean_lift_cohort - lift.mean_lift_control) / 10;
  const head = await k.log.head();
  const audit = await k.log.creditAudit();
  const story: Story = {
    id: `co-${sha(`${seed}|${card.id}`).slice(0, 10)}`, seed, course: card.id, title: card.title, price: card.price, scope: COHORT_SCOPE, agents, flows,
    records: head.seq ?? 0, head: head.logHash, books: audit.verdict,
    summary: {
      cohort: co.length, control: ct.length, completed: co.filter((a) => a.completed).length, passed: co.filter((a) => a.passed).length,
      pass_rate_permille: co.length ? Math.round((co.filter((a) => a.passed).length / co.length) * 1000) : 0,
      before_cohort: round1(mean(co.map((a) => a.before))), after_cohort: round1(mean(co.map((a) => a.after))), before_control: round1(mean(ct.map((a) => a.before))), after_control: round1(mean(ct.map((a) => a.after))),
      lift, regressions: co.reduce((s, a) => s + a.regressions, 0), tuition, cost_per_point: points > 0 ? round1(tuition / co.length / points) : null,
    },
  };
  return { story, k };
}

export async function runCohort(o: DemoOptions = {}): Promise<Story> { return (await runCohortWithLog(o)).story; }
