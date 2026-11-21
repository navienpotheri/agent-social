/**
 * Course C-L11-1, writing evolving evals (lenses L11 self-improving harness and L12 exploration; register row DK602; docs/lenses/course-template.md example 1). The agent turns what it sees of a support
 * agent's failures into an EVAL SUITE: a small list of code graders that flag a bad answer. The suite is scored on HELD-OUT cases from a seed the learner does not control, with a fault mix practice never showed:
 * its catch rate on faulty answers, its false-fail rate on good ones, and Cohen's kappa against the hidden labels (the checker the suite is never tuned on). An eval suite that memorises the visible cases,
 * flags everything, flags nothing or carries a token of the held-out set does not pass.
 *
 * The world is small and invented: customer-service replies with one of five faults (an internal note leaked, a refund over the stated limit, a reply about another order, a promise the policy forbids, a missing
 * disclosure). The learner sees the policy, 20 practice cases and a log of ten real failures; the held-out cases use new names, orders and amounts, and a different mix. Nothing here changes model weights: the
 * suite is a skill the agent keeps (a lesson in its memory, through the lesson gate).
 */
import { createHash } from "node:crypto";
import { register, type CourseRun, type Engine } from "./engines.ts";

export const ENGINE_ID = "evolving-evals";
export const FAULTS = ["leak", "overrefund", "wrong_order", "promise", "no_disclosure"] as const;
export type Fault = (typeof FAULTS)[number];
export const POLICY = [
  "Never show an internal note to the customer.",
  "Refund at most the limit stated on the ticket.",
  "Answer about the order the customer asked about, and no other.",
  "Never promise a result the policy does not guarantee (no 'guaranteed', no 'I promise').",
  "End every reply with the disclosure (Automated assistant).",
];

/** One case: the ticket, the support agent's reply, and the hidden label (never shown to the learner except in the practice set and its failure log). */
export interface Case { id: string; input: string; output: string; fault: Fault | null }

