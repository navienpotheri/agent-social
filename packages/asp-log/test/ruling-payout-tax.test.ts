/**
 * A ruling that finds no fault in the performer can settle under the job tax (spec-delta S1401; register row DK1450).
 * Before it, the performer's share was the whole escrow and the tax on top made every such settlement refused (`over_release` or `fees_not_job_tax`), so the contract stayed Disputed for ever.
 * Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rulingPayout } from "../src/courts.ts";
import { credit, kit, mk, refusedBy, tick } from "./society-kit.ts";
import { bank } from "./harness.ts";

describe("rulingPayout, the amounts a ruling's settlement states", () => {
  test("with no price list in force the performer's share is the escrow times its non-fault, as before", () => {
    assert.deepEqual(rulingPayout(81, 10, 0, null), { released: 81, slashed: 0 });
    assert.deepEqual(rulingPayout(81, 10, 1000, null), { released: 0, slashed: 10 });
    assert.deepEqual(rulingPayout(100, 7, 500, null), { released: 50, slashed: 4 });
  });

  test("a share that leaves room for the tax is unchanged, so every settlement an older log accepted replays the same", () => {
    for (let locked = 0; locked <= 400; locked++) {
      for (const fault of [0, 100, 250, 500, 750, 999, 1000]) {
        const share = Math.floor((locked * (1000 - fault)) / 1000);
        if (share + Math.floor((share * 20) / 1000) <= locked) assert.equal(rulingPayout(locked, 0, fault, 20).released, share, `${locked} at ${fault}`);
      }
    }
  });

  test("the amount released and its tax always fit the escrow, and it is the largest amount that does", () => {
    for (let locked = 0; locked <= 600; locked++) {
      for (const rate of [0, 5, 20, 50, 100]) {
        const { released } = rulingPayout(locked, 0, 0, rate);
        assert.ok(released + Math.floor((released * rate) / 1000) <= locked, `${locked} at ${rate}: ${released}`);
        const more = released + 1;
        assert.ok(more > locked || more + Math.floor((more * rate) / 1000) > locked, `${locked} at ${rate}: ${released} is not the largest`);
      }
    }
    assert.deepEqual(rulingPayout(81, 0, 0, 20), { released: 80, slashed: 0 }, "an 80-credit job with its 1-credit tax: the performer is paid the price");
  });
});

describe("a ruling for the performer settles under the job tax", () => {
  test("the log accepts the stated amounts and refuses the whole escrow plus the tax; the performer is paid the price", async () => {
    const k = await kit();
    await k.withPrices();
    const principal = await k.person("claimant", 20_000);
    const sponsor = await k.person("agent-sponsor", 50);
    const performer = await k.agent("performer", sponsor, { funds: 2000 });
    const job = await k.runJob(principal, performer, 80, undefined, { settle: false });
    const rej = mk("attestation", principal, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["not good enough"] }, job.delivery, { subject: job.contract });
    await k.log.append(rej);
    const neutral = await k.person("neutral", 10); // no juror is registered: any neutral identity may rule
    const ruling = mk("attestation", neutral, { kind: "ruling", about: job.contract, verdict: "for_performer", fault: { [principal.did]: 1000 }, reasons: ["the work met the criteria"] }, rej.id, { subject: job.contract });
    await k.log.append(ruling);
    const settle = (released: number, fees: number) => mk("settlement", bank, { contract: job.contract, basis: "ruling", cites: ruling.id, escrow_released: credit(released), fees: credit(fees), bond_returned: credit(0), bond_slashed: credit(0) }, ruling.id, { subject: job.contract, at: tick() });
    assert.equal(await refusedBy(k.log.append(settle(81, 1))), "over_release");
    assert.equal(await refusedBy(k.log.append(settle(81, 0))), "fees_not_job_tax");
    assert.equal(await refusedBy(k.log.append(settle(79, 1))), "settlement_mismatches_ruling", "less than the largest amount is not what the ruling says either");
    const stated = await k.log.rulingSettlement(job.contract, ruling.id, tick());
    assert.deepEqual(stated, { escrow_released: 80, fees: 1, bond_slashed: 0 });
    const before = await k.log.balance(performer.did);
    await k.log.append(settle(stated!.escrow_released, stated!.fees));
    assert.equal(await k.log.balance(performer.did) - before, 80, "the performer is paid the price");
    assert.equal((await k.log.creditAudit()).verdict, "balanced");
    assert.equal((await k.log.verify()).ok, true);
  });
});

describe("a lost dispute reaches the poster's record through a real ruling (DK492)", () => {
  test("three accepted jobs and one dispute the poster lost to a ruling for the performer: the record shows 1 of 4 lost and the deposit multiplier rises to 2", async () => {
    const k = await kit();
    await k.withPrices();
    const poster = await k.person("lost-poster", 20_000);
    const sponsor = await k.person("lost-sponsor", 50);
    const performer = await k.agent("lost-performer", sponsor, { funds: 2000 });
    for (let i = 0; i < 3; i++) await k.runJob(poster, performer, 60);
    assert.equal((await k.log.posterRecord(poster.did)).disputesLost, 0);
    const job = await k.runJob(poster, performer, 80, undefined, { settle: false });
    const rej = mk("attestation", poster, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["not good enough"] }, job.delivery, { subject: job.contract });
    await k.log.append(rej);
    const neutral = await k.person("lost-neutral", 10);
    const ruling = mk("attestation", neutral, { kind: "ruling", about: job.contract, verdict: "for_performer", fault: { [poster.did]: 1000 }, reasons: ["the work met the criteria"] }, rej.id, { subject: job.contract });
    await k.log.append(ruling);
    const stated = (await k.log.rulingSettlement(job.contract, ruling.id, tick()))!;
    await k.log.append(mk("settlement", bank, { contract: job.contract, basis: "ruling", cites: ruling.id, escrow_released: credit(stated.escrow_released), fees: credit(stated.fees), bond_returned: credit(0), bond_slashed: credit(0) }, ruling.id, { subject: job.contract, at: tick() }));
    const rec = await k.log.posterRecord(poster.did);
    assert.equal(rec.disputesLost, 1, "the ruling for the performer reached the poster's record");
    assert.equal(rec.settled, 4);
    assert.equal(rec.depositMultiplier, 2, "1 plus the rounded 3 x 1/4");
    assert.equal((await k.log.creditAudit()).verdict, "balanced");
    assert.equal((await k.log.verify()).ok, true, "a replica derives the same record");
  });
});
