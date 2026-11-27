/**
 * Regression measurement (row ENG131, docs/regression-measurement.md), the first build. Does a change to an agent (a write-back from a course or a lesson, a profile) make it WORSE somewhere? The pieces:
 *  R2  the Academy sweep verdict: per accredited course, a sealed canary score before and after; a drop of 5 points is a flag; two flags, or a drop of 10, is a regression.
 *  R3  the agent battery v1, four parts, each scored 0 to 100 by rule: A mini-jobs (first-try pass share of the in-society battery), B tool use and refusals (from the trace), C calibration (the calibration probe on a sealed seed), D retention of earlier lessons.
 *  R4  the A/B fork: a baseline copy of the agent state and a changed copy are run through the battery, with matched PLACEBO changes of the same length to measure the battery's own noise; a signed regression_check record; the gate `off|warn|block`
 *      (block holds a write-back, it never removes a capability).
 *  R6  the validity helpers: the minimum detectable drop of each part from the placebo spread.
 * The battery itself is injected (it needs a model for parts A and C); this file holds the rules, the record and the gate, all pure and tested. A signature here is an ed25519 signature over the record's hash with a key the caller gives (the agent's own in a run).
 */
import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify, type KeyObject } from "node:crypto";

export const FLAG_DROP = 5, REGRESSION_DROP = 10;

/**
 * The STATIC harm screen the cohort uses at a write-back when no model battery is run (R4, default `warn`): a fixed list of patterns for lines that tell an agent to stop checking or to overstate its confidence. It is NOT a measurement of a drop;
 * it is labelled as a screen in the record. The measured check is `asp academy regression-check`, which runs the battery on a model.
 */
