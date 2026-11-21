// The Mandate's `telemetry` field (register row DK195; spec-delta S342; instrumentation.md 7): absent means nothing is collected; a Mandate may list a signal only inside a live consent the sponsor signed and the
// agent countersigned; the collector never reads a signal the Mandate does not list. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { Collector, SIGNALS, mayCollect } from "../src/index.ts";
import { Kit, bankP, credit, hashOf, refused, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("tm-sponsor");
  const agent = await kit.agent("tm-agent", sponsor, 1);
  const principal = await kit.person("tm-principal");
  await kit.mint(principal.did, 500);
  const consent = (over: Record<string, unknown> = {}) => kit.mk("telemetry_act" as never, sponsor, { act: "consent", sponsor: sponsor.did, agent: agent.did, signals: ["belief_state", "calibration"], purposes: ["L7-belief-recalibration"], retention_days: 30, from: iso(Date.parse(kit.now()) - DAY), until: iso(Date.parse(kit.now()) + 30 * DAY), ...over }, null, { subject: agent.did, cosigners: [agent] });
  /** A Mandate with the given telemetry field (or none), on a fresh contract and Bond. */
  const mandate = async (telemetry?: Record<string, unknown>) => {
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: "a job", price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    const bond = kit.mk("bond", principal, { contract: c.id, backer: principal.did, amount: credit(2), escrow: { payer: principal.did, amount: credit(10) }, slashing_conditions: ["lost_dispute"] }, c.id, { subject: c.id });
    await kit.put(bond);
    return kit.mk("mandate", principal, { contract: c.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true, ...(telemetry ? { telemetry } : {}) }, bond.id, { subject: agent.did });
  };
  return { kit, sponsor, agent, consent, mandate };
}
const field = (over: Record<string, unknown> = {}) => ({ signals: ["belief_state"], purposes: ["L7-belief-recalibration"], retention_days: 30, raw: "local", ...over });

test("a Mandate with no telemetry field is accepted and says nothing is collected; listing a signal needs a live consent that names it and the purposes", async () => {
  const w = await world();
  const { kit } = w;
  await kit.put(await w.mandate()); // no field: nothing is collected, and nothing is asked of anyone
  assert.equal(await refused(kit.put(await w.mandate(field()))), "telemetry_signal_not_consented", "no consent yet");
  const consentId = await kit.put(w.consent());
  await kit.put(await w.mandate(field()));
  await kit.put(await w.mandate(field({ signals: ["belief_state", "calibration"] })));
  assert.equal(await refused(kit.put(await w.mandate(field({ signals: ["reasoning_trace"] })))), "telemetry_signal_not_consented", "a signal the consent does not name");
  assert.equal(await refused(kit.put(await w.mandate(field({ purposes: ["research-for-sale"] })))), "telemetry_purpose_not_consented");
  assert.ok(await refused(kit.put(await w.mandate(field({ retention_days: 120 })))), "raw content is kept at most 90 days");
  // A revoked consent no longer lets a new Mandate list the signal.
  await kit.put(w.consent({ revokes: consentId, signals: ["calibration"] }));
  assert.equal(await refused(kit.put(await w.mandate(field({ signals: ["belief_state"] })))), "telemetry_signal_not_consented", "belief_state was in the revoked consent only");
  await kit.put(await w.mandate(field({ signals: ["calibration"] })));
  // An expired consent is no consent.
  kit.addDays(40);
  assert.equal(await refused(kit.put(await w.mandate(field({ signals: ["calibration"] })))), "telemetry_signal_not_consented");
  assert.equal((await kit.log.verify()).ok, true);
});

test("the collector reads only the signals the Mandate lists, inside a consent: with the field absent nothing is read for any of the nine signals", () => {
  const at = () => "2026-11-10T00:00:00Z";
  const consent = { signals: [...SIGNALS], purposes: ["own_use"], from: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z", revoked: false, agentCountersigned: true };
  const reads: string[] = [];
  const none = new Collector(consent, at);
  for (const s of SIGNALS) none.collect(s, () => { reads.push(s); return {}; });
  assert.deepEqual(reads, [], "no Mandate telemetry field: not one source was called");
  assert.equal(none.status, "telemetry: off");
  const some = new Collector({ ...consent, mandateSignals: ["calibration", "plan_trace"] }, at);
  const reads2: string[] = [];
  for (const s of SIGNALS) some.collect(s, () => { reads2.push(s); return {}; });
  assert.deepEqual(reads2, ["plan_trace", "calibration"], "only what the Mandate lists, in the order the signals come");
  assert.equal(mayCollect({ ...consent, mandateSignals: ["calibration"] }, "belief_state", at()), false);
  assert.equal(mayCollect({ ...consent, mandateSignals: ["calibration"] }, "calibration", at()), true);
  void (null as unknown as Party);
});
