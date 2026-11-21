/**
 * Worlds for exploration and expeditions (register row DK1740; docs/research/exploration-and-expeditions.md; DK1317, DK1318, DK1350). Two kinds of world, and the difference is enforced here:
 *
 *   measured     seeded, replayable, scored from the transcript, eligible for studies and for any claim with numbers. The desert below is one.
 *   expedition   new every time, made by an open world model on rented GPUs. It cannot be regenerated, so it is audited instead: the model's name and weights hash, every frame's hash in a chain, the actions, the cost.
 *                An expedition result is never evidence for a claim (`claimable`), and an expedition that breaks its cost cap or shows an inconsistent frame chain is VOID, not scored.
 *
 * The desert is a small closed grid with no network and no real tool: the agent is dropped at a seeded cell, sees only its own supplies, the cell's neighbours' kinds and a bearing to the home beacon when it is within
 * the beacon's range, and must reach home before its water runs out. The referee runs a policy step by step, records every observation, action and outcome, and a transcript replays to the same result. The policies in
 * the tests are scripted: no real model is involved, and nothing here changes model weights. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- the declaration

export type WorldKind = "measured" | "expedition";
export interface WorldDecl {
  id: string;
  kind: WorldKind;
  /** A measured world has a seed and nothing else generates it. */
  seed?: string;
  /** An expedition names the world model, the hash of its weights and whether its licence was checked for the use; it has none of a seed's repeatability. */
  model?: { name: string; weights_sha256: string; licence_checked: boolean };
  max_steps: number;
  /** An expedition's cost cap in mock credits for the whole expedition; the GPU rate is per second. */
  cost_cap?: number;
  gpu_credits_per_second?: number;
}

/** What is wrong with a declaration. A world is either measured or expedition, and each carries what its kind needs. */
export function declProblems(d: WorldDecl): string[] {
  const out: string[] = [];
  if (!d.id) out.push("a world has an id");
  if (!(Number.isInteger(d.max_steps) && d.max_steps > 0)) out.push("a world has a step limit");
  if (d.kind === "measured") {
    if (!d.seed) out.push("a measured world has a seed: the same seed must give the same world");
    if (d.model) out.push("a measured world is made by its rules and its seed, not by a world model");
  } else if (d.kind === "expedition") {
    if (!d.model?.name || !/^sha256:[0-9a-f]{64}$/.test(d.model.weights_sha256 ?? "")) out.push("an expedition names its world model and the sha256 of the weights, so that a run can be audited");
    if (d.model && d.model.licence_checked !== true) out.push("the licence of the weights has not been checked for this use");
    if (!(d.cost_cap! > 0) || !(d.gpu_credits_per_second! > 0)) out.push("an expedition has a cost cap and a GPU rate, so that its cost is bounded and shown to the sponsor");
    if (d.seed) out.push("an expedition has no seed: it cannot be regenerated, and a seed would claim that it can");
  } else out.push("a world is measured or expedition");
  return out;
}
/** Only a measured world's result may stand behind a study or a claim with numbers. */
export const claimable = (d: Pick<WorldDecl, "kind">): boolean => d.kind === "measured";

// ---------------------------------------------------------------- the measured desert

export const SIZE = 15;
export const BEACON_RANGE = 5;
export const WATER = 60;
export type Cell = "sand" | "dune" | "oasis" | "home";
export type Move = "N" | "E" | "S" | "W" | "drink";
export interface Obs { pos: { x: number; y: number }; water: number; step: number; /** Kinds of the four neighbours, N E S W ("wall" off the grid). */ around: (Cell | "wall")[]; /** A bearing to home in the four compass moves that reduce the distance, only within the beacon's range. */ bearing: Move[] | null; on: Cell }
export type Policy = (obs: Obs, memory: Record<string, unknown>) => Move;

