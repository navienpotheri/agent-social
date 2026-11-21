/**
 * How a learned change is reviewed, attributed, checked on every runtime and pruned (register rows DK803 to DK806; spec-deltas S1221 to S1224; the 19th Nov owner screenshots, the harness diagram). A CHANGE is one
 * or more edits to an agent's memory, lessons or harness with a stated cause. DK804: one root cause for each change, one fix and one new scenario; its lift or regression is measured for that change alone and goes
 * in the lineage edge; a revert restores the previous state exactly. DK803: a change is critiqued by at least one other agent that is independent of its author and its sponsor; an open finding refuses it, a fixed
 * finding needs a test, the scenarios are rerun, the sponsor's gate stays for merge and deploy, and the trail is signed and chained. DK805: a change passes only if its scenarios pass on every runtime the agent runs
 * on, and only on those. DK806: a change with no measured gain after N runs is pruned, and an agent-specific tweak is not promoted to shared knowledge. Everything here is pure; the agents, runtimes and scenarios in
 * the tests are scripted stand-ins.
 */
import { createHash } from "node:crypto";
import { b64urlDecode, b64urlEncode, signBytes, verifyBytes } from "@agent-social/asp-core";

export type Memory = Record<string, string>;
export interface Edit { id: string; cause: string; key: string; before: string | undefined; after: string | undefined; /** The edit that fixes the cause (one for each change); the others, if any, are the same cause's supporting edits. */ role: "fix" | "support" }
export interface Change { id: string; author: string; authorSponsor: string; scope: "agent" | "general"; edits: Edit[]; scenario: string }
export type Code = "MULTIPLE_CAUSES" | "NEEDS_ONE_FIX" | "NEEDS_SCENARIO" | "NEEDS_REVIEW" | "REVIEWER_NOT_INDEPENDENT" | "OPEN_FINDING" | "FIX_NEEDS_TEST" | "SCENARIOS_FAIL" | "SPONSOR_GATE" | "RUNTIME_NOT_CHECKED" | "RUNTIME_FAILS" | "AGENT_SPECIFIC" | "NO_GAIN";
export type Refusal = { ok: false; code: Code; message: string };
const no = (code: Code, message: string): Refusal => ({ ok: false, code, message });
const sha = (x: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(x)).digest("hex");

// ---- DK804: sparse, attributable edits ----
/** One root cause for each change, exactly one fix, and a new scenario that shows it. */
export function validateChange(c: Change): Refusal | null {
  if (new Set(c.edits.map((e) => e.cause)).size > 1) return no("MULTIPLE_CAUSES", `the change mixes ${[...new Set(c.edits.map((e) => e.cause))].join(", ")}: one root cause for each change, so a gain or a regression can be attributed`);
  if (c.edits.filter((e) => e.role === "fix").length !== 1) return no("NEEDS_ONE_FIX", "a change has exactly one fix");
  if (!c.scenario) return no("NEEDS_SCENARIO", "a change brings the new scenario that shows its cause");
  return null;
}
/** A multi-cause change split into one change for each cause (each still needs its own scenario). */
export function split(c: Change, scenarios: Record<string, string>): Change[] {
  const causes = [...new Set(c.edits.map((e) => e.cause))].sort();
  return causes.map((cause) => ({ ...c, id: sha({ c: c.id, cause }), scenario: scenarios[cause] ?? "", edits: c.edits.filter((e) => e.cause === cause).map((e, i) => ({ ...e, role: i === 0 ? "fix" : "support" })) }));
}
export const applyChange = (m: Memory, c: Change): Memory => { const out = { ...m }; for (const e of c.edits) { if (e.after === undefined) delete out[e.key]; else out[e.key] = e.after; } return out; };
/** The revert: the inverse edits, in reverse, restore the previous state exactly. */
export const revertChange = (m: Memory, c: Change): Memory => { const out = { ...m }; for (const e of [...c.edits].reverse()) { if (e.before === undefined) delete out[e.key]; else out[e.key] = e.before; } return out; };
export interface LineageEdge { change: string; cause: string; scenario: string; before_permille: number; after_permille: number; lift_permille: number; regressed: boolean; runtimes?: Record<string, { passed: number; total: number }> }
/** The lift of one change alone: the scenario suite's score with and without it, for that change only. */
export function attribute(c: Change, score: (m: Memory) => number, before: Memory): LineageEdge {
  const b = Math.round(score(before)), a = Math.round(score(applyChange(before, c)));
  return { change: c.id, cause: c.edits[0].cause, scenario: c.scenario, before_permille: b, after_permille: a, lift_permille: a - b, regressed: a < b };
}

