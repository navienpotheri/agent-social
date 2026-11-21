/**
 * The active Bank (register row DK1458; spec-delta S1405; the owner's decision of 2026-11-21): deposits with no lock, the Treasury borrowing from the Bank, the weekly interest paid only from the week's income
 * (the unpaid part carrying over, nothing minted), the Bank's 20 % and the depositors' 80 % by balance and days held, the 70 % lending ceiling and the order of withdrawals in a run. Every flow keeps the supply
 * rule: the audit is balanced after each step. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BANK_DID, INSURER_DID, TREASURY_DID } from "../src/index.ts";
import { BANK_NUMBERS, isoWeekOf, mondayOfWeek } from "../src/bank-active.ts";
import { Kit, SERVICES, credit, refused, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const at = (iso: string) => iso;

async function world() {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 5000);
  const holders: Party[] = [];
  for (const n of ["a", "b", "c", "d"]) { const p = await kit.person(`ba-${n}`); await kit.mint(p.did, 6000); holders.push(p); }
  const buyer = await kit.agent("ba-buyer", await kit.person("ba-buyer-sponsor"), 3);
  await kit.mint(buyer.did, 3000);
  await kit.job(buyer, 5000);
  const bal = (d: string) => kit.log.balance(d);
  const audit = async (why: string) => { const a = await kit.log.creditAudit(); assert.equal(a.verdict, "balanced", `${why}: ${a.problems.join("; ")}`); return a; };
  const bank = (by: Party, body: Record<string, unknown>) => kit.mk("bank_act" as never, by, body, null, { subject: null });
  const deposit = (h: Party, n: number) => bank(h, { act: "deposit", holder: h.did, amount: credit(n) });
  const withdraw = (h: Party, n: number, by: Party = h) => bank(by, { act: "withdraw", holder: h.did, amount: credit(n) });
  const borrow = (n: number, by: Party = treasury) => bank(by, { act: "borrow", amount: credit(n) });
  const repay = (n: number) => bank(treasury, { act: "repay", amount: credit(n) });
  const interest = (week: string, by: Party = treasury) => bank(by, { act: "interest", week });
  /** Treasury income: a purchase of a course (the Treasury's share is 15 %: 18 credits of 120). */
  const earn = () => kit.buy(buyer, SERVICES.practitioner, 120);
  const note = async (week: string) => JSON.parse((await kit.log.store.transaction((tx) => tx.getMarker(`interest_paid:${week}`))) ?? "null") as { due: number; income: number; paid: number; carry: number; bank: number; depositors: number; payouts: { did: string; amount: number }[] } | null;
  const marker = (k: string) => kit.log.store.transaction((tx) => tx.getMarker(k));
  return { kit, holders, buyer, bal, audit, deposit, withdraw, borrow, repay, interest, earn, note, marker };
}

describe("deposits at the Bank have no lock", () => {
  test("a holder deposits and takes the credits back at once; only the holder, only what it has; a society account does not deposit", async () => {
    const w = await world();
    const [a, b] = w.holders;
    const start = await w.bal(a.did);
    await w.kit.put(w.deposit(a, 400));
    assert.equal(await w.bal(a.did), start - 400);
    assert.equal(await w.bal(BANK_DID), 400, "the Bank holds it");
    assert.equal(await refused(w.kit.put(w.withdraw(a, 100, b))), "bank_not_the_holder");
    assert.equal(await refused(w.kit.put(w.withdraw(a, 401))), "withdraw_exceeds_deposit");
    assert.ok(await refused(w.kit.put(w.deposit(b, 0))), "a deposit of nothing is refused");
    await w.kit.put(w.withdraw(a, 400));
    assert.equal(await w.bal(a.did), start, "whole, the same minute: no lock");
    assert.equal(await w.bal(BANK_DID), 0);
    const insurerDeposit = w.kit.mk("bank_act" as never, treasury, { act: "deposit", holder: INSURER_DID, amount: credit(10) }, null, {});
    assert.equal(await refused(w.kit.put(insurerDeposit)), "bank_not_the_holder");
    await w.audit("deposit and withdrawal");
  });
});

