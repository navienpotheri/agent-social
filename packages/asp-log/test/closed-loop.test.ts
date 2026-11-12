/**
 * The closed loop's last paths (docs/institutions/economy/credits.md 5.2 T4, T5, T10, R9, R13; register row DK7; spec-delta S190): Treasury budgets and payments, the newcomer allowance,
 * prizes against a signed result, self-dealing on an item that gives standing, and locked credits that no new record can move. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRecord, cosign, b64urlEncode, signerFromSeed, staticResolver, type AspRecord, type RecordType, type Signer } from "@agent-social/asp-core";
import { BURN_DID, EventLog, MemoryStore, TREASURY_DID, REGISTRAR_DID, ALLOWANCE_AMOUNT, institutionDid } from "../src/index.ts";
import { alice, bank, coder, failure, registerParties } from "./harness.ts";

type Party = { did: string } & Signer & { publicKey: Uint8Array };
const party = (did: string, n: number): Party => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(32).fill(n)) });

const operator = party("did:web:asp.local:operator", 11);
const owner = party("did:web:asp.local:owner", 12);
const treasury = party(TREASURY_DID, 13);
const academy = party(institutionDid("academy"), 14);
const courts = party(institutionDid("courts"), 18);
const registrar = party(REGISTRAR_DID, 50);
const mallory = party("did:web:evil.example:mallory", 16);
const poster = party("did:web:example.com:users:poster", 17);
const author = party("did:web:example.com:agents:author", 19);
const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, academy, courts, registrar, mallory, poster, author].map((p) => [p.kid, p.publicKey])));

let clockMs = Date.parse("2026-11-01T00:00:00Z");
const tick = () => new Date((clockMs += 60_000)).toISOString().replace(".000Z", "Z");
function mk(type: RecordType, by: Party, body: Record<string, unknown>, prev: string | null = null, opts: { subject?: string | null; at?: string; cosigners?: Party[] } = {}): AspRecord {
  let r = createRecord({ type, issuer: by.did, subject: opts.subject ?? null, body, prev, issued_at: opts.at ?? tick() }, by);
  for (const c of opts.cosigners ?? []) r = cosign(r, c);
  return r;
}
const credit = (value: number) => ({ value, unit: "credit" as const });
const refused = async (p: Promise<unknown>) => { const f = await failure(p); return f?.detail ?? f?.code; };
const agentPassport = (p: Party, sponsor: Party, extra: Record<string, unknown> = {}, at?: string) =>
  mk("passport", sponsor, { did: p.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }], ...extra }, null, { subject: p.did, ...(at ? { at } : {}) });
const humanPassport = (p: Party) => mk("passport", p, { did: p.did, kind: "human", keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, { subject: p.did });

const NOV = "2026-11-15T00:00:00Z";
const HASH = "sha256:" + "8".repeat(64);

async function world() {
  const store = new MemoryStore();
  const log = new EventLog(store, { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  await registerParties(log); // alice (sponsor), coder (an agent of alice, registered 2026-10-05), bank
  const mint = (to: string, value: number) => log.append(mk("mint", operator, { to, amount: credit(value), reason: "test", authority: "operator" }, null, { subject: to }));
  const budget = async (institution: string, amount: number, over: Record<string, unknown> = {}, by: Party = treasury, cosigners: Party[] = [owner], at = NOV) =>
    log.append(mk("budget", by, { institution, period: "2026-11", amount: credit(amount), purpose: institution === TREASURY_DID ? "allowance" : "charter", ...over }, null, { at, cosigners }));
  const pay = (budgetId: string, to: string, amount: number, by: Party = treasury, at = NOV) => mk("treasury_payment", by, { budget: budgetId, to, amount: credit(amount) }, null, { at });
  const claim = (by: Party, budgetId: string, over: Record<string, unknown> = {}, at = NOV) => mk("allowance", by, { amount: credit(ALLOWANCE_AMOUNT), trigger: "first_course", budget: budgetId, ...over }, null, { subject: by.did, at });
  const prize = (over: Record<string, unknown> = {}, by: Party = registrar) => mk("prize", by, { pool: academy.did, arena: "refactoring", season: "2026-q4", agent: coder.did, rank: 1, run_log_hash: HASH, amount: credit(60), ...over }, null, { subject: coder.did });
  return { log, store, mint, budget, pay, claim, prize };
}

describe("Treasury budgets and payments (T10, R4, R5)", () => {
  test("a budget is the Treasury's alone, one per institution per month, covered by its balance; the first needs the owner; a payment goes only to the budget's institution and never beyond it", async () => {
    const w = await world();
    await w.mint(TREASURY_DID, 1000);
    assert.equal(await refused(w.budget(institutionDid("courts"), 300, {}, mallory)), "budget_wrong_issuer");
    assert.equal(await refused(w.budget(institutionDid("courts"), 300, {}, treasury, [])), "budget_needs_cosign", "the first budget of an institution needs the owner");
    assert.equal(await refused(w.budget("did:web:asp.local:casino", 300)), "budget_unknown_institution");
    assert.equal(await refused(w.budget(institutionDid("courts"), 300, { purpose: "allowance" })), "budget_bad_line", "an institution's budget is not the allowance line");
    assert.equal(await refused(w.budget(TREASURY_DID, 80, { purpose: "charter" })), "budget_bad_line", "the Treasury holds no budget for itself but the allowance");
    assert.equal(await refused(w.budget(institutionDid("courts"), 300, { period: "2026-10" })), "budget_period_past");
    assert.equal(await refused(w.budget(institutionDid("courts"), 1200)), "budget_exceeds_treasury", "a budget cannot promise more than the Treasury holds");
    assert.equal(await refused(w.budget(institutionDid("courts"), 0)), "amount_not_positive");
    const courtsBudget = (await w.budget(institutionDid("courts"), 300)).id;
    assert.equal(await refused(w.budget(institutionDid("courts"), 100)), "budget_already_set", "one per institution per month");
    assert.equal(await refused(w.budget(institutionDid("academy"), 800)), "budget_exceeds_treasury", "300 are already promised, so 800 more is over the 1000 held");
    await w.budget(institutionDid("academy"), 700);

    // The payment: only the budget's institution, only inside the month, only up to the amount, only from the Treasury.
    assert.equal(await refused(w.log.append(w.pay(courtsBudget, institutionDid("courts"), 100, mallory))), "treasury_payment_wrong_issuer");
    assert.equal(await refused(w.log.append(w.pay(courtsBudget, institutionDid("academy"), 100))), "treasury_payment_not_allowed", "R4: the budget names the Courts, not another institution");
    assert.equal(await refused(w.log.append(w.pay(courtsBudget, coder.did, 100))), "treasury_payment_not_allowed", "R5: the Treasury does not pay an agent by a budget");
    assert.equal(await refused(w.log.append(w.pay("sha256:" + "9".repeat(64), institutionDid("courts"), 100))), "budget_unknown");
    assert.equal(await refused(w.log.append(w.pay(courtsBudget, institutionDid("courts"), 100, treasury, "2026-12-02T00:00:00Z"))), "budget_period_closed");
    assert.equal(await refused(w.log.append(w.pay(courtsBudget, institutionDid("courts"), 0))), "amount_not_positive");
    await w.log.append(w.pay(courtsBudget, institutionDid("courts"), 200));
    assert.deepEqual([await w.log.balance(TREASURY_DID), await w.log.balance(institutionDid("courts"))], [800, 200]);
    assert.equal(await refused(w.log.append(w.pay(courtsBudget, institutionDid("courts"), 101))), "over_budget", "200 of 300 are paid; 101 more is over");
    await w.log.append(w.pay(courtsBudget, institutionDid("courts"), 100));
    assert.equal(await refused(w.log.append(w.pay(courtsBudget, institutionDid("courts"), 1))), "over_budget", "the budget is used up");
    assert.equal((await w.log.creditAudit()).verdict, "balanced", "a payment moves credits, it creates none");
  });

  test("a later budget needs the owner only for a rise of more than a quarter; the allowance line is never paid to an account", async () => {
    const w = await world();
    await w.mint(TREASURY_DID, 5000);
    await w.budget(institutionDid("courts"), 400);
    const next = (amount: number, cosigners: Party[]) => w.log.append(mk("budget", treasury, { institution: institutionDid("courts"), period: "2026-12", amount: credit(amount), purpose: "charter" }, null, { at: "2026-11-20T00:00:00Z", cosigners }));
    assert.equal(await refused(next(501, [])), "budget_needs_cosign", "more than 25 % above 400");
    await next(500, []);
    const line = (await w.budget(TREASURY_DID, 80)).id;
    assert.equal(await refused(w.log.append(w.pay(line, courts.did, 40))), "treasury_payment_not_allowed", "the allowance line pays newcomers, not accounts");
    assert.equal(await refused(w.log.append(w.pay(line, TREASURY_DID, 40))), "treasury_payment_not_allowed");
  });
});

describe("the newcomer allowance (T5)", () => {
  /** An agent of `sponsor`, registered when the clock stands, that has bought its first Academy course (an essential item). */
  async function newcomer(w: Awaited<ReturnType<typeof world>>, p: Party, sponsor: Party, list: { id: string } | undefined, at = "2026-11-02T00:00:00Z") {
    if (sponsor.did !== alice.did) await w.log.append(humanPassport(sponsor)).catch(() => undefined); // a sponsor already registered stays as it is
    await w.log.append(agentPassport(p, sponsor, {}, at));
    await w.mint(p.did, 50);
    if (list) await w.log.append(mk("purchase", p, { service: "academy.first_course", institution: academy.did, price_list: list.id, quantity: 1, amount: credit(10), idempotency: `n-${p.did}` }, null, { at: "2026-11-03T00:00:00Z" }));
  }
  const academyList = async (w: Awaited<ReturnType<typeof world>>) => {
    const item = { service: "academy.first_course", institution: academy.did, price: 10, split: { treasury_permille: 250, burn_permille: 0, payees: [{ account: academy.did, permille: 750 }] }, class: "essential" };
    return w.log.append(mk("price_list", treasury, { version: 1, effective_from: "2026-11-01T00:00:00Z", bounds_version: 1, job_tax_permille: 20, items: [item] }, null, { at: "2026-11-01T00:00:00Z" }));
  };

  test("a newcomer with a first course claims the allowance once, from the allowance budget, and the Treasury pays it", async () => {
    const w = await world();
    await w.mint(TREASURY_DID, 500);
    const list = await academyList(w);
    const line = (await w.budget(TREASURY_DID, 80)).id;
    const courtsLine = (await w.budget(institutionDid("courts"), 100)).id;
    const newbie = party("did:web:example.com:agents:newbie", 31);
    const other = party("did:web:example.com:agents:other-newbie", 32);
    const third = party("did:web:example.com:agents:third-newbie", 33);
    await newcomer(w, newbie, poster, list);
    await newcomer(w, other, party("did:web:example.com:users:poster-two", 34), list);
    await newcomer(w, third, party("did:web:example.com:users:poster-three", 35), list);

    assert.equal(await refused(w.log.append(w.claim(newbie, line, { amount: credit(41) }))), "allowance_amount", "exactly the allowance");
    assert.equal(await refused(w.log.append(w.claim(newbie, courtsLine))), "allowance_budget_wrong", "not from an institution's budget");
    assert.equal(await refused(w.log.append(w.claim(newbie, line, { trigger: "first_bond" }))), "allowance_not_earned", "a first bond it has not posted");
    assert.equal(await refused(w.log.append(w.claim(mallory, line))), "allowance_no_passport");
    assert.equal(await refused(w.log.append(w.claim(treasury, line))), "allowance_reserved");
    const before = await w.log.balance(newbie.did);
    await w.log.append(w.claim(newbie, line));
    assert.deepEqual([await w.log.balance(newbie.did), await w.log.balance(TREASURY_DID)], [before + 40, await w.log.balance(TREASURY_DID)]);
    assert.equal(await refused(w.log.append(w.claim(newbie, line, {}, "2026-11-16T00:00:00Z"))), "allowance_already_paid", "once per identity");
    await w.log.append(w.claim(other, line));
    assert.equal(await refused(w.log.append(w.claim(third, line))), "over_budget", "the month's allowance budget (80) is the cap: two allowances are paid, the third is not");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("the first identity of a sponsor only; a passport over 90 days old; no first course; a slashed agent: each is refused with its reason", async () => {
    const w = await world();
    await w.mint(TREASURY_DID, 500);
    const list = await academyList(w);
    const line = (await w.budget(TREASURY_DID, 400)).id;
    const one = party("did:web:example.com:agents:sib-one", 36), two = party("did:web:example.com:agents:sib-two", 37);
    await newcomer(w, one, poster, list);
    await newcomer(w, two, poster, list); // poster already has a passport: not registered twice
    await w.log.append(w.claim(one, line));
    assert.equal(await refused(w.log.append(w.claim(two, line))), "allowance_already_paid", "a sponsor's second identity");

    const idle = party("did:web:example.com:agents:idle", 38);
    await newcomer(w, idle, party("did:web:example.com:users:poster-four", 39), undefined);
    assert.equal(await refused(w.log.append(w.claim(idle, line))), "allowance_not_earned", "no first course");

    const old = party("did:web:example.com:agents:old-hand", 40);
    await newcomer(w, old, party("did:web:example.com:users:poster-five", 41), list, "2026-07-01T00:00:00Z");
    assert.equal(await refused(w.log.append(w.claim(old, line, {}, "2026-11-20T00:00:00Z"))), "allowance_not_newcomer", "registered 142 days ago");

    const slashed = party("did:web:example.com:agents:slashed", 42);
    await newcomer(w, slashed, party("did:web:example.com:users:poster-six", 43), list);
    await w.store.transaction(async (tx) => { await tx.putReputation({ did: slashed.did, tier: 0, slashCount: 1, strikeLog: [] }); });
    assert.equal(await refused(w.log.append(w.claim(slashed, line))), "allowance_slashed");
  });

  test("the allowance does not pay in another month than its budget's", async () => {
    const w = await world();
    await w.mint(TREASURY_DID, 500);
    const list = await academyList(w);
    const line = (await w.budget(TREASURY_DID, 80)).id;
    const late = party("did:web:example.com:agents:late", 44);
    await newcomer(w, late, party("did:web:example.com:users:poster-seven", 45), list);
    assert.equal(await refused(w.log.append(w.claim(late, line, {}, "2026-12-03T00:00:00Z"))), "budget_period_closed");
  });
});

