// Register row DK232 (spec-delta S1652; treasury.md TRL-18 and TRL-19): the Treasury's monthly statement carries its opening, income and spending, and the log refuses one whose arithmetic does not close or whose
// figures are not the sums the log itself kept; over seeded random logs the statement built from the log's own flows (`treasuryStatement`) is accepted at every month end; and a budget that would leave the uncommitted
// Treasury below one month of approved budgets is refused from the cutover. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TREASURY_DID, institutionDid } from "../src/index.ts";
import { credit, kit, mk, operator, owner, refusedBy, treasury } from "./society-kit.ts";

const HASH = "sha256:" + "7".repeat(64);
const stmt = (period: string, opening: number, income: number, spending: number, closing: number, extra: Record<string, unknown> = {}) =>
  mk("treasury_statement", treasury, { period, balance: credit(closing), reconciles: true, unexplained: 0, statement_sha256: HASH, opening: credit(opening), income: credit(income), spending: credit(spending), ...extra }, null, { subject: null });
const issue = (k: Awaited<ReturnType<typeof kit>>, v: number) => k.log.append(mk("mint", operator, { to: TREASURY_DID, amount: credit(v), reason: "treasury_issuance", authority: "operator" }, null, { subject: TREASURY_DID, cosigners: [owner] }));

test("DK232: a statement with figures is accepted when the arithmetic closes and the figures are the log's own sums; one credit off in any figure is refused, and the next opens at the last close", async () => {
  const k = await kit();
  await k.withPrices();
  await issue(k, 1000);
  assert.equal(await k.log.balance(TREASURY_DID), 1000);
  // From the start of the log: opening 0, income 1000, spending 0, closing 1000.
  assert.equal(await refusedBy(k.log.append(stmt("2026-11", 0, 1000, 0, 1001))), "treasury_statement_balance_mismatch", "a closing the ledger does not hold");
  assert.equal(await refusedBy(k.log.append(stmt("2026-11", 0, 999, 0, 1000))), "treasury_statement_arithmetic", "opening + income - spending is not the closing");
  assert.equal(await refusedBy(k.log.append(stmt("2026-11", 1, 999, 0, 1000))), "treasury_statement_income", "the arithmetic closes but the income is one off the log's sum");
  const noIncome = mk("treasury_statement", treasury, { period: "2026-11", balance: credit(1000), reconciles: true, unexplained: 0, statement_sha256: HASH, opening: credit(0), spending: credit(0) }, null, { subject: null });
  assert.equal(await refusedBy(k.log.append(noIncome)), "treasury_statement_incomplete", "figures come together");
  await k.log.append(stmt("2026-11", 0, 1000, 0, 1000));
  // Credits move: 200 more in and 150 out (a budget payment).
  await issue(k, 200);
  const budget = await k.log.append(mk("budget", treasury, { institution: institutionDid("registry"), period: "2026-11", amount: credit(300), purpose: "the registry's month" }, null, { subject: null, cosigners: [owner] }));
  await k.log.append(mk("treasury_payment", treasury, { budget: budget.id, to: institutionDid("registry"), amount: credit(150) }, null, { subject: null }));
  assert.equal(await k.log.balance(TREASURY_DID), 1050);
  assert.equal(await refusedBy(k.log.append(stmt("2026-12", 999, 200, 149, 1050))), "treasury_statement_opening", "the opening is the last close");
  assert.equal(await refusedBy(k.log.append(stmt("2026-12", 1000, 201, 151, 1050))), "treasury_statement_income", "income one over and spending one over: the arithmetic closes, the sums do not");
  assert.equal(await refusedBy(k.log.append(stmt("2026-12", 1000, 199, 149, 1050))), "treasury_statement_income", "income one under");
  assert.equal(await refusedBy(k.log.append(stmt("2026-12", 1001, 200, 151, 1050))), "treasury_statement_opening", "an opening that is not the close, even when the arithmetic holds");
  assert.equal(await refusedBy(k.log.append(stmt("2026-12", 1000, 200, 150, 1050, { spending: credit(150), income: credit(200) }))) === undefined, true, "the exact figures are accepted");
  assert.equal((await k.log.creditAudit()).verdict, "balanced", "a statement moves no credit");
  assert.equal((await k.log.verify()).ok, true, "the replay rebuilds the running totals and accepts both statements");
});

