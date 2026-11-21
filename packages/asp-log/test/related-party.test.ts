/**
 * The related-party track record (register row DK1358; spec-delta S1411): clean runs by an agent for its own sponsor, attested by the sponsor, build a record that counts toward the second starter tranche and the first
 * promotion at a stated weight, is labelled related-party, never counts as an independent job and earns no credit; a breach resets it. The enterprise's association (full, related-party only, private) is enforced
 * and standing is computed the same way for the same acts. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { clinic, credit, jump, kit, keysOf, mk, nowIso, party, refusedBy, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";
import { journeyOf } from "../src/journey.ts";
import { STARTER_PER_DID, STARTER_UPFRONT } from "../src/starter.ts";
import { STARTER_POOL_DID } from "../src/economy.ts";
import { RP_RUNS_PER_JOB, promotionJobsOk, relatedEquivalentJobs, starterRestEarned } from "../src/related-party.ts";

const FLEET = "did:web:example.com:orgs:rp-co:fleets:all";

async function world(association?: string) {
  const k = await kit();
  await k.withPrices();
  await k.mint(STARTER_POOL_DID, 5000);
  const org = party("did:web:example.com:orgs:rp-co");
  await k.log.append(mk("passport", org, { did: org.did, kind: "org", keys: keysOf(org) }, null, { subject: org.did }));
  await k.mint(org.did, 2000);
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "All", purpose: "all of the company's agents", ...(association ? { association } : {}) }, null, { subject: FLEET }));
  const join = async (name: string): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${name}`);
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET }, null, { subject: a.did }));
    await k.mint(a.did, 100);
    return a;
  };
  let n = 0;
  /** A Running contract (Mandate in force) between a principal and the agent, as openMandate makes one, but for a principal of our choosing. */
  const running = async (principal: Party, a: Party): Promise<string> => {
    const contract = cosign(mk("contract", principal, { principal: principal.did, performer: a.did, bank: bank.did, purpose: `rp run ${++n}`, price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: a.did }), a as Signer);
    await k.log.append(contract);
    const bond = mk("bond", principal, { contract: contract.id, backer: principal.did, amount: credit(2), escrow: { payer: principal.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await k.log.append(bond);
    await k.log.append(mk("mandate", principal, { contract: contract.id, purpose: "Work for the company", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true }, bond.id, { subject: a.did }));
    return contract.id;
  };
  const action = async (a: Party, contract: string, over: Record<string, unknown> = {}) => {
    const r = mk("action", a, { contract, scopes_used: [], summary: `run ${++n}`, assurance: "gateway_observed", ...over }, null, { subject: contract });
    await k.log.append(r);
    return r.id;
  };
  const attest = (by: Party, a: Party, act: string) => mk("related_party_attestation", by, { agent: a.did, action: act }, null, { subject: a.did });
  return { ...k, org, join, running, action, attest, claim: (who: Party, part: "upfront" | "rest") => mk("starter_claim", who, { part, amount: credit(part === "upfront" ? STARTER_UPFRONT : STARTER_PER_DID - STARTER_UPFRONT) }, null, { subject: who.did }) };
}

describe("the stated weight", () => {
  test("ten clean attested runs are one job's worth; the second tranche needs one job's worth; promotion takes at most two of its three jobs from related-party runs and always needs one independent job", () => {
    assert.deepEqual([relatedEquivalentJobs(9), relatedEquivalentJobs(10), relatedEquivalentJobs(35)], [0, 1, 3]);
    assert.equal(starterRestEarned(0, 9), false);
    assert.equal(starterRestEarned(0, RP_RUNS_PER_JOB), true);
    assert.equal(starterRestEarned(1, 0), true, "an independent job still unlocks it");
    assert.deepEqual(promotionJobsOk(0, 1000), { ok: false, counted: 2, related: 2 }, "no independent job: never enough, however many related-party runs");
    assert.equal(promotionJobsOk(1, 20).ok, true, "one independent and two related-party");
    assert.equal(promotionJobsOk(1, 10).ok, false, "one and one is two");
    assert.equal(promotionJobsOk(2, 10).ok, true);
    assert.equal(promotionJobsOk(1, 100).counted, 3, "related-party jobs are capped at two");
  });
});

describe("a sponsor attests clean runs of its own agent", () => {
  test("the log checks who signs, the Action, its assurance, that it is clean, that it ran for a related party, that it is new and that it came after the last breach", async () => {
    const w = await world();
    const a = await w.join("rp-a"), b = await w.join("rp-b");
    const stranger = await w.person("rp-stranger");
    const own = await w.running(w.org, a);
    const act = await w.action(a, own);
    assert.equal(await refusedBy(w.log.append(w.attest(stranger, a, act))), "rp_attestation_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, a, "sha256:" + "9".repeat(64)))), "rp_attestation_not_an_action");
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, b, act))), "rp_attestation_not_agents", "the Action is a's, not b's");
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, stranger, act))), "rp_attestation_not_an_agent");
    const weak = await w.action(a, own, { assurance: "self_reported" });
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, a, weak))), "rp_attestation_weak");
    const dirty = await w.action(a, own, { blocked_attempts: [{ scope: "shell.exec", count: 1 }] });
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, a, dirty))), "rp_attestation_not_clean");
    // a run for an independent client is an ordinary job, not a related-party run
    const client = await w.person("rp-client", 100);
    const outside = await w.action(a, await w.running(client, a));
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, a, outside))), "rp_attestation_not_related");
    const ok = await w.action(a, own);
    await w.log.append(w.attest(w.org, a, ok));
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, a, ok))), "rp_attestation_known", "a run is attested once");
    const r = await w.log.relatedPartyRecord(a.did);
    assert.ok(r.lastBreach, "the dirty run above was a strike, so a breach is on record");
    assert.deepEqual([r.label, r.cleanRuns, r.equivalentJobs, r.runsPerJob, r.lastBreach, r.association], ["related-party", 1, 0, 10, r.lastBreach, "full"]);
    const j = journeyOf({ stored: await w.log.since(0, 5000), now: "2026-11-21T00:00:00Z" }, a.did, "public")!;
    const step = j.steps.find((x) => x.kind === "related_party_run");
    assert.ok(step, "the journey view shows the attested run");
    assert.match(step!.text, /related-party.*never an independent job.*earns no credit/);
    assert.equal((await w.log.verify()).ok, true);
  });
});

