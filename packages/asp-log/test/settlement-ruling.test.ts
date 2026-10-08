import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { b64urlEncode, cosign, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { alice, at, bank, codeOf, coder, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

const contractBody = (price: number) => ({
  principal: alice.did, performer: coder.did, bank: bank.did,
  purpose: "Fix the flaky test", price: { value: price, unit: "credit" as const },
  verification: "deterministic" as const, deadline: "2026-10-03T18:00:00Z",
  basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
});

/** contract -> bond -> mandate -> delivery -> reject, opening a dispute with a real price. */
async function disputed(log: EventLog, price: number, bond: number) {
  const contract = cosign(rec("contract", alice, contractBody(price), null, coder.did), coder);
  await log.append(contract);
  const bondRec = rec("bond", coder, {
    contract: contract.id, backer: coder.did, amount: { value: bond, unit: "credit" as const },
    escrow: { payer: alice.did, amount: { value: price, unit: "credit" as const } },
    slashing_conditions: ["lost_dispute" as const],
  }, contract.id, contract.id);
  await log.append(bondRec);
  const mandate = rec("mandate", alice, {
    contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1",
    scopes: ["repo.read"], forbidden_means: [],
    spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const },
    subcontract: { allowed: false }, nodes: { max_parallel: 1 },
    learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
    overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
  }, bondRec.id, coder.did);
  await log.append(mandate);
  const delivery = rec("delivery", coder, {
    contract: contract.id, result: { summary: "First attempt", artifacts: [] },
    evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] },
  }, mandate.id, contract.id);
  await log.append(delivery);
  const reject = rec("attestation", alice, { kind: "acceptance", about: delivery.id, verdict: "rejected", reasons: ["not good enough"] }, delivery.id, contract.id);
  await log.append(reject);
  return { contract, reject, escrowLocked: price, bondLocked: bond };
}

async function rule(log: EventLog, contractId: string, prev: string, verdict: string, fault: Record<string, number>) {
  const record = rec("attestation", bank, { kind: "ruling", about: contractId, verdict, fault }, prev, contractId);
  return { record, result: await codeOf(log.append(record)) };
}