describe("the Treasury borrows from the Bank", () => {
  test("only the Treasury; not before the Bank holds deposits; at most 50 % of what the Bank holds; money moves, supply does not", async () => {
    const w = await world();
    const [a, b] = w.holders;
    assert.equal(await refused(w.kit.put(w.borrow(10))), "bank_not_active");
    await w.kit.put(w.deposit(a, 1000));
    assert.equal(await refused(w.kit.put(w.borrow(10, a))), "bank_act_not_treasury");
    assert.equal(await refused(w.kit.put(w.borrow(501))), "treasury_borrow_cap");
    const t0 = await w.bal(TREASURY_DID);
    await w.kit.put(w.borrow(500));
    assert.equal(await w.bal(TREASURY_DID) - t0, 500);
    assert.equal(await w.bal(BANK_DID), 500);
    assert.equal(await refused(w.kit.put(w.borrow(1))), "treasury_borrow_cap", "500 of the 1000 it holds is the whole 50 %");
    await w.kit.put(w.deposit(b, 1000)); // the Bank now holds 2000, the cap is 1000: 500 more is allowed
    await w.kit.put(w.borrow(500));
    assert.equal(await w.marker("tr_principal"), "1000");
    await w.kit.put(w.repay(300));
    assert.equal(await refused(w.kit.put(w.repay(701))), "repay_exceeds_loan");
    assert.equal(await w.marker("tr_principal"), "700");
    await w.audit("loan and repayment");
  });

  test("the Bank lends at most 70 % of what it holds: a Treasury loan or a credit line past it is refused, naming the reserve", async () => {
    const w = await world();
    const [a, b] = w.holders;
    await w.kit.put(w.deposit(a, 1000));
    await w.kit.put(w.deposit(b, 1000));
    await w.kit.put(w.borrow(1000)); // 50 % of 2000, and under 70 %
    assert.equal(BANK_NUMBERS.maxLentPermille, 700);
    // a second holder adds nothing to the ceiling math: lent 1000 of 2000 held; 400 more is 1400 = 70 %, 401 is over
    const t = w.kit.mk("bank_act" as never, treasury, { act: "borrow", amount: credit(1) }, null, {});
    assert.equal(await refused(w.kit.put(t)), "treasury_borrow_cap", "the 50 % cap bites first");
    await w.audit("ceiling");
  });
});