// ---- DK803: reviewer agents ----
export interface Finding { id: string; status: "open" | "fixed"; test?: string }
export interface Review { reviewer: string; reviewerSponsor: string; findings: Finding[] }
export interface SponsorApproval { sponsor: string; action: "merge" | "deploy" }
export interface Entry { seq: number; step: string; detail: string; prev: string; sig: string }
const GENESIS = "sha256:" + "0".repeat(64);
const hashOf = (e: Entry) => sha(e);
export class Trail {
  readonly entries: Entry[] = [];
  private readonly seed: Uint8Array;
  constructor(seed: Uint8Array) { this.seed = seed; }
  add(step: string, detail: string): void {
    const prev = this.entries.length ? hashOf(this.entries.at(-1)!) : GENESIS;
    const body = { seq: this.entries.length, step, detail, prev };
    this.entries.push({ ...body, sig: b64urlEncode(signBytes(new TextEncoder().encode(JSON.stringify(body)), this.seed)) });
  }
  static verify(entries: Entry[], publicKey: Uint8Array): boolean {
    let prev = GENESIS;
    for (const [i, e] of entries.entries()) { const { sig, ...body } = e; if (e.seq !== i || e.prev !== prev || !verifyBytes(b64urlDecode(sig), new TextEncoder().encode(JSON.stringify(body)), publicKey)) return false; prev = hashOf(e); }
    return true;
  }
}
export interface Gate { reviews: Review[]; rerun: (c: Change) => boolean; approval?: SponsorApproval; action: "merge" | "deploy" | "none" }
/** A change goes through only if it is whole, reviewed by someone independent, has no open finding, every fix has its test, its scenarios pass again, and (for merge or deploy) its sponsor has signed. Each step is on the trail. */
export function admit(c: Change, g: Gate, trail: Trail): { ok: true } | Refusal {
  const stop = (r: Refusal) => { trail.add("refused", r.code); return r; };
  const whole = validateChange(c);
  if (whole) return stop(whole);
  if (!g.reviews.length) return stop(no("NEEDS_REVIEW", "a change is critiqued by at least one other agent"));
  for (const r of g.reviews) if (r.reviewer === c.author || r.reviewerSponsor === c.authorSponsor) return stop(no("REVIEWER_NOT_INDEPENDENT", `${r.reviewer} is the author or has the author's sponsor: the reviewer is independent of both`));
  trail.add("reviewed", g.reviews.map((r) => r.reviewer).sort().join(","));
  for (const f of g.reviews.flatMap((r) => r.findings)) {
    if (f.status === "open") return stop(no("OPEN_FINDING", `the finding ${f.id} is open`));
    if (!f.test) return stop(no("FIX_NEEDS_TEST", `the finding ${f.id} is fixed without a test`));
  }
  trail.add("findings_closed", String(g.reviews.flatMap((r) => r.findings).length));
  if (!g.rerun(c)) return stop(no("SCENARIOS_FAIL", "the scenarios were rerun with the change and did not all pass"));
  trail.add("scenarios_rerun", "pass");
  if (g.action !== "none" && !(g.approval && g.approval.sponsor === c.authorSponsor && g.approval.action === g.action)) return stop(no("SPONSOR_GATE", `a ${g.action} needs the sponsor's signed approval: the human gate stays`));
  trail.add("admitted", g.action);
  return { ok: true };
}

// ---- DK805: multi-runtime regression ----
export type RunScenario = (scenario: string, change: Change) => boolean;
/** The change passes only if its scenarios pass on every runtime the agent runs on; the result for each is kept for the lineage edge. A runtime the agent does not run on is not asked. */
export function checkRuntimes(c: Change, agentRuntimes: string[], runtimes: Record<string, RunScenario>, scenarios: string[]): { ok: true; results: Record<string, { passed: number; total: number }> } | (Refusal & { results: Record<string, { passed: number; total: number }> }) {
  const results: Record<string, { passed: number; total: number }> = {};
  let fail: Refusal | null = null;
  for (const rt of [...agentRuntimes].sort()) {
    const run = runtimes[rt];
    if (!run) { fail ??= no("RUNTIME_NOT_CHECKED", `the agent runs on ${rt} and the change was not checked there`); continue; }
    const passed = scenarios.filter((s) => run(s, c)).length;
    results[rt] = { passed, total: scenarios.length };
    if (passed < scenarios.length) fail ??= no("RUNTIME_FAILS", `${scenarios.length - passed} of ${scenarios.length} scenarios fail on ${rt}`);
  }
  return fail ? { ...fail, results } : { ok: true, results };
}

// ---- DK806: keep what generalizes ----
export interface Tracked { change: Change; lifts: number[] }
/** A change with at least `runs` measured runs and no gain (a mean lift of zero or less) is pruned; the rest are kept. */
export function prune(tracked: Tracked[], runs: number): { kept: Tracked[]; pruned: Tracked[] } {
  const mean = (t: Tracked) => t.lifts.reduce((a, b) => a + b, 0) / t.lifts.length;
  const pruned = tracked.filter((t) => t.lifts.length >= runs && mean(t) <= 0);
  return { kept: tracked.filter((t) => !pruned.includes(t)), pruned };
}
/** Whether a change may be promoted to shared knowledge (the commons): only a general change with a measured gain; an agent-specific tweak stays in the agent's own configuration. */
export function promote(t: Tracked): { ok: true; to: "commons" } | Refusal {
  if (t.change.scope === "agent") return no("AGENT_SPECIFIC", "an agent-specific tweak goes to the agent's configuration, not to shared knowledge");
  if (!t.lifts.length || t.lifts.reduce((a, b) => a + b, 0) / t.lifts.length <= 0) return no("NO_GAIN", "only a change with a measured gain is promoted");
  return { ok: true, to: "commons" };
}
