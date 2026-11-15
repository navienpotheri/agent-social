// Outcome series (register row D2; spec-delta S503): a scripted agent whose behaviour changes at a lineage edge, for one principal only, and the series that shows it: per agent, per principal, before and after
// the edge. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { b64urlEncode, cosign, createRecord, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { EventLog, compareAcrossEdges, outcomeJobs, windowOf } from "../src/index.ts";
import { alice, at, bank, memory, rec, registerParties } from "./harness.ts";

const bobSigner = signerFromSeed("did:web:example.com:users:bob#key-1", new Uint8Array(randomBytes(32)));
const bob = { did: "did:web:example.com:users:bob", ...bobSigner };

// A scripted agent at tier 3, so a run of slashes in the script does not demote it out of the story.
const agentSigner = signerFromSeed("did:web:example.com:agents:scripted#key-1", new Uint8Array(randomBytes(32)));
const agent = { did: "did:web:example.com:agents:scripted", ...agentSigner };
const contractBody = (principal: string, price: number) => ({
  principal, performer: agent.did, bank: bank.did, purpose: "Fix the flaky test", price: { value: price, unit: "credit" as const },
  verification: "deterministic" as const, deadline: "2027-03-01T00:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
});

/** One finished job for `principal`: contract, bond, mandate, an Action (with blocked attempts if asked), and a settlement that either pays (accepted) or slashes the bond (revoked). */
async function job(log: EventLog, principal: { did: string } & Signer, how: "accepted" | "slashed", blocked = 0) {
  await log.mint(principal.did, 200);
  await log.mint(agent.did, 100);
  const contract = cosign(rec("contract", principal, contractBody(principal.did, 100), null, agent.did), agent);
  await log.append(contract);
  const bondRec = rec("bond", agent, { contract: contract.id, backer: agent.did, amount: { value: 80, unit: "credit" as const }, escrow: { payer: principal.did, amount: { value: 100, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const] }, contract.id, contract.id);
  await log.append(bondRec);
  const mandate = rec("mandate", principal, { contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const, overlay: null, checkpoints: [], expires: "2027-03-02T00:00:00Z", revocable: true }, bondRec.id, agent.did);
  await log.append(mandate);
  await log.append(rec("action", agent, { contract: contract.id, scopes_used: ["repo.read"], ...(blocked ? { blocked_attempts: [{ scope: "shell.exec", count: blocked }] } : {}) }, null, contract.id));
  if (how === "accepted") {
    const delivery = rec("delivery", agent, { contract: contract.id, result: { summary: "done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, mandate.id, contract.id);
    await log.append(delivery);
    const accept = rec("attestation", principal, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, contract.id);
    await log.append(accept);
    await log.append(cosign(rec("settlement", bank, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: { value: 100, unit: "credit" }, bond_returned: { value: 80, unit: "credit" }, bond_slashed: { value: 0, unit: "credit" } }, accept.id, contract.id), principal));
  } else {
    const settle = rec("settlement", bank, { contract: contract.id, basis: "revoked", pro_rata_permille: 0, escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: 0, unit: "credit" }, bond_slashed: { value: 80, unit: "credit" } }, mandate.id, contract.id);
    await log.append(cosign(settle, principal));
  }
}
const edge = (log: EventLog, layer: string) => log.append(createRecord({ type: "lineage", issuer: agent.did, subject: agent.did, prev: null, issued_at: at(), body: { edge: "update", child: agent.did, parents: [agent.did], change: { layer, description: "a note" } } }, agent));

test("a change that hurt one principal's jobs shows in the series per agent and per principal, before and after the lineage edge", async () => {
  const log = new EventLog(await memory.make());
  await registerParties(log);
  await log.append(rec("passport", alice, { did: agent.did, kind: "agent", sponsor: alice.did, tier: 3, shape: { keeps_learning: true }, keys: [{ id: agent.kid, type: "Ed25519", public_key: b64urlEncode(agentSigner.publicKey) }] }, null, agent.did));
  await log.append(rec("passport", bob, { did: bob.did, kind: "human", keys: [{ id: bob.kid, type: "Ed25519", public_key: b64urlEncode(bobSigner.publicKey) }] }, null, bob.did));
  // Before the edge: three jobs for alice and three for bob all go well, with no blocked attempts.
  for (let i = 0; i < 3; i++) { await job(log, alice, "accepted"); await job(log, bob, "accepted"); }
  const e = await edge(log, "memory");
  // After it: the agent still serves alice well, but fails bob's jobs and gets refused more often.
  for (let i = 0; i < 3; i++) { await job(log, alice, "accepted"); await job(log, bob, "slashed", 2); }

  const series = await log.outcomeSeries(agent.did);
  assert.equal(series.jobs.length, 12);
  assert.deepEqual([series.overall.accepted, series.overall.failed], [9, 3]);
  assert.equal(series.edges.length, 1);
  const c = series.edges[0];
  assert.equal(c.edge, e.id);
  assert.equal(c.layer, "memory");
  assert.deepEqual([c.before.jobs, c.before.successPermille, c.before.blockedPerJob], [6, 1000, 0]);
  assert.deepEqual([c.after.jobs, c.after.successPermille, c.after.blockedPerJob], [6, 500, 1], "half of the jobs after the change failed, one refused attempt per job on average");
  assert.equal(c.verdict, "worse");
  assert.equal(c.deltaPermille, -500);
  // Per principal: bob's jobs went from all accepted to all failed, alice's did not move.
  const by = new Map(c.byPrincipal.map((p) => [p.principal, p]));
  assert.deepEqual([by.get(bob.did)!.before.successPermille, by.get(bob.did)!.after.successPermille, by.get(bob.did)!.verdict], [1000, 0, "worse"]);
  assert.deepEqual([by.get(alice.did)!.after.successPermille, by.get(alice.did)!.verdict], [1000, "unchanged"]);

  // The series of one principal, across the agents it hired.
  const bobSeries = await log.principalSeries(bob.did);
  assert.equal(bobSeries.jobs.length, 6);
  assert.deepEqual([bobSeries.overall.accepted, bobSeries.overall.failed], [3, 3]);
  assert.deepEqual(bobSeries.byAgent.map((a) => [a.agent, a.window.successPermille]), [[agent.did, 500]]);
  assert.deepEqual((await log.outcomeSeries("did:web:example.com:agents:nobody")).jobs, []);
});

test("too few jobs on a side is unmeasured, never unchanged; a rise is better; two edges split the series so one is not blamed for the other", () => {
  const j = (n: number, outcome: "accepted" | "failed", day: number, principal = "p") => ({ contract: `c${n}`, principal, agent: "a", price: 100, settledAt: `2026-11-${String(day).padStart(2, "0")}T00:00:00Z`, outcome, blocked: 0 });
  const jobs = [j(1, "failed", 1), j(2, "failed", 2), j(3, "failed", 3), j(4, "accepted", 11), j(5, "accepted", 12), j(6, "accepted", 13), j(7, "failed", 21)];
  const edges = [{ id: "e1", at: "2026-11-10T00:00:00Z", layer: "memory" }, { id: "e2", at: "2026-11-20T00:00:00Z", layer: "harness" }];
  const [first, second] = compareAcrossEdges(jobs, edges);
  assert.equal(first.verdict, "better", "3 failed before, 3 accepted after the first edge, up to the second");
  assert.equal(first.deltaPermille, 1000);
  assert.equal(first.after.jobs, 3, "the job after the second edge is not counted against the first");
  assert.equal(second.verdict, "unmeasured", "one job after the second edge is too few");
  assert.equal(second.deltaPermille, null);
  assert.equal(windowOf([]).successPermille, null);
  assert.deepEqual(outcomeJobs([]), []);
});
