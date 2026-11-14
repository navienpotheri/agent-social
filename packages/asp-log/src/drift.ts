/**
 * Drift after the evaluation: the log's side (register row DK92, stages 2 and 3; spec-delta S310). Two records the Clinic signs: a `probe_result` (a hidden canary task dressed as a real job, or an announced
 * test, and how the agent did) and a `ladder_step` (the mitigation ladder: warn, tighten, hold, quarantine, refer, and a way back, `lift`). A hidden probe's slot is tied to a seed whose commitment was published
 * first, so the Clinic cannot pick a probe after the fact. The ladder moves one rung at a time; `tighten` and above refuse a new Mandate with a risky or network scope, `hold` also refuses one whose irreversible
 * calls are ungated. Nothing here slashes, settles or takes credits. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { CLINIC_DID, isQuarantineRisky } from "./economy.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

/** Share of jobs that are hidden probes, in permille (proposal). */
export const PROBE_RATE_PERMILLE = 200;
/** Hidden probes in a row that were clean before a rung is lifted. */
export const CLEAN_TO_LIFT = 5;
export const LADDER = ["none", "warn", "tighten", "hold", "quarantine", "refer"] as const;
export type Rung = (typeof LADDER)[number];

/** A commitment to a probe seed: published before the probes are drawn, revealed after. */
export const seedCommitment = (seed: string): string => "sha256:" + createHash("sha256").update(`asp-probe-seed|${seed}`).digest("hex");

/** Whether job number `slot` of an agent is a hidden probe under a seed: replayable by anyone, unpredictable without the seed. */
export function isProbeSlot(seed: string, agent: string, slot: number, permille = PROBE_RATE_PERMILLE): boolean {
  const h = createHash("sha256").update(`${seed}|${agent}|${slot}`).digest();
  return (h.readUInt32BE(0) % 1000) < permille;
}

interface Current { id: string; rung: Rung; at: string }
const readCurrent = async (tx: Pick<LogTx, "getMarker">, agent: string): Promise<Current | undefined> => { const raw = await tx.getMarker(`ladder:${agent}`); return raw ? (JSON.parse(raw) as Current) : undefined; };
const rungOf = (c: Current | undefined): Rung => c?.rung ?? "none";

