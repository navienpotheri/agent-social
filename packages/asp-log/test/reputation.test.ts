import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { randomBytes } from "node:crypto";
import { EventLog } from "../src/index.ts";
import { alice, at, bank, codeOf, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

/** A fresh agent identity, sponsored by alice, self-issued key. */
function freshAgent(name: string): { did: string } & Signer & { publicKey: Uint8Array } {
  const did = `did:web:example.com:agents:${name}`;
  const seed = new Uint8Array(randomBytes(32));
  return { did, ...signerFromSeed(`${did}#key-1`, seed) };
}

async function registerAgent(log: EventLog, agent: { did: string } & Signer & { publicKey: Uint8Array }, opts: { fleet?: string } = {}) {
  const body: Record<string, unknown> = {
    did: agent.did, kind: "agent", sponsor: alice.did, tier: 1, shape: {},
    keys: [{ id: agent.kid, type: "Ed25519", public_key: b64urlEncode(agent.publicKey) }],
  };
  if (opts.fleet) body.fleet = opts.fleet;
  await log.append(rec("passport", alice, body, null, agent.did));
}

const contractBody = (performer: string, price: number) => ({
  principal: alice.did, performer, bank: bank.did,
  purpose: "Fix the flaky test", price: { value: price, unit: "credit" as const },
  verification: "deterministic" as const, deadline: "2026-10-03T18:00:00Z",
  basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
});

const bondBody = (contract: string, backer: string, bondAmount: number, escrowAmount: number) => ({
  contract, backer, amount: { value: bondAmount, unit: "credit" as const },
  escrow: { payer: alice.did, amount: { value: escrowAmount, unit: "credit" as const } },
  slashing_conditions: ["lost_dispute" as const, "floor_breach" as const, "forbidden_means" as const],
});

/** contract -> bond, for one performer/backer, stopping at Bonded (or the bond's own failure). */
async function bondOnly(log: EventLog, performer: { did: string } & Signer, backer: { did: string } & Signer, price: number, bondAmount: number, escrowAmount: number) {
  const contract = cosign(rec("contract", alice, contractBody(performer.did, price), null, performer.did), performer);
  await log.append(contract);
  const bond = rec("bond", backer, bondBody(contract.id, backer.did, bondAmount, escrowAmount), contract.id, contract.id);
  const bondResult = await codeOf(log.append(bond));
  return { bondResult, contract, bond };
}

/** contract -> bond -> mandate -> settlement(revoked, basis pro-rata), the shortest path to Settled. */
async function settleWithSlash(log: EventLog, performer: { did: string } & Signer, backer: { did: string } & Signer, price: number, bondAmount: number, bondSlashed: number) {
  const { bondResult, contract, bond } = await bondOnly(log, performer, backer, price, bondAmount, price);
  if (bondResult) return { bondResult };
  const mandate = rec("mandate", alice, {
    contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1",
    scopes: ["repo.read"], forbidden_means: [],
    spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const },
    subcontract: { allowed: false }, nodes: { max_parallel: 1 },
    learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
    overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
  }, bond.id, performer.did);
  await log.append(mandate);
  let settlement = rec("settlement", bank, {
    contract: contract.id, basis: "revoked", pro_rata_permille: 0,
    escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: bondAmount - bondSlashed, unit: "credit" },
    bond_slashed: { value: bondSlashed, unit: "credit" },
  }, mandate.id, contract.id);
  settlement = cosign(settlement, alice);
  const settlementResult = await codeOf(log.append(settlement));
  return { settlementResult };
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`deterrence (reputation) on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("a slash demotes tier by one and counts it; humans are never tracked", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const performer = freshAgent("perf-1");
      const backer = freshAgent("backer-1");
      await registerAgent(log, performer);
      await registerAgent(log, backer);
      await log.mint(alice.did, 1000);
      await log.mint(backer.did, 100);

      assert.deepEqual(await log.reputationOf(backer.did), { tier: 1, slashCount: 0 }); // no reputation row yet: falls back to the declared passport tier
      const { settlementResult } = await settleWithSlash(log, performer, backer, 1000, 100, 100);
      assert.equal(settlementResult, undefined);
      assert.deepEqual(await log.reputationOf(backer.did), { tier: 0, slashCount: 1 });
      assert.equal(await log.reputationOf(alice.did), null, "a human is never tier-tracked");
    });

    test("tier 0 (repeat slashes) excludes a backer from bonding at all", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const performer = freshAgent("perf-2");
      const backer = freshAgent("backer-2");
      await registerAgent(log, performer);
      await registerAgent(log, backer);
      await log.mint(alice.did, 2000);
      await log.mint(backer.did, 200);

      // Tier starts at 1 (registerAgent sets tier: 1): one slash demotes straight to 0.
      const first = await settleWithSlash(log, performer, backer, 1000, 100, 100);
      assert.equal(first.settlementResult, undefined);
      assert.deepEqual(await log.reputationOf(backer.did), { tier: 0, slashCount: 1 });

      const second = await bondOnly(log, performer, backer, 1000, 100, 1000);
      assert.equal(second.bondResult, "GUARD_FAILED");
    });

    test("a prior slash raises the minimum bond a backer must post next time (risk floor)", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const performer = freshAgent("perf-3");
      // A backer whose declared tier survives one slash, so it can still bond a second contract.
      const backer = freshAgent("backer-3");
      await log.append(rec("passport", alice, {
        did: backer.did, kind: "agent", sponsor: alice.did, tier: 4, shape: {},
        keys: [{ id: backer.kid, type: "Ed25519", public_key: b64urlEncode(backer.publicKey) }],
      }, null, backer.did));
      await registerAgent(log, performer);
      await log.mint(alice.did, 3000);
      await log.mint(backer.did, 1000);
      await settleWithSlash(log, performer, backer, 1000, 100, 100);
      assert.deepEqual(await log.reputationOf(backer.did), { tier: 3, slashCount: 1 });

      // Next contract, price 1000: risk floor is 250 permille of price = 250. A bond below that is refused.
      const performer2 = freshAgent("perf-3b");
      await registerAgent(log, performer2);
      const tooLow = await bondOnly(log, performer2, backer, 1000, 200, 1000);
      assert.equal(tooLow.bondResult, "GUARD_FAILED");
      const enough = await bondOnly(log, performer2, backer, 1000, 250, 1000);
      assert.equal(enough.bondResult, undefined);
    });

    test("a fellow live fleet member's slash raises the risk floor too, not just the slashed agent's own", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.append(rec("fleet", alice, { did: "did:web:example.com:fleets:coders", org: alice.did, name: "Coders", purpose: "Fix flaky tests" }, null, "did:web:example.com:fleets:coders"));

      const badActor = freshAgent("fleet-bad");
      const cleanMember = freshAgent("fleet-clean");
      const performer = freshAgent("fleet-performer");
      await registerAgent(log, badActor, { fleet: "did:web:example.com:fleets:coders" });
      await registerAgent(log, cleanMember, { fleet: "did:web:example.com:fleets:coders" });
      await registerAgent(log, performer);
      await log.mint(alice.did, 5000);
      await log.mint(badActor.did, 1000);
      await log.mint(cleanMember.did, 1000);

      await settleWithSlash(log, performer, badActor, 1000, 500, 500);
      assert.deepEqual(await log.reputationOf(badActor.did), { tier: 0, slashCount: 1 });
      assert.deepEqual(await log.reputationOf(cleanMember.did), { tier: 1, slashCount: 0 }, "clean member has no slashes of its own");

      // cleanMember has never been slashed, but its fleet-mate's one slash adds 100 permille to its floor.
      const performer2 = freshAgent("fleet-performer-2");
      await registerAgent(log, performer2);
      await log.mint(alice.did, 2000);
      const tooLow = await bondOnly(log, performer2, cleanMember, 1000, 50, 1000);
      assert.equal(tooLow.bondResult, "GUARD_FAILED");
      const enough = await bondOnly(log, performer2, cleanMember, 1000, 100, 1000);
      assert.equal(enough.bondResult, undefined);
    });

    test("tier 0 excludes an agent from receiving a Mandate too, not just bonding", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const agent = freshAgent("mandate-blocked");
      const cleanBacker = freshAgent("clean-backer");
      await registerAgent(log, agent);
      await registerAgent(log, cleanBacker);
      await log.mint(alice.did, 3000);
      await log.mint(agent.did, 100);
      await log.mint(cleanBacker.did, 100);
      // Demote `agent` to tier 0 by slashing it as a backer elsewhere, unrelated to what follows.
      await settleWithSlash(log, cleanBacker, agent, 1000, 100, 100);
      assert.deepEqual(await log.reputationOf(agent.did), { tier: 0, slashCount: 1 });

      // Now `agent` is the performer on a fresh contract, backed by someone with a clean tier —
      // the Bond succeeds (it's about the backer's tier, not the performer's), but the Mandate
      // that would let `agent` actually start work is refused.
      const { bondResult, contract, bond } = await bondOnly(log, agent, cleanBacker, 1000, 100, 1000);
      assert.equal(bondResult, undefined);
      const mandate = rec("mandate", alice, {
        contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1",
        scopes: ["repo.read"], forbidden_means: [],
        spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const },
        subcontract: { allowed: false }, nodes: { max_parallel: 1 },
        learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
        overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
      }, bond.id, agent.did);
      assert.equal(await codeOf(log.append(mandate)), "GUARD_FAILED");
    });

    test("tier 0 excludes an agent from submitting a Proposal (allocation mode)", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const agent = freshAgent("proposal-blocked");
      const cleanBacker = freshAgent("clean-backer-2");
      await registerAgent(log, agent);
      await registerAgent(log, cleanBacker);
      await log.mint(alice.did, 2000);
      await log.mint(agent.did, 100);
      await log.mint(cleanBacker.did, 100);
      await settleWithSlash(log, cleanBacker, agent, 1000, 100, 100);
      assert.deepEqual(await log.reputationOf(agent.did), { tier: 0, slashCount: 1 });

      const call = rec("call", alice, {
        purpose: "Fix it", budget: { value: 1000, unit: "credit" as const },
        evaluation_criteria: ["works"], panel: [bank.did], deadline: "2026-12-01T00:00:00Z",
      }, null, alice.did);
      await log.append(call);
      const proposal = rec("proposal", agent, {
        call: call.id, plan: "I'll fix it", team: [agent.did], budget_asked: { value: 1000, unit: "credit" as const }, milestones: [],
      }, null, agent.did);
      assert.equal(await codeOf(log.append(proposal)), "GUARD_FAILED");
    });

    test("verify() replays reputation and risk-floor guards without breaking", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const performer = freshAgent("perf-v");
      const backer = freshAgent("backer-v");
      await log.append(rec("passport", alice, {
        did: backer.did, kind: "agent", sponsor: alice.did, tier: 4, shape: {},
        keys: [{ id: backer.kid, type: "Ed25519", public_key: b64urlEncode(backer.publicKey) }],
      }, null, backer.did));
      await registerAgent(log, performer);
      await log.mint(alice.did, 3000);
      await log.mint(backer.did, 1000);
      await settleWithSlash(log, performer, backer, 1000, 100, 100);
      await bondOnly(log, performer, backer, 1000, 250, 1000);

      const report = await log.verify();
      assert.equal(report.ok, true, report.error && JSON.stringify(report.error));
    });
  });
}