test("DK232: a spending figure that is one off is refused when income is right", async () => {
  const k = await kit();
  await issue(k, 500);
  const budget = await k.log.append(mk("budget", treasury, { institution: institutionDid("courts"), period: "2026-11", amount: credit(100), purpose: "courts" }, null, { subject: null, cosigners: [owner] }));
  await k.log.append(mk("treasury_payment", treasury, { budget: budget.id, to: institutionDid("courts"), amount: credit(40) }, null, { subject: null }));
  // income 500, spending 40, closing 460: a statement that says spending 39 with opening 1 closes arithmetically (1 + 500 - 39 = 462 is not 460), so use opening -1 style: spending 41 and opening 2 -> 2+500-41 = 461 no.
  // The way to be exactly one off in spending alone is to also be one off in opening or income; each is refused by its own rule.
  assert.equal(await refusedBy(k.log.append(stmt("2026-11", 1, 500, 41, 460))), "treasury_statement_spending", "income is right, spending is one over");
  assert.equal(await refusedBy(k.log.append(stmt("2026-11", 2, 500, 42, 460))), "treasury_statement_spending", "two over");
  assert.equal(await refusedBy(k.log.append(stmt("2026-11", 0, 499, 39, 460))), "treasury_statement_income", "income one under");
  await k.log.append(stmt("2026-11", 0, 500, 40, 460));
});

test("DK232: over seeded random logs the statement built from the log's own flows is accepted at every month end", async () => {
  for (const seed of [11, 202611, 77]) {
    let a = seed >>> 0;
    const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const k = await kit();
    await k.withPrices();
    const buyers = [await k.person(`sf-a-${seed}`, 500), await k.person(`sf-b-${seed}`, 500)];
    let lastClose = 0, lastIn = 0, lastOut = 0, months = 0, budgetNo = 0;
    for (let step = 0; step < 36; step++) {
      const op = pick(["issue", "buy", "buy", "pay", "none"]);
      if (op === "issue") await issue(k, 1 + Math.floor(rnd() * 90));
      else if (op === "buy") { const svc = pick([["registry.name.claim", 10], ["registry.name.renew", 5], ["clinic.checkup", 10]] as [string, number][]); await k.buy(pick(buyers), svc[0], svc[1]); }
      else if (op === "pay") {
        const bal = await k.log.balance(TREASURY_DID);
        if (bal >= 40) {
          const period = `2026-1${(budgetNo % 2) + 1}`;
          const inst = pick(["registry", "courts", "clinic"]);
          try {
            const b = await k.log.append(mk("budget", treasury, { institution: institutionDid(inst), period, amount: credit(20 + budgetNo), purpose: `line ${++budgetNo}` }, null, { subject: null, cosigners: [owner] }));
            await k.log.append(mk("treasury_payment", treasury, { budget: b.id, to: institutionDid(inst), amount: credit(5 + Math.floor(rnd() * 10)) }, null, { subject: null }));
          } catch { /* a refusal is allowed; it leaves nothing behind */ }
        }
      }
      if (step % 9 === 8) {
        const st = await k.log.treasuryStatement();
        const inNow = st.treasury.in.issuance + st.treasury.in.jobTax + st.treasury.in.purchaseShare + st.treasury.in.returns, outNow = st.treasury.out.budgetPayments + st.treasury.out.allowances;
        const closing = await k.log.balance(TREASURY_DID);
        months++;
        await k.log.append(stmt(`2027-${String(months).padStart(2, "0")}`, lastClose, inNow - lastIn, outNow - lastOut, closing));
        lastClose = closing; lastIn = inNow; lastOut = outNow;
      }
    }
    assert.ok(months >= 3);
    assert.equal((await k.log.verify()).ok, true, `seed ${seed}: the replay accepts every statement`);
    assert.equal((await k.log.creditAudit()).verdict, "balanced");
  }
});

test("DK232 (TRL-19): from the cutover a budget that would leave the uncommitted Treasury below one month of approved budgets is refused; before the cutover, and for the first month, it is not", async () => {
  const k = await kit({ treasuryReserveFloorFrom: "2026-11-01T00:00:00Z" });
  await issue(k, 500);
  const budget = (kk: typeof k, inst: string, period: string, amount: number) => kk.log.append(mk("budget", treasury, { institution: institutionDid(inst), period, amount: credit(amount), purpose: `${inst} ${period}` }, null, { subject: null, cosigners: [owner] }));
  await budget(k, "registry", "2026-11", 200);              // the first month: no earlier month, no floor
  await budget(k, "courts", "2026-11", 100);                // a month of budgets: 300 in all
  // December: the reserve after must be at least November's 300. 500 held, 300 open, so a budget of 100 leaves 100.
  assert.equal(await refusedBy(budget(k, "registry", "2026-12", 100)), "budget_reserve_floor");
  await issue(k, 400);
  // 900 held, 300 open: a budget of 300 leaves 300, exactly the floor, and is allowed; one more credit is not.
  assert.equal(await refusedBy(budget(k, "registry", "2026-12", 301)), "budget_reserve_floor", "one credit under the floor");
  await budget(k, "registry", "2026-12", 300);
  // Without the cutover the same sequence is not refused.
  const free = await kit();
  await issue(free, 500);
  await budget(free, "registry", "2026-11", 300);
  await budget(free, "registry", "2026-12", 200);
});
