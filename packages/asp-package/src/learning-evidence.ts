/**
 * Grading the path, paying for progress and counting episodes (register rows DK848, DK817 and DK815; spec-deltas S1237 to S1239; docs/intake/11th-nov.md Part 3, ranks 23, 25 and 26). DK848: TOOL-CALL SEQUENCE
 * REGRESSION: trajectories are replayed against a golden call graph (each call with the calls it needs before it); an invented tool is a failure of its own kind, and a right answer reached through one still fails; a
 * reordered valid path passes. DK817: a LEARNING-PROGRESS STIPEND: pay in proportion to the improvement on a fixed probe set above the best so far, with a noise source in the world that offers novelty and no progress; a
 * novelty-seeking scripted agent earns nothing, a progress-seeking one earns and improves. DK815: EPISODES-TO-FIX and EXPOSURE for the capability fingerprint. Pure code, scripted agents and a toy world; credits are mock
 * accounting entries.
 */

// ---- DK848 ----
/** A golden call graph: each valid call with the calls that must already have happened before it. */
export type CallGraph = Record<string, string[]>;
export type PathFailure = "invented_call" | "missing_call" | "order_violation" | "wrong_outcome";
export interface PathGrade { pass: boolean; failures: PathFailure[]; invented: string[]; missing: string[]; violations: string[] }
/** Grades one trajectory: the calls it made, in order, and whether its answer was right. Every invented call (not in the graph) is named; the path must contain every graph call, each after what it needs. */
export function gradePath(calls: string[], graph: CallGraph, outcomeOk: boolean): PathGrade {
  const invented = [...new Set(calls.filter((c) => !(c in graph)))].sort();
  const missing = Object.keys(graph).filter((c) => !calls.includes(c)).sort();
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const c of calls) {
    if (c in graph) for (const need of graph[c]) if (!seen.has(need)) violations.push(`${c} before ${need}`);
    seen.add(c);
  }
  const failures: PathFailure[] = [];
  if (invented.length) failures.push("invented_call");
  if (missing.length) failures.push("missing_call");
  if (violations.length) failures.push("order_violation");
  if (!outcomeOk) failures.push("wrong_outcome");
  return { pass: failures.length === 0, failures, invented, missing, violations: [...new Set(violations)].sort() };
}
/** Replays N trajectories and reports the pass rate and how often each kind of failure occurred; a right answer by an invented call counts as invented, not as success. */
export function regress(trajectories: { calls: string[]; outcomeOk: boolean }[], graph: CallGraph): { n: number; passPermille: number; byFailure: Record<PathFailure, number>; rightAnswerWrongPath: number } {
  const by: Record<PathFailure, number> = { invented_call: 0, missing_call: 0, order_violation: 0, wrong_outcome: 0 };
  let pass = 0, rightWrong = 0;
  for (const t of trajectories) {
    const g = gradePath(t.calls, graph, t.outcomeOk);
    if (g.pass) pass++;
    else if (t.outcomeOk) rightWrong++;
    for (const f of g.failures) by[f]++;
  }
  return { n: trajectories.length, passPermille: trajectories.length ? Math.round((pass / trajectories.length) * 1000) : 0, byFailure: by, rightAnswerWrongPath: rightWrong };
}

