import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { b64urlEncode, cosign, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { alice, bank, coder, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

type Who = { did: string; publicKey: Uint8Array } & Signer;
const fresh = (name: string): Who => {
  const did = `did:web:example.com:users:${name}`;
  return { did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(randomBytes(32))) } as Who;
};
const passportOf = (log: EventLog, p: Who, extra: Record<string, unknown> = {}) =>
  log.append(rec("passport", p, { did: p.did, kind: "human", keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }], ...extra }, null, p.did));

const contractBody = (price: number) => ({
  principal: alice.did, performer: coder.did, bank: bank.did, purpose: "Fix the flaky test",
  price: { value: price, unit: "credit" as const }, verification: "deterministic" as const, deadline: "2026-10-03T18:00:00Z",
  basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
});

/** contract -> bond (-> mandate, so Running). Funds are minted first. */
async function job(log: EventLog, price: number, bond: number, opts: { running?: boolean } = {}) {
  await log.mint(alice.did, price);
  await log.mint(coder.did, bond);
  const contract = cosign(rec("contract", alice, contractBody(price), null, coder.did), coder);
  await log.append(contract);
  const bondRec = rec("bond", coder, {
    contract: contract.id, backer: coder.did, amount: { value: bond, unit: "credit" as const },
    escrow: { payer: alice.did, amount: { value: price, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const],
  }, contract.id, contract.id);
  await log.append(bondRec);
  if (opts.running !== false) {
    await log.append(rec("mandate", alice, {
      contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [],
      spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const }, subcontract: { allowed: false },
      nodes: { max_parallel: 1 }, learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
      overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
    }, bondRec.id, coder.did));
  }
  return contract;
}

async function jurors(log: EventLog, names: string[]) {
  const list = names.map(fresh);
  for (const j of list) {
    await passportOf(log, j);
    await log.mint(j.did, 500);
    await log.append(rec("juror", j, { did: j.did, stake: { value: 100, unit: "credit" } }, null));
  }
  return list; // each has 400 credits free after staking
}

const reportOf = (by: Who, contractId: string) => rec("attestation", by, { kind: "report", about: contractId, reasons: ["the agent is sending data to an outside host"] }, null, contractId);
const rulingOf = (by: Who, others: Who[], reportId: string, contractId: string, verdict: "upheld" | "dismissed") => {
  let r = rec("attestation", by, { kind: "report_ruling", about: reportId, verdict }, null, contractId);
  for (const o of others) r = cosign(r, o);
  return r;
};
const settleRevoked = (log: EventLog, contractId: string, prev: string, released: number, returned: number, slashed: number) =>
  log.append(cosign(rec("settlement", bank, {
    contract: contractId, basis: "revoked", escrow_released: { value: released, unit: "credit" },
    bond_returned: { value: returned, unit: "credit" }, bond_slashed: { value: slashed, unit: "credit" }, pro_rata_permille: 0,
  }, prev, contractId), alice));