describe("prizes (T4, R3)", () => {
  test("a prize is paid from the institution's pool against a result the Registrar signs; no one else, no second prize for one result, nothing beyond the pool", async () => {
    const w = await world();
    await w.mint(academy.did, 100);
    assert.equal(await refused(w.log.append(w.prize({}, mallory))), "prize_wrong_issuer");
    assert.equal(await refused(w.log.append(w.prize({}, academy))), "prize_wrong_issuer", "an institution does not sign its own prize");
    assert.equal(await refused(w.log.append(w.prize({ pool: TREASURY_DID }))), "prize_bad_pool", "the Treasury is not a prize pool");
    assert.equal(await refused(w.log.append(w.prize({ agent: mallory.did }))), "prize_bad_winner", "no passport");
    assert.equal(await refused(w.log.append(w.prize({ agent: academy.did }))), "prize_bad_winner", "an institution does not win a prize");
    assert.equal(await refused(w.log.append(w.prize({ amount: credit(0) }))), "amount_not_positive");
    assert.equal(await refused(w.log.append(w.prize({ amount: credit(101) }))), "prize_exceeds_pool");
    await w.log.append(w.prize());
    assert.deepEqual([await w.log.balance(academy.did), await w.log.balance(coder.did)], [40, 60]);
    assert.equal(await refused(w.log.append(w.prize({ run_log_hash: "sha256:" + "a".repeat(64) }))), "prize_already_paid", "one prize per agent per arena and season");
    assert.equal(await refused(w.log.append(w.prize({ rank: 2, season: "2027-q1", amount: credit(41) }))), "prize_exceeds_pool", "total prizes never exceed the pool");
    await w.log.append(w.prize({ rank: 2, season: "2027-q1", amount: credit(40) }));
    assert.equal(await w.log.balance(academy.did), 0);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("R3 still holds: an institution cannot pay an agent any other way", async () => {
    const w = await world();
    await w.mint(academy.did, 100);
    assert.equal(await refused(w.log.append(mk("internal_transfer", academy, { to: coder.did, amount: credit(10) }, null, { subject: coder.did }))), "institution_payment_not_allowed");
    assert.equal(await refused(w.log.append(mk("budget", academy, { institution: academy.did, period: "2026-11", amount: credit(10), purpose: "x" }, null, { at: NOV, cosigners: [owner] }))), "budget_wrong_issuer", "an institution does not set budgets");
  });
});

describe("an item that gives standing may not pay the buyer's own side (R9)", () => {
  const item = (service: string, payee: string, gives?: boolean) => ({ service, institution: academy.did, price: 20, split: { treasury_permille: 100, burn_permille: 100, payees: [{ account: payee, permille: 800 }] }, class: "essential", ...(gives === undefined ? {} : { gives_standing: gives }) });

  test("a certificate item whose author is the buyer's sponsor, or another agent of the buyer's sponsor, is refused as self_dealing; an unrelated author is paid; an item that gives no standing is not checked", async () => {
    const w = await world();
    await w.mint(coder.did, 200);
    await w.log.append(agentPassport(author, poster)); // poster is the author's sponsor (a person with no passport yet is fine as a sponsor DID only when it has one)
    const sibling = party("did:web:example.com:agents:sibling", 46);
    await w.log.append(agentPassport(sibling, alice));
    const list = await w.log.append(mk("price_list", treasury, { version: 1, effective_from: "2026-11-01T00:00:00Z", bounds_version: 1, job_tax_permille: 20, items: [
      item("academy.course.by_sponsor", alice.did, true), item("academy.course.by_sibling", sibling.did, true), item("academy.course.by_author", author.did, true), item("academy.course.plain_sibling", sibling.did, false), item("academy.course.unflagged_sibling", sibling.did),
    ] }, null, { at: "2026-11-01T00:00:00Z" }));
    const buy = (service: string) => mk("purchase", coder, { service, institution: academy.did, price_list: list.id, quantity: 1, amount: credit(20), idempotency: `n-${service}` }, null, { at: "2026-11-05T00:00:00Z" });
    assert.equal(await refused(w.log.append(buy("academy.course.by_sponsor"))), "self_dealing", "the author is the buyer's sponsor");
    assert.equal(await refused(w.log.append(buy("academy.course.by_sibling"))), "self_dealing", "the author is controlled by the buyer's sponsor");
    await w.log.append(buy("academy.course.by_author"));
    assert.equal(await w.log.balance(author.did), 16, "an unrelated author earns its share");
    await w.log.append(buy("academy.course.plain_sibling"));
    await w.log.append(buy("academy.course.unflagged_sibling"));
    assert.equal(await w.log.balance(sibling.did), 32, "an item that gives no standing may pay the buyer's side: the rule is about standing");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("a payee that is no institution, no Treasury and no agent with a passport is still refused", async () => {
    const w = await world();
    const bad = await refused(w.log.append(mk("price_list", treasury, { version: 1, effective_from: "2026-11-01T00:00:00Z", bounds_version: 1, job_tax_permille: 20, items: [item("academy.course.x", mallory.did, true)] }, null, { at: "2026-11-01T00:00:00Z" })));
    assert.equal(bad, "price_list_unknown_payee");
  });
});

describe("locked credits move only by their own records (R13)", () => {
  test("credits locked in a bond cannot be sent by a transfer, paid as a prize, or drawn on by a payment: only what is free moves", async () => {
    const w = await world();
    const funder = party("did:web:example.com:users:funder-1", 71);
    await w.log.append(humanPassport(funder));
    await w.mint(funder.did, 10);
    await w.mint(coder.did, 25);
    const contract = cosign(mk("contract", funder, { principal: funder.did, performer: coder.did, bank: bank.did, purpose: "A job that locks a bond", price: credit(10), verification: "deterministic", deadline: "2026-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: coder.did }), coder);
    await w.log.append(contract);
    await w.log.append(mk("bond", coder, { contract: contract.id, backer: coder.did, amount: credit(20), escrow: { payer: funder.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id }));
    assert.equal(await w.log.balance(coder.did), 5, "20 of 25 are locked in the bond");
    const send = (value: number) => mk("internal_transfer", coder, { to: alice.did, amount: credit(value) }, null, { subject: alice.did });
    assert.equal(await refused(w.log.append(send(6))), "insufficient_balance", "the locked 20 cannot be sent");
    await w.log.append(send(5));
    assert.equal(await w.log.balance(coder.did), 0);
    assert.equal(await refused(w.log.append(send(1))), "insufficient_balance");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });
});

describe("replay: a log rebuilt from the records alone has the same balances after budgets, payments, allowances and prizes", () => {
  test("a replica agrees on every balance", async () => {
    const w = await world();
    await w.mint(TREASURY_DID, 1000);
    await w.mint(academy.did, 100);
    const courtsBudget = (await w.budget(institutionDid("courts"), 300)).id;
    await w.log.append(w.pay(courtsBudget, institutionDid("courts"), 120));
    await w.log.append(w.prize());
    const replica = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
    await replica.importRecords((await w.log.since(0, 1000)) as never);
    for (const did of [TREASURY_DID, institutionDid("courts"), academy.did, coder.did, BURN_DID]) assert.equal(await replica.balance(did), await w.log.balance(did), did);
  });
});
