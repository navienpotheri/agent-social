/**
 * Reset on plateau (register row DK819; spec-delta S1210; docs/intake/11th-nov.md, IMG_6491, paper P34): a harness rule. When an agent's search has gained nothing for N cycles, it forgets its session and its
 * candidate history and restarts from the best signed artifact plus the lessons that passed the gate. The history is what anchors a search to the place it is stuck, so forgetting it lets the search look elsewhere
 * on the same budget; the artifact and the lessons are what must not be forgotten, so a reset that drops a gate-passed lesson, or restarts from an artifact whose hash is not the signed one, is flagged.
 * Scripted search on a toy landscape; no real model. The course that would teach it is row DK1210.
 */
import { createHash } from "node:crypto";

export interface Candidate { x: number; score: number }
export interface Lesson { id: string; text: string }
export interface Options {
  seed: string; budget: number;
  /** Cycles without a gain before a reset; undefined means never reset (an anchored agent). */
  resetAfter?: number;
  /** A reset that drops the gate-passed lessons (the flawed rule the audit must catch). */
  dropLessons?: boolean;
  /** A reset that restarts from a different artifact than the signed best. */
  forgeArtifact?: boolean;
  lessons?: Lesson[];
  start: Candidate;
  f: (x: number) => number;
}
export interface Reset { at: number; keptArtifact: string; keptLessons: string[] }
export interface Flag { at: number; kind: "dropped_lesson" | "unsigned_artifact"; detail: string }
export interface Result { best: Candidate; evaluations: number; resets: Reset[]; flags: Flag[]; trace: number[] }

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
const rng = (seed: string) => { let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export const artifactHash = (c: Candidate): string => sha(JSON.stringify(c));
/** The landscape of the test: a local peak of 50 at 20 and the global peak of 100 at 80, over 0 to 99. */
export const landscape = (x: number): number => Math.max(50 - Math.abs(x - 20) * 5, 100 - Math.abs(x - 80) * 5, 0);
/** The width of a search step; a fresh search explores this many uniformly drawn points before it climbs. */
export const STEP = 3;
export const EXPLORE = 4;

/**
 * The search: while there is history it proposes a small step from the best candidate in it (the history anchors it); with none it draws uniformly. After a reset it explores EXPLORE points before it climbs, then
 * climbs from the best of everything it has seen since, never below the signed artifact it restarted from.
 */
export function search(o: Options): Result {
  const r = rng(o.seed);
  const lessons = (o.lessons ?? []).map((l) => ({ ...l }));
  const passed = new Set(lessons.map((l) => l.id));
  let artifact = { ...o.start, score: o.f(o.start.x) };
  let signed = artifactHash(artifact);
  let history: Candidate[] = [artifact];
  let sinceGain = 0, evaluations = 1, exploring = 0;
  const resets: Reset[] = [], flags: Flag[] = [], trace = [artifact.score];
  let held = lessons;
  while (evaluations < o.budget) {
    const bestHist = history.reduce((a, b) => (b.score > a.score ? b : a));
    const x = exploring > 0 ? Math.floor(r() * 100) : Math.min(99, Math.max(0, bestHist.x + (Math.floor(r() * (2 * STEP + 1)) - STEP)));
    if (exploring > 0) exploring--;
    const c = { x, score: o.f(x) };
    evaluations++;
    history.push(c);
    if (c.score > artifact.score) { artifact = c; signed = artifactHash(artifact); sinceGain = 0; } else sinceGain++;
    trace.push(artifact.score);
    if (o.resetAfter !== undefined && sinceGain >= o.resetAfter) {
      // The reset: forget the history and the session; keep the best signed artifact and the lessons that passed the gate.
      history = [o.forgeArtifact ? { x: 50, score: o.f(50) } : { ...artifact }];
      held = o.dropLessons ? [] : lessons;
      const at = evaluations;
      for (const id of passed) if (!held.some((l) => l.id === id)) flags.push({ at, kind: "dropped_lesson", detail: `the reset dropped the gate-passed lesson ${id}` });
      if (artifactHash(history[0]) !== signed) flags.push({ at, kind: "unsigned_artifact", detail: `the reset restarted from ${artifactHash(history[0])}, not the signed best ${signed}` });
      resets.push({ at, keptArtifact: signed, keptLessons: held.map((l) => l.id) });
      sinceGain = 0; exploring = EXPLORE;
    }
  }
  return { best: artifact, evaluations, resets, flags, trace };
}
