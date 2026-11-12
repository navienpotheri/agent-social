/**
 * The first thin slice of the credit economy (docs/institutions/economy/credits.md CR-2, CR-3, CR-4, CR-5, CR-6; register rows DK1, DK9, DK67, DK68; spec-delta S163).
 * Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRecord, cosign, b64urlEncode, signerFromSeed, staticResolver, type AspRecord, type RecordType, type Signer } from "@agent-social/asp-core";
import { BURN_DID, EventLog, MemoryStore, PLATFORM_DID, SPLIT_BOUNDS_V1, TREASURY_DID, institutionDid, refundParts, splitParts, splitProblem, type Split } from "../src/index.ts";
import { alice, bank, coder, failure, registerParties } from "./harness.ts";

type Party = { did: string } & Signer & { publicKey: Uint8Array };
const party = (did: string, n: number): Party => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(32).fill(n)) });

const operator = party("did:web:asp.local:operator", 11);
const owner = party("did:web:asp.local:owner", 12);
const treasury = party(TREASURY_DID, 13);
const market = party(institutionDid("market"), 14);
const burn = party(BURN_DID, 15);
const mallory = party("did:web:evil.example:mallory", 16);
const poster = party("did:web:example.com:users:poster", 17);
const worker = party("did:web:example.com:agents:worker-9", 18);
const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, market, burn, mallory].map((p) => [p.kid, p.publicKey])));

const HOUR = 3_600_000;
let clockMs = Date.parse("2026-11-01T00:00:00Z");
const tick = () => new Date((clockMs += 60_000)).toISOString().replace(".000Z", "Z");
function mk(type: RecordType, by: Party, body: Record<string, unknown>, prev: string | null = null, opts: { subject?: string | null; at?: string; cosigners?: Party[] } = {}): AspRecord {
  let r = createRecord({ type, issuer: by.did, subject: opts.subject ?? null, body, prev, issued_at: opts.at ?? tick() }, by);
  for (const c of opts.cosigners ?? []) r = cosign(r, c);
  return r;
}
const credit = (value: number) => ({ value, unit: "credit" as const });
const mintBody = (to: string, value: number, reason = "bootstrap") => ({ to, amount: credit(value), reason, authority: "operator" });

const split = (treasuryP: number, burnP: number, payees: [string, number][]): Split => ({ treasury_permille: treasuryP, burn_permille: burnP, payees: payees.map(([account, permille]) => ({ account, permille })) });
const item = (service: string, price: number, s: Split, cls = "standard") => ({ service, institution: market.did, price, split: s, class: cls });
/** posting deposit: 150 treasury, 100 burn, 750 to the Market (credits.md market.md 4); mentoring: an `essential` item that burns nothing. */
const DEPOSIT = split(150, 100, [[market.did, 750]]);
const priceList = (version: number, at: string, items: unknown[], extra: Record<string, unknown> = {}) => ({ version, effective_from: at, bounds_version: 1, job_tax_permille: 20, items, ...extra });
const listV1 = (at: string) => priceList(1, at, [item("market.posting.deposit", 40, DEPOSIT), item("market.first_course", 30, split(250, 0, [[market.did, 750]]), "essential")]);

async function world() {
  const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  await registerParties(log); // alice (sponsor), coder (an agent), bank
  const mintSigned = (to: string, value: number, reason = "bootstrap") => log.append(mk("mint", operator, mintBody(to, value, reason), null, { subject: to }));
  const issueList = async (body: Record<string, unknown>, prev: string | null, at = tick()) => (await log.append(mk("price_list", treasury, body, prev, { at }))).id;
  const buy = (by: Party, list: string, over: Record<string, unknown> = {}, at = tick()) =>
    mk("purchase", by, { service: "market.posting.deposit", institution: market.did, price_list: list, quantity: 1, amount: credit(40), idempotency: `n-${at}`, ...over }, null, { at });
  const receipt = (by: Party, purchase: string, body: Record<string, unknown> = {}) => mk("receipt", by, { purchase, status: "delivered", ...body }, purchase);
  return { log, mintSigned, issueList, buy, receipt };
}

