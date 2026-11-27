/**
 * Breach response, end to end (register row DK1714; spec-delta S1426): one flow from a detection to a contained, recorded and alerted breach. Given a detection (a signed finding, a run halt, an upheld report: any record id) for an agent, it
 *  1. quarantines the agent at once (the Clinic's emergency quarantine, at level halt, which the log lists for the operator's review and which ends by itself within 72 hours);
 *  2. when the breach is in a fleet node, halts every running contract of the node's members (a signed `run_halt` with reason `breach`), so nothing in the node keeps buying;
 *  3. alerts the sponsor and the operator (the caller's channel: the service's mail);
 *  4. signs an `incident` record naming the cause, the detection, the node and every step with the record it made, and opens the restitution path (the operator's remedy: a takedown, a suspension or a written response, never credits);
 * and returns the seconds from detection to the incident record, so the response time is a measured number. The log decides nothing here beyond its own rules: every record is signed by its own issuer through `sign`, and the log refuses what is not
 * allowed. Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import type { EventLog } from "./log.ts";
import { CLINIC_DID } from "./economy.ts";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type Cause = "exceeded_mandate" | "exfiltration" | "loop" | "stolen_credential" | "injection" | "manual";
export interface BreachEvent { agent: string; cause: Cause; summary: string; detectedAt: string; detection?: string; fleet?: string; node?: string; remedy?: "takedown" | "suspension" | "written_response" }
export interface Hooks {
  /** Signs a record of this type for this issuer (the Clinic, the operator): the caller holds the keys. */
  sign(issuer: string, type: string, subject: string | null, body: Record<string, unknown>, at: string): AspRecord;
  /** Tells the sponsor or the operator; true when the message went. */
  alert(to: "sponsor" | "operator", text: string): Promise<boolean>;
  now(): string;
  operator: string;
}

/** What the flow needs of a log: it writes, and reads the node's running contracts and whether a contract is halted. An EventLog is one; so is a service client (an adapter over its append and reads). */
export interface BreachLog { append(r: AspRecord): Promise<unknown>; nodeRunningContracts: EventLog["nodeRunningContracts"]; runHaltOf: EventLog["runHaltOf"] }

export async function respondToBreach(log: BreachLog, e: BreachEvent, h: Hooks): Promise<{ incident: string; seconds: number; steps: string[] }> {
  const steps: { step: string; ref?: string; at: string }[] = [];
  const plus72 = (at: string) => new Date(Date.parse(at) + 72 * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
  // 1. quarantine the agent now: an emergency freeze takes effect at once
  const t1 = h.now();
  const q = h.sign(CLINIC_DID, "quarantine", null, { members: [e.agent], level: "halt", reason: `breach (${e.cause}): ${e.summary}`.slice(0, 300), until: plus72(t1), emergency: { reason: `a breach was detected at ${e.detectedAt}: ${e.cause}` }, ...(e.detection ? { report: e.detection } : {}) }, t1);
  await log.append(q);
  steps.push({ step: "quarantine", ref: q.id, at: t1 });
  // 2. the node: halt every running contract of its members
  if (e.fleet && e.node) {
    for (const c of await log.nodeRunningContracts(e.fleet, e.node)) {
      if (await log.runHaltOf(c.contract)) continue;
      const t = h.now();
      const halt = h.sign(h.operator, "run_halt", c.contract, { contract: c.contract, agent: c.agent, reason: "breach", detail: `the node ${e.node} was frozen by an incident (${e.cause})`, node: e.node }, t);
      await log.append(halt);
      steps.push({ step: "node_halt", ref: halt.id, at: t });
    }
  }
  // 3. alerts
  const text = `A breach was detected for ${e.agent} (${e.cause}): ${e.summary}. The agent is quarantined${e.node ? ` and node ${e.node} is halted` : ""}. Nothing was slashed; the incident record is public.`;
  if (await h.alert("sponsor", text)) steps.push({ step: "alert_sponsor", at: h.now() });
  if (await h.alert("operator", text)) steps.push({ step: "alert_operator", at: h.now() });
  // 4. restitution opens, and the incident is recorded
  steps.push({ step: "restitution_opened", at: h.now() });
  const at = h.now();
  const inc = h.sign(h.operator, "incident", e.agent, { agent: e.agent, cause: e.cause, summary: e.summary.slice(0, 500), detected_at: e.detectedAt, ...(e.detection ? { detection: e.detection } : {}), ...(e.fleet ? { fleet: e.fleet } : {}), ...(e.node ? { node: e.node } : {}), steps, restitution: { open: true, remedy: e.remedy ?? "suspension" } }, at);
  await log.append(inc);
  return { incident: inc.id, seconds: (Date.parse(at) - Date.parse(e.detectedAt)) / 1000, steps: steps.map((s) => s.step) };
}

/**
 * A breach the running service was told of (register row DK1714, the service part): the service holds neither the Clinic's key nor the operator's, so it cannot run `respondToBreach` alone, as it cannot sign a Clinic quarantine
 * for the sponsor-less review (`PendingQuarantines`, the same pattern). It writes the report down with its time and the owner's `asp breach respond --from-service` signs the quarantine and the incident on the owner's machine,
 * measuring the response from THIS time. A file, like the other pending lists; one open report for each agent.
 */
export interface PendingBreach { id: string; agent: string; cause: Cause; summary: string; at: string; detection?: string; fleet?: string; node?: string; by: string }
export class PendingBreaches {
  private path: string | undefined;
  private mem: PendingBreach[] = [];
  constructor(path?: string) { this.path = path; }
  list(): PendingBreach[] {
    if (!this.path) return this.mem;
    try { return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as PendingBreach[]) : []; } catch { return []; }
  }
  private write(list: PendingBreach[]): void {
    if (!this.path) { this.mem = list; return; }
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
  /** False when this agent already has an open report. */
  add(e: PendingBreach): boolean {
    const list = this.list();
    if (list.some((x) => x.agent === e.agent)) return false;
    this.write([...list, e]);
    return true;
  }
  ack(ids: string[]): number {
    const list = this.list();
    const keep = list.filter((x) => !ids.includes(x.id));
    if (keep.length !== list.length) this.write(keep);
    return list.length - keep.length;
  }
}
export const BREACH_CAUSES = ["exceeded_mandate", "exfiltration", "loop", "stolen_credential", "injection", "manual"] as const;
