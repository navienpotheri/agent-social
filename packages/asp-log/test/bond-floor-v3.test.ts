// The verifiable risk floor, version 3 (register row DK43; spec-delta S506): the floor for a job is a function of recorded inputs only. It reproduces the learning pilot's published floors, and adds four terms
// read from signed records: valid certificates lower it, a recent Clinic drift diagnosis raises it, the task class the Intent declared multiplies it, and the scopes the Mandate grants add a threat term. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { EventLog, MemoryStore } from "../src/index.ts";
import { FLOOR_TABLE, bondFloorPermille, bondFloorV3, floorTableHash, minBond, threatPermille, type FloorInputsV3 } from "../src/bond-floor.ts";
// @ts-expect-error: plain .mjs without type declarations
import { track } from "../../../evals/learning/track.mjs";
import { Kit, bankP, clinic, credit, hashOf, operator, owner, refused, registrar, treasury, courts, type Party } from "./academy-kit.ts";
import { staticResolver } from "@agent-social/asp-core";

const none: FloorInputsV3 = { ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0, verifiedImprovements: 0, acceptedCleanJobs: 0, regressions: 0, certificates: 0, drift: "none", taskClass: "routine", scopes: [] };

test("the learning pilot's published floors are reproduced from its readings, and v3 with no new input is exactly the same number", () => {
  const readings = (passes: number[]) => passes.map((p, i) => ({ round: i, passes: p, n: 8 }));
  // docs/credits-and-learning-experiment.md: Stage A5 (Learner floors 400, 400, 400, 352, 299, 242) and its replication with seed 1 (400, 400, 369, 310, 270, 237). The accepted clean jobs are
  // the pilot's own counts, recovered from the published floors (one at round 4 and round 5 in A5; one at round 4 and two at round 5 in the replication).
  const a5 = track(readings([0, 3, 1, 6, 5, 7]), [0, 0, 0, 0, 1, 1]);
  assert.deepEqual(a5.map((r: { floor: number }) => r.floor), [400, 400, 400, 352, 299, 242]);
  const rep = track(readings([0, 3, 5, 6, 5, 5]), [0, 0, 0, 0, 1, 2]);
  assert.deepEqual(rep.map((r: { floor: number }) => r.floor), [400, 400, 369, 310, 270, 237]);
  // Static, with no improvement and no job, stays at the base.
  assert.deepEqual(track(readings([0, 0, 0, 0, 0, 0]), []).map((r: { floor: number }) => r.floor), [400, 400, 400, 400, 400, 400]);
  // v3 with no certificate, no drift, routine class and no threat scope returns the v2 number for every one of these records.
  for (const row of [...a5, ...rep]) {
    const rec = { ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0, verifiedImprovements: row.improvements, regressions: row.regressions, acceptedCleanJobs: row.jobs };
    assert.ok(Math.abs(bondFloorV3({ ...none, ...rec }) - row.floor) <= 1, "the row prints improvements to two places, so a floor recomputed from it is within one permille");
    assert.equal(bondFloorV3({ ...none, ...rec }), Math.min(1000, Math.max(50, Math.round(bondFloorPermille(rec)))));
  }
});

test("each new term moves the floor the stated way, they combine in a stated order, and it stays between the minimum and the whole price", () => {
  const f = (over: Partial<FloorInputsV3>) => bondFloorV3({ ...none, ...over });
  assert.equal(f({}), 400);
  assert.deepEqual([1, 2, 3, 9].map((c) => f({ certificates: c })), [360, 320, 280, 280], "40 off each certificate, 120 at most");
  assert.equal(f({ drift: "warn" }), 500);
  assert.equal(f({ drift: "quarantine_recommended" }), 700);
  assert.deepEqual((["trivial", "routine", "skilled", "critical"] as const).map((taskClass) => f({ taskClass })), [240, 400, 520, 680]);
  assert.deepEqual([[], ["repo.read"], ["shell.exec"], ["shell.network"], ["web.read"], ["mcp.github"], ["shell.exec", "shell.network"]].map((scopes) => threatPermille(scopes)), [0, 0, 50, 100, 75, 50, 125]);
  // Order: certificates and drift adjust the v2 floor, the class multiplies, then the threat terms add. 2 certificates (320), drift warn (420), critical (714), shell.network and repo.push (+125) = 839.
  assert.equal(f({ certificates: 2, drift: "warn", taskClass: "critical", scopes: ["shell.network", "repo.push"] }), 839);
  assert.equal(f({ ownSlashes: 9, taskClass: "critical", scopes: ["shell.exec"] }), 1000, "never above the whole price");
  assert.equal(f({ certificates: 9, taskClass: "trivial", verifiedImprovements: 99, acceptedCleanJobs: 99 }), 50, "never below the minimum");
  // Monotone: a certificate never raises it, drift and a dearer class never lower it.
  for (let i = 0; i < 5; i++) {
    assert.ok(f({ certificates: i + 1 }) <= f({ certificates: i }));
    assert.ok(f({ drift: "warn" }) >= f({ drift: "none" }) && f({ drift: "quarantine_recommended" }) >= f({ drift: "warn" }));
  }
  assert.equal(minBond(1000, f({ taskClass: "critical" })), 680);
});

test("the table is published with a version and a hash, so a floor can be recomputed against the exact numbers it used", async () => {
  assert.equal(FLOOR_TABLE.version, "v3-1");
  const h = await floorTableHash();
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await floorTableHash(), h);
});

