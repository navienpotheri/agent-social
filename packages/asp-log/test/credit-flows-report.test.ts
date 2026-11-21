// The credit-flow report for the Bank, the deposits, the Insurer and the Courts (register row DK1452; docs/institutions/credit-structure.md; `asp credits audit --by-flow`).
// Every figure is checked against what the test itself did, and the report's own figures against the audit: the Bank's reserve and the deposit account are the audit's balances, and the audit still balances.
// Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, staticResolver } from "@agent-social/asp-core";
import { BANK_DEPOSIT_DID, BANK_DID, EventLog, INSURER_DID, MemoryStore, TREASURY_DID, payoutFor, premiumFor, rewardFor } from "../src/index.ts";
import { Kit, bankP, clinic, courts, credit, hashOf, operator, owner, party, registrar, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const insurerParty = party(INSURER_DID, 56);
const mandateBody = (c: string) => ({ contract: c, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true });

async function newKit() {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, insurerParty].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  await kit.mint(TREASURY_DID, 20_000);
  const fund = async (to: string, amount: number) => {
    const b = await kit.put(kit.mk("budget", treasury, { institution: to, period: kit.now().slice(0, 7), amount: credit(amount), purpose: "charter" }, null, { cosigners: [owner] }));
    await kit.put(kit.mk("treasury_payment", treasury, { budget: b, to, amount: credit(amount) }, null));
  };
  return { kit, fund };
}

