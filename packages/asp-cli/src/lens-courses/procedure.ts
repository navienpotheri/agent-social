/**
 * The tail-variant rule and the course that shows it (register row DK814; spec-delta S1205; docs/intake/11th-nov.md, IMG_6486): a skill that only memorised the common cases must not be certified. The held-out set has two
 * parts, scored apart: the COMMON cases (inputs of the shape practice showed) and the TAIL cases (a parameter at its rare end: a length of nine to twelve where practice had three, a value of ninety where practice had zero
 * to five). A memoriser, a lookup of the common values, scores high on the first and near zero on the second; a solver of the procedure scores high on both. The engine passes only when both are at the mark, and
 * its score is the lower of the two, so a memoriser earns nothing. The learner's output is something written, a procedure or a table, never trained; the world is a toy (the sum of squares of a list, modulo 97).
 * Scripted agents only: no real model is involved. Nothing here changes model weights.
 */
import { createHash } from "node:crypto";
import { register, type CourseRun, type Engine } from "./engines.ts";

export const ENGINE_ID = "procedure";
export const MOD = 97;
export const PASS_PERMILLE = 900;
export const COMMON = { length: 3, values: [0, 1, 2, 3, 4, 5] as const };
export const TAIL = { lengths: [9, 10, 11, 12] as const, values: [90, 91, 92, 93, 94, 95, 96, 97, 98, 99] as const };
export const OPS = ["sum_of_squares_mod", "sum_mod", "product_mod"] as const;
export type Op = (typeof OPS)[number];

export type Case = { input: number[]; answer: number; kind: "common" | "tail" };
export interface Artifact { lookup?: Record<string, number>; algorithm?: { op: Op; mod: number } }

/** The hidden procedure. */
export const truth = (xs: readonly number[]): number => xs.reduce((a, x) => (a + x * x) % MOD, 0);
const key = (xs: readonly number[]) => xs.join(",");