for (const h of [memory, postgres] as Harness[]) {
  describe(`whistleblower reports on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("an upheld report returns the deposit, pays the jurors and the reporter from the accused's bond, and forces full fault", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await job(log, 1000, 200);
      const [j1, j2] = await jurors(log, ["rj-a", "rj-b", "rj-c"]);
      const reporter = fresh("reporter");
      await passportOf(log, reporter);
      await log.mint(reporter.did, 100);

      const report = reportOf(reporter, contract.id);
      await log.append(report);
      assert.equal(await log.balance(reporter.did), 50, "the 50-credit deposit (5% of 1000) is locked");

      await log.append(rulingOf(j1, [j2], report.id, contract.id, "upheld"));
      // Deposit back (50), then 20% of the bond left after the 50 fee (150 -> 30) to the reporter.
      assert.equal(await log.balance(reporter.did), 50 + 50 + 30);
      assert.equal(await log.balance(j1.did), 400 + 25);
      assert.equal(await log.balance(j2.did), 400 + 25);
      assert.equal((await log.escrow(contract.id))!.bondLocked, 120, "200 less the fee (50) and the reward (30)");

      // The bank cannot settle gently once a report is upheld.
      const head = (await log.chain(contract.id)).at(-1)!.id;
      await assert.rejects(settleRevoked(log, contract.id, head, 0, 120, 0), /upheld report requires a full-fault settlement/);
      await settleRevoked(log, contract.id, head, 0, 0, 120);
      assert.equal(await log.balance(alice.did), 1000 + 120, "escrow back plus the rest of the slashed bond");
      assert.equal(await log.balance(coder.did), 0);
    });

    test("a dismissed report costs the reporter the deposit, which pays the jurors; the job goes on normally", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await job(log, 1000, 200);
      const [j1, j2] = await jurors(log, ["rj-d", "rj-e", "rj-f"]);
      const reporter = fresh("reporter-2");
      await passportOf(log, reporter);
      await log.mint(reporter.did, 100);
      const report = reportOf(reporter, contract.id);
      await log.append(report);
      await log.append(rulingOf(j1, [j2], report.id, contract.id, "dismissed"));
      assert.equal(await log.balance(reporter.did), 50, "the deposit is gone");
      assert.equal(await log.balance(j1.did) + await log.balance(j2.did), 800 + 50);
      assert.equal((await log.escrow(contract.id))!.bondLocked, 200, "the accused's bond is untouched");
      const head = (await log.chain(contract.id)).at(-1)!.id;
      await settleRevoked(log, contract.id, head, 500, 200, 0); // a gentle settlement is still allowed
    });

    test("who may report, and when", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const notRunning = await job(log, 1000, 200, { running: false });
      const reporter = fresh("reporter-3");
      await passportOf(log, reporter);
      await log.mint(reporter.did, 100);
      await assert.rejects(log.append(reportOf(reporter, notRunning.id)), /is not running/);

      const contract = await job(log, 1000, 200);
      await assert.rejects(log.append(reportOf(alice, contract.id)), /party to the contract/, "the principal rejects or revokes instead");
      const sponsored = fresh("sponsored-by-alice");
      await passportOf(log, sponsored, { sponsor: alice.did });
      await assert.rejects(log.append(reportOf(sponsored, contract.id)), /party to the contract/, "nor can someone the principal sponsors");
      const broke = fresh("broke");
      await passportOf(log, broke);
      await assert.rejects(log.append(reportOf(broke, contract.id)), /needs 50|insufficient/i, "a reporter must be able to cover the deposit");
      const stranger = fresh("no-passport");
      await assert.rejects(log.append(reportOf(stranger, contract.id)));

      await log.append(reportOf(reporter, contract.id));
      const second = fresh("reporter-4");
      await passportOf(log, second);
      await log.mint(second.did, 100);
      await assert.rejects(log.append(reportOf(second, contract.id)), /already has an open report/);
    });

    test("a ruling needs a drawn panel, a quorum of it, and happens once", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await job(log, 1000, 200);
      const reporter = fresh("reporter-5");
      await passportOf(log, reporter);
      await log.mint(reporter.did, 100);
      const report = reportOf(reporter, contract.id);
      await log.append(report);

      const [j1, j2, j3] = await jurors(log, ["rj-g", "rj-h", "rj-i"]);
      await assert.rejects(log.append(rulingOf(j1, [], report.id, contract.id, "upheld")), /needs 2 of the drawn panel/);
      const outsider = fresh("outsider");
      await passportOf(log, outsider);
      await assert.rejects(log.append(rulingOf(outsider, [j1], report.id, contract.id, "upheld")), /needs 2 of the drawn panel/, "an outsider's signature does not count");
      await log.append(rulingOf(j3, [j2], report.id, contract.id, "dismissed"));
      await assert.rejects(log.append(rulingOf(j1, [j2], report.id, contract.id, "upheld")), /already dismissed/);
    });

    test("with no juror registered, a report cannot be ruled on", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await job(log, 1000, 200);
      const reporter = fresh("reporter-6");
      await passportOf(log, reporter);
      await log.mint(reporter.did, 100);
      const report = reportOf(reporter, contract.id);
      await log.append(report);
      const j = fresh("late-juror");
      await passportOf(log, j);
      await assert.rejects(log.append(rulingOf(j, [], report.id, contract.id, "upheld")), /no staked, conflict-free juror/);
    });
  });
}
