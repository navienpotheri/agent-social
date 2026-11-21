/**
 * A generic RULE WORLD for courses whose artifact is a short list of rules in a small language (`when <feature>=<value> and ... then <action>`), scored by replay on held-out tasks: a world has features and
 * values, hidden rules, a runbook that states them in prose, and a failure log that shows some of them at work (register rows DK611 and after). The executor is scripted and reads the rules the same way every time,
 * so the score is the quality of the rules and nothing else. `reflection.ts` (course C-L2-1) is the first world written out by hand; later courses are specs for this engine. Nothing here changes model weights: the
 * learner's output is something written, a note, a policy or a checklist, never something trained.
 */
import { createHash } from "node:crypto";
import type { HeldOutTask } from "@agent-social/asp-package";
import { register, type CourseRun, type Engine } from "./engines.ts";

export interface RuleSpec {
  id: string;
  actions: readonly string[];
  /** The action when no rule applies. */
  defaultAction: string;
  features: Record<string, readonly string[]>;
  /** The hidden rules, in order; a task fires exactly one (or none, and takes the default). */
  rules: { when: (s: Record<string, string>) => boolean; action: string }[];
  /** The runbook states every rule in prose; the failure log shows the first `shown` of them. */
  runbook: string[];
  shown: number;
  /** What the thing being decided about is called, and the parts a name is made of (names are the part that never repeats between seeds). */
  subject: string;
  nameParts: string[];
  maxLessons: number;
  accuracyMin: number;
  regressionsMax: number;
  /** The scripted honest set: one general rule per hidden rule, with a reason. */
  honest: string[];
  /** An over-broad set that breaks what works. */
  overbroad: string[];
}

export type Task = Record<string, string> & { correct: string };