async function settle(log: EventLog, contractId: string, prev: string, citesId: string, escrowReleased: number, bondReturned: number, bondSlashed: number) {
  let record = rec("settlement", bank, {
    contract: contractId, basis: "ruling", cites: citesId,
    escrow_released: { value: escrowReleased, unit: "credit" }, bond_returned: { value: bondReturned, unit: "credit" },
    bond_slashed: { value: bondSlashed, unit: "credit" },
  }, prev, contractId);
  record = cosign(record, alice);
  return codeOf(log.append(record));
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`settlement-ruling consistency on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("a ruling by drawn jurors pays them a panel fee (5% of the price), the loser's side bearing it", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      // Jurors exist at Bond time, so each side also locks half the 50-credit fee (25) as a reserve.
      await log.mint(alice.did, 1000 + 25);
      await log.mint(coder.did, 200 + 25);
      const jurors = ["a", "b", "c"].map((n) => {
        const did = `did:web:example.com:users:fee-juror-${n}`;
        return { did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(randomBytes(32))) } as { did: string; publicKey: Uint8Array } & Signer;
      });
      for (const j of jurors) {
        await log.append(rec("passport", j, { did: j.did, kind: "human", keys: [{ id: j.kid, type: "Ed25519", public_key: b64urlEncode(j.publicKey) }] }, null, j.did));
        await log.mint(j.did, 500);
        await log.append(rec("juror", j, { did: j.did, stake: { value: 100, unit: "credit" } }, null));
      }
      const { contract, reject } = await disputed(log, 1000, 200);
      assert.equal((await log.drawPanel(contract.id)).length, 3);
      // Two of the three drawn jurors sign; the performer carries all the fault.
      const ruling = cosign(rec("attestation", jurors[0], { kind: "ruling", about: contract.id, verdict: "for_principal", fault: { [coder.did]: 1000 } }, reject.id, contract.id), jurors[1]);
      assert.equal(await codeOf(log.append(ruling)), undefined);
      assert.equal(await settle(log, contract.id, ruling.id, ruling.id, 0, 0, 200), undefined);
      // Fee 50 (5% of 1000): the performer's side pays it, its 25 reserve first, then 25 of the slashed 200.
      assert.equal(await log.balance(alice.did), 1000 + 175 + 25, "escrow back, the slashed bond less 25, and her own untouched reserve");
      assert.equal(await log.balance(coder.did), 0);
      assert.equal(await log.balance(jurors[0].did), 400 + 25);
      assert.equal(await log.balance(jurors[1].did), 400 + 25);
      assert.equal(await log.balance(jurors[2].did), 400, "a drawn juror who did not sign earns nothing");
    });

    test("a loser with nothing left over still pays: the fee reserve covers it (principal loses after the whole price was released)", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000 + 25);
      await log.mint(coder.did, 200 + 25);
      const jurors = ["d", "e", "f"].map((n) => {
        const did = `did:web:example.com:users:fee-juror-${n}`;
        return { did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(randomBytes(32))) } as { did: string; publicKey: Uint8Array } & Signer;
      });
      for (const j of jurors) {
        await log.append(rec("passport", j, { did: j.did, kind: "human", keys: [{ id: j.kid, type: "Ed25519", public_key: b64urlEncode(j.publicKey) }] }, null, j.did));
        await log.mint(j.did, 500);
        await log.append(rec("juror", j, { did: j.did, stake: { value: 100, unit: "credit" } }, null));
      }
      const { contract, reject } = await disputed(log, 1000, 200);
      const ruling = cosign(rec("attestation", jurors[0], { kind: "ruling", about: contract.id, verdict: "for_performer", fault: { [alice.did]: 1000 } }, reject.id, contract.id), jurors[1]);
      assert.equal(await codeOf(log.append(ruling)), undefined);
      assert.equal(await settle(log, contract.id, ruling.id, ruling.id, 1000, 200, 0), undefined);
      // The principal lost and has no escrow left: it pays its 25 reserve; the performer's reserve covers the other 25.
      assert.equal(await log.balance(alice.did), 0);
      assert.equal(await log.balance(coder.did), 1000 + 200, "paid in full and the bond back, minus nothing: its reserve went to the panel");
      assert.equal(await log.balance(jurors[0].did) + await log.balance(jurors[1].did) + await log.balance(jurors[2].did), 3 * 400 + 50);
    });

    test("a settlement matching the ruling's fault exactly succeeds", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { contract, reject } = await disputed(log, 1000, 200);
      const { record: ruling, result } = await rule(log, contract.id, reject.id, "split", { [coder.did]: 400, [alice.did]: 600 });
      assert.equal(result, undefined);
      // 400 permille performer fault: released = floor(1000*600/1000)=600, slashed = ceil(200*400/1000)=80.
      const settled = await settle(log, contract.id, ruling.id, ruling.id, 600, 120, 80);
      assert.equal(settled, undefined);
      assert.equal(await log.balance(coder.did), 600 + 120, "paid 600, bond partly returned (120 of 200)");
      assert.equal(await log.balance(alice.did), 400 + 80, "unreleased escrow (400) plus the slashed bond (80)");
    });

    test("a settlement understating the performer's fault (too generous) is refused", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { contract, reject } = await disputed(log, 1000, 200);
      const { record: ruling } = await rule(log, contract.id, reject.id, "for_principal", { [coder.did]: 1000 });
      // Full fault on the performer requires escrow_released=0, bond_slashed=200 — this tries to pay in full instead.
      const settled = await settle(log, contract.id, ruling.id, ruling.id, 1000, 200, 0);
      assert.equal(settled, "GUARD_FAILED");
      assert.equal(await log.balance(coder.did), 0, "nothing moved: the mismatched settlement never landed");
    });

    test("a settlement over-slashing beyond what the ruling justifies is also refused", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { contract, reject } = await disputed(log, 1000, 200);
      const { record: ruling } = await rule(log, contract.id, reject.id, "for_performer", { [coder.did]: 0 });
      // Zero fault on the performer requires the full release and no slash — this slashes anyway.
      const settled = await settle(log, contract.id, ruling.id, ruling.id, 1000, 0, 200);
      assert.equal(settled, "GUARD_FAILED");
    });

    test("full fault on the performer requires zero release and the whole bond slashed", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { contract, reject } = await disputed(log, 1000, 200);
      const { record: ruling } = await rule(log, contract.id, reject.id, "for_principal", { [coder.did]: 1000 });
      const settled = await settle(log, contract.id, ruling.id, ruling.id, 0, 0, 200);
      assert.equal(settled, undefined);
      assert.equal(await log.balance(coder.did), 0);
      assert.equal(await log.balance(alice.did), 1000 + 200);
    });

    test("verify() replays a ruling-consistent settlement without breaking", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await log.mint(alice.did, 1000);
      await log.mint(coder.did, 200);
      const { contract, reject } = await disputed(log, 1000, 200);
      const { record: ruling } = await rule(log, contract.id, reject.id, "split", { [coder.did]: 250, [alice.did]: 750 });
      await settle(log, contract.id, ruling.id, ruling.id, 750, 150, 50);
      const report = await log.verify();
      assert.equal(report.ok, true, report.error && JSON.stringify(report.error));
    });
  });
}
