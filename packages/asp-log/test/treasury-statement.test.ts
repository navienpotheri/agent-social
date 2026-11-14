// The Treasury's published statement (register rows DK14, DK15; spec-delta S451): a settled job moves the job tax to the Treasury, a purchase gives it its share, a service payment goes out of it by a
// budget, the statement reconciles to the ledger with nothing unexplained, and every institution has a line showing its budget, what it was paid and what it earned. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTITUTION_DIDS, TREASURY_DID, institutionDid } from "../src/index.ts";
import { Kit, SERVICES, credit, operator, owner, treasury } from "./academy-kit.ts";

test("DK14 and DK15: the job tax and the purchase share come in, a budget payment goes out, the statement reconciles and shows each institution's budget, payments and earnings", async () => {
  const kit = new Kit();
  const academy = institutionDid("academy"), courts = institutionDid("courts");
  const empty = await kit.log.treasuryStatement();
  assert.equal(empty.treasury.balance, 0);
  assert.equal(empty.treasury.reconciles, true);
  assert.deepEqual(empty.institutions.map((i) => i.did).sort(), [...INSTITUTION_DIDS].sort(), "every institution has a line");

  // Funding: the owner co-signs the operator's issuance to the Treasury.
  await kit.put(kit.mk("mint", operator, { to: TREASURY_DID, amount: credit(2000), reason: "treasury_issuance", authority: "operator" }, null, { subject: TREASURY_DID, cosigners: [owner] }));
  // A settled job: the job tax (4 on a release of 96, the list's 50 permille) goes to the Treasury.
  const buyer = await kit.person("st-buyer");
  const worker = await kit.agent("st-worker", await kit.person("st-sponsor"), 1);
  await kit.acceptedJob(buyer, worker);
  // A purchase at the Academy: the Treasury's 200 permille of 20 is 4, the Academy's 700 permille is 14, 100 permille is burned.
  const student = await kit.agent("st-student", await kit.person("st-sponsor-2"), 1);
  await kit.job(student); await kit.fund(student, 50);
  await kit.buy(student, SERVICES.sitting, 20);
  // The Treasury's budgets (the owner co-signs the first of each) and a service payment out of the Academy's.
  const bud = (inst: string, amount: number) => kit.put(kit.mk("budget", treasury, { institution: inst, period: "2026-11", amount: credit(amount), purpose: "charter" }, null, { cosigners: [owner] }));
  const academyBudget = await bud(academy, 500);
  await bud(courts, 300);
  await kit.put(kit.mk("treasury_payment", treasury, { budget: academyBudget, to: academy, amount: credit(100) }, null));

  const st = await kit.log.treasuryStatement();
  assert.deepEqual(st.treasury.in, { issuance: 2000, jobTax: 4, purchaseShare: 4 });
  assert.deepEqual(st.treasury.out, { budgetPayments: 100, allowances: 0 });
  assert.equal(st.treasury.balance, 2000 + 4 + 4 - 100, "the balance is what came in less what went out");
  assert.equal(st.treasury.unexplained, 0);
  assert.equal(st.treasury.reconciles, true, "the statement reconciles to the ledger");

  const line = (did: string) => st.institutions.find((i) => i.did === did)!;
  assert.deepEqual([line(academy).budgeted, line(academy).paidByTreasury, line(academy).earnedFromPurchases], [500, 100, 14]);
  assert.equal(line(academy).balance, 100 + 14, "the account holds what the Treasury paid and what the purchase earned");
  assert.deepEqual([line(courts).budgeted, line(courts).paidByTreasury, line(courts).earnedFromPurchases], [300, 0, 0]);
  assert.equal((await kit.log.creditAudit()).verdict, "balanced", "and the supply rule still balances");

  // A period limits the flows and turns the reconciliation off, since the balance is not a period figure.
  const later = await kit.log.treasuryStatement("2099-01-01T00:00:00Z");
  assert.equal(later.treasury.reconciles, null);
  assert.deepEqual(later.treasury.in, { issuance: 0, jobTax: 0, purchaseShare: 0 });
  await assert.rejects(kit.log.treasuryStatement("not a time"), /not a time/);
});
