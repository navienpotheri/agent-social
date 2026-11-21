/**
 * The Market completeness audit's end-to-end chain (register rows DK1728 and DK1729; docs/institutions/market-completeness-audit.md): ONE seeded run over ONE real log of what a job and its money go through: the Treasury funds the Bank's reserve
 * and the Insurer's, a poster posts a job (the posting deposit is a purchase), an agent bids, the Market assigns by the published rule, the contract is bonded and escrowed, delivered, accepted and settled, a newcomer with no balance
 * lends from the Bank to bond a job and the line repays at settlement, an agent insures a bond and a failed job pays a claim from the Insurer's reserve, a ruled dispute is appealed and decided, a holder deposits at the Bank and
 * withdraws at term. The supply audit is asked after EVERY step and must balance. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { BANK_DEPOSIT_DID, BANK_DID, INSURER_DID, TREASURY_DID, premiumFor, drawPanel } from "../src/index.ts";
import { DEFAULT_ROUTES } from "../src/courts.ts";
import { DAY, courts, credit, jump, kit, market, mk, owner, refusedBy, tick, treasury, type Party } from "./society-kit.ts";
import { party as accParty } from "./academy-kit.ts";

const bankP = accParty(BANK_DID, 55) as unknown as Party;
const insurerP = accParty(INSURER_DID, 56) as unknown as Party;
const sha = (c: string) => "sha256:" + c.repeat(64);
const CODE = { version: "1.0", articles: ["4.1"] };
const TEXT_HASH = createHash("sha256").update(readFileSync(fileURLToPath(new URL("../../../docs/court-charter.md", import.meta.url)), "utf8")).digest("hex");
const at = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

test("DK1728 and DK1729: the credit chain of a job and its money over one real log, the supply audit balanced after every step", async () => {
  const k = await kit({ parties: [bankP, insurerP] });
  const log = k.log;
  const audits: string[] = [];
  const check = async (step: string) => {
    const a = await log.creditAudit();
    audits.push(`${step}: ${a.verdict}`);
    assert.equal(a.verdict, "balanced", `after ${step}: ${JSON.stringify(a)}`);
  };
  const bal = (d: string) => log.balance(d);

  // ---- setup: prices, the Treasury, the Bank's and the Insurer's reserves, the Courts' charter and jurors
  await k.withPrices();
  await k.mint(TREASURY_DID, 5000);
  for (const [inst, amount] of [[BANK_DID, 600], [INSURER_DID, 700]] as const) {
    const t = tick();
    const budget = mk("budget", treasury, { institution: inst, period: "2026-11", amount: credit(amount), purpose: "charter" }, null, { at: t, cosigners: [owner] });
    await log.append(budget);
    await log.append(mk("treasury_payment", treasury, { budget: budget.id, to: inst, amount: credit(amount) }, null, { at: tick() }));
  }
  const jurors: Party[] = [];
  for (let i = 0; i < 12; i++) { const j = await k.person(`e2e-juror-${i}`, 500); await log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null)); jurors.push(j); }
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  { const t = tick(); await log.append(mk("court_act", courts, { act: "charter", version: 1, text_sha256: TEXT_HASH, routes: DEFAULT_ROUTES, effective_from: t }, null, { at: t })); }
  await check("setup: prices, the Treasury, the Bank's and Insurer's reserves, the Courts' charter, twelve jurors");

  // ---- the Market: post, bid, assign
  const poster = await k.person("e2e-poster", 3000);
  const sponsor = await k.person("e2e-sponsor", 200);
  const worker = await k.agent("e2e-worker", sponsor, { tier: 1, skills: ["review"], funds: 100 });
  const intent = await k.intent(poster, { class: "routine", budget: credit(60), skills: ["review"] });
  await check("a job is written as an intent");
  const deposit = await k.buy(poster, "market.posting.deposit", 2);
  const posting = mk("market_act", poster, { act: "posting", intent, board: "main", expires: at(Date.parse("2026-11-01T00:00:00Z") + 60 * DAY), deposit });
  await log.append(posting);
  await check("the posting, its deposit bought as a purchase");
  const offer = await k.offer(worker, intent, 60);
  await log.append(mk("market_act", worker, { act: "bid", posting: posting.id, offer }));
  await check("a bid");
  const ranked = await log.rankPosting(posting.id, "best_match", "seed-e2e");
  await log.append(mk("market_act", market, { act: "assignment", posting: posting.id, intent, agent: worker.did, rule: "best_match", ranked, seed: "seed-e2e" }));
  await check("the Market assigns by the published rule");

  // ---- the contract, the bond, escrow, delivery, acceptance, settlement
  const before = await bal(worker.did);
  await k.runJob(poster, worker, 60, { intent, offer });
  assert.equal(await bal(worker.did), before + 60, "the worker is paid the price");
  await check("contract, bond, escrow, delivery, acceptance and settlement");
  await log.append(mk("receipt", market, { purchase: deposit, status: "refunded", refund_amount: credit(2) }, deposit));
  await check("the posting deposit is returned once the job is filled");

  // ---- the Bank lends to a newcomer with no balance, who bonds a job from the line; the line repays at settlement
  const newcomer = await k.agent("e2e-newcomer", sponsor, { tier: 1, funds: 5 }); // the Courts' fee reserve (3) is the newcomer's own; the line funds the bond lock
  const lendContract = cosign(mk("contract", poster, { principal: poster.did, performer: newcomer.did, bank: bankP.did, purpose: "a first job", price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: sha("0"), offer: sha("1") } }, null, { subject: newcomer.did }), newcomer as unknown as Signer);
  await log.append(lendContract);
  const reserve0 = await bal(BANK_DID);
  await log.append(mk("credit_line", bankP, { borrower: newcomer.did, guarantor: sponsor.did, contract: lendContract.id, amount: credit(23), fee: 0, due: at(Date.parse(tick()) + 7 * DAY) }, null, { subject: newcomer.did, cosigners: [newcomer, sponsor] }));
  await check("the Bank lends a credit line");
  const lbond = mk("bond", newcomer, { contract: lendContract.id, backer: newcomer.did, amount: credit(23), escrow: { payer: poster.did, amount: credit(102) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, lendContract.id, { subject: lendContract.id });
  await log.append(lbond);
  assert.equal(await bal(BANK_DID), reserve0 - 23, "the reserve funds the bond lock");
  await check("the bond is locked from the line");
  const lmandate = mk("mandate", poster, { contract: lendContract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, lbond.id, { subject: newcomer.did });
  await log.append(lmandate);
  const ldeliv = mk("delivery", newcomer, { contract: lendContract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: sha("2") }, forecasts: [] } }, lmandate.id, { subject: lendContract.id });
  await log.append(ldeliv);
  const lacc = mk("attestation", poster, { kind: "acceptance", about: ldeliv.id, verdict: "accepted" }, ldeliv.id, { subject: lendContract.id });
  await log.append(lacc);
  await check("the newcomer delivers and is accepted");
  await log.append(mk("settlement", bankP, { contract: lendContract.id, basis: "accepted", cites: lacc.id, escrow_released: credit(100), fees: credit(2), bond_returned: credit(23), bond_slashed: credit(0) }, lacc.id, { subject: lendContract.id }));
  assert.equal(await bal(BANK_DID), reserve0, "the line repaid at settlement: the reserve is whole");
  await check("settlement repays the line");

  // ---- the Insurer: a bond-slash policy, a failed job, a claim paid from the reserve
  const insured = await k.agent("e2e-insured", sponsor, { tier: 1, funds: 100 });
  const insContract = cosign(mk("contract", poster, { principal: poster.did, performer: insured.did, bank: bankP.did, purpose: "an insured job", price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: sha("0"), offer: sha("1") } }, null, { subject: insured.did }), insured as unknown as Signer);
  await log.append(insContract);
  const policy = mk("policy", insurerP, { holder: insured.did, contract: insContract.id, cover: "bond_slash", insured_amount: credit(20), premium: credit(premiumFor("bond_slash", 20, 100, 0, 0)), valid_from: tick(), valid_to: at(Date.parse(tick()) + 60 * DAY) }, null, { subject: insured.did, cosigners: [insured] });
  await log.append(policy);
  await check("a bond-slash policy is bought, the premium split");
  const ibond = mk("bond", insured, { contract: insContract.id, backer: insured.did, amount: credit(20), escrow: { payer: poster.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, insContract.id, { subject: insContract.id });
  await log.append(ibond);
  const imandate = mk("mandate", poster, { contract: insContract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, ibond.id, { subject: insured.did });
  await log.append(imandate);
  const failed = cosign(mk("settlement", bankP, { contract: insContract.id, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(10), bond_slashed: credit(10) }, imandate.id, { subject: insContract.id }), poster as unknown as Signer);
  await log.append(failed);
  await check("the job fails and half the bond is slashed");
  const claim = mk("claim", insured, { policy: policy.id, event: failed.id, amount_claimed: credit(1) }, null, { subject: insured.did });
  await log.append(claim);
  const insBefore = await bal(insured.did);
  await log.append(mk("claim_decision", insurerP, { claim: claim.id, decision: "paid", amount: credit(4), reason: "covered" }, null, { subject: insured.did }));
  assert.equal(await bal(insured.did), insBefore + 4, "the stated share was paid from the reserve");
  await check("the claim is decided and paid from the Insurer's reserve");

  // ---- the Courts: a disputed job ruled for the principal, appealed, the appeal decided
  const performer = await k.agent("e2e-performer", sponsor, { tier: 1, funds: 2000 });
  const job = await k.runJob(poster, performer, 80, undefined, { settle: false });
  const rej = mk("attestation", poster, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["the work is not good enough"] }, job.delivery, { subject: job.contract });
  await log.append(rej);
  const panel = await log.drawPanel(job.contract);
  const signing = panel.slice(0, Math.ceil(panel.length / 2)).map((x) => byDid.get(x)!);
  const [first, ...others] = signing;
  let ruling = mk("attestation", first, { kind: "ruling", about: job.contract, verdict: "for_principal", fault: { [performer.did]: 1000 }, reasons: ["decided on the record"], code: CODE }, rej.id, { subject: job.contract });
  for (const s of others) ruling = cosign(ruling, s as unknown as Signer);
  await log.append(ruling);
  await check("a dispute is ruled by the drawn panel");
  const fee = await k.buy(performer, "courts.appeal.small", 5);
  const appeal = mk("court_act", performer, { act: "appeal", ruling: ruling.id, grounds: "error_of_law", statement: "Article 4.1 was misapplied", fee_paid: fee }, null, { at: at(Date.parse(ruling.issued_at) + 3_600_000) });
  await log.append(appeal);
  await check("the loser appeals and pays the appeal fee");
  const apanel = drawPanel(log.store as never, { principal: poster.did, performer: performer.did, seed: appeal.id, size: DEFAULT_ROUTES.appeal_panel, exclude: [ruling.sig.kid, ...(ruling.cosigs ?? []).map((c) => c.kid)].map((x) => x.split("#")[0]) });
  const asigners = (await apanel).slice(0, 3).map((x) => byDid.get(x)!);
  const [af, ...arest] = asigners;
  let aruling = mk("court_act", af, { act: "appeal_ruling", appeal: appeal.id, outcome: "affirmed", reasons: ["decided on appeal"], code: CODE }, null);
  for (const s of arest) aruling = cosign(aruling, s as unknown as Signer);
  await log.append(aruling);
  await check("the appeal is decided");

  // ---- the Bank takes a deposit and returns it whole at term
  const holder = poster;
  const startBal = await bal(holder.did);
  const dep = mk("deposit_act" as never, holder, { act: "deposit", holder: holder.did, amount: credit(300) }, null, { subject: holder.did, cosigners: [bankP] });
  await log.append(dep);
  assert.equal(await bal(BANK_DEPOSIT_DID), 300);
  await check("a deposit is locked at the Bank");
  assert.equal(await refusedBy(log.append(mk("deposit_act" as never, holder, { act: "withdraw", deposit: dep.id }, null, { subject: holder.did }))), "deposit_locked");
  jump(31 * DAY);
  await log.append(mk("deposit_act" as never, holder, { act: "withdraw", deposit: dep.id }, null, { subject: holder.did }));
  assert.equal(await bal(holder.did), startBal, "returned whole at term");
  await check("the deposit is withdrawn at term");

  assert.equal((await log.verify()).ok, true, "a replica replays the whole chain to the same books");
  console.log(`\nDK1728/DK1729 end-to-end chain over one log, the supply audit after each of ${audits.length} steps:\n  ` + audits.join("\n  "));
});
