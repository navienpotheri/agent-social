import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { randomBytes } from "node:crypto";
import { EventLog } from "../src/index.ts";
import type { EventLogOptions } from "../src/index.ts";
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

/** contract -> bond -> mandate -> settlement on basis `accepted` (all released, all returned). */
async function settleAccepted(log: EventLog, performer: { did: string } & Signer, backer: { did: string } & Signer, price: number, bondAmount: number) {
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
  const delivery = rec("delivery", performer, {
    contract: contract.id, result: { summary: "Done", artifacts: [] },
    evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] },
  }, mandate.id, contract.id);
  await log.append(delivery);
  const accept = rec("attestation", alice, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, contract.id);
  await log.append(accept);
  let settlement = rec("settlement", bank, {
    contract: contract.id, basis: "accepted", cites: accept.id,
    escrow_released: { value: price, unit: "credit" }, bond_returned: { value: bondAmount, unit: "credit" },
    bond_slashed: { value: 0, unit: "credit" },
  }, accept.id, contract.id);
  settlement = cosign(settlement, alice);
  return { settlementResult: await codeOf(log.append(settlement)) };
}

const v2: EventLogOptions = { bondFloor: "v2" };

for (const h of [memory, postgres] as Harness[]) {
  describe(`bond floor v2 (S143) on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("the default is unchanged: with no option an unknown agent may bond below 400 permille", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const performer = freshAgent("fl-perf-0"), backer = freshAgent("fl-backer-0");
      await registerAgent(log, performer); await registerAgent(log, backer);
      await log.mint(alice.did, 3000); await log.mint(backer.did, 1000);
      assert.equal((await bondOnly(log, performer, backer, 1000, 100, 1000)).bondResult, undefined);
    });

    test("v2: an unknown agent must bond 400 permille of the price, and a clean accepted job lowers it by 15", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const performer = freshAgent("fl-perf-1"), backer = freshAgent("fl-backer-1");
      await registerAgent(log, performer); await registerAgent(log, backer);
      await log.mint(alice.did, 6000); await log.mint(backer.did, 3000);

      const low = await bondOnly(log, performer, backer, 1000, 399, 1000);
      assert.equal(low.bondResult, "GUARD_FAILED", "399 is under 40% of 1000");
      const first = await settleAccepted(log, performer, backer, 1000, 400);
      assert.equal(first.settlementResult, undefined, String(first.settlementResult));
      assert.deepEqual(await log.reputationOf(backer.did), { tier: 1, slashCount: 0, strikes: 0, acceptedJobs: 1 });

      const performer2 = freshAgent("fl-perf-1b");
      await registerAgent(log, performer2);
      assert.equal((await bondOnly(log, performer2, backer, 1000, 384, 1000)).bondResult, "GUARD_FAILED", "one clean job: the floor is 385");
      assert.equal((await bondOnly(log, performer2, backer, 1000, 385, 1000)).bondResult, undefined);
    });

    test("v2: a slash puts the floor back up and a job settled with a slash is not counted as clean", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const performer = freshAgent("fl-perf-2");
      const backer = freshAgent("fl-backer-2");
      await log.append(rec("passport", alice, { did: backer.did, kind: "agent", sponsor: alice.did, tier: 4, shape: {}, keys: [{ id: backer.kid, type: "Ed25519", public_key: b64urlEncode(backer.publicKey) }] }, null, backer.did));
      await registerAgent(log, performer);
      await log.mint(alice.did, 6000); await log.mint(backer.did, 3000);
      await settleWithSlash(log, performer, backer, 1000, 500, 100);
      assert.deepEqual(await log.reputationOf(backer.did), { tier: 3, slashCount: 1, strikes: 0 });
      const performer2 = freshAgent("fl-perf-2b");
      await registerAgent(log, performer2);
      // 400 base + 250 for the slash = 650
      assert.equal((await bondOnly(log, performer2, backer, 1000, 649, 1000)).bondResult, "GUARD_FAILED");
      assert.equal((await bondOnly(log, performer2, backer, 1000, 650, 1000)).bondResult, undefined);
    });

    test("v2: the floor is never below 50 permille, however many clean jobs", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const backer = freshAgent("fl-backer-3");
      await registerAgent(log, backer);
      await log.mint(alice.did, 40000); await log.mint(backer.did, 20000);
      for (let i = 0; i < 12; i++) {
        const p = freshAgent(`fl-perf-3-${i}`); await registerAgent(log, p);
        assert.equal((await settleAccepted(log, p, backer, 1000, 1000)).settlementResult, undefined);
      }
      const p = freshAgent("fl-perf-3z"); await registerAgent(log, p);
      // 12 clean jobs: tenure credit 150 (capped), so 400 - 150 = 250.
      assert.equal((await bondOnly(log, p, backer, 1000, 249, 1000)).bondResult, "GUARD_FAILED");
      assert.equal((await bondOnly(log, p, backer, 1000, 250, 1000)).bondResult, undefined);
    });
  });
}