/** The log rule that refused (its name), or the error code for a refusal that is not a named rule; undefined if it was accepted. */
const refused = async (p: Promise<unknown>) => { const f = await failure(p); return f?.detail ?? f?.code; };

describe("the split policy (CR-4)", () => {
  test("every part sums to the price at every price from 1 to 1000, for every sample split, with the remainder to the first payee", () => {
    const splits = [DEPOSIT, split(50, 50, [[market.did, 600], [institutionDid("academy"), 300]]), split(300, 150, [[market.did, 550]]), split(250, 0, [[market.did, 750]])];
    for (const s of splits) {
      for (let price = 1; price <= 1000; price++) {
        const p = splitParts(price, s);
        assert.equal(p.treasury + p.burn + p.payees.reduce((n, x) => n + x.amount, 0), price, `price ${price}`);
        assert.equal(p.treasury, Math.floor((price * s.treasury_permille) / 1000));
        assert.equal(p.burn, Math.floor((price * s.burn_permille) / 1000));
        assert.ok(p.payees.every((x) => x.amount >= 0));
        const r = refundParts(price - p.burn, p)!;
        assert.equal(r.treasury + r.payees.reduce((n, x) => n + x.amount, 0), price - p.burn, "a full refund is price less burn");
      }
    }
    assert.deepEqual(splitParts(40, DEPOSIT), { treasury: 6, burn: 4, payees: [{ account: market.did, amount: 30 }] });
    assert.equal(refundParts(37, splitParts(40, DEPOSIT)), null, "the burned part is not refundable");
  });

  test("bounds: one permille outside each bound is refused, at the bound is accepted; a standard item needs burn >= 50, an essential one may burn 0", () => {
    const ok = (s: Split, cls = "standard") => splitProblem(s, cls as "standard") === null;
    assert.ok(ok(split(150, 100, [[market.did, 750]])));
    assert.ok(ok(split(50, 50, [[market.did, 900]])), "provider 900, treasury 50, burn 50: all at a bound");
    assert.ok(ok(split(300, 150, [[market.did, 550]])), "provider 550, treasury 300, burn 150: all at a bound");
    assert.ok(!ok(split(49, 51, [[market.did, 900]])), "treasury 49");
    assert.ok(!ok(split(301, 149, [[market.did, 550]])), "treasury 301");
    assert.ok(!ok(split(50, 49, [[market.did, 901]])), "burn 49 on a standard item, and provider 901");
    assert.ok(!ok(split(299, 151, [[market.did, 550]])), "burn 151");
    assert.ok(!ok(split(300, 151, [[market.did, 549]])), "provider 549");
    assert.ok(!ok(split(150, 100, [[market.did, 700]])), "sums to 950");
    assert.ok(ok(split(250, 0, [[market.did, 750]]), "essential"), "burn 0 on an essential item");
    assert.ok(ok(split(250, 0, [[market.did, 750]]), "remedial"));
    assert.ok(!ok(split(250, 0, [[market.did, 750]])), "burn 0 on a standard item");
    assert.equal(splitProblem(split(150, 100, [[mallory.did, 750]]), "standard")?.rule, "price_list_unknown_payee");
  });
});