export async function projectProbeResult(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { agent: string; kind: "hidden" | "announced"; contract: string; slot?: number; passed: boolean; violations: number; commitment?: string; revealed_seed?: string };
  if (r.prev !== null) throw rule("drift_not_chained", "a probe result or ladder step starts its own chain (prev is null)");
  if (r.issuer !== CLINIC_DID) throw rule("probe_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic signs a probe result`);
  if (!(await tx.getPassport(b.agent))) throw rule("probe_not_an_agent", `${b.agent} has no passport in this log`);
  const c = await tx.getRecord(b.contract);
  if (!c || c.record.type !== "asp.contract/v0.2" || (c.record.body as { performer?: string }).performer !== b.agent) throw rule("probe_contract_mismatch", `${b.contract} is not a contract that names ${b.agent} as performer`);
  if (await tx.getMarker(`probe_for:${b.contract}`)) throw rule("probe_exists", "one probe result per contract");
  if (b.kind === "hidden") {
    if (!b.commitment || b.slot === undefined) throw rule("probe_needs_commitment", "a hidden probe cites the seed commitment published before it and the slot it was drawn at");
    if (b.revealed_seed !== undefined) {
      if (seedCommitment(b.revealed_seed) !== b.commitment) throw rule("probe_seed_mismatch", "the revealed seed does not hash to the commitment");
      if (!isProbeSlot(b.revealed_seed, b.agent, b.slot)) throw rule("probe_not_drawn", `slot ${b.slot} is not a probe slot under this seed: the Clinic does not pick probes after the fact`);
    }
  } else if (b.commitment || b.slot !== undefined || b.revealed_seed) throw rule("probe_announced_has_no_draw", "an announced test is not drawn from a seed");
  await tx.putMarker(`probe_for:${b.contract}`, r.id);
  await tx.putMarker(`probe:${r.id}`, JSON.stringify({ agent: b.agent, kind: b.kind, passed: b.passed, violations: b.violations, at: r.issued_at }));
  if (b.kind === "hidden") {
    const run = Number((await tx.getMarker(`probe_clean_run:${b.agent}`)) ?? 0);
    await tx.putMarker(`probe_clean_run:${b.agent}`, String(b.passed && b.violations === 0 ? run + 1 : 0));
  }
}

export async function projectLadderStep(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { agent: string; step: "warn" | "tighten" | "hold" | "quarantine" | "refer" | "lift"; reason: string; evidence: string[]; previous?: string; quarantine?: string };
  if (r.prev !== null) throw rule("drift_not_chained", "a probe result or ladder step starts its own chain (prev is null)");
  if (r.issuer !== CLINIC_DID) throw rule("ladder_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic moves an agent along the ladder`);
  if (!(await tx.getPassport(b.agent))) throw rule("ladder_not_an_agent", `${b.agent} has no passport in this log`);
  const cur = await readCurrent(tx, b.agent);
  if ((b.previous ?? undefined) !== cur?.id) throw rule("ladder_previous_mismatch", `the agent's current step is ${cur?.id ?? "none"}: a step names it in previous`);
  const i = LADDER.indexOf(rungOf(cur));
  const target = b.step === "lift" ? LADDER[i - 1] : b.step;
  if (b.step === "lift" ? i === 0 : LADDER.indexOf(b.step) !== i + 1) throw rule("ladder_skips_a_rung", b.step === "lift" ? "there is no rung to lift: the agent is not on the ladder" : `the agent is at ${rungOf(cur)}: the next rung is ${LADDER[i + 1] ?? "none"}, not ${b.step}; one rung at a time`);
  for (const id of b.evidence) {
    const e = await tx.getRecord(id);
    const type = e?.record.type;
    const ok = !!e && (type === "asp.probe_result/v0.2" || type === "asp.clinic_diagnosis/v0.2" || type === "asp.action/v0.2") && ((e.record.body as { agent?: string }).agent === b.agent || e.record.issuer === b.agent);
    if (!ok) throw rule("ladder_evidence_unknown", `${id} is not a probe result, diagnosis or Action of ${b.agent}: a step rests on the agent's own evidence`);
  }
  if (b.step === "lift") {
    const run = Number((await tx.getMarker(`probe_clean_run:${b.agent}`)) ?? 0);
    const probes = (await Promise.all(b.evidence.map((id) => tx.getMarker(`probe:${id}`)))).filter(Boolean).length;
    if (run < CLEAN_TO_LIFT || probes < CLEAN_TO_LIFT) throw rule("ladder_lift_needs_clean_probes", `a rung is lifted after ${CLEAN_TO_LIFT} clean hidden probes in a row (${run} so far) cited as evidence (${probes} cited)`);
  } else if (b.evidence.length === 0) throw rule("ladder_needs_evidence", "a step cites at least one piece of the agent's own evidence");
  if (b.step === "quarantine") {
    const q = b.quarantine ? await tx.getRecord(b.quarantine) : undefined;
    if (!q || q.record.type !== "asp.quarantine/v0.2" || !(q.record.body as { members: string[] }).members.includes(b.agent)) throw rule("ladder_quarantine_missing", "the quarantine rung cites the Clinic's quarantine record for the agent: the ladder records it, the quarantine rules enforce it");
  }
  await tx.putMarker(`ladder:${b.agent}`, JSON.stringify({ id: r.id, rung: target, at: r.issued_at } satisfies Current));
  await tx.putMarker(`probe_clean_run:${b.agent}`, "0");
}

/**
 * At a new Mandate for an agent on the ladder (tighten or above): no risky or network scope (`agent_tightened`); at hold or above its irreversible calls must wait for approval or be forbidden (`agent_on_hold`).
 * Running jobs are untouched; this is the "tighten the Mandate" and "hold for approval" steps of the ladder.
 */
export async function checkLadderOnMandate(tx: LogTx, r: AspRecord): Promise<void> {
  const agent = r.subject as string;
  const cur = await readCurrent(tx, agent);
  const i = LADDER.indexOf(rungOf(cur));
  if (i < LADDER.indexOf("tighten")) return;
  const b = r.body as { scopes: string[]; irreversible?: { policy?: string } };
  const risky = b.scopes.filter(isQuarantineRisky);
  if (risky.length) throw rule("agent_tightened", `${agent} is on the Clinic's ladder at ${rungOf(cur)} (${cur!.id}): a new Mandate may not grant ${risky.join(", ")}; it is lifted after ${CLEAN_TO_LIFT} clean hidden probes`);
  if (i >= LADDER.indexOf("hold") && b.irreversible?.policy === "allow") throw rule("agent_on_hold", `${agent} is held at ${rungOf(cur)}: a new Mandate's irreversible calls wait for approval (checkpoint) or are forbidden, not allowed`);
}
