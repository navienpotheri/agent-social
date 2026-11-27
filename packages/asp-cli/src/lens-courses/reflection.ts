/**
 * Course C-L2-1, reflection and memory consolidation (lenses L2 reflection, L8 memory consolidation and L20 lifelong learning; register row DK604). An ops agent keeps failing on changes it makes. From a SEEDED
 * FAILURE LOG and a short runbook the learner writes LESSONS, one rule a line in a small language (`when <feature>=<value> and ... then <action>`), keeps at most six, and merges what repeats. The lessons are
 * scored by REPLAY on held-out tasks (the same replay the lesson gate runs before a lesson enters memory): the share of tasks the executor gets right with the lessons in memory, and the tasks it used to get
 * right that the lessons now break (regressions). The held-out tasks use new service names and a mix the log never showed; a lesson fitted to the names in the log, a copy of the log, a rule that is too broad,
 * one that carries a held-out name and a set that covers only the failures it saw do not pass.
 *
 * The executor is scripted and reads memory the same way every time, so the score is the quality of the lessons and nothing else. Nothing here changes model weights: the lessons are memory.
 */
import { createHash } from "node:crypto";
import type { HeldOutTask } from "@agent-social/asp-package";
import { register, type CourseRun, type Engine } from "./engines.ts";

export const ENGINE_ID = "reflection";
export const ACTIONS = ["go", "wait", "backup_first", "drain_first", "review"] as const;
export type Action = (typeof ACTIONS)[number];
export const FEATURES = { change: ["deploy", "migrate", "restart", "config"], day: ["mon", "tue", "wed", "thu", "fri"], env: ["prod", "stage"], queue: ["idle", "draining"], load: ["low", "high"] } as const;
export type Feature = keyof typeof FEATURES;
export interface Situation { service: string; change: string; day: string; env: string; queue: string; load: string }
export interface Task extends Situation { correct: Action }

/** The hidden rules, in order. The learner is told them in prose in the runbook; the failure log shows the first three at work. */
export const RUNBOOK = [
  "Do not run a migration while the queue is draining: wait.",
  "A deploy to prod on a Friday needs a backup first.",
  "Restarting under high load needs the service drained first.",
  "A config change in prod needs a review.",
];
const RULES: { when: (s: Situation) => boolean; action: Action }[] = [
  { when: (s) => s.change === "migrate" && s.queue === "draining", action: "wait" },
  { when: (s) => s.change === "deploy" && s.day === "fri" && s.env === "prod", action: "backup_first" },
  { when: (s) => s.change === "restart" && s.load === "high", action: "drain_first" },
  { when: (s) => s.change === "config" && s.env === "prod", action: "review" },
];
const fired = (s: Situation) => RULES.filter((r) => r.when(s));
export function correctAction(s: Situation): Action { return fired(s)[0]?.action ?? "go"; }
/** The hash of the hidden rules (the conditions probed on a fixed set of situations), published before any sitting. */
export function rulesCommitment(): string {
  const h = createHash("sha256");
  for (const change of FEATURES.change) for (const day of FEATURES.day) for (const env of FEATURES.env) for (const queue of FEATURES.queue) for (const load of FEATURES.load) h.update(correctAction({ service: "x", change, day, env, queue, load }) + "|");
  return "sha256:" + h.digest("hex");
}