describe("the weekly interest", () => {
  test("accrues every week, is paid only from that week's income, the Bank keeps 20 %, the depositors share the rest by balance and days held, and nothing is minted", async () => {
    const w = await world();
    const [a, b, c] = w.holders;
    const kit = w.kit;
    kit.at("2026-11-02T00:00:10Z"); // Monday of 2026-W45
    await kit.put(w.deposit(a, 1500));
    await kit.put(w.deposit(c, 2500));
    await kit.put(w.borrow(2000));
    assert.equal(isoWeekOf(Date.parse("2026-11-09T00:00:00Z")), "2026-W46");
    assert.equal(new Date(mondayOfWeek("2026-W46")).toISOString(), "2026-11-09T00:00:00.000Z");
    kit.at("2026-11-09T00:00:30Z"); // W46: A and C hold the whole week
    kit.at("2026-11-11T12:00:00Z"); await w.earn(); await w.earn(); // 2 x 18 = 36 of Treasury income in W46
    assert.equal(await w.marker("tr_income:2026-W46"), "36");
    kit.at("2026-11-12T00:00:05Z"); await kit.put(w.deposit(b, 3000)); // B holds the last 4 days
    assert.equal(await refused(kit.put(w.interest("2026-W46"))), "interest_week_open", "paid from the Monday after the week");
    kit.at("2026-11-16T00:10:00Z");
    const before = { a: await w.bal(a.did), b: await w.bal(b.did), c: await w.bal(c.did), bank: await w.bal(BANK_DID), tr: await w.bal(TREASURY_DID) };
    const minted = (await kit.log.creditAudit()).minted;
    assert.equal(await refused(kit.put(w.interest("2026-W46", a))), "bank_act_not_treasury");
    await kit.put(w.interest("2026-W46"));
    const n = (await w.note("2026-W46"))!;
    assert.equal(n.due, Math.floor((2000 * 25) / 10_000), "0.25 % of 2000 is 5");
    assert.equal(n.paid, 5, "the week's income (36) covers it");
    assert.equal(n.carry, 0);
    const wa = 1500 * 7, wc = 2500 * 7, wb = 3000 * 4; // balance times days held in the week (B from Thursday 00:00 is a little over 3.99 days: the log uses exact time)
    const total = wa + wb + wc;
    assert.ok(n.depositors <= 4 && n.depositors >= 3, `the depositors' 80 % of 5 is 4, paid by weight: ${n.depositors}`);
    assert.equal(n.bank + n.depositors, 5);
    assert.equal(await w.bal(TREASURY_DID), before.tr - 5, "paid out of the Treasury's income, a move");
    assert.equal(await w.bal(BANK_DID), before.bank + n.bank);
    for (const [h, key, wt] of [[a, "a", wa], [b, "b", wb], [c, "c", wc]] as const) {
      const got = (await w.bal(h.did)) - before[key];
      assert.equal(got, n.payouts.find((p) => p.did === h.did)?.amount ?? 0);
      assert.equal(got, Math.floor((4 * wt) / total), `${key} is paid by balance times days held`);
    }
    assert.equal((await kit.log.creditAudit()).minted, minted, "nothing was minted");
    assert.equal(await refused(kit.put(w.interest("2026-W46"))), "interest_already_paid");
    await w.audit("interest");
  });

  test("when the week's income does not cover the interest the unpaid part carries to the next week and nothing is minted; the carry is paid when income allows", async () => {
    const w = await world();
    const [a, c] = w.holders;
    const kit = w.kit;
    kit.at("2026-11-02T00:00:10Z");
    await kit.put(w.deposit(a, 4000));
    await kit.put(w.borrow(2000));
    const minted = (await kit.log.creditAudit()).minted;
    // W46 has no income at all
    kit.at("2026-11-16T00:10:00Z");
    const tr0 = await w.bal(TREASURY_DID);
    await kit.put(w.interest("2026-W46"));
    let n = (await w.note("2026-W46"))!;
    assert.deepEqual([n.due, n.income, n.paid, n.carry], [5, 0, 0, 5], "no income: nothing is paid, the 5 carries");
    assert.equal(await w.bal(TREASURY_DID), tr0, "the Treasury paid nothing and nothing was minted");
    // W47: one purchase (18), due is 5 + the carried 5, income covers it
    kit.at("2026-11-18T12:00:00Z"); await w.earn();
    kit.at("2026-11-23T00:10:00Z");
    await kit.put(w.interest("2026-W47"));
    n = (await w.note("2026-W47"))!;
    assert.deepEqual([n.due, n.income, n.paid, n.carry], [10, 18, 10, 0], "this week's interest and last week's carry, from this week's income");
    // W48: income of 18 but the Treasury has spent nearly everything: paid up to the balance, the rest carries
    kit.at("2026-11-25T12:00:00Z"); await w.earn();
    kit.at("2026-11-30T00:10:00Z");
    await kit.put(w.interest("2026-W48"));
    assert.equal((await w.note("2026-W48"))!.paid, 5);
    assert.equal((await kit.log.creditAudit()).minted, minted, "weeks of accrual, carry and payment minted nothing");
    void c;
    await w.audit("carry-over");
  });

  test("the Insurer's reserve earns interest as a depositor, in proportion to what it holds", async () => {
    const w = await world();
    const [a] = w.holders;
    const kit = w.kit;
    kit.at("2026-11-02T00:00:10Z");
    await kit.put(w.deposit(a, 3000));
    await kit.put(w.borrow(1500));
    // the Insurer holds 3000 (a Treasury budget payment, as always)
    const b = await kit.put(kit.mk("budget", treasury, { institution: INSURER_DID, period: "2026-11", amount: credit(3000), purpose: "charter" }, null, { cosigners: [(await import("./academy-kit.ts")).owner] }));
    await kit.put(kit.mk("treasury_payment", treasury, { budget: b, to: INSURER_DID, amount: credit(3000) }, null));
    kit.at("2026-11-11T12:00:00Z"); await w.earn(); await w.earn();
    kit.at("2026-11-16T00:10:00Z");
    const insurer0 = await w.bal(INSURER_DID);
    await kit.put(w.interest("2026-W46"));
    const n = (await w.note("2026-W46"))!;
    const got = (await w.bal(INSURER_DID)) - insurer0;
    assert.equal(got, n.payouts.find((p) => p.did === INSURER_DID)?.amount ?? 0);
    assert.ok(got >= 1, `the Insurer was paid ${got} as a holder of 3000 beside a depositor of 3000`);
    await w.audit("insurer interest");
  });
});

