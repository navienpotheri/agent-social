// Bank deposits and the Treasury-paid reward (register row DK294; spec-delta S370; bank-insurer.md decision 6): a deposit is a lock that returns whole at term, the reward is a move out of the Treasury of 1 % a month
// within a co-signed budget and a cap for one holder, and the supply audit still balances. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BANK_DEPOSIT_DID, TREASURY_DID, rewardFor } from "../src/index.ts";
import { Kit, bankP, credit, owner, refused, treasury, type Party } from "./academy-kit.ts";

async function world(budget = 100) {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 5000);
  const at = kit.tick();
  const budgetId = await kit.put(kit.mk("budget", treasury, { institution: TREASURY_DID, period: "2026-12", amount: credit(budget), purpose: "deposit_reward" }, null, { at, cosigners: [owner] }));
  const holder = await kit.person("dp-holder");
  await kit.mint(holder.did, 20_000);
  const bal = (d: string) => kit.log.balance(d);
  const deposit = (amount: number, by: Party = holder, cosigners: Party[] = [bankP], over: Record<string, unknown> = {}) => kit.mk("deposit_act" as never, by, { act: "deposit", holder: holder.did, amount: credit(amount), ...over }, null, { subject: holder.did, cosigners });
  const withdraw = (id: string, by: Party = holder) => kit.mk("deposit_act" as never, by, { act: "withdraw", deposit: id }, null, { subject: holder.did });
  const reward = (id: string, amount: number, over: Record<string, unknown> = {}, by: Party = treasury) => kit.mk("deposit_act" as never, by, { act: "reward", deposit: id, budget: budgetId, amount: credit(amount), ...over }, null, { subject: holder.did });
  return { kit, holder, budgetId, bal, deposit, withdraw, reward };
}

test("(T15) a deposit is a lock: the credits move to the Bank's deposit account, stay there for 30 days, and return whole; only the holder, only at term, only once", async () => {
  const w = await world();
  const { kit } = w;
  const stranger = await kit.person("dp-stranger");
  const start = await w.bal(w.holder.did);
  assert.equal(await refused(kit.put(w.deposit(300, stranger))), "deposit_not_the_holder");
  assert.equal(await refused(kit.put(w.deposit(300, w.holder, []))), "deposit_needs_bank");
  assert.equal(await refused(kit.put(kit.mk("deposit_act" as never, treasury, { act: "deposit", holder: TREASURY_DID, amount: credit(10) }, null, { subject: TREASURY_DID, cosigners: [bankP] }))), "deposit_reserved_account", "an account of the society does not deposit");
  assert.equal(await refused(kit.put(w.deposit(start + 1))), "insufficient_balance");
  const id = await kit.put(w.deposit(300));
  assert.equal(await w.bal(w.holder.did), start - 300);
  assert.equal(await w.bal(BANK_DEPOSIT_DID), 300);
  assert.equal(await refused(kit.put(w.withdraw(id, stranger))), "withdraw_not_the_holder");
  assert.equal(await refused(kit.put(w.withdraw(id))), "deposit_locked", "locked for 30 days");
  kit.addDays(29);
  assert.equal(await refused(kit.put(w.withdraw(id))), "deposit_locked", "day 29 is still inside the term");
  kit.addDays(1.1);
  await kit.put(w.withdraw(id));
  assert.equal(await w.bal(w.holder.did), start, "whole, no interest by the Bank");
  assert.equal(await w.bal(BANK_DEPOSIT_DID), 0);
  assert.equal(await refused(kit.put(w.withdraw(id))), "deposit_withdrawn");
  assert.equal(await refused(kit.put(w.withdraw("sha256:" + "7".repeat(64)))), "deposit_unknown");
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
});