test("the report counts the Bank's lines, draws, returns, defaults and debt, the deposits and their reward, and agrees with the audit", async () => {
  const { kit, fund } = await newKit();
  await fund(BANK_DID, 500);
  const principal = await kit.person("fr-principal"); await kit.mint(principal.did, 5000);
  const sponsor = await kit.person("fr-sponsor"); await kit.mint(sponsor.did, 100);
  const poor = await kit.person("fr-poor-sponsor"); await kit.mint(poor.did, 5); // exactly 25 % of a 20-credit line
  const job = async (name: string, guarantor: Party, outcome: "repaid" | "default") => {
    const agent = await kit.agent(name, guarantor, 1);
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `first job ${name}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    const line = kit.mk("credit_line", bankP, { borrower: agent.did, guarantor: guarantor.did, contract: c.id, amount: credit(20), fee: 0, due: iso(Date.parse(kit.now()) + 7 * DAY) }, null, { subject: agent.did, cosigners: [agent, guarantor] });
    await kit.put(line);
    const bond = kit.mk("bond", agent, { contract: c.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c.id, { subject: c.id });
    await kit.put(bond);
    const mandate = kit.mk("mandate", principal, mandateBody(c.id), bond.id, { subject: agent.did });
    await kit.put(mandate);
    if (outcome === "repaid") {
      const d = kit.mk("delivery", agent, { contract: c.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandate.id, { subject: c.id });
      await kit.put(d);
      const acc = kit.mk("attestation", principal, { kind: "acceptance", about: d.id, verdict: "accepted" }, d.id, { subject: c.id });
      await kit.put(acc);
      await kit.put(kit.mk("settlement", bankP, { contract: c.id, basis: "accepted", cites: acc.id, escrow_released: credit(96), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, acc.id, { subject: c.id }));
    } else {
      await kit.put(cosign(kit.mk("settlement", bankP, { contract: c.id, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, mandate.id, { subject: c.id }), principal));
      await kit.put(kit.mk("credit_default", bankP, { line: line.id, unpaid: credit(20), against: guarantor.did }, null, { subject: agent.did }));
    }
    return line.id;
  };
  await job("fr-repaid", sponsor, "repaid");
  const defaulted = await job("fr-defaulter", poor, "default"); // the guarantor holds 5: the Bank recovers 5 and 15 is a debt
  await kit.mint(poor.did, 60);
  await kit.put(kit.mk("debt_payment", poor, { line: defaulted, amount: credit(10) }, null, { subject: poor.did }));
  // a deposit of 300, its reward after 30 days, and a withdrawal after the term
  const holder = await kit.person("fr-holder"); await kit.mint(holder.did, 1000);
  const dep = kit.mk("deposit_act" as never, holder, { act: "deposit", holder: holder.did, amount: credit(300) }, null, { subject: holder.did, cosigners: [bankP] });
  await kit.put(dep);
  const open = kit.mk("deposit_act" as never, holder, { act: "deposit", holder: holder.did, amount: credit(120) }, null, { subject: holder.did, cosigners: [bankP] });
  await kit.put(open);
  kit.addDays(30.5);
  const rb = await kit.put(kit.mk("budget", treasury, { institution: TREASURY_DID, period: kit.now().slice(0, 7), amount: credit(50), purpose: "deposit_reward" }, null, { cosigners: [owner] }));
  await kit.put(kit.mk("deposit_act" as never, treasury, { act: "reward", deposit: dep.id, budget: rb, amount: credit(rewardFor(300)) }, null, { subject: holder.did }));
  await kit.put(kit.mk("deposit_act" as never, holder, { act: "withdraw", deposit: dep.id }, null, { subject: holder.did }));

  const flows = await kit.log.creditFlows();
  const audit = await kit.log.creditAudit();
  assert.equal(audit.verdict, "balanced");
  assert.equal(flows.bank.linesOpened.count, 2);
  assert.equal(flows.bank.linesOpened.amount, 40);
  assert.deepEqual(flows.bank.lent, { count: 2, amount: 40 });
  assert.equal(flows.bank.outstanding, 5, "15 was a debt after the default; 10 of it was cleared");
  assert.equal(flows.bank.returned, 35, "20 repaid at settlement, 5 recovered from the guarantor and 10 of the debt cleared");
  assert.deepEqual(flows.bank.defaults, { count: 1, unpaid: 20 });
  assert.deepEqual(flows.bank.debtCleared, { count: 1, amount: 10 });
  assert.equal(flows.bank.reserve, (await kit.log.balance(BANK_DID)), "the Bank's reserve is the account's balance");
  assert.equal(flows.bank.reserve, 500 - 40 + 35, "reserve: 500, less 40 lent, plus 35 back");
  assert.deepEqual(flows.deposits.made, { count: 2, amount: 420 });
  assert.deepEqual(flows.deposits.withdrawn, { count: 1, amount: 300 });
  assert.deepEqual(flows.deposits.rewards, { count: 1, amount: rewardFor(300) });
  assert.equal(flows.deposits.held, 120, "only the open deposit is held");
  assert.equal(flows.deposits.held, await kit.log.balance(BANK_DEPOSIT_DID));
  assert.equal(flows.treasury.budgets.count, 2);
  assert.equal(flows.treasury.payments.amount, 500);
  // since: a period after everything counts nothing of the records, though the balances are still read
  const later = await kit.log.creditFlows(iso(Date.parse(kit.now()) + DAY));
  assert.equal(later.bank.linesOpened.count, 0);
  assert.equal(later.deposits.made.count, 0);
  assert.equal(later.bank.reserve, flows.bank.reserve, "the reserve is a balance now, not a count of the period");
});

test("the report counts the Insurer's policies, claims and decisions and its reserve", async () => {
  const { kit, fund } = await newKit();
  await fund(INSURER_DID, 800);
  const principal = await kit.person("fi-principal"); await kit.mint(principal.did, 5000);
  const sponsor = await kit.person("fi-sponsor"); await kit.mint(sponsor.did, 400);
  let n = 0;
  const insured = async (cover: "bond_slash" | "failed_job", slashed: number) => {
    const agent = await kit.agent(`fi-agent-${++n}`, sponsor, 1);
    await kit.mint(agent.did, 100);
    const holder = cover === "failed_job" ? principal : agent;
    const insuredAmount = cover === "failed_job" ? 50 : 20;
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `insured ${n}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    const premium = premiumFor(cover, insuredAmount, 100, 0, 0);
    const policy = kit.mk("policy", insurerParty, { holder: holder.did, contract: c.id, cover, insured_amount: credit(insuredAmount), premium: credit(premium), valid_from: kit.now(), valid_to: iso(Date.parse(kit.now()) + 60 * DAY) }, null, { subject: holder.did, cosigners: [holder] });
    await kit.put(policy);
    const bond = kit.mk("bond", agent, { contract: c.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c.id, { subject: c.id });
    await kit.put(bond);
    const mandate = kit.mk("mandate", principal, mandateBody(c.id), bond.id, { subject: agent.did });
    await kit.put(mandate);
    const s = await kit.put(cosign(kit.mk("settlement", bankP, { contract: c.id, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(20 - slashed), bond_slashed: credit(slashed) }, mandate.id, { subject: c.id }), principal));
    const claim = kit.mk("claim", holder, { policy: policy.id, event: s, amount_claimed: credit(1) }, null, { subject: holder.did });
    await kit.put(claim);
    const terms = payoutFor(cover, insuredAmount, 100, slashed, slashed > 0 ? Math.ceil((slashed * 1000) / 20) : 0);
    await kit.put(kit.mk("claim_decision", insurerParty, { claim: claim.id, decision: terms.amount === 0 ? "denied" : "paid", amount: credit(terms.amount), reason: terms.amount === 0 ? (terms.reason ?? "no_slash") : "covered" }, null, { subject: null }));
    return { premium, paid: terms.amount };
  };
  const a = await insured("bond_slash", 10);   // covered: 50 % of (10 less a 20 % deductible) = 4
  const b = await insured("bond_slash", 20);   // fault 1000: excluded as fraud, denied
  const c = await insured("failed_job", 10);   // covered up to 30 % of the price
  const flows = await kit.log.creditFlows();
  assert.deepEqual(flows.insurer.policies, { count: 3, premiums: a.premium + b.premium + c.premium });
  assert.equal(flows.insurer.claims, 3);
  assert.deepEqual(flows.insurer.decisions.paid, { count: a.paid > 0 && c.paid > 0 ? 2 : 1, amount: a.paid + b.paid + c.paid });
  assert.equal(flows.insurer.decisions.denied.count, 1);
  assert.equal(flows.insurer.decisions.reduced.count, 0);
  assert.equal(flows.insurer.reserve, await kit.log.balance(INSURER_DID));
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
  assert.ok(flows.unavailable.every((u) => !/credit lines, premiums, claims/.test(u)), "the report no longer says the Bank and Insurer flows are missing");
});