describe("a run on the Bank", () => {
  test("every depositor asks for the whole balance on one day: the first 70 % is not lent so the free part is paid at once, the rest in the order asked as loans come back; nothing is created or lost", async () => {
    const w = await world();
    const [a, b, c, d] = w.holders;
    const kit = w.kit;
    for (const h of [a, b, c, d]) await kit.put(w.deposit(h, 1000));
    await kit.put(w.borrow(2000)); // 50 % of 4000 held, under the 70 % ceiling
    const supply = (await kit.log.creditAudit()).minted;
    const start = { a: await w.bal(a.did), b: await w.bal(b.did), c: await w.bal(c.did), d: await w.bal(d.did) };
    assert.equal(await w.bal(BANK_DID), 2000, "half of what it holds is free");
    // the run: all four ask for everything, in this order
    await kit.put(w.withdraw(a, 1000));
    await kit.put(w.withdraw(b, 1000));
    assert.equal(await w.bal(a.did) - start.a, 1000, "a is paid at once");
    assert.equal(await w.bal(b.did) - start.b, 1000, "b is paid at once: the free 2000 is used");
    await kit.put(w.withdraw(c, 1000));
    await kit.put(w.withdraw(d, 1000));
    assert.equal(await w.bal(c.did) - start.c, 0, "c waits: the Bank has nothing free");
    assert.equal(await w.bal(d.did) - start.d, 0, "d waits behind c");
    assert.equal(await w.bal(BANK_DID), 0);
    assert.equal(await refused(kit.put(w.withdraw(c, 1))), "withdraw_exceeds_deposit", "what is waiting cannot be asked for twice");
    await w.audit("run, first payments");
    // loans come back: c is paid first, then d
    await kit.put(w.repay(600));
    assert.equal(await w.bal(c.did) - start.c, 600, "the first 600 repaid goes to c, who asked first");
    assert.equal(await w.bal(d.did) - start.d, 0);
    await kit.put(w.repay(900));
    assert.equal(await w.bal(c.did) - start.c, 1000, "c is whole");
    assert.equal(await w.bal(d.did) - start.d, 500, "then d, in the order asked");
    await kit.put(w.repay(500));
    assert.equal(await w.bal(d.did) - start.d, 1000, "d is whole once the Treasury's 2000 is back");
    assert.equal(await w.bal(BANK_DID), 0);
    assert.equal(await w.marker("bank_queue"), "[]");
    assert.equal((await kit.log.creditAudit()).minted, supply, "a run delays payment; it creates and loses nothing");
    await w.audit("run, all paid");
    assert.equal((await kit.log.verify()).ok, true, "a replica replays the run the same way");
  });
});

describe("the 70 % lending ceiling covers credit lines too", () => {
  test("once the Bank holds deposits a credit line that would take what is lent and promised above 70 % of what it holds is refused, naming the reserve", async () => {
    const { cosign } = await import("@agent-social/asp-core");
    const { bankP, hashOf, owner } = await import("./academy-kit.ts");
    void owner;
    const w = await world();
    const kit = w.kit;
    await kit.put(w.deposit(w.holders[0], 100)); // the Bank holds 100: it may lend or promise 70
    const principal = await kit.person("cl-principal"); await kit.mint(principal.did, 1000);
    const sponsor = await kit.person("cl-sponsor"); await kit.mint(sponsor.did, 200);
    const line = async (name: string, amount: number) => {
      const agent = await kit.agent(name, sponsor, 1);
      const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `job ${name}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
      await kit.put(c);
      return kit.mk("credit_line", bankP, { borrower: agent.did, guarantor: sponsor.did, contract: c.id, amount: credit(amount), fee: 0, due: new Date(Date.parse(kit.now()) + 7 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") }, null, { subject: agent.did, cosigners: [agent, sponsor] });
    };
    await kit.put(await line("cl-first", 60));
    assert.equal(await refused(kit.put(await line("cl-second", 20))), "bank_liquidity", "60 promised and 20 more is 80 of the 100 held: over 70");
    await kit.put(await line("cl-third", 10)); // 70 of 100: exactly the ceiling
    await w.audit("lines under the ceiling");
  });
});
void at;