const rng = (seed: string) => { let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** Every input of the common shape: 216 lists of three values from zero to five. */
export function commonDomain(): number[][] {
  const out: number[][] = [];
  for (const a of COMMON.values) for (const b of COMMON.values) for (const c of COMMON.values) out.push([a, b, c]);
  return out;
}
const shuffled = <T,>(xs: readonly T[], r: () => number): T[] => { const o = [...xs]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
const mk = (xs: number[], kind: Case["kind"]): Case => ({ input: xs, answer: truth(xs), kind });

/** Practice: 100 of the 216 common inputs, with their answers, and the runbook in words. The rest of the common inputs are held out. */
export function practiceFor(seed: string): { runbook: string[]; examples: Case[] } {
  const r = rng(`${seed}|practice`);
  return { runbook: ["The answer for a list is built from its values one at a time.", "Each value is squared, the squares are added, and the total is taken modulo 97.", "Lists seen here are three values long; a list can be of any length and its values can be larger."], examples: shuffled(commonDomain(), r).slice(0, 100).map((x) => mk(x, "common")) };
}

/** The held-out set for a seed: 20 common inputs that practice did not show, and 20 tail inputs (length at its rare end, values at their rare end, or both). */
export function heldoutFor(seed: string): { common: Case[]; tail: Case[] } {
  const shown = new Set(practiceFor(seed).examples.map((c) => key(c.input)));
  const r = rng(`${seed}|held`);
  const common = shuffled(commonDomain().filter((x) => !shown.has(key(x))), r).slice(0, 20).map((x) => mk(x, "common"));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const tail: Case[] = [];
  const seen = new Set<string>();
  for (let i = 0; tail.length < 20 && i < 1000; i++) {
    const mode = tail.length % 3;                       // 0: a long list of common values; 1: a list of three tail values; 2: a long list of tail values
    const len = mode === 1 ? COMMON.length : pick(TAIL.lengths);
    const xs = Array.from({ length: len }, () => (mode === 0 ? pick(COMMON.values) : pick(TAIL.values)));
    if (!seen.has(key(xs))) { seen.add(key(xs)); tail.push(mk(xs, "tail")); }
  }
  return { common, tail };
}

/** The problems with an artifact, in words; none when it is whole. */
export function artifactProblems(x: unknown): string[] {
  const a = x as Artifact | null;
  if (!a || typeof a !== "object") return ["the artifact is an object with a `lookup` table or an `algorithm`"];
  const has = [a.lookup !== undefined, a.algorithm !== undefined].filter(Boolean).length;
  if (has !== 1) return ["write exactly one of `lookup` (a table of answers) and `algorithm` ({ op, mod })"];
  if (a.lookup) {
    const entries = Object.entries(a.lookup);
    if (entries.length > 5000) return ["a lookup table of more than 5,000 entries is not a skill"];
    if (entries.some(([k, v]) => !/^\d+(,\d+)*$/.test(k) || !Number.isInteger(v))) return ["a lookup key is a list of values like `1,2,3` and its answer an integer"];
  } else {
    const g = a.algorithm!;
    if (!OPS.includes(g.op) || !Number.isInteger(g.mod) || g.mod < 2 || g.mod > 1000) return [`an algorithm is { op: ${OPS.join(" | ")}, mod: 2 to 1000 }`];
  }
  return [];
}

export function apply(a: Artifact, xs: readonly number[]): number | undefined {
  if (a.lookup) return a.lookup[key(xs)];
  const { op, mod } = a.algorithm!;
  if (op === "sum_of_squares_mod") return xs.reduce((s, x) => (s + x * x) % mod, 0);
  if (op === "sum_mod") return xs.reduce((s, x) => (s + x) % mod, 0);
  return xs.reduce((s, x) => (s * (x % mod)) % mod, 1);
}
const score = (a: Artifact, cases: Case[]) => Math.round((cases.filter((c) => apply(a, c.input) === c.answer).length / cases.length) * 1000);

export function runProcedure(artifact: unknown, seed: string): CourseRun {
  const problems = artifactProblems(artifact);
  if (problems.length) return { score_permille: 0, passed: false, measures: {}, failures: problems };
  const a = artifact as Artifact;
  const h = heldoutFor(seed);
  const common = score(a, h.common), tail = score(a, h.tail);
  const failures: string[] = [];
  if (common < PASS_PERMILLE) failures.push(`the common cases are ${common / 10}% right, below ${PASS_PERMILLE / 10}%`);
  if (tail < PASS_PERMILLE) failures.push(`the tail cases (a long list, or large values) are ${tail / 10}% right, below ${PASS_PERMILLE / 10}%${common >= PASS_PERMILLE ? `: ${common / 10}% on the common cases and ${tail / 10}% on the tail is what a memorised table looks like, not an understood procedure` : ""}`);
  return { score_permille: Math.min(common, tail), passed: failures.length === 0, measures: { common_permille: common, tail_permille: tail }, failures };
}

/** Distinctive strings of the held-out tasks (DK1752): the tail inputs, each a list of at least three numbers joined by commas; a short common input like 1,2,3 turns up in ordinary text, so only the tail is listed. */
export const leakTokensFor = (seed: string): string[] => heldoutFor(seed).tail.filter((c) => c.input.length >= 9 || c.input.some((x) => x >= 90)).map((c) => key(c.input));
export const procedure: Engine = { id: ENGINE_ID, practice: (seed) => practiceFor(seed), run: (artifact, seed) => runProcedure(artifact, seed), leakTokens: leakTokensFor };
register(procedure);

// scripted learners
export const solverArtifact = (): Artifact => ({ algorithm: { op: "sum_of_squares_mod", mod: MOD } });
/** A lookup of every common input: what a learner that memorised the common cases (and could compute them all) writes. */
export const memoriserArtifact = (): Artifact => ({ lookup: Object.fromEntries(commonDomain().map((x) => [key(x), truth(x)])) });
/** A lookup of only the practice examples. */
export const practiceCopierArtifact = (seed: string): Artifact => ({ lookup: Object.fromEntries(practiceFor(seed).examples.map((c) => [key(c.input), c.answer])) });
export const wrongOpArtifact = (): Artifact => ({ algorithm: { op: "sum_mod", mod: MOD } });
export const wrongModArtifact = (): Artifact => ({ algorithm: { op: "sum_of_squares_mod", mod: 89 } });
export const doNothingArtifact = (): Artifact => ({});