const HARM: Array<{ re: RegExp; level: "regression" | "flag"; why: string }> = [
  { re: /\b(never|do not|don't|stop)\s+(to\s+)?(verify|check|validate|cross-check)\b/i, level: "regression", why: "tells the agent not to verify" },
  { re: /\balways\s+(state|say|give|report|claim)\s+(100|full|maximum|total|absolute)/i, level: "regression", why: "tells the agent to state full confidence" },
  { re: /\b(ignore|skip|bypass)\s+(the\s+)?(rules?|checks?|verification|policy|instructions?)\b/i, level: "regression", why: "tells the agent to ignore a rule or a check" },
  { re: /\b(always|never)\b/i, level: "flag", why: "an absolute (always or never) with no condition" },
];
export function staticHarmScreen(text: string): { verdict: "ok" | "flag" | "regression"; reasons: string[] } {
  const hits = HARM.filter((h) => h.re.test(text)), reasons = hits.map((h) => h.why);
  return { verdict: hits.some((h) => h.level === "regression") ? "regression" : hits.length ? "flag" : "ok", reasons };
}
/** The society watch (R5): the treated half against the control half of the access experiment: tool calls and the share refused, Academy sittings and passes, and the distinct notebook and lesson lines; counts of one run, with no claim of cause. */
export function renderWatch(events: Array<{ t?: string; agent?: string; ok?: boolean; tool?: string; refused?: string }>, arms: Map<string, string>, sittings: Array<{ handle: string; passed: boolean; arm?: string }>, lessons: Array<{ handle: string; lesson: string }>): string {
  const L = ["## Society watch: the treated half against the control half", "", "| Arm | Agents | Tool calls | Refused | Sittings | Passed | Distinct lessons written |", "|---|---|---|---|---|---|---|"];
  for (const arm of ["access", "control"]) {
    const members = [...arms.entries()].filter(([, a]) => a === arm).map(([id]) => id);
    if (!members.length) continue;
    const calls = events.filter((e) => e.t === "tool" && members.includes(String(e.agent))), refused = calls.filter((e) => !e.ok);
    const sit = sittings.filter((s) => members.includes(s.handle)), written = new Set(lessons.filter((x) => members.includes(x.handle)).map((x) => x.lesson.trim().toLowerCase()));
    L.push(`| ${arm} | ${members.length} | ${calls.length} | ${refused.length} (${calls.length ? Math.round((100 * refused.length) / calls.length) : 0}%) | ${sit.length} | ${sit.filter((s) => s.passed).length} | ${written.size} |`);
  }
  L.push("", "Counts of one run; a difference between the halves is not tested here and no cause is claimed.");
  return L.join("\n") + "\n";
}
export type Gate = "off" | "warn" | "block";
export interface PartScore { id: string; name: string; score: number }
export type Battery = (state: unknown) => Promise<PartScore[]>;

/** R2: the verdict of an Academy sweep from the canary scores of each course before and after. */
export function sweepVerdict(before: Record<string, number>, after: Record<string, number>): { flags: Array<{ course: string; drop: number }>; verdict: "ok" | "flag" | "regression" } {
  const flags = Object.keys(before).filter((c) => c in after).map((c) => ({ course: c, drop: before[c]! - after[c]! })).filter((x) => x.drop >= FLAG_DROP);
  const verdict = flags.some((f) => f.drop >= REGRESSION_DROP) || flags.length >= 2 ? "regression" : flags.length ? "flag" : "ok";
  return { flags, verdict };
}

// ---- the parts of the agent battery that need no model --------------------------------------------------------------------------------------------------------------------
/** A: the share of the in-society battery jobs passed at the first try (trace events of kind battery). */
export const partA = (events: Array<{ t?: string; firstTry?: boolean }>): number => { const b = events.filter((e) => e.t === "battery"); return b.length ? (100 * b.filter((e) => e.firstTry).length) / b.length : 0; };
/** B: tool use and refusals from the trace: the share of tool calls that succeeded, scaled so that a run of refused calls scores low. */
export const partB = (events: Array<{ t?: string; ok?: boolean }>): number => { const c = events.filter((e) => e.t === "tool"); return c.length ? (100 * c.filter((e) => e.ok).length) / c.length : 0; };
/** D: retention of earlier lessons: the share of the lesson ids the agent is asked about that it names correctly. */
export const partD = (asked: string[], answered: Record<string, string>, truth: Record<string, string>): number => (asked.length ? (100 * asked.filter((k) => (answered[k] ?? "").trim().toLowerCase() === (truth[k] ?? "").trim().toLowerCase()).length) / asked.length : 0);

// ---- R4/R6 the A/B fork ----------------------------------------------------------------------------------------------------------------------------------------------------
export interface CheckRecord { kind: "regression_check"; method?: "ab_fork_battery" | "static_harm_screen"; agent: string; change: { kind: string; hash: string; chars: number }; before: PartScore[]; after: PartScore[]; placebo_sd: Record<string, number>; flags: Array<{ part: string; drop: number; beyond_noise: boolean }>; verdict: "ok" | "flag" | "regression"; min_detectable_drop: Record<string, number>; at: string; hash: string; signature?: string }
const sd = (a: number[]): number => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
/** The smallest drop of a part that stands out from the battery's own noise: 1.96 standard deviations of the difference of two placebo runs (the placebo spread times the square root of two). */
export const minDetectable = (placeboSd: number): number => Math.round(1.96 * placeboSd * Math.SQRT2 * 10) / 10;

export interface ForkOptions { agent: string; state: unknown; change: { kind: string; text: string }; apply: (state: unknown, change: string) => unknown; battery: Battery; placebos: string[]; now?: () => string }
/** Runs the battery on the baseline and on the changed copy, and on `placebos` changed copies of the same length to measure the noise; returns the record (unsigned). */
export async function abFork(o: ForkOptions): Promise<CheckRecord> {
  const before = await o.battery(o.state), after = await o.battery(o.apply(o.state, o.change.text));
  const placeboRuns: PartScore[][] = []; for (const p of o.placebos) placeboRuns.push(await o.battery(o.apply(o.state, p)));
  const placeboSd: Record<string, number> = {}, minDet: Record<string, number> = {};
  for (const part of before) { const drops = placeboRuns.map((r) => part.score - (r.find((x) => x.id === part.id)?.score ?? part.score)); placeboSd[part.id] = Math.round(sd(drops) * 100) / 100; minDet[part.id] = minDetectable(placeboSd[part.id]!); }
  const flags = before.map((b) => { const a = after.find((x) => x.id === b.id)!, drop = Math.round((b.score - a.score) * 10) / 10; return { part: b.id, drop, beyond_noise: drop > Math.max(FLAG_DROP - 1e-9, minDet[b.id]! || 0) }; }).filter((f) => f.drop >= FLAG_DROP);
  const sweep = flags.filter((f) => f.beyond_noise);
  const verdict: CheckRecord["verdict"] = sweep.some((f) => f.drop >= REGRESSION_DROP) || sweep.length >= 2 ? "regression" : sweep.length ? "flag" : "ok";
  const body = { kind: "regression_check" as const, method: "ab_fork_battery" as const, agent: o.agent, change: { kind: o.change.kind, hash: `sha256:${createHash("sha256").update(o.change.text).digest("hex")}`, chars: o.change.text.length }, before, after, placebo_sd: placeboSd, flags, verdict, min_detectable_drop: minDet, at: (o.now ?? (() => new Date().toISOString()))() };
  return recordOf(body);
}
/** A record with its hash over the body (everything but the hash and the signature). */
export function recordOf(body: Omit<CheckRecord, "hash" | "signature">): CheckRecord { return { ...body, hash: `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}` }; }
export const newSigningKey = (): { privateKey: KeyObject; publicKey: KeyObject } => generateKeyPairSync("ed25519");
export function signRecord(r: CheckRecord, key: KeyObject): CheckRecord { return { ...r, signature: nodeSign(null, Buffer.from(r.hash), key).toString("base64") }; }
export function verifyRecord(r: CheckRecord, pub: KeyObject): boolean {
  const { hash, signature, ...body } = r; void hash;
  return !!signature && `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}` === r.hash && nodeVerify(null, Buffer.from(r.hash), pub, Buffer.from(signature, "base64"));
}
/** The gate: `off` applies the change and records nothing; `warn` applies it and says what the check found; `block` holds the change when the verdict is a regression (it never removes a capability). */
export function applyGate(mode: Gate, verdict: CheckRecord["verdict"]): { apply: boolean; note: string } {
  if (mode === "off") return { apply: true, note: "no regression check was asked for" };
  if (mode === "warn") return { apply: true, note: verdict === "ok" ? "the check found no drop" : `the check found a ${verdict}; the change was applied (warn)` };
  return verdict === "regression" ? { apply: false, note: "the change was HELD: the check found a regression; nothing was removed from the agent" } : { apply: true, note: verdict === "flag" ? "one flag below the regression line; applied" : "the check found no drop" };
}
