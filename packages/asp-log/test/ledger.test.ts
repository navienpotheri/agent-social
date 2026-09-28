import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { EventLog, PLATFORM_DID } from "../src/index.ts";
import { alice, at, bank, codeOf, coder, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

const contractBody = (price: number) => ({
  principal: alice.did, performer: coder.did, bank: bank.did,
  purpose: "Fix the flaky test", price: { value: price, unit: "credit" as const },
  verification: "deterministic" as const, deadline: "2026-10-03T18:00:00Z",
  basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
});

const bondBody = (contract: string, bondAmount: number, escrowAmount: number) => ({
  contract, backer: coder.did, amount: { value: bondAmount, unit: "credit" as const },
  escrow: { payer: alice.did, amount: { value: escrowAmount, unit: "credit" as const } },
  slashing_conditions: ["lost_dispute" as const, "floor_breach" as const, "forbidden_means" as const],
});

const mandateBody = (contract: string) => ({
  contract, purpose: "Fix the flaky test", floor: "asp.floor/v1",
  scopes: ["repo.read", "repo.branch.write"], forbidden_means: ["skipping tests"],
  spend: { cap: 0, unit: "credit" as const, per_action_max: 0 },
  irreversible: { policy: "checkpoint" as const, examples: ["merge"] },
  subcontract: { allowed: false }, nodes: { max_parallel: 4, liability: "to_issuer" as const },
  learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
  overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
});

/** contract -> bond, stopping at Bonded (vector: partial_bonded). */
async function bondOnly(log: EventLog, price: number, bondAmount: number, escrowAmount: number) {
  const contract = cosign(rec("contract", alice, contractBody(price), null, coder.did), coder);
  await log.append(contract);
  const bond = rec("bond", coder, bondBody(contract.id, bondAmount, escrowAmount), contract.id, contract.id);
  const bondResult = await codeOf(log.append(bond));
  return { bondResult, contract, bond };
}

/** contract -> bond -> mandate -> settlement(revoked), the shortest path to Settled (vector: revoked_while_running). */
async function bondAndRevoke(log: EventLog, price: number, bondAmount: number, escrowAmount: number, settled: {
  escrowReleased: number; bondReturned: number; bondSlashed: number; proRata?: number; fees?: number;
}) {
  const { bondResult, contract, bond } = await bondOnly(log, price, bondAmount, escrowAmount);
  if (bondResult) return { bondResult, contract };
  const mandate = rec("mandate", alice, mandateBody(contract.id), bond.id, coder.did);
  await log.append(mandate);
  const settlementBody: Record<string, unknown> = {
    contract: contract.id, basis: "revoked",
    escrow_released: { value: settled.escrowReleased, unit: "credit" },
    bond_returned: { value: settled.bondReturned, unit: "credit" },
    bond_slashed: { value: settled.bondSlashed, unit: "credit" },
    pro_rata_permille: settled.proRata ?? 400,
  };
  if (settled.fees !== undefined) settlementBody.fees = { value: settled.fees, unit: "credit" };
  const settlement = cosign(rec("settlement", bank, settlementBody, mandate.id, contract.id), alice);
  const settlementResult = await codeOf(log.append(settlement));
  return { settlementResult, contract };
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`credit ledger on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("mint bootstraps a balance; balance() reads it back", async () => {
      const log = new EventLog(await h.make());
      assert.equal(await log.balance(alice.did), 0);
      await log.mint(alice.did, 500);
      assert.equal(await log.balance(alice.did), 500);
      await log.mint(alice.did, 250);
      assert.equal(await log.balance(alice.did), 750, "mint accumulates");
    });

    test("a Bond debits the escrow payer and the backer for real, and locks against the contract", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { bondResult, contract } = await bondOnly(log, 1000, 200, 1000);
      assert.equal(bondResult, undefined);
      assert.equal(await log.balance(alice.did), 0, "alice's escrow is locked, not spent");
      assert.equal(await log.balance(coder.did), 0, "coder's bond is locked");
      assert.deepEqual(await log.escrow(contract.id), {
        contract: contract.id, escrowPayer: alice.did, escrowLocked: 1000, backer: coder.did, bondLocked: 200, settled: false,
      });
    });

    test("insufficient balance rejects the Bond and leaves nothing behind", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 999); // one credit short of the 1000 escrow
      await log.mint(coder.did, 200);
      const { bondResult } = await bondAndRevoke(log, 1000, 200, 1000, { escrowReleased: 0, bondReturned: 0, bondSlashed: 0 });
      assert.equal(bondResult, "GUARD_FAILED");
      assert.equal(await log.balance(alice.did), 999, "the failed debit did not happen");
      assert.equal(await log.balance(coder.did), 200);
    });

    test("Settlement distributes exactly what was locked: pro-rata pay, the rest back to the principal, bond returned to the backer", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      await bondAndRevoke(log, 1000, 200, 1000, { escrowReleased: 400, bondReturned: 200, bondSlashed: 0, proRata: 400 });
      assert.equal(await log.balance(coder.did), 400 + 200, "coder is paid pro-rata as performer and gets its bond back as backer");
      assert.equal(await log.balance(alice.did), 600, "the unreleased 600 credits of escrow return to the principal");
    });

    test("a slashed bond compensates the principal, not the backer", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      await bondAndRevoke(log, 1000, 200, 1000, { escrowReleased: 0, bondReturned: 0, bondSlashed: 200, proRata: 0 });
      assert.equal(await log.balance(coder.did), 0, "the backer (also the performer here) gets nothing back");
      assert.equal(await log.balance(alice.did), 1000 + 200, "principal gets its unused escrow back, plus the slashed bond");
    });

    test("Settlement cannot release or slash more than the Bond locked", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { settlementResult } = await bondAndRevoke(log, 1000, 200, 1000, { escrowReleased: 1001, bondReturned: 0, bondSlashed: 0 });
      assert.equal(settlementResult, "GUARD_FAILED");
    });

    test("settlement fees come out of escrow and credit to the local mock platform account", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { settlementResult } = await bondAndRevoke(log, 1000, 200, 1000, { escrowReleased: 400, bondReturned: 200, bondSlashed: 0, fees: 10 });
      assert.equal(settlementResult, undefined);
      assert.equal(await log.balance(coder.did), 400 + 200, "paid 400, bond returned in full");
      assert.equal(await log.balance(PLATFORM_DID), 10);
      assert.equal(await log.balance(alice.did), 1000 - 400 - 10, "the rest of the escrow (590) returns to alice");
    });

    test("fees can't push escrow_released past what was actually locked", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { settlementResult } = await bondAndRevoke(log, 1000, 200, 1000, { escrowReleased: 995, bondReturned: 200, bondSlashed: 0, fees: 10 });
      assert.equal(settlementResult, "GUARD_FAILED");
      assert.equal(await log.balance(PLATFORM_DID), 0, "the failed settlement moved nothing");
    });

    test("zero-value bonds and settlements (single-player mode, MOCKS.md #1-#2) still work with no ledger effect", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const { bondResult, settlementResult } = await bondAndRevoke(log, 0, 0, 0, { escrowReleased: 0, bondReturned: 0, bondSlashed: 0 });
      assert.equal(bondResult, undefined);
      assert.equal(settlementResult, undefined);
    });

    test("verify() and verifyCheckpoint() replay mints, bonds and settlements together without double-counting", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      await bondAndRevoke(log, 1000, 200, 1000, { escrowReleased: 400, bondReturned: 200, bondSlashed: 0, proRata: 400 });
      const report = await log.verify();
      assert.equal(report.ok, true, report.error && JSON.stringify(report.error));

      const head = await log.head();
      const cp = { seq: head.seq, logHash: head.logHash };
      assert.equal(await log.verifyCheckpoint(cp), true);
      assert.equal(await log.verifyCheckpoint({ ...cp, logHash: "sha256:" + "f".repeat(64) }), false);
    });
  });
}