describe("the record counts, and counts as itself", () => {
  test("ten attested runs unlock the second starter tranche without an independent job; reputation shows no counted job and no credit was rewarded", async () => {
    const w = await world();
    const a = await w.join("rp-starter");
    await w.log.append(w.claim(a, "upfront"));
    assert.equal(await refusedBy(w.log.append(w.claim(a, "rest"))), "starter_rest_not_earned");
    const contract = await w.running(w.org, a);
    const balanceBefore = await w.log.balance(a.did);
    for (let i = 0; i < RP_RUNS_PER_JOB; i++) {
      await w.log.append(w.attest(w.org, a, await w.action(a, contract)));
      if (i === RP_RUNS_PER_JOB - 2) assert.equal(await refusedBy(w.log.append(w.claim(a, "rest"))), "starter_rest_not_earned", "nine runs are not yet one job's worth");
    }
    assert.equal(await w.log.balance(a.did), balanceBefore, "attesting pays nothing: no credit reward");
    const rep = await w.log.reputationOf(a.did);
    assert.equal(rep?.qualifyingJobs, undefined, "the related-party runs never became an independent qualifying job");
    assert.equal(rep?.acceptedJobs, undefined);
    assert.equal((await w.log.relatedPartyRecord(a.did)).equivalentJobs, 1);
    await w.log.append(w.claim(a, "rest"));
    assert.equal(await w.log.balance(a.did), balanceBefore + STARTER_PER_DID - STARTER_UPFRONT, "the second tranche came from the starter pool, as for any agent");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("a blocked attempt or a Clinic freeze resets the record, and a run from before the breach cannot be attested afterwards", async () => {
    const w = await world();
    const a = await w.join("rp-breach");
    const contract = await w.running(w.org, a);
    const before = await w.action(a, contract);
    const early = await w.action(a, contract);
    for (let i = 0; i < 3; i++) await w.log.append(w.attest(w.org, a, await w.action(a, contract)));
    assert.equal((await w.log.relatedPartyRecord(a.did)).cleanRuns, 3);
    jump(60_000);
    await w.action(a, contract, { blocked_attempts: [{ scope: "shell.exec", count: 1 }] });
    const r = await w.log.relatedPartyRecord(a.did);
    assert.equal(r.cleanRuns, 0, "a strike resets the record");
    assert.ok(r.lastBreach);
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, a, before))), "rp_attestation_before_breach", "a run from before the breach does not count after it");
    assert.equal(await refusedBy(w.log.append(w.attest(w.org, a, early))), "rp_attestation_before_breach");
    jump(60_000);
    await w.log.append(w.attest(w.org, a, await w.action(a, contract)));
    assert.equal((await w.log.relatedPartyRecord(a.did)).cleanRuns, 1, "it starts again after the breach");
    // a Clinic freeze is a breach too
    jump(20 * 86_400_000);
    const t = Date.parse(nowIso());
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    await w.log.append(mk("quarantine", clinic, { members: [a.did], level: "observe", reason: "drift seen in three runs", until: iso(t + 5 * 86_400_000), effective_from: iso(t + 86_400_000 + 60_000) }, null));
    assert.equal((await w.log.relatedPartyRecord(a.did)).cleanRuns, 0, "a Clinic freeze resets the record");
  });
});

describe("the enterprise's association with the society", () => {
  test("related-party only: an offer to an independent client's job is refused, an offer to the sponsor's own job is accepted; full allows both; standing is computed the same way", async () => {
    for (const assoc of ["related_party_only", "private", "full"] as const) {
      const w = await world(assoc);
      const a = await w.join(`rp-assoc-${assoc}`);
      const client = await w.person(`rp-assoc-client-${assoc}`, 100);
      const outside = await w.intent(client);
      const own = await w.intent(w.org);
      const blocked = await refusedBy(w.log.append(mk("offer", a, { intent: outside, price: credit(60), plan: "do it", eta: "2027-05-01T00:00:00Z", bond_offered: credit(0) }, null, { subject: a.did })));
      assert.equal(blocked, assoc === "full" ? undefined : "fleet_association_blocks_market", `${assoc}: an offer to an independent client`);
      assert.equal(await refusedBy(w.log.append(mk("offer", a, { intent: own, price: credit(60), plan: "do it", eta: "2027-05-01T00:00:00Z", bond_offered: credit(0) }, null, { subject: a.did }))), undefined, `${assoc}: an offer to its own sponsor`);
      assert.equal((await w.log.relatedPartyRecord(a.did)).association, assoc);
    }
  });

  test("a private fleet is accountable and logged but not shown in discovery; the others are", async () => {
    const shown = async (assoc: string) => {
      const w = await world(assoc);
      const a = await w.join(`rp-disc-${assoc}`);
      const found = await w.log.discoverAgents({}, "seed");
      return found.some((r) => (r as unknown as { did?: string; agent?: { did: string } }).did === a.did || JSON.stringify(r).includes(a.did));
    };
    assert.equal(await shown("full"), true);
    assert.equal(await shown("related_party_only"), true, "related-party only agents are found but cannot take the market's jobs");
    assert.equal(await shown("private"), false);
  });
});
