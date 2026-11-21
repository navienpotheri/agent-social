/**
 * The Insurer and the Courts (register row DK402; spec-delta S1592; bank-insurer.md 5): a decision on a claim that rests on a ruling waits for the appeal window to close and for an open appeal to be decided; a ruling may
 * find that the performer acted outside its Mandate, and bond-slash cover does not pay for that. Real rulings by a drawn panel over a real log. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cosign, type Signer } from "@agent-social/asp-core";
import { DEFAULT_ROUTES } from "../src/courts.ts";
import { INSURER_DID, TREASURY_DID, premiumFor } from "../src/index.ts";
import { DAY, courts, credit, insurer, jump, kit, mk, owner, refusedBy, tick, treasury, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";

const TEXT_HASH = createHash("sha256").update(readFileSync(fileURLToPath(new URL("../../../docs/court-charter.md", import.meta.url)), "utf8")).digest("hex");

async function world() {
  const k = await kit();
  await k.withPrices();
  await k.mint(TREASURY_DID, 5000);
  const at = tick();
  const budget = await k.log.append(mk("budget", treasury, { institution: INSURER_DID, period: "2026-11", amount: credit(1000), purpose: "charter" }, null, { at, cosigners: [owner] }));
  await k.log.append(mk("treasury_payment", treasury, { budget: budget.id, to: INSURER_DID, amount: credit(1000) }));
  const jurors: Party[] = [];
  for (let i = 0; i < 9; i++) { const j = await k.person(`ir-juror-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null)); jurors.push(j); }
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  const cat = tick();
  await k.log.append(mk("court_act", courts, { act: "charter", version: 1, text_sha256: TEXT_HASH, routes: DEFAULT_ROUTES, effective_from: cat }, null, { at: cat }));
  const principal = await k.person("ir-principal", 5000);
  const sponsor = await k.person("ir-sponsor", 500);
  const performer = await k.agent("ir-performer", sponsor, { funds: 500 });
  const contract = cosign(mk("contract", principal, { principal: principal.did, performer: performer.did, bank: bank.did, purpose: "a job that fails", price: credit(100), verification: "principal", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: performer.did }), performer);
  await k.log.append(contract);
  // cover is bought before the job starts
  const policy = mk("policy", performer, { holder: performer.did, contract: contract.id, cover: "bond_slash", insured_amount: credit(20), premium: credit(premiumFor("bond_slash", 20, 100, 0, 0)), valid_from: new Date(Date.parse("2026-11-01T00:00:00Z")).toISOString().replace(".000Z", "Z"), valid_to: "2027-06-01T00:00:00Z" }, null, { subject: performer.did });
  await k.log.append(policy);
  const bond = mk("bond", performer, { contract: contract.id, backer: performer.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await k.log.append(bond);
  const mandate = mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: performer.did });
  await k.log.append(mandate);
  const delivery = mk("delivery", performer, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, mandate.id, { subject: contract.id });
  await k.log.append(delivery);
  const rejection = mk("attestation", principal, { kind: "acceptance", about: delivery.id, verdict: "rejected", reasons: ["it went outside what it was allowed to do"] }, delivery.id, { subject: contract.id });
  await k.log.append(rejection);
  // a panel rules for the principal; the ruling may also find the performer outside its Mandate
  const rule = async (outside: boolean) => {
    const panel = await k.log.drawPanel(contract.id);
    const [first, ...others] = panel.slice(0, Math.ceil(panel.length / 2)).map((x) => byDid.get(x)!);
    let ruling = mk("attestation", first, { kind: "ruling", about: contract.id, verdict: "for_principal", fault: { [performer.did]: 500 }, reasons: ["decided on the record"], code: { version: "1.0", articles: ["4.1"] }, ...(outside ? { outside_mandate: [performer.did] } : {}) }, rejection.id, { subject: contract.id });
    for (const s of others) ruling = cosign(ruling, s as Signer);
    await k.log.append(ruling);
    return ruling;
  };
  const settle = async (ruling: { id: string }) => {
    const s = cosign(mk("settlement", bank, { contract: contract.id, basis: "ruling", cites: ruling.id, escrow_released: credit(50), fees: credit(1), bond_returned: credit(10), bond_slashed: credit(10) }, ruling.id, { subject: contract.id, at: jump(73 * 3_600_000) }), principal as Signer);
    await k.log.append(s);
    return s;
  };
  const claim = async (settlement: { id: string }) => { const c = mk("claim", performer, { policy: policy.id, event: settlement.id, amount_claimed: credit(1) }, null, { subject: performer.did }); await k.log.append(c); return c; };
  const decision = (claimId: string, d: string, amount: number, reason: string) => mk("claim_decision", insurer as never, { claim: claimId, decision: d, amount: credit(amount), reason }, null, { subject: null, at: tick() });
  return { k, principal, performer, rule, settle, claim, decision, policy };
}

test("DK402: a decision on a claim that rests on a ruling waits for the appeal window to close; then the terms pay", async () => {
  const w = await world();
  const ruling = await w.rule(false);
  const settlement = await w.settle(ruling);
  const claim = await w.claim(settlement);
  assert.equal(await refusedBy(w.k.log.append(w.decision(claim.id, "paid", 4, "covered"))), "decision_in_appeal_window", "the ruling can still be appealed for 14 days");
  jump(14 * DAY);
  const held0 = await w.k.log.balance(w.performer.did);
  await w.k.log.append(w.decision(claim.id, "paid", 4, "covered"));
  assert.equal(await w.k.log.balance(w.performer.did) - held0, 4, "the terms pay 4 once the window is closed");
  assert.equal(((await w.k.log.creditAudit()) as { verdict: string }).verdict, "balanced");
  assert.equal((await w.k.log.verify()).ok, true, "a replica replays the hold to the same books");
});

test("DK402: an appeal filed late holds the decision for as long as it is open, so no payment rests on a ruling that is then reversed", async () => {
  const w = await world();
  const ruling = await w.rule(false);
  const settlement = await w.settle(ruling);
  const claim = await w.claim(settlement);
  jump(9 * DAY);
  const fee = await w.k.buy(w.performer, "courts.appeal.small", 5);
  await w.k.log.append(mk("court_act", w.performer, { act: "appeal", ruling: ruling.id, grounds: "error_of_law", statement: "Article 4.1 was misapplied to this delivery", fee_paid: fee }));
  jump(3 * DAY); // the 14-day window is closed, the appeal is open
  assert.equal(await refusedBy(w.k.log.append(w.decision(claim.id, "paid", 4, "covered"))), "decision_appeal_pending");
  jump(60 * DAY); // an appeal nobody has ruled on yet: the claim still waits
  assert.equal(await refusedBy(w.k.log.append(w.decision(claim.id, "paid", 4, "covered"))), "decision_appeal_pending");
});

test("DK402: a ruling that finds the performer outside its Mandate excludes bond-slash cover: the claim is denied with that reason, and paying it is refused", async () => {
  const w = await world();
  const ruling = await w.rule(true);
  const settlement = await w.settle(ruling);
  const claim = await w.claim(settlement);
  jump(14 * DAY);
  assert.equal(await refusedBy(w.k.log.append(w.decision(claim.id, "paid", 4, "covered"))), "decision_not_covered", "the terms pay nothing: the decision is a denial");
  const held0 = await w.k.log.balance(w.performer.did);
  await w.k.log.append(w.decision(claim.id, "denied", 0, "outside_mandate"));
  assert.equal(await w.k.log.balance(w.performer.did), held0, "nothing was paid");
  assert.equal((await w.k.log.verify()).ok, true);
});
