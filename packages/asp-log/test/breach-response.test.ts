/**
 * Breach response end to end (register row DK1714; spec-delta S1426): a seeded breach (an agent that tries to exfiltrate and exceed its Mandate, in a fleet node) goes through detection, the agent's quarantine, the halt of the node's running
 * contracts, the alerts to the sponsor and the operator, the signed incident record and the opened restitution path, against a real log, in a measured time; and the city-wide stop (GV6) halts a seeded run's spending and resumes it with the owner's
 * co-signature. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { clinic, credit, jump, kit, keysOf, mk, nowIso, operator, owner, party, refusedBy, tick, DAY, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";
import { respondToBreach } from "../src/breach-response.ts";

const FLEET = "did:web:example.com:orgs:br-co:fleets:all";
const STATED_SECONDS = 5;

async function world() {
  const k = await kit();
  await k.withPrices();
  const org = party("did:web:example.com:orgs:br-co");
  await k.log.append(mk("passport", org, { did: org.did, kind: "org", keys: keysOf(org) }, null, { subject: org.did, cosigners: [operator] }));
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "All", purpose: "everything" }, null, { subject: FLEET }));
  const node = (id: string, kind: string, parent?: string) => mk("fleet_node", org, { fleet: FLEET, node: id, version: 1, kind, name: id, ...(parent ? { parent } : {}), owner: org.did }, null, { subject: FLEET });
  await k.log.append(node("root", "fleet")); await k.log.append(node("platform", "department", "root")); await k.log.append(node("support", "department", "root"));
  const join = async (name: string, at: string): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${name}`);
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET, node: at }, null, { subject: a.did }));
    await k.mint(a.did, 500);
    return a;
  };
  let n = 0;
  const running = async (a: Party): Promise<string> => {
    const client = await k.person(`br-client-${++n}`, 100);
    const contract = cosign(mk("contract", client, { principal: client.did, performer: a.did, bank: bank.did, purpose: `br run ${n}`, price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: a.did }), a as Signer);
    await k.log.append(contract);
    const bond = mk("bond", client, { contract: contract.id, backer: client.did, amount: credit(2), escrow: { payer: client.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await k.log.append(bond);
    const m = mk("mandate", client, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, institution_spend: [{ institution: "registry", cap: credit(70), period: "month" }] }, bond.id, { subject: a.did });
    await k.log.append(m);
    return contract.id;
  };
  return { ...k, org, join, running };
}

const signers = (org: Party) => (issuer: string, type: string, subject: string | null, body: Record<string, unknown>, at: string) => {
  const by = issuer === operator.did ? operator : issuer === clinic.did ? clinic : org;
  return mk(type as never, by, body, null, { subject, at });
};

test("a seeded breach in a fleet node: detected, the agent quarantined at once, the node's running contracts halted, sponsor and operator alerted, the incident signed, the restitution path open, all within the stated time; the sibling node and its agents untouched", async () => {
  const w = await world();
  const bad = await w.join("br-bad", "platform"), peer = await w.join("br-peer", "platform"), other = await w.join("br-other", "support");
  const [cb, cp, co] = [await w.running(bad), await w.running(peer), await w.running(other)];
  const mandate = ((await w.log.chain(cb)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1))!.id;
  // the breach: the agent tries to exfiltrate and to exceed its Mandate: blocked attempts the gateway signed into an Action (the detection)
  const detection = mk("action", bad, { contract: cb, scopes_used: [], summary: "blocked", assurance: "gateway_observed", blocked_attempts: [{ scope: "net.upload", count: 4 }, { scope: "shell.exec", count: 2 }] }, null, { subject: cb });
  await w.log.append(detection);
  const alerts: { to: string; text: string }[] = [];
  const t0 = Date.now();
  const detectedAt = nowIso();
  const r = await respondToBreach(w.log, { agent: bad.did, cause: "exfiltration", summary: "the agent tried to send data to an outside host and to run a shell it was not granted", detectedAt, detection: detection.id, fleet: FLEET, node: "platform" }, {
    sign: signers(w.org), alert: async (to, text) => { alerts.push({ to, text }); return true; }, now: () => { tick(); return nowIso(); }, operator: operator.did,
  });
  const wall = (Date.now() - t0) / 1000;
  assert.ok(wall < STATED_SECONDS, `the whole response took ${wall} s against a stated ${STATED_SECONDS} s`);
  console.log(`breach response: detection to signed incident in ${wall.toFixed(3)} s of wall time (${r.steps.length} steps: ${r.steps.join(", ")}); stated bound ${STATED_SECONDS} s`);
  assert.deepEqual(r.steps, ["quarantine", "node_halt", "node_halt", "alert_sponsor", "alert_operator", "restitution_opened"], "the agent, then both running contracts of the node");
  // the agent is quarantined at once (an emergency freeze takes effect immediately and is on the operator's review list)
  assert.equal(await refusedBy(w.openMandate(bad)), "agent_quarantined");
  assert.equal((await w.log.emergencyQuarantines()).length, 1);
  // the node's contracts are halted, so nothing in the node buys; the sibling node goes on
  assert.ok((await w.log.runHaltOf(cb)) && (await w.log.runHaltOf(cp)));
  assert.equal(await w.log.runHaltOf(co), undefined);
  assert.equal(await refusedBy(w.buy(peer, "registry.name.claim", 10, { mandate: ((await w.log.chain(cp)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1))!.id })), "run_halted", "the peer in the node buys nothing");
  void mandate;
  const sibling = ((await w.log.chain(co)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1))!.id;
  assert.equal(await refusedBy(w.buy(other, "registry.name.claim", 10, { mandate: sibling })), undefined, "the sibling node's agent buys as before");
  // alerts went to both, naming the cause and that nothing was slashed
  assert.deepEqual(alerts.map((a) => a.to), ["sponsor", "operator"]);
  assert.match(alerts[0].text, /exfiltration.*quarantined and node platform is halted.*Nothing was slashed/);
  // the incident record: signed by the operator, naming the detection, the node, each step with its record, and the restitution path
  const inc = await w.log.incidentsOf(bad.did);
  assert.equal(inc.length, 1);
  assert.deepEqual([inc[0].cause, inc[0].restitutionOpen, inc[0].steps.length], ["exfiltration", true, 6]);
  const rec = (await w.log.get(r.incident))!.record as unknown as { issuer: string; body: { detection: string; node: string; restitution: { remedy: string }; steps: { step: string; ref?: string }[] } };
  assert.deepEqual([rec.issuer, rec.body.detection, rec.body.node, rec.body.restitution.remedy], [operator.did, detection.id, "platform", "suspension"]);
  for (const s of rec.body.steps.filter((x) => x.ref)) assert.ok(await w.log.get(s.ref!), "every step names a record that exists");
  assert.equal((await w.log.reputationOf(bad.did))?.slashCount, 0, "a breach response slashes nobody");
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.log.verify()).ok, true);
});

test("the incident record is refused when it names a record that is not there, is signed by someone else, or is for an agent the log does not know", async () => {
  const w = await world();
  const a = await w.join("br-a", "platform");
  const inc = (over: Record<string, unknown>, by: Party = operator) => mk("incident", by, { agent: a.did, cause: "manual", summary: "test", detected_at: nowIso(), steps: [{ step: "alert_operator" }], ...over }, null, { subject: a.did });
  assert.equal(await refusedBy(w.log.append(inc({}, a))), "incident_wrong_issuer");
  assert.equal(await refusedBy(w.log.append(inc({ agent: "did:web:example.com:agents:ghost" }))), "incident_unknown_agent");
  assert.equal(await refusedBy(w.log.append(inc({ steps: [{ step: "quarantine", ref: "sha256:" + "8".repeat(64) }] }))), "incident_step_unknown");
  assert.equal(await refusedBy(w.log.append(inc({ detection: "sha256:" + "8".repeat(64) }))), "incident_detection_unknown");
  await w.log.append(inc({}));
  assert.equal((await w.log.incidentsOf(a.did)).length, 1);
});

test("the city-wide stop halts a seeded run's spending and resumes it with the owner's co-signature", async () => {
  const w = await world();
  const a = await w.join("br-stop", "platform");
  const c = await w.running(a);
  const mandate = ((await w.log.chain(c)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1))!.id;
  await w.buy(a, "registry.name.claim", 10, { mandate });
  const t = Date.parse(nowIso());
  const stop = mk("emergency_stop", operator, { act: "stop", reason: "a live exploit in the Market", until: new Date(t + 24 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z") }, null, { cosigners: [owner] });
  await w.log.append(stop);
  assert.equal(await refusedBy(w.buy(a, "registry.name.claim", 10, { mandate })), "city_stopped", "the seeded run cannot spend");
  assert.equal(await refusedBy(w.running(a)), "city_stopped", "and no new contract is made");
  assert.equal(await refusedBy(w.log.append(mk("emergency_stop", operator, { act: "lift", reason: "fixed and checked", stop: stop.id }, null, { cosigners: [owner] }))), undefined);
  await w.buy(a, "registry.name.claim", 10, { mandate });
  jump(DAY);
});