export function ruleWorld(spec: RuleSpec) {
  const featureNames = Object.keys(spec.features);
  const fired = (s: Record<string, string>) => spec.rules.filter((r) => r.when(s));
  const correctAction = (s: Record<string, string>): string => fired(s)[0]?.action ?? spec.defaultAction;

  const rng = (seed: string) => { let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const rulesCommitment = (): string => {
    const h = createHash("sha256");
    const walk = (i: number, s: Record<string, string>) => { if (i === featureNames.length) { h.update(correctAction({ name: "x", ...s }) + "|"); return; } for (const v of spec.features[featureNames[i]]) walk(i + 1, { ...s, [featureNames[i]]: v }); };
    walk(0, {});
    return "sha256:" + h.digest("hex");
  };

  /** `count` tasks whose correct action satisfies `want` and where at most one rule fires, by seeded draws. */
  function draw(seed: string, count: number, want: (a: string, s: Record<string, string>) => boolean): Task[] {
    const r = rng(seed);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const out: Task[] = [];
    for (let tries = 0; out.length < count && tries < 30000; tries++) {
      const s: Record<string, string> = { name: `${pick(spec.nameParts)}${pick(spec.nameParts)}-${10 + Math.floor(r() * 89)}` };
      for (const f of featureNames) s[f] = pick(spec.features[f]);
      if (fired(s).length > 1) continue;
      const a = correctAction(s);
      if (want(a, s)) out.push({ ...s, correct: a });
    }
    return out;
  }
  const shownActions = new Set(spec.rules.slice(0, spec.shown).map((r) => r.action));
  const ruleActions = [...new Set(spec.rules.map((r) => r.action))];

  const practiceFor = (seed: string) => ({ runbook: spec.runbook, tasks: draw(`${seed}|practice`, 20, (a) => a === spec.defaultAction || shownActions.has(a)), failureLog: draw(`${seed}|failures`, 10, (a) => shownActions.has(a)) });
  const heldoutFor = (seed: string): Task[] => {
    const tasks: Task[] = [];
    for (const a of ruleActions) tasks.push(...draw(`${seed}|held|${a}`, 6, (x) => x === a));
    tasks.push(...draw(`${seed}|held|default`, 16, (x) => x === spec.defaultAction));
    const r = rng(`${seed}|held|order`);
    for (let i = tasks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [tasks[i], tasks[j]] = [tasks[j], tasks[i]]; }
    return tasks;
  };

  type Parsed = { conds: [string, string][]; action: string };
  const LINE = /^\s*when\s+(.+?)\s+then\s+(\w+)\s*(?:because\s.*)?$/i;
  const parseLesson = (line: string): Parsed | string => {
    const m = LINE.exec(line);
    if (!m) return "a rule is `when <feature>=<value> and ... then <action>`";
    const action = m[2].toLowerCase();
    if (!spec.actions.includes(action)) return `the action ${m[2]} is not one of ${spec.actions.join(", ")}`;
    const conds: [string, string][] = [];
    for (const part of m[1].split(/\s+and\s+/i)) {
      const c = /^(\w+)=([\w-]+)$/.exec(part.trim());
      if (!c) return `the condition "${part.trim()}" is not <feature>=<value>`;
      const f = c[1].toLowerCase(), v = c[2].toLowerCase();
      if (!featureNames.includes(f)) return `${c[1]} is not a feature (${featureNames.join(", ")})`;
      if (!spec.features[f].includes(v)) return `${v} is not a value of ${f} (${spec.features[f].join(", ")}): a rule about a name or a one-off is not a rule`;
      conds.push([f, v]);
    }
    return { conds, action };
  };
  const lessonProblems = (x: unknown): string[] => {
    const l = x as { lessons?: unknown };
    if (!l || typeof l !== "object" || !Array.isArray(l.lessons) || l.lessons.some((t) => typeof t !== "string")) return ["the artifact is an object with a list of rule lines"];
    const lines = l.lessons as string[];
    const out: string[] = [];
    if (lines.length === 0) out.push("no rule was written");
    if (lines.length > spec.maxLessons) out.push(`more than ${spec.maxLessons} rules: consolidate what repeats into fewer, broader rules`);
    const seen = new Map<string, string>();
    lines.forEach((t, i) => {
      const p = parseLesson(t);
      if (typeof p === "string") { out.push(`rule ${i + 1}: ${p}`); return; }
      const key = p.conds.map(([f, v]) => `${f}=${v}`).sort().join("&");
      const prior = seen.get(key);
      if (prior === p.action) out.push(`rule ${i + 1} repeats an earlier one: merge them`);
      else if (prior) out.push(`rule ${i + 1} contradicts an earlier rule for ${key}: ${prior} against ${p.action}`);
      else seen.set(key, p.action);
    });
    return out;
  };
  const decide = (memory: readonly string[], s: Record<string, string>): string => {
    let best: { n: number; action: string } | undefined;
    for (const text of memory) for (const line of text.split("\n")) {
      const p = parseLesson(line);
      if (typeof p === "string") continue;
      if (p.conds.every(([f, v]) => s[f] === v) && (!best || p.conds.length > best.n)) best = { n: p.conds.length, action: p.action };
    }
    return best?.action ?? spec.defaultAction;
  };
  const heldOutTasks = (seed: string): HeldOutTask[] => heldoutFor(seed).map((t, i) => ({ id: `${spec.id}-${i}-${t.correct}`, run: (memory) => decide(memory, t) === t.correct }));

  const runLessons = (artifact: unknown, seed: string): CourseRun => {
    const problems = lessonProblems(artifact);
    if (problems.length) return { score_permille: 0, passed: false, measures: {}, failures: problems };
    const memory = (artifact as { lessons: string[] }).lessons;
    const held = heldoutFor(seed);
    const leaked = [...new Set(held.map((t) => t.name))].find((n) => memory.some((m) => m.toLowerCase().includes(n)));
    if (leaked) return { score_permille: 0, passed: false, measures: { leaked: true }, failures: [`a rule carries ${leaked}, a ${spec.subject} of the held-out tasks: it has seen them`] };
    const before = held.map((t) => decide([], t) === t.correct), after = held.map((t) => decide(memory, t) === t.correct);
    const accuracy = Math.round((after.filter(Boolean).length / held.length) * 1000);
    const baseline = Math.round((before.filter(Boolean).length / held.length) * 1000);
    const regressions = held.filter((_, i) => before[i] && !after[i]).length;
    const missed = ruleActions.filter((a) => held.some((t, i) => t.correct === a && !after[i]));
    const failures: string[] = [];
    if (accuracy < spec.accuracyMin) failures.push(`the executor is right on ${accuracy / 10}% of the held-out tasks with these rules (${baseline / 10}% without), below ${spec.accuracyMin / 10}%${missed.length ? `; it still gets ${missed.join(", ")} wrong` : ""}`);
    if (regressions > spec.regressionsMax) failures.push(`${regressions} tasks it got right without the rules are now wrong: a rule is too broad`);
    return { score_permille: regressions > spec.regressionsMax ? Math.min(accuracy, 500) : accuracy, passed: failures.length === 0, measures: { accuracy_permille: accuracy, baseline_permille: baseline, regressions, rules: memory.length }, failures };
  };
  const engine: Engine = { id: spec.id, practice: practiceFor, run: (artifact, seed) => runLessons(artifact, seed), replay: heldOutTasks };
  register(engine);

  // scripted agents
  const honest = () => ({ lessons: [...spec.honest] });
  const doNothing = () => ({ lessons: [] as string[] });
  const copier = (p: { failureLog: Task[] }) => ({ lessons: p.failureLog.slice(0, spec.maxLessons).map((t) => `${t.name} ${featureNames.map((f) => `${f} ${t[f]}`).join(" ")} went wrong: ${t.correct}`) });
  const overfitter = (p: { failureLog: Task[] }) => ({ lessons: p.failureLog.slice(0, spec.maxLessons).map((t) => `when ${featureNames.map((f) => `${f}=${t[f]}`).join(" and ")} then ${t.correct}`) });
  const halfway = () => ({ lessons: spec.honest.slice(0, spec.shown) });
  const overbroad = () => ({ lessons: [...spec.overbroad] });
  const hoarder = () => ({ lessons: [...spec.honest, ...spec.honest.slice(0, 3).map((l) => l.replace(/ because.*$/, ""))] });
  const leaker = (name: string) => ({ lessons: spec.honest.map((l, i) => (i === 0 ? `${l} (as with ${name})` : l)) });
  return { spec, correctAction, rulesCommitment, practiceFor, heldoutFor, parseLesson, lessonProblems, decide, heldOutTasks, runLessons, engine, agents: { honest, doNothing, copier, overfitter, halfway, overbroad, hoarder, leaker } };
}