// ---- DK817 ----
export const STIPEND_PER_PERMILLE = 0.04;
/** Pays for improvement over the best score so far, never for recovering lost ground, so a score that drops and rises again earns nothing twice. */
export function stipendFor(scores: number[], rate = STIPEND_PER_PERMILLE): { paid: number; best: number; perRound: number[] } {
  let best = scores.length ? scores[0] : 0, paid = 0;
  const perRound: number[] = [0];
  for (let i = 1; i < scores.length; i++) {
    const gain = Math.max(0, scores[i] - best);
    const credits = Math.floor(gain * rate);
    if (scores[i] > best) best = scores[i];
    paid += credits;
    perRound.push(credits);
  }
  return { paid, best, perRound };
}
export type Source = "noise" | "learnable";
export interface StipendRun { rounds: number; attended: Record<Source, number>; probeScore: number[]; earned: number; finalProbePermille: number }
/** A tiny world: a hidden map from eight keys to values 1 to 3 (the learnable source) and a noise source whose pairs are random each time. The probe set is the eight keys; a probe is right when memory has the true value. */
export function stipendRun(strategy: "novelty" | "progress", rounds: number, seed: number): StipendRun {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const K = 8;
  const truth = Array.from({ length: K }, () => 1 + Math.floor(rnd() * 3));
  const memory = new Map<number, number>();
  const probe = () => Math.round((truth.filter((v, k) => memory.get(k) === v).length / K) * 1000);
  const attended: Record<Source, number> = { noise: 0, learnable: 0 };
  const surprise: Record<Source, number | null> = { noise: null, learnable: null };
  const gain: Record<Source, number | null> = { noise: null, learnable: null };
  let next = 0, last: Source = "noise";
  const scores = [probe()];
  for (let i = 0; i < rounds; i++) {
    let src: Source;
    if (strategy === "novelty") {
      // Seeks the most surprising source. The noise is always surprising; a source not yet tried counts as unsurprising.
      src = (surprise.learnable ?? 0) > (surprise.noise ?? 0) ? "learnable" : "noise";
    } else if (gain.noise === null) src = "noise";
    else if (gain.learnable === null) src = "learnable";
    else src = (gain.learnable ?? 0) > (gain.noise ?? 0) ? "learnable" : (gain.noise ?? 0) > (gain.learnable ?? 0) ? "noise" : last;
    attended[src]++;
    const before = probe();
    if (src === "learnable") {
      const k = next++ % K;
      surprise.learnable = memory.get(k) === truth[k] ? 0 : 1;
      memory.set(k, truth[k]);
    } else {
      surprise.noise = rnd() < 0.75 ? 1 : 0.5;
    }
    gain[src] = probe() - before;
    last = src;
    scores.push(probe());
  }
  return { rounds, attended, probeScore: scores, earned: stipendFor(scores).paid, finalProbePermille: scores.at(-1) ?? 0 };
}

// ---- DK815 ----
export interface Episode { index: number; /** The failures that happened in this episode (a tag each). */ failures: string[] }
export interface FingerprintEntry { tag: string; firstEpisode: number; lastEpisode: number; occurrences: number; /** Episodes from the first occurrence to the last one, plus one; null while the failure is still repeating. */ episodesToFix: number | null }
export interface ExposureFingerprint { exposure: number; entries: FingerprintEntry[] }
/** From a stream of episodes: per failure, the number of episodes before it stopped repeating (fixed once it has not occurred for `quiet` episodes), and per agent the total exposure. */
export function exposureFingerprint(stream: Episode[], quiet: number): ExposureFingerprint {
  const by = new Map<string, number[]>();
  for (const e of stream) for (const t of new Set(e.failures)) by.set(t, [...(by.get(t) ?? []), e.index]);
  const end = stream.length ? stream[stream.length - 1].index : 0;
  const entries = [...by.entries()].map(([tag, at]) => {
    const first = at[0], lastAt = at[at.length - 1];
    const fixed = end - lastAt >= quiet;
    return { tag, firstEpisode: first, lastEpisode: lastAt, occurrences: at.length, episodesToFix: fixed ? lastAt - first + 1 : null };
  }).sort((a, b) => a.tag.localeCompare(b.tag));
  return { exposure: stream.length, entries };
}
/** A scripted learner that repeats a failure until it has met it `needed` times, then stops. */
export function scriptedStream(needed: number, tags: string[], episodes: number): Episode[] {
  const met = new Map<string, number>();
  return Array.from({ length: episodes }, (_v, index) => {
    const tag = tags[index % tags.length];
    const n = met.get(tag) ?? 0;
    const fails = n < needed;
    if (fails) met.set(tag, n + 1);
    return { index, failures: fails ? [tag] : [] };
  });
}