function rng(seed: string) {
  let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export interface Desert { grid: Cell[][]; start: { x: number; y: number }; home: { x: number; y: number } }
/** The desert of a seed: home at the middle, dunes that cannot be crossed, oases that give water, and a start at least 8 steps from home. */
export function desertOf(seed: string): Desert {
  const r = rng(`desert|${seed}`);
  const home = { x: 7, y: 7 };
  const grid: Cell[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => (r() < 0.12 ? "dune" : "sand")));
  for (let k = 0; k < 6; k++) { const x = Math.floor(r() * SIZE), y = Math.floor(r() * SIZE); if (Math.abs(x - 7) + Math.abs(y - 7) > 2) grid[y]![x] = "oasis"; }
  grid[home.y]![home.x] = "home";
  let start = { x: 0, y: 0 };
  for (let tries = 0; tries < 200; tries++) { const x = Math.floor(r() * SIZE), y = Math.floor(r() * SIZE); if (Math.abs(x - 7) + Math.abs(y - 7) >= 8 && grid[y]![x] === "sand") { start = { x, y }; break; } }
  grid[start.y]![start.x] = "sand";
  return { grid, start, home };
}
const D: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export interface Step { n: number; obs: Obs; move: Move; ok: boolean }
export interface Outcome { returned: boolean; water_left: number; steps: number; reason: "home" | "out_of_water" | "step_limit"; closest: number }
export interface Transcript { world: string; seed: string; steps: Step[]; outcome: Outcome; sha256: string }
const hashOf = (world: string, seed: string, steps: Step[], o: Outcome) => sha(JSON.stringify({ world, seed, steps, o }));

function observe(w: Desert, pos: { x: number; y: number }, water: number, step: number): Obs {
  const kind = (x: number, y: number): Cell | "wall" => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? "wall" : w.grid[y]![x]!);
  const around = (["N", "E", "S", "W"] as const).map((m) => kind(pos.x + D[m]![0], pos.y + D[m]![1]));
  const near = dist(pos, w.home) <= BEACON_RANGE;
  const bearing = near ? (["N", "E", "S", "W"] as const).filter((m) => dist({ x: pos.x + D[m]![0], y: pos.y + D[m]![1] }, w.home) < dist(pos, w.home)) : null;
  return { pos: { ...pos }, water, step, around: around as Obs["around"], bearing: bearing as Move[] | null, on: w.grid[pos.y]![pos.x]! };
}
/** Plays a policy in the desert of a seed. Every step is recorded; a move into a dune or off the grid costs the step and moves nothing; an oasis gives water once. */
export function play(decl: WorldDecl, policy: Policy): Transcript {
  const bad = declProblems(decl); if (bad.length) throw new Error(`the world is refused: ${bad.join("; ")}`);
  if (decl.kind !== "measured") throw new Error("this referee runs measured worlds; an expedition is audited by `auditExpedition`");
  const w = desertOf(decl.seed!);
  let pos = { ...w.start }, water = WATER, closest = dist(pos, w.home);
  const memory: Record<string, unknown> = {}, used = new Set<string>(), steps: Step[] = [];
  let reason: Outcome["reason"] = "step_limit";
  for (let n = 0; n < decl.max_steps; n++) {
    const obs = observe(w, pos, water, n);
    const move = policy(obs, memory);
    let ok = true;
    if (move === "drink") { if (obs.on === "oasis" && !used.has(`${pos.x},${pos.y}`)) { used.add(`${pos.x},${pos.y}`); water = WATER; } else ok = false; }
    else {
      const nx = pos.x + D[move]![0], ny = pos.y + D[move]![1];
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || w.grid[ny]![nx] === "dune") ok = false; else pos = { x: nx, y: ny };
    }
    water -= 1;
    steps.push({ n, obs, move, ok });
    closest = Math.min(closest, dist(pos, w.home));
    if (pos.x === w.home.x && pos.y === w.home.y) { reason = "home"; break; }
    if (water <= 0) { reason = "out_of_water"; break; }
  }
  const outcome: Outcome = { returned: reason === "home", water_left: Math.max(0, water), steps: steps.length, reason, closest };
  return { world: decl.id, seed: decl.seed!, steps, outcome, sha256: hashOf(decl.id, decl.seed!, steps, outcome) };
}

/** Replays a transcript's moves in the world of its seed and says whether the observations, the outcome and the hash are exactly what was recorded: a measured world is replayable, so a result can be checked by anyone. */
export function replay(decl: WorldDecl, t: Transcript): { ok: boolean; why: string } {
  if (decl.seed !== t.seed || decl.id !== t.world) return { ok: false, why: "the transcript is of another world or seed" };
  let i = 0;
  const again = play(decl, (obs) => { const s = t.steps[i++]; return s ? s.move : "drink"; });
  if (again.sha256 !== t.sha256) return { ok: false, why: "the replay does not give the recorded observations and outcome: the transcript was altered or is not of this world" };
  return { ok: true, why: "the replay gives the same observations, the same outcome and the same hash" };
}

// ---------------------------------------------------------------- scripted policies, for the measurements

