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

export async function respondToBreach(log: EventLog, e: BreachEvent, h: Hooks): Promise<{ incident: string; seconds: number; steps: string[] }> {
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