test("(T16) the reward is 1 % a completed month, paid by the Treasury from a co-signed budget: due only at 30 days, the exact amount, within the budget and 50 credits a month for one holder, never after a withdrawal", async () => {
  const w = await world(5);
  const { kit } = w;
  const id = await kit.put(w.deposit(300));
  assert.equal(rewardFor(300), 3);
  assert.equal(await refused(kit.put(w.reward(id, 3))), "reward_not_due");
  kit.addDays(30.1);
  const before = await w.bal(w.holder.did), treasuryBefore = await w.bal(TREASURY_DID);
  assert.equal(await refused(kit.put(w.reward(id, 3, {}, w.holder as Party))), "reward_wrong_issuer", "only the Treasury pays");
  assert.equal(await refused(kit.put(w.reward(id, 4))), "reward_amount_mismatch", "1 %, no more");
  assert.equal(await refused(kit.put(w.reward(id, 3, { budget: id }))), "reward_budget_wrong");
  await kit.put(w.reward(id, 3));
  assert.equal(await w.bal(w.holder.did), before + 3);
  assert.equal(await w.bal(TREASURY_DID), treasuryBefore - 3, "paid out of the Treasury: a move, no mint");
  assert.equal(await refused(kit.put(w.reward(id, 3))), "reward_not_due", "the next month is not due yet");
  kit.addDays(30);
  // The budget is 5 credits and 3 are drawn: another 3 would be 6, beyond what the owner co-signed.
  assert.equal(await refused(kit.put(w.reward(id, 3))), "over_budget", "never beyond the co-signed budget");
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
  kit.addDays(1);
  await kit.put(w.withdraw(id));
  assert.equal(await refused(kit.put(w.reward(id, 3))), "reward_deposit_withdrawn");
});

test("the reward's own limits: a deposit under 100 credits earns nothing, and one holder is paid at most 50 credits of reward in a calendar month", async () => {
  const w = await world(1000);
  const { kit } = w;
  const small = await kit.put(w.deposit(99));
  const big1 = await kit.put(w.deposit(4000)); // 40 a month
  const big2 = await kit.put(w.deposit(4000)); // another 40: together over the cap of 50
  kit.addDays(30.1);
  assert.equal(await refused(kit.put(w.reward(small, 0))), "reward_zero");
  await kit.put(w.reward(big1, 40));
  assert.equal(await refused(kit.put(w.reward(big2, 40))), "reward_over_account_cap", "40 and 40 are over 50 in one month");
  kit.addDays(32); // next calendar month: the cap is for the month
  assert.equal(await refused(kit.put(w.reward(big1, 40))), "budget_period_closed", "the budget is for December: a new month needs a new co-signed budget");
});

test("(T15, T16) property: over 60 seeded random deposits, withdrawals and rewards the credits only move, the deposit account holds exactly the open deposits and is never negative, and the audit balances", async () => {
  const w = await world(4000);
  const { kit } = w;
  let s = 4242;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const parties: string[] = [TREASURY_DID, BANK_DEPOSIT_DID, w.holder.did];
  const total = async () => { let t = 0; for (const d of parties) t += await kit.log.balance(d); return t; };
  const start = await total();
  const open = new Map<string, number>();
  let ops = 0;
  for (let i = 0; i < 60; i++) {
    const pick = rnd();
    try {
      if (pick < 0.45 || open.size === 0) { const a = 100 + Math.floor(rnd() * 400); open.set(await kit.put(w.deposit(a)), a); }
      else {
        const [id, a] = [...open][Math.floor(rnd() * open.size)];
        if (pick < 0.75) { kit.addDays(31); await kit.put(w.reward(id, rewardFor(a))); }
        else { kit.addDays(31); await kit.put(w.withdraw(id)); open.delete(id); }
      }
      ops++;
    } catch (e) {
      const d = (e as { detail?: string }).detail ?? "";
      assert.ok(["reward_over_account_cap", "reward_not_due", "over_budget", "budget_period_closed", "reward_budget_wrong"].includes(d), `an expected refusal, not ${d}`);
    }
    assert.equal(await total(), start, "the credits only moved");
    assert.equal(await kit.log.balance(BANK_DEPOSIT_DID), [...open.values()].reduce((n, v) => n + v, 0), "the deposit account holds exactly the open deposits");
  }
  assert.ok(ops >= 20, `${ops} operations went through`);
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
  void bankP;
});
