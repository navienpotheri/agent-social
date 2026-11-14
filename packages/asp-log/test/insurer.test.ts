// The Insurer (register row DK20; spec-delta S281; bank-insurer.md): a policy is bought, a covered breach pays the stated share, an excluded one does not, and over random sales and claims no sale leaves the
// reserve below its floor and the reserve is never negative. Every rule by name. The reserve comes from a Treasury budget payment, never a mint. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, INSURER_DID, TREASURY_DID, premiumFor, payoutFor, reserveFloor, type Cover } from "../src/index.ts";
import { Kit, bankP, clinic, courts, credit, hashOf, operator, owner, refused, registrar, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world(reserve = 600) {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, insurerParty].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  await kit.mint(TREASURY_DID, 50_000);
  const at = kit.tick();
  const budget = await kit.put(kit.mk("budget", treasury, { institution: INSURER_DID, period: "2026-11", amount: credit(reserve), purpose: "charter" }, null, { at, cosigners: [owner] }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget, to: INSURER_DID, amount: credit(reserve) }, null, { at: kit.tick() }));
  const sponsor = await kit.person("ins-sponsor");
  const principal = await kit.person("ins-principal");
  await kit.mint(sponsor.did, 500); await kit.mint(principal.did, 60_000);
  const insurer = { did: INSURER_DID, ...({} as object) } as Party;
  void insurer;
  const bal = (d: string) => kit.log.balance(d);
  let n = 0;
  // A sponsor opens at most 10 agent passports a day (RG-11): the first eight jobs' agents are the sponsor's, the next eight another's, and so on.
  const sponsors = new Map<number, Awaited<ReturnType<typeof kit.person>>>([[0, sponsor]]);
  const sponsorFor = async (k: number) => { const g = Math.floor((k - 1) / 8); if (!sponsors.has(g)) sponsors.set(g, await kit.person(`ins-sponsor-${g}`)); return sponsors.get(g)!; };
  /** A contract, optionally a policy on it, a bond (backed by the agent) and a Mandate. */
  async function job(opts: { price?: number; cover?: Cover; insured?: number; holder?: Party; actFirst?: boolean } = {}) {
    const price = opts.price ?? 100;
    const agent = await kit.agent(`ins-agent-${++n}`, await sponsorFor(n), 1);
    await kit.mint(agent.did, 100);
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `job ${n}`, price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    let policy: string | undefined;
    if (opts.cover) policy = await kit.put(policyRec(c.id, opts.cover, opts.insured ?? 20, opts.holder ?? (opts.cover === "failed_job" ? principal : agent), price));
    const bond = kit.mk("bond", agent, { contract: c.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(price) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c.id, { subject: c.id });
    await kit.put(bond);
    const mandate = kit.mk("mandate", principal, { contract: c.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
    await kit.put(mandate);
    return { agent, contract: c.id, mandate, policy };
  }
  const policyRec = (contract: string, cover: Cover, insured: number, holder: Party, price: number, over: Record<string, unknown> = {}, by: Party = { did: INSURER_DID } as Party) =>
    kit.mk("policy", by.did === INSURER_DID ? insurerParty : by, { holder: holder.did, contract, cover, insured_amount: credit(insured), premium: credit(premiumFor(cover, insured, price, 0, 0)), valid_from: kit.now(), valid_to: iso(Date.parse(kit.now()) + 60 * DAY), ...over }, null, { subject: holder.did, cosigners: [holder] });
  /** A failed job: revoked, `slashed` of the 20 credit bond goes to the principal. */
  async function fail(j: Awaited<ReturnType<typeof job>>, slashed: number) {
    return kit.put(cosign(kit.mk("settlement", bankP, { contract: j.contract, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(20 - slashed), bond_slashed: credit(slashed) }, j.mandate.id, { subject: j.contract }), principal));
  }
  const claim = (j: Awaited<ReturnType<typeof job>>, settlement: string, holder: Party) => kit.mk("claim", holder, { policy: j.policy, event: settlement, amount_claimed: credit(1) }, null, { subject: holder.did });
  const decision = (claimId: string, d: string, amount: number, reason: string, by: Party = insurerParty) => kit.mk("claim_decision", by, { claim: claimId, decision: d, amount: credit(amount), reason }, null, { subject: null });
  return { kit, sponsor, principal, job, fail, claim, decision, policyRec, bal };
}
// The Insurer's key: a fixture party for the Insurer account's DID.
import { party } from "./academy-kit.ts";
const insurerParty = party(INSURER_DID, 56);

test("the cover formula and the premium, at their edges", () => {
  assert.equal(premiumFor("bond_slash", 20, 100, 0, 0), 2, "8 % of 20, rounded up");
  assert.equal(premiumFor("bond_slash", 100, 100, 3, 0), 4, "4 % once three jobs have counted");
  assert.equal(premiumFor("bond_slash", 100, 100, 0, 2), 10, "8 + 10 % for each of 2 strikes");
  assert.equal(premiumFor("failed_job", 30, 100, 0, 0), 6, "6 % of the price");
  assert.deepEqual(payoutFor("bond_slash", 20, 100, 10, 500), { amount: 4 }, "50 % of (10 less a 20 % deductible)");
  assert.deepEqual(payoutFor("bond_slash", 3, 100, 10, 500), { amount: 3 }, "never more than the insured amount");
  assert.deepEqual(payoutFor("bond_slash", 20, 100, 20, 800), { amount: 0, reason: "fraud" }, "fault 800 is excluded");
  assert.deepEqual(payoutFor("bond_slash", 20, 100, 20, 799), { amount: 8 }, "fault 799 is not");
  assert.deepEqual(payoutFor("bond_slash", 20, 100, 0, 0), { amount: 0, reason: "no_slash" });
  assert.deepEqual(payoutFor("failed_job", 50, 100, 10, 500), { amount: 30 }, "at most 30 % of the price");
  assert.equal(reserveFloor(10, 0), 500);
  assert.equal(reserveFloor(60, 0), 600, "10 times the largest insured amount");
  assert.equal(reserveFloor(10, 1200), 600, "1.5 times the expected 30-day claims (the 90-day total over 3)");
});

test("(T14) DK20 done: a policy is bought, a covered breach pays the stated share, an excluded one does not", async () => {
  const w = await world();
  const { kit } = w;
  // Bond-slash cover bought before the job; half the bond is slashed (fault 500): 4 of the 10 slashed come back.
  const j = await w.job({ cover: "bond_slash", insured: 20 });
  assert.equal(await w.bal(j.agent.did), 100 - 20 - 2, "the 2 credit premium and the bond lock left the holder's balance");
  assert.equal(await w.bal(INSURER_DID), 600 + 2, "a 2 credit premium rounds down for the Treasury and the burn, so the reserve gets it");
  const s = await w.fail(j, 10);
  const claimId = await kit.put(w.claim(j, s, j.agent));
  const before = await w.bal(j.agent.did);
  assert.equal(await refused(kit.put(w.decision(claimId, "paid", 5, "covered"))), "decision_amount_mismatch", "the amount is the terms'");
  assert.equal(await refused(kit.put(w.decision(claimId, "denied", 0, "fraud"))), "decision_wrongly_denied", "a covered event is not denied");
  await kit.put(w.decision(claimId, "paid", 4, "covered"));
  assert.equal(await w.bal(j.agent.did), before + 4, "the stated share was paid from the reserve");
  assert.equal(await refused(kit.put(w.decision(claimId, "paid", 4, "covered"))), "decision_exists");
  // An excluded event: a full slash is fault 1000, which is fraud-level: denied, nothing paid.
  const j2 = await w.job({ cover: "bond_slash", insured: 20 });
  const s2 = await w.fail(j2, 20);
  const c2 = await kit.put(w.claim(j2, s2, j2.agent));
  assert.equal(await refused(kit.put(w.decision(c2, "paid", 8, "covered"))), "decision_not_covered");
  assert.equal(await refused(kit.put(w.decision(c2, "denied", 0, "no_slash"))), "decision_wrong_reason");
  const reserve = await w.bal(INSURER_DID);
  await kit.put(w.decision(c2, "denied", 0, "fraud"));
  assert.equal(await w.bal(INSURER_DID), reserve, "an excluded event pays nothing");
  // Failed-job cover pays the principal up to 30 % of the price.
  const j3 = await w.job({ cover: "failed_job", insured: 50 });
  const s3 = await w.fail(j3, 10);
  const c3 = await kit.put(w.claim(j3, s3, w.principal));
  const pBefore = await w.bal(w.principal.did);
  await kit.put(w.decision(c3, "paid", 30, "covered"));
  assert.equal(await w.bal(w.principal.did), pBefore + 30);
  assert.equal((await kit.log.verify()).ok, true);
});

test("every rule of the policy, the claim and the decision is refused by name", async () => {
  const w = await world();
  const { kit } = w;
  const agent = await kit.agent("rule-agent", w.sponsor, 1);
  await kit.mint(agent.did, 100);
  const c = cosign(kit.mk("contract", w.principal, { principal: w.principal.did, performer: agent.did, bank: bankP.did, purpose: "rules", price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
  await kit.put(c);
  const p = (over: Record<string, unknown> = {}, holder: Party = agent, cover: Cover = "bond_slash", by?: Party) => w.policyRec(c.id, cover, 20, holder, 100, over, by);
  assert.equal(await refused(kit.put(p({}, agent, "bond_slash", w.sponsor))), "policy_wrong_issuer");
  assert.equal(await refused(kit.put(kit.mk("policy", insurerParty, { holder: agent.did, contract: c.id, cover: "bond_slash", insured_amount: credit(20), premium: credit(2), valid_from: kit.now(), valid_to: iso(Date.parse(kit.now()) + DAY) }, null, { subject: agent.did }))), "policy_needs_holder");
  assert.equal(await refused(kit.put(p({ premium: credit(1) }))), "premium_mismatch");
  assert.equal(await refused(kit.put(p({ insured_amount: credit(101), premium: credit(9) }))), "policy_insured_amount");
  assert.equal(await refused(kit.put(p({ valid_to: kit.now() }))), "policy_dates");
  assert.equal(await refused(kit.put(p({}, w.principal))), "policy_holder_not_a_party", "bond-slash cover is the backer's");
  assert.equal(await refused(kit.put(p({}, agent, "failed_job"))), "policy_holder_not_a_party", "failed-job cover is the principal's");
  assert.equal(await refused(kit.put(p({ contract: "sha256:" + "4".repeat(64) }))), "policy_contract_unknown");
  await kit.put(p());
  assert.equal(await refused(kit.put(p())), "policy_exists", "one per contract and cover");
  // Linked parties: a job the sponsor posted for its own agent has no cover.
  const own = cosign(kit.mk("contract", w.sponsor, { principal: w.sponsor.did, performer: agent.did, bank: bankP.did, purpose: "own", price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
  await kit.put(own);
  assert.equal(await refused(kit.put(w.policyRec(own.id, "bond_slash", 20, agent, 100))), "policy_linked_parties");
  // After the first Action there is no cover: the job is running.
  const late = await w.job();
  await kit.put(kit.mk("action", late.agent, { contract: late.contract, scopes_used: ["repo.read"], summary: "started" }, null, { subject: late.contract }));
  assert.equal(await refused(kit.put(w.policyRec(late.contract, "bond_slash", 20, late.agent, 100))), "policy_after_first_action");
  // Claims: the holder only, the policy's own settlement, within 14 days, once.
  const j = await w.job({ cover: "bond_slash" });
  const other = await w.job();
  const sOther = await w.fail(other, 5);
  const s = await w.fail(j, 10);
  assert.equal(await refused(kit.put(w.claim(j, s, w.principal))), "claim_not_the_holder");
  assert.equal(await refused(kit.put(w.claim(j, sOther, j.agent))), "claim_event_not_the_contract");
  assert.equal(await refused(kit.put(kit.mk("claim", j.agent, { policy: j.contract, event: s, amount_claimed: credit(1) }, null, { subject: j.agent.did }))), "claim_unknown_policy");
  kit.addDays(15);
  assert.equal(await refused(kit.put(w.claim(j, s, j.agent))), "claim_too_late");
  const j2 = await w.job({ cover: "bond_slash" });
  const s2 = await w.fail(j2, 10);
  const cl = await kit.put(w.claim(j2, s2, j2.agent));
  assert.equal(await refused(kit.put(w.claim(j2, s2, j2.agent))), "claim_exists");
  assert.equal(await refused(kit.put(w.decision(cl, "paid", 4, "covered", w.sponsor))), "decision_wrong_issuer");
  assert.equal(await refused(kit.put(w.decision("sha256:" + "6".repeat(64), "paid", 4, "covered"))), "decision_unknown_claim");
  assert.equal(await refused(kit.put(w.decision(cl, "reduced", 4, "covered"))), "decision_kind_mismatch");
});

test("the reserve floor stops a sale by one credit, and a claim is paid down to the reserve and no further (`reduced`)", async () => {
  // Failed-job cover on a 600 credit job insuring 60: premium 36, 30 of it to the reserve; the floor is 600, so a reserve of 570 sells and 569 does not.
  assert.ok(await (await world(570)).job({ price: 600, cover: "failed_job", insured: 60 }));
  assert.equal(await refused((await world(569)).job({ price: 600, cover: "failed_job", insured: 60 })), "reserve_below_floor");
  // Payouts can use up the reserve: 22 policies of 30 on 100 credit jobs are sold (each adds 6), then every job fails; the 22nd claim is `reduced` to what is left and the reserve is 0, never below.
  const w = await world(500);
  const jobs = [];
  for (let i = 0; i < 22; i++) jobs.push(await w.job({ price: 100, cover: "failed_job", insured: 30 }));
  let reduced = 0;
  for (const j of jobs) {
    const settlement = await w.fail(j, 10);
    const claimId = await w.kit.put(w.claim(j, settlement, w.principal));
    const have = await w.bal(INSURER_DID);
    const due = Math.min(30, have);
    if (due < 30) {
      assert.equal(await refused(w.kit.put(w.decision(claimId, "paid", 30, "covered"))), "decision_amount_mismatch", "the payment can never exceed the reserve");
      assert.equal(await refused(w.kit.put(w.decision(claimId, "paid", due, "covered"))), "decision_kind_mismatch", "less than the terms give is `reduced`");
      reduced++;
    }
    await w.kit.put(w.decision(claimId, due < 30 ? "reduced" : "paid", due, "covered"));
    assert.ok((await w.bal(INSURER_DID)) >= 0, "the reserve is never negative");
  }
  assert.equal(reduced, 1);
  assert.equal(await w.bal(INSURER_DID), 0, "paid down to nothing and no further");
});

test("(T14) property: over 40 seeded random sales, failures and claims, no sale leaves the reserve below its floor and the reserve is never negative", async () => {
  const w = await world(520);
  const { kit } = w;
  let s = 987654;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let sold = 0, refusedSales = 0, paid = 0, largest = 0;
  for (let i = 0; i < 40; i++) {
    const cover: Cover = rnd() < 0.5 ? "bond_slash" : "failed_job";
    const price = 100 + Math.floor(rnd() * 300);
    const insured = Math.min(price, 10 + Math.floor(rnd() * 50));
    let j;
    try { j = await w.job({ price, cover, insured }); } catch (e) {
      assert.equal((e as { detail?: string }).detail, "reserve_below_floor", "a sale is refused only for the floor");
      refusedSales++;
      continue;
    }
    sold++;
    largest = Math.max(largest, insured);
    assert.ok((await w.bal(INSURER_DID)) >= reserveFloor(largest, paid), "no sale leaves the reserve below its floor");
    const slashed = 1 + Math.floor(rnd() * 15);
    const settlement = await w.fail(j, slashed);
    const claimId = await kit.put(w.claim(j, settlement, cover === "failed_job" ? w.principal : j.agent));
    const terms = payoutFor(cover, insured, price, slashed, Math.ceil((slashed * 1000) / 20));
    const due = Math.min(terms.amount, await w.bal(INSURER_DID));
    if (terms.amount === 0) await kit.put(w.decision(claimId, "denied", 0, terms.reason!));
    else await kit.put(w.decision(claimId, due === terms.amount ? "paid" : "reduced", due, "covered"));
    paid += due;
    assert.ok((await w.bal(INSURER_DID)) >= 0, "the reserve is never negative");
  }
  assert.ok(sold >= 5 && refusedSales >= 1, `${sold} policies were sold and ${refusedSales} refused at the floor: the floor binds and the sales before it went through`);
  assert.equal((await kit.log.verify()).ok, true);
});

test("DK184 done: the Insurer's public page lists the reserve against its floor and each claim decision with its reason, and the monthly report says the same", async () => {
  const { publicReply } = await import("../src/public-pages.ts");
  const w = await world();
  const { kit } = w;
  const j = await w.job({ cover: "bond_slash", insured: 20 });
  const s1 = await w.fail(j, 10);
  const c1 = await kit.put(w.claim(j, s1, j.agent));
  await kit.put(w.decision(c1, "paid", 4, "covered"));
  const j2 = await w.job({ cover: "bond_slash", insured: 20 });
  const s2 = await w.fail(j2, 20);
  const c2 = await kit.put(w.claim(j2, s2, j2.agent));
  await kit.put(w.decision(c2, "denied", 0, "fraud"));

  const page = await kit.log.insurerPage(kit.now());
  assert.equal(page.reserve, await w.bal(INSURER_DID), "the reserve is the account's");
  assert.equal(page.floor, 500, "the floor is at least 500");
  assert.equal(page.aboveFloor, true);
  assert.equal(page.policies, 2);
  assert.equal(page.openPolicies, 2);
  assert.deepEqual(page.claims, { paid: 1, reduced: 0, denied: 1, paidOut: 4 });
  const decisions = await kit.log.insurerClaims();
  assert.deepEqual(decisions.map((d) => [d.decision, d.amount, d.reason]), [["paid", 4, "covered"], ["denied", 0, "fraud"]], "each decision with its reason");
  assert.equal(decisions[1].holder, j2.agent.did);

  const json = await publicReply(kit.log, "/insurer/claims", false);
  assert.deepEqual((json!.json as { result: { reason: string }[] }).result.map((d) => d.reason), ["covered", "fraud"]);
  const reserve = await publicReply(kit.log, "/insurer/reserve", false);
  assert.equal((reserve!.json as { result: { reserve: number } }).result.reserve, page.reserve);
  const html = await publicReply(kit.log, "/insurer/claims", true);
  assert.match(html!.html!, /<th>above its floor<\/th><td>yes<\/td>/);
  assert.match(html!.html!, /<td>denied<\/td><td>0<\/td><td>fraud<\/td>/);
  assert.match(html!.html!, /not insurance in a legal sense/);

  const month = kit.now().slice(0, 7);
  const rep = await kit.log.insurerReport(month);
  assert.equal(rep.policiesSold, 2);
  assert.equal(rep.premiums, 4, "two policies at 2 credits");
  assert.deepEqual(rep.decisions.map((d) => d.reason), ["covered", "fraud"]);
  assert.equal(rep.aboveFloor, true);
  assert.equal((await kit.log.insurerReport("2020-01")).policiesSold, 0);
  await assert.rejects(kit.log.insurerReport("next month"), /YYYY-MM/);
});

// ---- DK183 (spec-delta S483): what was left loose in the Insurer's terms
test("DK183: a claim the reserve could not pay in full is `reduced`, the rest is owed and paid as the reserve recovers, never beyond what is owed or what the reserve holds", async () => {
  const w = await world(500);
  const jobs = [];
  for (let i = 0; i < 22; i++) jobs.push(await w.job({ price: 100, cover: "failed_job", insured: 30 }));
  let last = "";
  let holder = w.principal.did;
  for (const j of jobs) {
    const settlement = await w.fail(j, 10);
    last = await w.kit.put(w.claim(j, settlement, w.principal));
    const due = Math.min(30, await w.bal(INSURER_DID));
    await w.kit.put(w.decision(last, due < 30 ? "reduced" : "paid", due, "covered"));
  }
  const paidSoFar = await w.bal(holder);
  const owed = await w.kit.log.claimOwed(last);
  assert.ok(owed > 0 && owed < 30, `the 22nd claim was reduced and ${owed} is owed`);
  assert.equal(await w.bal(INSURER_DID), 0);
  assert.equal(await refused(w.kit.put(w.decision(last, "paid", owed, "covered"))), "decision_reserve_empty", "nothing to pay from an empty reserve: it waits");
  // The Treasury tops the reserve up by a budget line (owner co-signed, never a mint); the Insurer then pays what is owed, in two steps.
  const at = "2026-12-02T00:00:00Z";
  const budget = await w.kit.put(w.kit.mk("budget", treasury, { institution: INSURER_DID, period: "2026-12", amount: credit(40), purpose: "insurer_reserve" }, null, { at, cosigners: [owner] }));
  await w.kit.put(w.kit.mk("treasury_payment", treasury, { budget, to: INSURER_DID, amount: credit(Math.ceil(owed / 2)) }, null, { at }));
  const half = Math.ceil(owed / 2);
  assert.equal(await refused(w.kit.put(w.decision(last, "paid", owed, "covered"))), "decision_amount_mismatch", "never more than the reserve holds");
  assert.equal(await refused(w.kit.put(w.decision(last, "denied", 0, "covered"))), "decision_wrongly_denied", "a reduced claim is paid further, not denied");
  if (half < owed) {
    assert.equal(await refused(w.kit.put(w.decision(last, "paid", half, "covered"))), "decision_kind_mismatch", "less than is owed is `reduced` again");
    await w.kit.put(w.decision(last, "reduced", half, "covered"));
    assert.equal(await w.kit.log.claimOwed(last), owed - half);
    await w.kit.put(w.kit.mk("treasury_payment", treasury, { budget, to: INSURER_DID, amount: credit(owed - half) }, null, { at: "2026-12-03T00:00:00Z" }));
  }
  await w.kit.put(w.decision(last, "paid", owed - (half < owed ? half : 0), "covered", insurerParty));
  assert.equal(await w.kit.log.claimOwed(last), 0);
  assert.equal(await w.bal(holder), paidSoFar + owed, "the holder received everything the terms gave");
  assert.equal(await refused(w.kit.put(w.decision(last, "paid", 1, "covered"))), "decision_exists", "once nothing is owed the claim is closed");
  assert.equal((await w.kit.log.creditAudit()).verdict, "balanced");
});

test("DK183: the failed-job premium follows the job's class (routine 6 %, skilled 8 %, critical 10 %), read from the intent the contract rests on, with the class named in the refusal", async () => {
  assert.equal(premiumFor("failed_job", 60, 250, 0, 0, "routine"), 15);
  assert.equal(premiumFor("failed_job", 60, 250, 0, 0, "skilled"), 20);
  assert.equal(premiumFor("failed_job", 60, 250, 0, 0, "critical"), 25);
  assert.equal(premiumFor("failed_job", 60, 250, 0, 0), 15, "no class reads as routine");
  assert.equal(premiumFor("bond_slash", 20, 250, 0, 0, "critical"), 2, "bond-slash cover does not read the class");
  const w = await world(600);
  const agent = await w.kit.agent("class-agent", w.sponsor, 1);
  const classed = async (cls: string, price: number, intentBudget = price) => {
    const intent = w.kit.mk("intent", w.principal, { purpose: `A ${cls} job`, acceptance_criteria: ["done"], budget: credit(intentBudget), class: cls, deadline: "2027-12-03T18:00:00Z", verification: { mode: "principal" } }, null, { subject: w.principal.did });
    await w.kit.put(intent);
    const c = cosign(w.kit.mk("contract", w.principal, { principal: w.principal.did, performer: agent.did, bank: bankP.did, purpose: `A ${cls} job`, price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: intent.id, offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await w.kit.put(c);
    return c.id;
  };
  const critical = await classed("critical", 250);
  assert.equal(await w.kit.log.jobClassOf(critical), "critical");
  assert.equal(await refused(w.kit.put(w.policyRec(critical, "failed_job", 60, w.principal, 250))), "premium_mismatch", "the routine premium (15) is refused for a critical job");
  const ok = await w.kit.put(w.policyRec(critical, "failed_job", 60, w.principal, 250, { premium: credit(25) }));
  assert.ok(ok);
  // A class the price cannot support counts as what the price supports: a critical job contracted at 30 counts as routine, 6 %.
  const cheap = await classed("critical", 30, 250);
  assert.equal(await w.kit.log.jobClassOf(cheap), "routine");
  await w.kit.put(w.policyRec(cheap, "failed_job", 9, w.principal, 30, { premium: credit(2) }));
});

test("DK183: the Treasury tops the reserve up by a budget line (owner co-signed, never a mint) and a sale the floor refused goes through", async () => {
  const w = await world(569);
  assert.equal(await refused(w.job({ price: 600, cover: "failed_job", insured: 60 })), "reserve_below_floor");
  const at = "2026-12-02T00:00:00Z";
  const budget = await w.kit.put(w.kit.mk("budget", treasury, { institution: INSURER_DID, period: "2026-12", amount: credit(100), purpose: "insurer_reserve" }, null, { at, cosigners: [owner] }));
  await w.kit.put(w.kit.mk("treasury_payment", treasury, { budget, to: INSURER_DID, amount: credit(20) }, null, { at }));
  assert.equal(await w.bal(INSURER_DID), 589);
  assert.ok(await w.job({ price: 600, cover: "failed_job", insured: 60 }), "the reserve is above the floor again: the sale goes through");
  assert.equal(await refused(w.kit.put(w.kit.mk("treasury_payment", treasury, { budget, to: INSURER_DID, amount: credit(81) }, null, { at }))), "over_budget", "the top-up is capped by the budget");
  assert.equal((await w.kit.log.creditAudit()).verdict, "balanced");
});