/** Walks at random. */
export const randomWalk = (seed: string): Policy => { const r = rng(`walk|${seed}`); return () => (["N", "E", "S", "W"] as const)[Math.floor(r() * 4)]!; };
/** Follows the beacon's bearing when it hears it and sweeps the grid in rows (a boustrophedon) until it does. Drinks at an oasis when below half. */
export const sweepThenBeacon: Policy = (o, m) => {
  if (o.on === "oasis" && o.water < WATER / 2) return "drink";
  if (o.bearing && o.bearing.length) { const free = o.bearing.find((b) => o.around["NESW".indexOf(b[0]!)] !== "dune" && o.around["NESW".indexOf(b[0]!)] !== "wall"); return free ?? o.bearing[0]!; }
  const dir = (m.dir as Move | undefined) ?? "E";
  const idx = "NESW".indexOf(dir[0]!);
  if (o.around[idx] === "wall" || o.around[idx] === "dune") { m.dir = dir === "E" ? "W" : "E"; return o.around[0] !== "wall" && o.around[0] !== "dune" && (o.pos.y > 7) ? "N" : "S"; }
  return dir;
};
/** Goes straight for the middle of the map, ignoring the beacon, and drinks only when empty-handed. */
export const headForMiddle: Policy = (o) => (o.pos.x < 7 ? "E" : o.pos.x > 7 ? "W" : o.pos.y < 7 ? "S" : "N");

export interface Rate { policy: string; n: number; returned: number; rate_permille: number; ci_permille: [number, number]; mean_steps: number }
/** The return rate of a policy over `n` seeds, with a Wilson interval at 95 % (a count of successes, not a claim about a real agent). */
export function measure(name: string, make: (seed: string) => Policy, n: number, tag: string, maxSteps = 120): Rate {
  let ok = 0, steps = 0;
  for (let i = 0; i < n; i++) { const seed = `${tag}|${i}`; const t = play({ id: "desert-1", kind: "measured", seed, max_steps: maxSteps }, make(seed)); if (t.outcome.returned) ok++; steps += t.outcome.steps; }
  const p = ok / n, z = 1.96, den = 1 + (z * z) / n, centre = (p + (z * z) / (2 * n)) / den, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { policy: name, n, returned: ok, rate_permille: Math.round(p * 1000), ci_permille: [Math.round((centre - half) * 1000), Math.round((centre + half) * 1000)], mean_steps: Math.round(steps / n) };
}

// ---------------------------------------------------------------- the audited expedition

export interface Frame { n: number; sha256: string; action: string; gpu_seconds: number; /** The hash of the previous frame's record: a chain, so a frame cannot be dropped or reordered. */ prev: string }
export interface ExpeditionRun { decl: WorldDecl; group: string[]; goal: string; frames: Frame[]; claimed_outcome: { reached: boolean; evaluator: string; evaluator_error_permille: number } }
export interface Audit { status: "scored" | "void"; reasons: string[]; cost: number; frames: number; claimable: false }
export const frameHash = (f: Omit<Frame, "prev">, prev: string) => sha(JSON.stringify({ ...f, prev }));
/** Audits an expedition: the chain of frames must be unbroken, the cost within the cap, the declaration complete and the evaluator's own error rate stated. A failed audit is void, never scored. An expedition is never claimable. */
export function auditExpedition(run: ExpeditionRun): Audit {
  const reasons: string[] = declProblems(run.decl);
  if (run.decl.kind !== "expedition") reasons.push("this is not an expedition");
  let prev = "genesis", seconds = 0;
  for (const [i, f] of run.frames.entries()) {
    if (f.n !== i) reasons.push(`frame ${i} is out of order or missing`);
    if (f.prev !== prev) reasons.push(`frame ${i} does not follow the hash of the frame before it: the chain is broken`);
    prev = frameHash({ n: f.n, sha256: f.sha256, action: f.action, gpu_seconds: f.gpu_seconds }, f.prev);
    seconds += f.gpu_seconds;
  }
  if (run.frames.length > run.decl.max_steps) reasons.push(`${run.frames.length} frames exceed the limit of ${run.decl.max_steps}`);
  const cost = Math.round(seconds * (run.decl.gpu_credits_per_second ?? 0) * 100) / 100;
  if (run.decl.cost_cap !== undefined && cost > run.decl.cost_cap) reasons.push(`the cost ${cost} credits exceeds the cap of ${run.decl.cost_cap}: the expedition is stopped and voided`);
  if (!(run.claimed_outcome.evaluator_error_permille >= 0 && run.claimed_outcome.evaluator_error_permille <= 1000)) reasons.push("the evaluator's own error rate is stated, because the world has no state table to score from");
  if (!run.group.length) reasons.push("an expedition has a group");
  return { status: reasons.length ? "void" : "scored", reasons, cost, frames: run.frames.length, claimable: false };
}