describe("the slice, end to end", () => {
  test("a job is accepted and earns credits; every credit has a signed mint; the fee is split provider/Treasury/burn; a Market listing is bought with a receipt; the audit balances; standing is untouched", async () => {
    const w = await world();
    const { log } = w;
    // 1. Every credit created is a signed mint record, with a reason.
    await w.mintSigned(poster.did, 1000, "test");
    await w.mintSigned(coder.did, 200, "starter_upfront");
    assert.equal(await log.balance(poster.did), 1000);

    // 2. An accepted job: the poster's escrow goes to the agent; the bank signs a settlement with a fee of 5 (it lands in the Treasury, the old platform account's alias).
    await log.append(passport(poster));
    const price = 100;
    const contract = cosign(mk("contract", poster, { principal: poster.did, performer: coder.did, bank: bank.did, purpose: "Fix the flaky test", price: credit(price), verification: "deterministic", deadline: "2026-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: coder.did }), coder);
    await log.append(contract);
    const bond = mk("bond", coder, { contract: contract.id, backer: coder.did, amount: credit(20), escrow: { payer: poster.did, amount: credit(price) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await log.append(bond);
    const mandate = mk("mandate", poster, { contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2027-01-01T00:00:00Z", revocable: true }, bond.id, { subject: coder.did });
    await log.append(mandate);
    const delivery = mk("delivery", coder, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, mandate.id, { subject: contract.id });
    await log.append(delivery);
    const accept = mk("attestation", poster, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: contract.id });
    await log.append(accept);
    await log.append(mk("settlement", bank, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: credit(95), fees: credit(5), bond_returned: credit(20), bond_slashed: credit(0) }, accept.id, { subject: contract.id, cosigners: [poster] }));
    assert.equal(await log.balance(coder.did), 200 - 20 + 95 + 20, "the agent earned 95 credits of the poster's escrow");
    assert.equal(await log.balance(poster.did), 1000 - price);
    assert.equal(await log.balance(TREASURY_DID), 5, "the settlement fee lands in the Treasury");
    assert.equal(await log.balance(PLATFORM_DID), 5, "the old platform account is an alias of the Treasury");
    const standingBefore = await log.reputationOf(coder.did);

    // 3. The Treasury publishes the price list. The agent buys a Market listing (a posting deposit, 40) by the standard rule.
    const t0 = tick();
    const list1 = await w.issueList(listV1(t0), null, t0);
    const purchase = w.buy(coder, list1);
    await log.append(purchase);
    assert.equal(await log.balance(coder.did), 295 - 40);
    assert.equal(await log.balance(market.did), 30, "provider share 750 permille");
    assert.equal(await log.balance(TREASURY_DID), 5 + 6, "Treasury share 150 permille (floor)");
    assert.equal(await log.balance(BURN_DID), 4, "burn share 100 permille");
    const rcpt = w.receipt(market, purchase.id, { delivered_ref: "posting-1" });
    await log.append(rcpt);
    assert.equal((await log.chain(purchase.id)).length, 2, "the receipt is chained on the purchase");

    // 4. The audit: supply = balances + locks (+ burned, in the balances) = minted; every minted credit is signed.
    const audit = await log.creditAudit();
    assert.equal(audit.verdict, "balanced", audit.problems.join("; "));
    assert.equal(audit.minted, 1200);
    assert.equal(audit.mintedSigned, 1200);
    assert.equal(audit.mintedUnsigned, 0, "no credit was created without a signed mint record");
    assert.equal(audit.burned, 4);
    assert.equal(audit.treasury, 11);
    assert.deepEqual(audit.institutions, [{ did: market.did, balance: 30 }]);
    assert.equal(audit.balances, 1200);
    assert.equal(audit.circulating, 1200 - 11 - 4 - 30);
    assert.equal(audit.difference, 0);
    const flows = await log.creditFlows();
    assert.deepEqual(flows.mintedByReason, { test: 1000, starter_upfront: 200 });
    assert.deepEqual({ ...flows.purchases, byService: undefined }, { count: 1, amount: 40, provider: 30, treasury: 6, burned: 4, byService: undefined });

    // 5. Credits never change standing: tier, strikes, counts are exactly what the job alone made them.
    assert.deepEqual(await log.reputationOf(coder.did), standingBefore);

    // 6. A replica replaying every record reproduces every balance and the minted total, with no mint snapshot.
    assert.equal((await log.verify()).ok, true);
    const replica = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
    await replica.importRecords(await log.since(0, 1000));
    for (const did of [poster.did, coder.did, market.did, TREASURY_DID, BURN_DID]) assert.equal(await replica.balance(did), await log.balance(did), did);
    const again = await replica.creditAudit();
    assert.equal(again.minted, 1200); assert.equal(again.mintedUnsigned, 0); assert.equal(again.verdict, "balanced");
  });

  test("a deliberately corrupted log fails the audit (one credit changed, one credit lost, one burned credit returned)", async () => {
    const w = await world();
    await w.mintSigned(coder.did, 100);
    const t0 = tick();
    const list1 = await w.issueList(listV1(t0), null, t0);
    await w.log.append(w.buy(coder, list1));
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    const tamper = async (edit: (accounts: Map<string, { did: string; balance: number }>) => void) => {
      const state = (w.log.store as MemoryStore).exportState();
      const accounts = new Map((state.tables.accounts as [string, { did: string; balance: number }][]));
      edit(accounts);
      state.tables.accounts = [...accounts.entries()];
      const copy = new MemoryStore(); copy.importState(state);
      return new EventLog(copy, { operator: operator.did, fallbackResolver: resolver }).creditAudit();
    };
    const plusOne = await tamper((a) => { a.get(coder.did)!.balance += 1; });
    assert.equal(plusOne.verdict, "mismatch"); assert.equal(plusOne.difference, 1);
    const lost = await tamper((a) => { a.get(market.did)!.balance -= 1; });
    assert.equal(lost.verdict, "mismatch"); assert.equal(lost.difference, -1);
    const unburn = await tamper((a) => { a.get(BURN_DID)!.balance = 0; });
    assert.equal(unburn.verdict, "mismatch", "a burned credit that vanishes from the Burn account is a lost credit");
  });
});

/** a human passport for the poster. */
function passport(p: Party): AspRecord {
  return mk("passport", p, { did: p.did, kind: "human", keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, { subject: p.did });
}

describe("signed mint (CR-2): who may create credits", () => {
  test("only the operator mints; R11 mint_unauthorised, R10 amount_not_positive, no mint into the Burn account, treasury_issuance needs the owner", async () => {
    const w = await world();
    assert.equal(await refused(w.log.append(mk("mint", mallory, mintBody(mallory.did, 1000)))), "mint_unauthorised");
    assert.equal(await refused(w.log.append(mk("mint", alice, mintBody(alice.did, 1000)))), "mint_unauthorised", "even a registered person");
    assert.equal(await refused(w.log.append(mk("mint", operator, mintBody(coder.did, 0)))), "amount_not_positive");
    assert.equal(await refused(w.log.append(mk("mint", operator, mintBody(BURN_DID, 5)))), "mint_to_burn");
    assert.equal(await refused(w.log.append(mk("mint", operator, mintBody(TREASURY_DID, 500, "treasury_issuance")))), "mint_needs_cosign");
    assert.equal(await refused(w.log.append(mk("mint", operator, mintBody(TREASURY_DID, 500, "treasury_issuance"), null, { cosigners: [mallory] }))), "mint_needs_cosign", "a stranger's co-signature is not the owner's");
    await w.log.append(mk("mint", operator, mintBody(TREASURY_DID, 500, "treasury_issuance"), null, { cosigners: [owner] }));
    assert.equal(await w.log.balance(TREASURY_DID), 500);
    assert.equal(await refused(w.log.append(mk("mint", operator, mintBody(coder.did, 5), "sha256:" + "a".repeat(64)))), "BAD_PREV", "a mint cannot be chained");
    assert.equal((await w.log.balance(mallory.did)), 0);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("a log with no operator configured refuses every signed mint; the old unsigned mint still works and is counted apart", async () => {
    const log = new EventLog(new MemoryStore(), { fallbackResolver: resolver });
    assert.equal(await refused(log.append(mk("mint", operator, mintBody(coder.did, 10)))), "mint_unauthorised");
    await log.mint(coder.did, 10);
    const a = await log.creditAudit();
    assert.equal(a.minted, 10); assert.equal(a.mintedSigned, 0); assert.equal(a.mintedUnsigned, 10);
    assert.equal(a.verdict, "balanced");
  });

  test("the unsigned and signed mints add up together and the replay seeds only the unsigned part", async () => {
    const w = await world();
    await w.log.mint(coder.did, 7);
    await w.mintSigned(coder.did, 3);
    await w.log.mint(coder.did, 2);
    const a = await w.log.creditAudit();
    assert.deepEqual([a.minted, a.mintedSigned, a.mintedUnsigned, a.balances], [12, 3, 9, 12]);
    assert.equal((await w.log.verify()).ok, true);
  });
});

describe("price list (CR-5): the rules of credits.md 4.1", () => {
  test("wrong issuer, bad chain, retroactive, notice for a rise or a fall, the 25 % rule with the owner's co-signature, split and payee checks", async () => {
    const w = await world();
    const fail = async (body: Record<string, unknown>, prev: string | null, by: Party = treasury, at = tick(), cosigners: Party[] = []) => refused(w.log.append(mk("price_list", by, body, prev, { at, cosigners })));
    const t0 = tick();
    assert.equal(await fail(listV1(t0), null, alice), "price_list_wrong_issuer");
    assert.equal(await fail(priceList(2, t0, [item("market.a.b", 10, DEPOSIT)]), null), "price_list_bad_chain", "version 1 first");
    assert.equal(await fail(listV1("2026-10-01T00:00:00Z"), null, treasury, t0), "price_list_effective_too_soon", "no retroactive change");
    assert.equal(await fail(priceList(1, t0, [item("market.a.b", 10, split(150, 40, [[market.did, 810]]))]), null, treasury, t0), "price_list_split_invalid", "burn 40 on a standard item");
    assert.equal(await fail(priceList(1, t0, [item("market.a.b", 10, split(150, 100, [[mallory.did, 750]]))]), null, treasury, t0), "price_list_unknown_payee");
    assert.equal(await fail(priceList(1, t0, [{ ...item("market.a.b", 10, DEPOSIT), institution: mallory.did }]), null, treasury, t0), "price_list_unknown_payee", "an unregistered institution");
    assert.equal(await fail(priceList(1, t0, [item("market.a.b", 10, DEPOSIT), item("market.a.b", 11, DEPOSIT)]), null, treasury, t0), "price_list_split_invalid", "a service listed twice");
    const v1 = await w.issueList(listV1(t0), null, t0);

    const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
    const t1 = iso(Date.parse(t0) + 60_000);
    const rise = (price: number, effective: string, v = 2) => priceList(v, effective, [item("market.posting.deposit", price, DEPOSIT), item("market.first_course", 30, split(250, 0, [[market.did, 750]]), "essential")]);
    assert.equal(await fail(rise(45, iso(Date.parse(t1) + 71 * HOUR)), v1, treasury, t1), "price_list_effective_too_soon", "71 hours' notice for a rise");
    assert.equal(await fail(rise(51, iso(Date.parse(t1) + 72 * HOUR)), v1, treasury, t1), "price_list_needs_cosign", "51 is more than 25 % over 40");
    assert.equal(await fail(priceList(3, iso(Date.parse(t1) + 72 * HOUR), [item("market.posting.deposit", 40, DEPOSIT)]), v1, treasury, t1), "price_list_bad_chain", "version 3 skips 2");
    const v2 = (await w.log.append(mk("price_list", treasury, rise(51, iso(Date.parse(t1) + 72 * HOUR)), v1, { at: t1, cosigners: [owner] }))).id;
    // a fall needs 24 hours, a rise inside 25 % needs 72
    const t2 = iso(Date.parse(t1) + 60_000);
    assert.equal(await fail(rise(40, iso(Date.parse(t2) + 23 * HOUR), 3), v2, treasury, t2), "price_list_effective_too_soon", "23 hours for a fall");
    await w.log.append(mk("price_list", treasury, rise(40, iso(Date.parse(t2) + 24 * HOUR), 3), v2, { at: t2 }));
    // a changed bound version needs the owner
    const t3 = iso(Date.parse(t2) + 60_000);
    const head = (await w.log.chain(v1)).at(-1)!.id;
    assert.equal(await fail({ ...rise(40, iso(Date.parse(t3) + 24 * HOUR), 4), bounds_version: 2 }, head, treasury, t3), "price_list_needs_cosign", "changing the bounds needs the owner");
  });
});

describe("purchase and receipt (CR-6): refusals and the closed loop", () => {
  async function ready() {
    const w = await world();
    await w.mintSigned(coder.did, 100, "test");
    const t0 = tick();
    const list1 = await w.issueList(listV1(t0), null, t0);
    return { ...w, list1 };
  }

  test("R7 price_mismatch, a stale list, a wrong institution, an unknown service, no overdraft, replay; each leaves every balance unchanged", async () => {
    const w = await ready();
    const snapshot = async () => [await w.log.balance(coder.did), await w.log.balance(market.did), await w.log.balance(TREASURY_DID), await w.log.balance(BURN_DID)];
    const before = await snapshot();
    assert.equal(await refused(w.log.append(w.buy(coder, w.list1, { amount: credit(39) }))), "price_mismatch");
    assert.equal(await refused(w.log.append(w.buy(coder, w.list1, { quantity: 2, amount: credit(40) }))), "price_mismatch");
    assert.equal(await refused(w.log.append(w.buy(coder, "sha256:" + "b".repeat(64)))), "price_list_not_in_force");
    assert.equal(await refused(w.log.append(w.buy(coder, w.list1, { institution: institutionDid("academy") }))), "institution_mismatch");
    assert.equal(await refused(w.log.append(w.buy(coder, w.list1, { service: "market.unlisted" }))), "unknown_service");
    assert.equal(await refused(w.log.append(w.buy(mallory, w.list1))), "insufficient_balance", "no overdraft");
    assert.equal(await refused(w.log.append(w.buy(coder, w.list1, { amount: credit(0), quantity: 1 }))), "amount_not_positive", "R10: no zero or negative amount");
    assert.deepEqual(await snapshot(), before, "refusals move nothing");
    const first = w.buy(coder, w.list1, { idempotency: "same" });
    await w.log.append(first);
    assert.equal(await refused(w.log.append(w.buy(coder, w.list1, { idempotency: "same" }))), "purchase_replay");
    assert.equal(await w.log.balance(coder.did), 60);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("a purchase is judged against the list in force at its own time: the old price stays valid until the new one takes effect", async () => {
    const w = await ready();
    const t = Date.parse((await w.log.get(w.list1))!.record.issued_at);
    const effective = new Date(t + 72 * HOUR + 120_000).toISOString().replace(".000Z", "Z");
    const v2 = await w.issueList(priceList(2, effective, [item("market.posting.deposit", 50, DEPOSIT), item("market.first_course", 30, split(250, 0, [[market.did, 750]]), "essential")]), w.list1, new Date(t + 120_000).toISOString().replace(".000Z", "Z"));
    const before = new Date(t + 3 * HOUR).toISOString().replace(".000Z", "Z");
    const after = new Date(t + 73 * HOUR).toISOString().replace(".000Z", "Z");
    await w.log.append(w.buy(coder, w.list1, {}, before));
    assert.equal(await refused(w.log.append(w.buy(coder, v2, {}, before))), "price_list_not_in_force", "the new list is not yet in force");
    assert.equal(await refused(w.log.append(w.buy(coder, w.list1, {}, after))), "price_list_not_in_force", "the old list no longer is");
    await w.log.append(w.buy(coder, v2, { amount: credit(50) }, after));
    assert.equal(await w.log.balance(coder.did), 100 - 40 - 50);
  });

  test("R3, R5, R12: an institution, the Treasury and the Burn account never buy, so none pays out; R1: there is no free-transfer record at all", async () => {
    const w = await ready();
    await w.log.mint(market.did, 100); await w.log.mint(TREASURY_DID, 100); await w.log.mint(BURN_DID, 100);
    assert.equal(await refused(w.log.append(w.buy(market, w.list1))), "institution_payment_not_allowed");
    assert.equal(await refused(w.log.append(w.buy(treasury, w.list1))), "treasury_payment_not_allowed");
    assert.equal(await refused(w.log.append(w.buy(burn, w.list1))), "burn_account_locked", "even signed with the Burn account's own (fake) key");
    assert.equal(await w.log.balance(BURN_DID), 100);
    const transfer = mk("price_list" as RecordType, coder, {});
    const forged = { ...transfer, type: "asp.transfer/v0.2" };
    assert.equal((await failure(w.log.append(forged)))?.code, "UNKNOWN_TYPE", "a transfer between agents has no record type");
  });

  test("R8 tier_excluded: a tier 0 agent may buy an essential item but not a standard one", async () => {
    const w = await ready();
    const slashed = party("did:web:example.com:agents:tier-zero", 21);
    await w.log.append(mk("passport", alice, { did: slashed.did, kind: "agent", sponsor: alice.did, tier: 0, shape: {}, keys: [{ id: slashed.kid, type: "Ed25519", public_key: b64urlEncode(slashed.publicKey) }] }, null, { subject: slashed.did }));
    await w.mintSigned(slashed.did, 100);
    assert.equal(await refused(w.log.append(w.buy(slashed, w.list1))), "tier_excluded");
    await w.log.append(w.buy(slashed, w.list1, { service: "market.first_course", amount: credit(30) }));
    assert.equal(await w.log.balance(slashed.did), 70);
    assert.equal(await w.log.balance(BURN_DID), 0, "an essential item burns nothing");
    assert.equal(await w.log.balance(TREASURY_DID), 7 + 0, "floor(30 * 250 / 1000) = 7");
    assert.equal(await w.log.balance(market.did), 23);
  });

  test("receipts: only the seller signs, at most one, a refund is at most price less burn and comes back by the split in reverse; the audit stays balanced", async () => {
    const w = await ready();
    const p = w.buy(coder, w.list1);
    await w.log.append(p);
    assert.equal(await refused(w.log.append(w.receipt(alice, p.id))), "receipt_wrong_issuer");
    assert.equal(await refused(w.log.append(w.receipt(market, p.id, { status: "refunded", refund_amount: credit(37) }))), "refund_exceeds_price_less_burn");
    assert.equal(await refused(w.log.append(mk("receipt", market, { purchase: p.id, status: "delivered" }, null))), "receipt_needs_purchase");
    assert.equal(await refused(w.log.append(mk("receipt", market, { purchase: "sha256:" + "c".repeat(64), status: "delivered" }, p.id))), "receipt_wrong_purchase");
    assert.equal(await w.log.balance(coder.did), 60, "refused receipts moved nothing");
    const r = w.receipt(market, p.id, { status: "refunded", refund_amount: credit(36) });
    await w.log.append(r);
    assert.equal(await w.log.balance(coder.did), 60 + 36);
    assert.equal(await w.log.balance(market.did), 0); assert.equal(await w.log.balance(TREASURY_DID), 0);
    assert.equal(await w.log.balance(BURN_DID), 4, "the burned part is gone for good");
    assert.equal(await refused(w.log.append(w.receipt(market, p.id))), "BAD_PREV", "a purchase has at most one receipt");
    assert.equal(await refused(w.log.append(mk("receipt", market, { purchase: p.id, status: "delivered" }, r.id))), "ILLEGAL_TRANSITION", "nor a receipt on a receipt");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true);
  });
});

describe("the job tax (CR-15, DK68)", () => {
  test("with a price list in force, the fee on a paid settlement is the list's rate times what is released: another fee is refused, the right one is accepted and lands in the Treasury", async () => {
    const w = await world();
    const { log } = w;
    await w.mintSigned(poster.did, 1000, "test");
    await w.mintSigned(coder.did, 200, "starter_upfront");
    await log.append(passport(poster));
    const t0 = tick();
    await w.issueList(listV1(t0), null, t0); // job tax 20 permille
    const price = 100;
    const contract = cosign(mk("contract", poster, { principal: poster.did, performer: coder.did, bank: bank.did, purpose: "Fix the flaky test", price: credit(price), verification: "deterministic", deadline: "2026-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: coder.did }), coder);
    await log.append(contract);
    const bond = mk("bond", coder, { contract: contract.id, backer: coder.did, amount: credit(20), escrow: { payer: poster.did, amount: credit(price) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await log.append(bond);
    const mandate = mk("mandate", poster, { contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2027-01-01T00:00:00Z", revocable: true }, bond.id, { subject: coder.did });
    await log.append(mandate);
    const delivery = mk("delivery", coder, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, mandate.id, { subject: contract.id });
    await log.append(delivery);
    const accept = mk("attestation", poster, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: contract.id });
    await log.append(accept);
    const settle = (fee: number) => mk("settlement", bank, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: credit(95), fees: credit(fee), bond_returned: credit(20), bond_slashed: credit(0) }, accept.id, { subject: contract.id });
    // 20 permille of 95 is 1 (floor). The bank may not choose 5, nor 0.
    assert.equal(await refused(log.append(settle(5))), "fees_not_job_tax");
    assert.equal(await refused(log.append(settle(0))), "fees_not_job_tax");
    await log.append(settle(1));
    assert.equal(await log.balance(TREASURY_DID), 1, "the job tax lands in the Treasury");
    assert.equal((await log.creditAudit()).verdict, "balanced");
  });
});