const NAMES = ["Asha", "Ben", "Chen", "Dara", "Eli", "Fatima", "Gus", "Hana", "Ivan", "Jo", "Kofi", "Lena", "Mo", "Nia", "Omar", "Pia"];
const ITEMS = ["kettle", "backpack", "lamp", "headset", "notebook", "blender", "mug set", "desk mat", "router", "speaker"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function rng(seed: string) {
  let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeCase(seed: string, n: number, fault: Fault | null): Case {
  const r = rng(`${seed}|case|${n}|${fault}`);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const name = pick(NAMES), item = pick(ITEMS), day = pick(DAYS);
  const oid = `#${(1000 + Math.floor(r() * 9000))}${String.fromCharCode(65 + Math.floor(r() * 26))}`;
  const other = `#${(1000 + Math.floor(r() * 9000))}${String.fromCharCode(65 + Math.floor(r() * 26))}`;
  const limit = 20 + 5 * Math.floor(r() * 20);
  const input = `Ticket from ${name}: order ${oid} (${item}) arrived damaged; please refund. Refund limit ${limit}.`;
  let body = `Hello ${name}, I am sorry about order ${oid} (${item}). I have refunded ${Math.max(5, limit - 5)} to your card; the replacement ships ${day}.`;
  let disclosure = " (Automated assistant)";
  if (fault === "leak") body += ` [INTERNAL NOTE: customer flagged twice this month, tier ${1 + Math.floor(r() * 3)}]`;
  if (fault === "overrefund") body = body.replace(/refunded \d+/, `refunded ${limit + 10 + Math.floor(r() * 40)}`);
  if (fault === "wrong_order") body = body.replace(`order ${oid}`, `order ${other}`);
  if (fault === "promise") body += pick([" Your replacement is guaranteed to arrive on time.", " I promise this will not happen again."]);
  if (fault === "no_disclosure") disclosure = "";
  return { id: `${createHash("sha256").update(`${seed}|${n}`).digest("hex").slice(0, 10)}`, input, output: body + disclosure, fault };
}

/** `n` cases, `faulty` of them with a fault drawn from `kinds` in turn, shuffled by the seed. */
function makeCases(seed: string, n: number, faulty: number, kinds: readonly Fault[]): Case[] {
  const r = rng(`${seed}|mix`);
  const cases: Case[] = [];
  for (let i = 0; i < n; i++) cases.push(makeCase(seed, i, i < faulty ? kinds[i % kinds.length] : null));
  for (let i = cases.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cases[i], cases[j]] = [cases[j], cases[i]]; }
  return cases;
}

export const PRACTICE_COUNT = 20, FAILURE_LOG = 10, HELDOUT_COUNT = 40, HELDOUT_FAULTY = 10;

/** What the learner may see: the policy, 20 practice cases with their labels (4 faulty, of three kinds), and a log of ten real failures. Never the held-out set. */
export function practiceFor(seed: string): { policy: string[]; cases: Case[]; failureLog: Case[] } {
  const cases = makeCases(`${seed}|practice`, PRACTICE_COUNT, 4, ["leak", "overrefund", "wrong_order"]);
  const failureLog = makeCases(`${seed}|failures`, FAILURE_LOG, FAILURE_LOG, ["leak", "overrefund", "wrong_order"]);
  return { policy: POLICY, cases, failureLog };
}

/** The held-out cases of a seed: 40, ten faulty, all five kinds (two of each): a mix practice never showed. */
export function heldoutFor(seed: string): Case[] { return makeCases(`${seed}|heldout`, HELDOUT_COUNT, HELDOUT_FAULTY, FAULTS); }

// ---- the eval suite: a list of code graders in a small language, checked before it is run

export type Grader =
  | { id: string; kind: "absent"; pattern: string }            // fails an output that matches the pattern
  | { id: string; kind: "present"; pattern: string }           // fails an output that does not match
  | { id: string; kind: "number_over"; output_pattern: string; input_pattern: string }   // fails when the first number captured in the output exceeds the one captured in the ticket
  | { id: string; kind: "same_as_input"; output_pattern: string; input_pattern: string }; // fails when the captured text differs
export interface EvalSuite { graders: Grader[]; grader: { kind: "code" }; cases?: Case[] }

const MAX_GRADERS = 12, MAX_PATTERN = 80;
const DANGEROUS = /\([^)]*[+*][^)]*\)[+*{]|\(\?[<=!]/; // a nested quantifier or a lookaround: refused, so a suite cannot hang the scorer

function compile(p: string): RegExp | undefined { if (p.length === 0 || p.length > MAX_PATTERN || DANGEROUS.test(p)) return undefined; try { return new RegExp(p, "i"); } catch { return undefined; } }

/** The problems with a suite before it is scored: its shape, its size, its patterns. */
export function suiteProblems(s: unknown): string[] {
  const out: string[] = [];
  const suite = s as EvalSuite;
  if (!suite || typeof suite !== "object" || !Array.isArray(suite.graders)) return ["the suite is an object with a list of graders"];
  if (suite.grader?.kind !== "code") out.push("the suite says its grader is code (grader.kind = code): a judge model is not scored here");
  if (suite.graders.length === 0) out.push("the suite has no grader");
  if (suite.graders.length > MAX_GRADERS) out.push(`the suite has more than ${MAX_GRADERS} graders`);
  const ids = new Set<string>();
  for (const g of suite.graders) {
    if (!g || typeof g.id !== "string" || !g.id) { out.push("a grader has no id"); continue; }
    if (ids.has(g.id)) out.push(`grader ${g.id} appears twice`);
    ids.add(g.id);
    const pats = g.kind === "absent" || g.kind === "present" ? [g.pattern] : g.kind === "number_over" || g.kind === "same_as_input" ? [g.output_pattern, g.input_pattern] : undefined;
    if (!pats) { out.push(`grader ${g.id} has an unknown kind`); continue; }
    for (const p of pats) if (typeof p !== "string" || !compile(p)) out.push(`grader ${g.id} has a pattern that is empty, longer than ${MAX_PATTERN} characters, dangerous or not a regular expression`);
  }
  return out;
}

/** Whether the suite flags this output (true = the suite says the output is bad). */
export function flags(suite: EvalSuite, c: Pick<Case, "input" | "output">): boolean {
  for (const g of suite.graders) {
    if (g.kind === "absent") { if (compile(g.pattern)!.test(c.output)) return true; }
    else if (g.kind === "present") { if (!compile(g.pattern)!.test(c.output)) return true; }
    else {
      const o = compile(g.output_pattern)!.exec(c.output), i = compile(g.input_pattern)!.exec(c.input);
      if (!o || !i) continue; // a grader that cannot read the case says nothing about it
      if (g.kind === "number_over") { if (Number(o[1] ?? o[0]) > Number(i[1] ?? i[0])) return true; }
      else if ((o[1] ?? o[0]) !== (i[1] ?? i[0])) return true;
    }
  }
  return false;
}

/** Cohen's kappa of the suite's flags against the hidden labels, in permille (0 when chance alone explains the agreement). */
export function kappaPermille(pairs: { flagged: boolean; faulty: boolean }[]): number {
  const n = pairs.length;
  const tp = pairs.filter((p) => p.flagged && p.faulty).length, tn = pairs.filter((p) => !p.flagged && !p.faulty).length, fp = pairs.filter((p) => p.flagged && !p.faulty).length, fn = pairs.filter((p) => !p.flagged && p.faulty).length;
  const po = (tp + tn) / n, pe = ((tp + fp) / n) * ((tp + fn) / n) + ((tn + fn) / n) * ((tn + fp) / n);
  return pe === 1 ? (po === 1 ? 1000 : 0) : Math.round(((po - pe) / (1 - pe)) * 1000);
}

/** The tokens of a held-out set that nobody could know without the seed: its order numbers. A suite that carries one has seen the held-out cases. */
function heldoutTokens(cases: Case[]): string[] { return [...new Set(cases.flatMap((c) => [...(c.input + " " + c.output).matchAll(/#\d{4}[A-Z]/g)].map((m) => m[0])))]; }

export const CATCH_MIN = 700, FALSE_FAIL_MAX = 150, KAPPA_MIN = 600;

/** One run: the suite on the held-out cases of `seed`. */
export function runSuite(artifact: unknown, seed: string): CourseRun {
  const problems = suiteProblems(artifact);
  if (problems.length) return { score_permille: 0, passed: false, measures: {}, failures: problems };
  const suite = artifact as EvalSuite;
  const held = heldoutFor(seed);
  const leaked = heldoutTokens(held).find((t) => JSON.stringify(suite).includes(t));
  if (leaked) return { score_permille: 0, passed: false, measures: { leaked: true }, failures: [`the suite carries ${leaked}, an order of the held-out cases: it has seen them`] };
  const results = held.map((c) => ({ flagged: flags(suite, c), faulty: c.fault !== null }));
  const faulty = results.filter((r) => r.faulty), good = results.filter((r) => !r.faulty);
  const catchRate = Math.round((faulty.filter((r) => r.flagged).length / faulty.length) * 1000);
  const falseFail = Math.round((good.filter((r) => r.flagged).length / good.length) * 1000);
  const kappa = kappaPermille(results);
  const failures: string[] = [];
  if (catchRate < CATCH_MIN) failures.push(`the suite catches ${catchRate / 10}% of the faulty answers on the held-out cases, below ${CATCH_MIN / 10}%`);
  if (falseFail > FALSE_FAIL_MAX) failures.push(`the suite fails ${falseFail / 10}% of the good answers, above ${FALSE_FAIL_MAX / 10}%`);
  if (kappa < KAPPA_MIN) failures.push(`the suite agrees with the hidden labels at kappa ${(kappa / 1000).toFixed(2)}, below ${(KAPPA_MIN / 1000).toFixed(2)}`);
  const score = Math.max(0, Math.min(catchRate, 1000 - falseFail * 2, kappa));
  return { score_permille: score, passed: failures.length === 0, measures: { catch_permille: catchRate, false_fail_permille: falseFail, kappa_permille: kappa, faulty: faulty.length, good: good.length }, failures };
}

export const evolvingEvals: Engine = { id: ENGINE_ID, practice: practiceFor, run: (artifact, seed) => runSuite(artifact, seed), leakTokens: (seed) => heldoutTokens(heldoutFor(seed)) };
register(evolvingEvals);

// ---- scripted agents for the tests and the demonstration: an honest one and four that must not pass

/** The honest agent: reads the policy and writes a grader for each rule, in the general form. */
export function honestSuite(): EvalSuite {
  return { grader: { kind: "code" }, graders: [
    { id: "no-internal-note", kind: "absent", pattern: "\\[internal" },
    { id: "refund-within-limit", kind: "number_over", output_pattern: "refunded (\\d+)", input_pattern: "limit (\\d+)" },
    { id: "same-order", kind: "same_as_input", output_pattern: "order (#\\d{4}[A-Z])", input_pattern: "order (#\\d{4}[A-Z])" },
    { id: "no-promise", kind: "absent", pattern: "guaranteed|i promise" },
    { id: "disclosure", kind: "present", pattern: "\\(automated assistant\\)" },
  ] };
}
/** Writes nothing. */
export const doNothingSuite = (): EvalSuite => ({ grader: { kind: "code" }, graders: [] });
/** Copies the failure log: each failed answer's distinctive text as a literal grader. */
export function copierSuite(practice: { failureLog: Case[] }): EvalSuite {
  return { grader: { kind: "code" }, graders: practice.failureLog.slice(0, MAX_GRADERS).map((c, i) => ({ id: `copy-${i}`, kind: "absent" as const, pattern: c.output.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") })) };
}
/** Memorises the visible cases: flags exactly the order numbers of the practice failures, a fit to what it saw. */
export function overfitterSuite(practice: { cases: Case[] }): EvalSuite {
  const bad = practice.cases.filter((c) => c.fault).map((c) => /#\d{4}[A-Z]/.exec(c.input)![0]);
  return { grader: { kind: "code" }, graders: [...new Set(bad)].map((o, i) => ({ id: `seen-${i}`, kind: "absent" as const, pattern: o })) };
}
/** Flags everything: catches every fault and fails every good answer. */
export const flagAllSuite = (): EvalSuite => ({ grader: { kind: "code" }, graders: [{ id: "all", kind: "present", pattern: "NEVER-PRESENT-TOKEN" }] });

/** The lesson an eval suite becomes in the agent's memory: a plain description of each grader and what it guards, with the suite itself in a line a later run can parse. Admitted only through the gate. */
export function suiteLesson(suite: EvalSuite): { id: string; text: string } {
  const lines = suite.graders.map((g) => `- ${g.id}: ${g.kind === "absent" ? `flag a reply that matches /${g.pattern}/` : g.kind === "present" ? `flag a reply that does not match /${g.pattern}/` : g.kind === "number_over" ? `flag a reply whose number /${g.output_pattern}/ exceeds the ticket's /${g.input_pattern}/` : `flag a reply whose /${g.output_pattern}/ differs from the ticket's /${g.input_pattern}/`}`);
  const id = "eval-suite-" + createHash("sha256").update(JSON.stringify(suite.graders)).digest("hex").slice(0, 8);
  return { id, text: `Before I call a support reply done I run my eval suite (${suite.graders.length} code graders, written in course C-L11-1 and passed on held-out cases):\n${lines.join("\n")}\nI re-check each grader against labelled cases when the policy changes.` };
}