function v3log() {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey])));
  return new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, bondFloor: "v3" });
}

async function world() {
  const kit = new Kit(v3log());
  const sponsor = await kit.person("v3-sponsor");
  const agent = await kit.agent("v3-agent", sponsor, 1);
  const principal = await kit.person("v3-principal");
  await kit.mint(principal.did, 5000);
  await kit.mint(agent.did, 2000);
  const intent = async (cls?: string) => { const r = kit.mk("intent", principal, { purpose: "Do a job", acceptance_criteria: ["done"], budget: credit(1000), deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" }, ...(cls ? { class: cls } : {}) }, null, { subject: principal.did }); return kit.put(r); };
  /** A contract of price 1000 on an intent of the given class, and a bond from the agent of `amount`; returns what the log said about the bond and the ids. */
  const job = async (cls: string | undefined, amount: number) => {
    const intentId = await intent(cls);
    const contract = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: "A priced job", price: credit(1000), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: intentId, offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(contract);
    const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(amount), escrow: { payer: principal.did, amount: credit(1000) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    return { contract, bond, intentId };
  };
  const mandate = (j: { contract: { id: string }; bond: { id: string } }, scopes: string[]) => kit.mk("mandate", principal, { contract: j.contract.id, purpose: "Do it", floor: "asp.floor/v1", scopes, forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2027-12-04T00:00:00Z", revocable: true }, j.bond.id, { subject: agent.did });
  return { kit, sponsor, agent, principal, job, mandate };
}

test("in the log: the class the Intent declared sets the bond a new agent must lock, and the floor is recomputed from the recorded Intent", async () => {
  const w = await world();
  // routine (none declared): 400 permille of 1000 is 400; critical: 680.
  const routine = await w.job(undefined, 399);
  assert.equal(await refused(w.kit.put(routine.bond)), "bond_below_risk_floor");
  const ok400 = await w.job(undefined, 400);
  await w.kit.put(ok400.bond);
  const critical = await w.job("critical", 679);
  assert.equal(await refused(w.kit.put(critical.bond)), "bond_below_risk_floor");
  await w.kit.put((await w.job("critical", 680)).bond);
  const trivial = await w.job("trivial", 240);
  await w.kit.put(trivial.bond);
});

test("in the log: a valid certificate lowers the bond a job needs by 40 permille, and a revoked one does not", async () => {
  const w = await world();
  const cert = await w.kit.certify(w.agent, "foundations", 1);
  const one = await w.job(undefined, 359);
  assert.equal(await refused(w.kit.put(one.bond)), "bond_below_risk_floor", "one certificate: 400 - 40 = 360");
  await w.kit.put((await w.job(undefined, 360)).bond);
  await w.kit.put(w.kit.revoke(cert, "error", registrar));
  const revoked = await w.job(undefined, 399);
  assert.equal(await refused(w.kit.put(revoked.bond)), "bond_below_risk_floor", "a revoked certificate counts for nothing");
});

test("in the log: the Mandate's scopes add the threat term, checked when the Mandate arrives because the Bond came first", async () => {
  const w = await world();
  const j = await w.job(undefined, 400);
  await w.kit.put(j.bond);
  // pr.merge and repo.push: 100 + 25 = 125 permille more, so 525 of 1000 is needed; 400 is locked.
  assert.equal(await refused(w.kit.put(w.mandate(j, ["repo.read", "repo.push", "pr.merge"]))), "bond_below_threat_floor");
  await w.kit.put(w.mandate(j, ["repo.read"]));
  const k = await w.job(undefined, 525);
  await w.kit.put(k.bond);
  await w.kit.put(w.mandate(k, ["repo.read", "repo.push", "pr.merge"]));
});

test("in the log: a recent Clinic diagnosis of drift raises the floor for 30 days, and then it falls away", async () => {
  const w = await world();
  const j0 = await w.kit.job(w.agent); // an agent job with Actions to cite
  const act = async (assurance: string) => w.kit.put(w.kit.mk("action", w.agent, { contract: j0.contract, scopes_used: ["repo.read"], assurance, summary: "run", metrics: { tokens_in: 1000, tokens_out: 0, tool_calls: 3, seconds: 10 } }, null, { subject: j0.contract }));
  const a1 = await act("gateway_observed"), a2 = await act("gateway_observed"), a3 = await act("gateway_observed");
  w.kit.addDays(1);
  const at = async (id: string) => (await w.kit.log.get(id))!.record.issued_at;
  const dx = w.kit.mk("clinic_diagnosis", clinic, {
    agent: w.agent.did, window: { from: await at(a1), to: await at(a3) }, severity: "warn", assurance: "gateway_observed", baseline_jobs: 20, cause: { cause: "unknown" },
    findings: [{ measure: "tokens", baseline: 1000, observed: 4000, threshold: "x", evidence: [a1, a2] }, { measure: "tool_calls", baseline: 3, observed: 12, threshold: "y", evidence: [a3] }],
    recommendation: [{ action: "re_exam", skill: "foundations", note: "sit it again" }],
  }, null, { subject: w.agent.did });
  await w.kit.put(dx);
  const drifting = await w.job(undefined, 499);
  assert.equal(await refused(w.kit.put(drifting.bond)), "bond_below_risk_floor", "400 + 100 for a warn");
  await w.kit.put((await w.job(undefined, 500)).bond);
  w.kit.addDays(31);
  await w.kit.put((await w.job(undefined, 400)).bond);
});
