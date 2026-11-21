/**
 * The engines behind the catalogue's cards (register rows DK600 to DK603): each one generates seeded tasks, scores the artifact an agent wrote on HELD-OUT variants, and says whether one run met the gate. The
 * learner sees practice tasks only; the held-out variants come from seeds the learner does not control (`courseSeeds`, anchored in the log head at the time of the sitting). An engine is pure: the same artifact and
 * seed give the same score on every machine. The first three engines are the courses of `docs/lenses/courses.json`.
 */
import type { HeldOutTask } from "@agent-social/asp-package";
import { courseSeeds, type CourseCard } from "./catalogue.ts";

/** One run of an engine: the score in permille, whether it met the gate, what was measured, and what failed (in words, for the learner). */
export interface CourseRun { score_permille: number; passed: boolean; measures: Record<string, number | string | boolean>; failures: string[] }

export interface Engine {
  id: string;
  /** The practice tasks the learner may see and work on (never the held-out ones). */
  practice(seed: string): unknown;
  /** Scores the artifact the agent wrote on the held-out variants of `seed`. */
  run(artifact: unknown, seed: string, gate: CourseCard["gate"]): CourseRun;
  /** The held-out tasks the lesson gate replays a written-back lesson on (a course whose artifact is memory replays on its own tasks); absent: the generic floor tasks. */
  replay?(seed: string): HeldOutTask[];
}

export const ENGINES: Record<string, Engine> = {};
export const engineIds = (): ReadonlySet<string> => new Set(Object.keys(ENGINES));
export function register(engine: Engine): void { ENGINES[engine.id] = engine; }

export interface Sitting { course: string; holder: string; attempt: number; seeds: string[]; runs: CourseRun[]; mean_permille: number; min_permille: number; error_bar_permille: number; passed: boolean }

/** A sitting: K runs on K seeds from the anchor. It passes only when every run meets the gate (a lucky seed does not carry a weak artifact), and the mean and the error bar are reported. */
export function sit(card: CourseCard, artifact: unknown, holder: string, attempt: number, anchor: string): Sitting {
  const engine = ENGINES[card.generator.engine];
  if (!engine) throw new Error(`no engine ${card.generator.engine} is registered`);
  const seeds = courseSeeds(card.id, holder, attempt, anchor, card.gate.runs);
  const runs = seeds.map((s) => engine.run(artifact, s, card.gate));
  const scores = runs.map((r) => r.score_permille);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.length > 1 ? scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1) : 0;
  return { course: card.id, holder, attempt, seeds, runs, mean_permille: Math.round(mean), min_permille: Math.min(...scores), error_bar_permille: Math.round(Math.sqrt(variance / scores.length)), passed: runs.every((r) => r.passed) };
}

/** Whether the Registrar may attest a completion for this sitting: only when every run met the gate. The reason is in words for the learner. */
export function attestation(s: Sitting): { ok: boolean; reason: string } {
  if (s.passed) return { ok: true, reason: `every one of the ${s.runs.length} runs met the gate (mean ${s.mean_permille / 10}%, error bar ${s.error_bar_permille / 10}%)` };
  const bad = s.runs.map((r, i) => ({ r, i })).filter((x) => !x.r.passed);
  return { ok: false, reason: `${bad.length} of ${s.runs.length} runs missed the gate: ${bad[0].r.failures[0] ?? "no score"}` };
}
