/**
 * An institution returns its surplus to the Treasury (register row DK172; credits.md 3.3, CR-25; spec-delta S1566): the account keeps its reserve (the larger of 50 and what it still owes in refunds on purchases it never
 * answered), a return is signed by the institution for itself once a month, the Bank, the Insurer and the Academy do not return, it moves credits and nothing else (the supply audit balances after each step) and the
 * Treasury's statement counts it as income. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TREASURY_DID } from "../src/index.ts";
import { academy, bankInstitution, credit, insurer, kit, mk, refusedBy, registrar, jump, DAY } from "./society-kit.ts";
import { institutionDid } from "../src/index.ts";

const REGISTRY = institutionDid("registry");

async function world() {
  const k = await kit();
  await k.withPrices();
  const buyer = await k.person("tr-buyer", 5000);
  const answered: string[] = [];
  const buyNames = async (n: number, answer: boolean) => {
    for (let i = 0; i < n; i++) {
      const id = await k.buy(buyer, "registry.name.claim", 10);
      if (answer) { await k.log.append(mk("receipt", registrar, { purchase: id, status: "delivered" }, id)); answered.push(id); }
    }
  };
  const audit = async (why: string) => { const a = await k.log.creditAudit(); assert.equal(a.verdict, "balanced", why); };
  const ret = (amount: number, over: Record<string, unknown> = {}, by = registrar) => mk("treasury_return", by, { institution: by.did, period: "2026-11", amount: credit(amount), ...over });
  return { k, buyNames, audit, ret };
}

test("DK172: the institution returns what it holds above its reserve once a month, the Treasury gets it, the audit balances and the statement counts it", async () => {
  const w = await world();
  await w.buyNames(20, true);
  assert.equal(await w.k.log.balance(REGISTRY), 140, "20 names, a provider share of 7 each");
  const treasury0 = await w.k.log.balance(TREASURY_DID);
  assert.equal(await refusedBy(w.k.log.append(w.ret(91))), "return_below_reserve", "one more than the surplus above 50");
  assert.equal(await refusedBy(w.k.log.append(w.ret(90, { period: "2026-12" }))), "return_period", "a return is for the month it is signed in");
  await w.k.log.append(w.ret(90));
  assert.equal(await w.k.log.balance(REGISTRY), 50, "the reserve stays");
  assert.equal(await w.k.log.balance(TREASURY_DID) - treasury0, 90);
  await w.audit("after the return");
  assert.equal(await refusedBy(w.k.log.append(w.ret(1))), "return_once", "once a month");
  const st = await w.k.log.treasuryStatement();
  assert.equal(st.treasury.in.returns, 90);
  jump(32 * DAY);
  await w.buyNames(10, true);
  await w.k.log.append(w.ret(70, { period: new Date(Date.parse("2026-11-01T00:00:00Z") + 33 * DAY).toISOString().slice(0, 7) }));
  await w.audit("after the second month's return");
  assert.equal((await w.k.log.verify()).ok, true, "a replica replays the returns to the same books");
});

test("DK172: what the institution still owes in refunds stays in the account; the answered ones free it", async () => {
  const w = await world();
  await w.buyNames(8, false); // 8 purchases never answered: 72 owed, 56 held
  assert.equal(await w.k.log.balance(REGISTRY), 56);
  assert.equal(await refusedBy(w.k.log.append(w.ret(1))), "return_below_reserve", "56 held against 72 owed");
  await w.buyNames(10, true); // 70 more held, 10 more answered: 126 held, 72 owed
  assert.equal(await refusedBy(w.k.log.append(w.ret(55))), "return_below_reserve", "126 - 55 = 71 is under the 72 owed");
  await w.k.log.append(w.ret(54));
  assert.equal(await w.k.log.balance(REGISTRY), 72);
  await w.audit("after the return that keeps the refunds");
});

test("DK172: only the institution for itself, never the Bank, the Insurer or the Academy, and a person cannot", async () => {
  const w = await world();
  await w.buyNames(20, true);
  const person = await w.k.person("tr-person", 100);
  assert.equal(await refusedBy(w.k.log.append(w.ret(10, { institution: person.did }, person as never))), "return_wrong_issuer");
  assert.equal(await refusedBy(w.k.log.append(w.ret(10, { institution: REGISTRY }, (await import("./society-kit.ts")).courts))), "return_wrong_issuer", "another institution's account is not returned by someone else");
  for (const p of [academy, bankInstitution, insurer]) assert.equal(await refusedBy(w.k.log.append(w.ret(1, {}, p))), "return_locked", p.did);
  assert.equal(await refusedBy(w.k.log.append(w.ret(0))), "amount_not_positive");
});