function rng(seed: string) {
  let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SYLL = ["or", "bil", "pay", "rou", "cat", "inv", "sea", "mes", "aut", "sta", "log", "ing", "ren", "dis"];

/** `count` tasks whose correct action is in `want` and where exactly one rule (or none) fires, found by seeded draws. */
function draw(seed: string, count: number, want: (a: Action, s: Situation) => boolean): Task[] {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const out: Task[] = [];
  for (let tries = 0; out.length < count && tries < 20000; tries++) {
    const s: Situation = { service: `${pick(SYLL)}${pick(SYLL)}-${seed.includes("|held|") ? 50 + Math.floor(r() * 49) : 10 + Math.floor(r() * 40)}`, change: pick(FEATURES.change), day: pick(FEATURES.day), env: pick(FEATURES.env), queue: pick(FEATURES.queue), load: pick(FEATURES.load) };
    if (fired(s).length > 1) continue;
    const a = correctAction(s);
    if (want(a, s)) out.push({ ...s, correct: a });
  }
  return out;
}

/** What the learner may see: the runbook, 20 practice tasks (labelled), and a log of ten failures of the default action, all from the first three rules. Never the held-out set. */
export function practiceFor(seed: string): { runbook: string[]; tasks: Task[]; failureLog: Task[] } {
  const tasks = draw(`${seed}|practice`, 20, (a) => a !== "review");
  const failureLog = draw(`${seed}|failures`, 10, (a) => a !== "go" && a !== "review");
  return { runbook: RUNBOOK, tasks, failureLog };
}
export const HELDOUT_COUNT = 40;
/** The held-out tasks of a seed: six for each of the four rules and sixteen where going ahead is right (some of them tempting: a migration with the queue idle, a deploy on Monday). */
export function heldoutFor(seed: string): Task[] {
  const tasks: Task[] = [];
  for (const a of ["wait", "backup_first", "drain_first", "review"] as const) tasks.push(...draw(`${seed}|held|${a}`, 6, (x) => x === a));
  tasks.push(...draw(`${seed}|held|go`, 16, (x, s) => x === "go" && (s.change === "migrate" || s.change === "deploy" || s.change === "restart" || s.change === "config")));
  const r = rng(`${seed}|held|order`);
  for (let i = tasks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [tasks[i], tasks[j]] = [tasks[j], tasks[i]]; }
  return tasks;
}

// ---- the lessons and the executor that reads them

export interface Lessons { lessons: string[] }
export interface Parsed { conds: [Feature, string][]; action: Action }
const LINE = /^\s*when\s+(.+?)\s+then\s+(\w+)\s*(?:because\s.*)?$/i;
export function parseLesson(line: string): Parsed | string {
  const m = LINE.exec(line);
  if (!m) return "a lesson is `when <feature>=<value> and ... then <action>`";
  const action = m[2].toLowerCase() as Action;
  if (!(ACTIONS as readonly string[]).includes(action)) return `the action ${m[2]} is not one of ${ACTIONS.join(", ")}`;
  const conds: [Feature, string][] = [];
  for (const part of m[1].split(/\s+and\s+/i)) {
    const c = /^(\w+)=([\w-]+)$/.exec(part.trim());
    if (!c) return `the condition "${part.trim()}" is not <feature>=<value>`;
    const f = c[1].toLowerCase() as Feature, v = c[2].toLowerCase();
    if (!(f in FEATURES)) return `${c[1]} is not a feature (${Object.keys(FEATURES).join(", ")})`;
    if (!(FEATURES[f] as readonly string[]).includes(v)) return `${v} is not a value of ${f} (${FEATURES[f].join(", ")}): a lesson about a name or a one-off is not a rule`;
    conds.push([f, v]);
  }
  return { conds, action };
}

export const MAX_LESSONS = 6;
/** The problems with a set of lessons before it is replayed: shape, size, contradiction and repetition (the consolidation the course asks for). */
export function lessonProblems(x: unknown): string[] {
  const l = x as Lessons;
  if (!l || typeof l !== "object" || !Array.isArray(l.lessons) || l.lessons.some((t) => typeof t !== "string")) return ["the artifact is an object with a list of lesson lines"];
  const out: string[] = [];
  if (l.lessons.length === 0) out.push("no lesson was written");
  if (l.lessons.length > MAX_LESSONS) out.push(`more than ${MAX_LESSONS} lessons: consolidate what repeats into fewer, broader rules`);
  const seen = new Map<string, Action>();
  l.lessons.forEach((t, i) => {
    const p = parseLesson(t);
    if (typeof p === "string") { out.push(`lesson ${i + 1}: ${p}`); return; }
    const key = p.conds.map(([f, v]) => `${f}=${v}`).sort().join("&");
    const prior = seen.get(key);
    if (prior === p.action) out.push(`lesson ${i + 1} repeats an earlier one: merge them`);
    else if (prior) out.push(`lesson ${i + 1} contradicts an earlier lesson for ${key}: ${prior} against ${p.action}`);
    else seen.set(key, p.action);
  });
  return out;
}

/** What the executor does with the lessons in memory: the matching lesson with the most conditions wins (the first, on a tie); with none it goes ahead. */
export function decide(memory: readonly string[], s: Situation): Action {
  let best: { n: number; action: Action } | undefined;
  for (const text of memory) for (const line of text.split("\n")) {
    const p = parseLesson(line);
    if (typeof p === "string") continue;
    if (p.conds.every(([f, v]) => s[f] === v) && (!best || p.conds.length > best.n)) best = { n: p.conds.length, action: p.action };
  }
  return best?.action ?? "go";
}

/** The replay as the lesson gate runs it: one held-out task each, passed when the executor with the memory does the right thing. */
export function heldOutTasks(seed: string): HeldOutTask[] {
  return heldoutFor(seed).map((t, i) => ({ id: `ops-${i}-${t.correct}`, run: (memory) => decide(memory, t) === t.correct }));
}

export const ACCURACY_MIN = 900, REGRESSIONS_MAX = 1;

/** One run: the lessons replayed on the held-out tasks of `seed`. */
export function runLessons(artifact: unknown, seed: string): CourseRun {
  const problems = lessonProblems(artifact);
  if (problems.length) return { score_permille: 0, passed: false, measures: {}, failures: problems };
  const memory = (artifact as Lessons).lessons;
  const held = heldoutFor(seed);
  const leaked = [...new Set(held.map((t) => t.service))].find((n) => memory.some((m) => m.toLowerCase().includes(n)));
  if (leaked) return { score_permille: 0, passed: false, measures: { leaked: true }, failures: [`a lesson carries ${leaked}, a service of the held-out tasks: it has seen them`] };
  const before = held.map((t) => decide([], t) === t.correct), after = held.map((t) => decide(memory, t) === t.correct);
  const accuracy = Math.round((after.filter(Boolean).length / held.length) * 1000);
  const regressions = held.filter((_, i) => before[i] && !after[i]).length;
  const baseline = Math.round((before.filter(Boolean).length / held.length) * 1000);
  const missed = ACTIONS.filter((a) => a !== "go").filter((a) => held.some((t, i) => t.correct === a && !after[i]));
  const failures: string[] = [];
  if (accuracy < ACCURACY_MIN) failures.push(`the executor is right on ${accuracy / 10}% of the held-out tasks with these lessons (${baseline / 10}% without), below ${ACCURACY_MIN / 10}%${missed.length ? `; it still gets ${missed.join(", ")} wrong` : ""}`);
  if (regressions > REGRESSIONS_MAX) failures.push(`${regressions} tasks it got right without the lessons are now wrong: a lesson is too broad`);
  return { score_permille: regressions > REGRESSIONS_MAX ? Math.min(accuracy, 500) : accuracy, passed: failures.length === 0, measures: { accuracy_permille: accuracy, baseline_permille: baseline, regressions, lessons: memory.length }, failures };
}

export const reflection: Engine = { id: ENGINE_ID, practice: practiceFor, run: (artifact, seed) => runLessons(artifact, seed), replay: heldOutTasks, leakTokens: (seed) => [...new Set(heldoutFor(seed).map((t) => t.service))] };
register(reflection);

// ---- scripted agents

/** The honest agent: reads the runbook and the log and writes one general rule for each cause, with the reason. */
export function honestLessons(): Lessons {
  return { lessons: [
    "when change=migrate and queue=draining then wait because a migration under a draining queue loses jobs",
    "when change=deploy and day=fri and env=prod then backup_first because a Friday prod deploy cannot be rolled back over the weekend",
    "when change=restart and load=high then drain_first because a restart under load drops requests",
    "when change=config and env=prod then review because a bad prod config has no staging cushion",
  ] };
}
export const doNothingLessons = (): Lessons => ({ lessons: [] });
/** Copies the failure log into memory as the log's own sentences. */
export const copierLessons = (p: { failureLog: Task[] }): Lessons => ({ lessons: p.failureLog.slice(0, MAX_LESSONS).map((t) => `${t.service} ${t.change} on ${t.day} in ${t.env} failed: ${t.correct}`) });
/** Fits each failure exactly: one rule per failing case with every feature of that case as a condition, so it matches that case and almost nothing else. */
export const overfitterLessons = (p: { failureLog: Task[] }): Lessons => ({ lessons: p.failureLog.slice(0, MAX_LESSONS).map((t) => `when change=${t.change} and day=${t.day} and env=${t.env} and queue=${t.queue} and load=${t.load} then ${t.correct}`) });
/** Fits the names in the log: a rule per failing service, which is not a rule in the language. */
export const nameFitterLessons = (p: { failureLog: Task[] }): Lessons => ({ lessons: p.failureLog.slice(0, MAX_LESSONS).map((t) => `when service=${t.service} then ${t.correct}`) });
/** Covers only the three rules the log showed. */
export const halfwayLessons = (): Lessons => ({ lessons: honestLessons().lessons.slice(0, 3) });
/** Too broad: every prod change is reviewed and every migration waits. */
export const overbroadLessons = (): Lessons => ({ lessons: ["when env=prod then review because prod is risky", "when change=migrate then wait because migrations are risky", "when change=deploy then backup_first because deploys are risky", "when change=restart then drain_first because restarts are risky"] });
/** Writes the rules and carries a service name from the held-out set in a reason. */
export const leakerLessons = (heldService: string): Lessons => ({ lessons: honestLessons().lessons.map((l, i) => (i === 0 ? `${l} (as with ${heldService})` : l)) });
/** Keeps adding the same rule in different words: more than six lines and a repeat. */
export const hoarderLessons = (): Lessons => ({ lessons: [...honestLessons().lessons, "when change=migrate and queue=draining then wait", "when change=restart and load=high then drain_first", "when change=config and env=prod then review"] });
