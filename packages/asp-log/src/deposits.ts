/**
 * Bank deposits and the Treasury-paid reward (docs/institutions/bank-insurer.md 3, 4 and decision 6; register row DK294; spec-delta S370). An agent or person may lock credits with the Bank for 30 days; the credits
 * sit in the Bank's deposit account and return whole at term. Each completed 30 days the Treasury pays a reward of 1 % of the deposit, from the Treasury's own deposit-reward line (a budget the Treasury set and the owner co-signed; the same draw
 * the newcomer allowance makes), at most 50 credits a month to one holder, never beyond the budget. The reward is a move out of the Treasury, never a mint; the deposit is a lock, never a loan the Bank may spend.
 * Credits are accounting entries, not money.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { BANK_DEPOSIT_DID, TREASURY_DID, isReservedAccount } from "./economy.ts";
import { BANK_DID } from "./bank.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

export const DEPOSIT_TERM_DAYS = 30;
/** The monthly reward: 1 % of the deposit (10 permille), at most this many credits a month to one holder (bank-insurer.md 4). */
export const REWARD_PERMILLE = 10;
export const REWARD_MONTHLY_CAP = 50;
export const REWARD_BUDGET_PURPOSE = "deposit_reward";
const DAY = 86_400_000;

export const rewardFor = (amount: number): number => Math.floor((amount * REWARD_PERMILLE) / 1000);

interface Deposit { holder: string; amount: number; at: string; withdrawn: boolean; paid: number }
const readDeposit = async (tx: Pick<LogTx, "getMarker">, id: string): Promise<Deposit | undefined> => { const raw = await tx.getMarker(`deposit:${id}`); return raw ? (JSON.parse(raw) as Deposit) : undefined; };
const writeDeposit = (tx: LogTx, id: string, d: Deposit) => tx.putMarker(`deposit:${id}`, JSON.stringify(d));

export interface DepositEnv {
  debit(tx: LogTx, did: string, n: number): Promise<void>;
  credit(tx: LogTx, did: string, n: number): Promise<void>;
  drawBudget(tx: LogTx, id: string, amount: number, at: string): Promise<void>;
  cosignedBy(r: AspRecord, did: string): boolean;
}

export async function projectDepositAct(tx: LogTx, r: AspRecord, env: DepositEnv): Promise<void> {
  const b = r.body as { act: "deposit" | "withdraw" | "reward"; holder?: string; amount?: { value: number }; deposit?: string; budget?: string };
  if (r.prev !== null) throw rule("deposit_not_chained", "a deposit record starts its own chain (prev is null)");
  const now = Date.parse(r.issued_at);

  if (b.act === "deposit") {
    if (r.issuer !== b.holder) throw rule("deposit_not_the_holder", "the holder signs its own deposit");
    if (isReservedAccount(b.holder!) || b.holder === BANK_DEPOSIT_DID || b.holder === BANK_DID) throw rule("deposit_reserved_account", "an account of the society does not make a deposit");
    if (!env.cosignedBy(r, BANK_DID)) throw rule("deposit_needs_bank", `the Bank (${BANK_DID}) countersigns a deposit`);
    if (b.amount!.value < 1) throw rule("amount_not_positive", "a deposit is at least 1 credit");
    await env.debit(tx, b.holder!, b.amount!.value);
    await env.credit(tx, BANK_DEPOSIT_DID, b.amount!.value);
    await writeDeposit(tx, r.id, { holder: b.holder!, amount: b.amount!.value, at: r.issued_at, withdrawn: false, paid: 0 });
    return;
  }

  const id = b.deposit!;
  const d = await readDeposit(tx, id);
  if (!d) throw rule("deposit_unknown", `${id} is not a deposit in this log`);

  if (b.act === "withdraw") {
    if (r.issuer !== d.holder) throw rule("withdraw_not_the_holder", `only ${d.holder} withdraws its deposit`);
    if (d.withdrawn) throw rule("deposit_withdrawn", "the deposit was already withdrawn");
    if (now < Date.parse(d.at) + DEPOSIT_TERM_DAYS * DAY) throw rule("deposit_locked", `a deposit is locked for ${DEPOSIT_TERM_DAYS} days: it can be withdrawn from ${new Date(Date.parse(d.at) + DEPOSIT_TERM_DAYS * DAY).toISOString()}`);
    await env.debit(tx, BANK_DEPOSIT_DID, d.amount);
    await env.credit(tx, d.holder, d.amount);
    await writeDeposit(tx, id, { ...d, withdrawn: true });
    return;
  }

  // The reward: the Treasury's, for one completed 30 days of a deposit still held, from a co-signed Bank budget for the month, at most 1 % and at most 50 credits a month to the holder.
  if (r.issuer !== TREASURY_DID) throw rule("reward_wrong_issuer", `${r.issuer} is not the Treasury (${TREASURY_DID}): only the Treasury pays a deposit reward`);
  if (d.withdrawn) throw rule("reward_deposit_withdrawn", "a withdrawn deposit earns no more reward");
  const due = Date.parse(d.at) + DEPOSIT_TERM_DAYS * DAY * (d.paid + 1);
  if (now < due) throw rule("reward_not_due", `the next reward for this deposit is due from ${new Date(due).toISOString()}: 1 % for each completed ${DEPOSIT_TERM_DAYS} days`);
  const amount = b.amount!.value;
  if (amount !== rewardFor(d.amount)) throw rule("reward_amount_mismatch", `the reward is 1 % of the deposit (${rewardFor(d.amount)} on ${d.amount}), not ${amount}`);
  if (amount < 1) throw rule("reward_zero", "a deposit under 100 credits earns no reward: 1 % rounds to nothing");
  const month = r.issued_at.slice(0, 7);
  const monthKey = `deposit_reward_month:${d.holder}|${month}`;
  const monthPaid = Number((await tx.getMarker(monthKey)) ?? 0);
  if (monthPaid + amount > REWARD_MONTHLY_CAP) throw rule("reward_over_account_cap", `${d.holder} was paid ${monthPaid} credits of reward in ${month}; the cap is ${REWARD_MONTHLY_CAP} a month for one holder`);
  const budget = b.budget ? await tx.getRecord(b.budget) : undefined;
  const bb = budget?.record.body as { institution?: string; purpose?: string } | undefined;
  if (!budget || budget.record.type !== "asp.budget/v0.2" || bb?.institution !== TREASURY_DID || bb.purpose !== REWARD_BUDGET_PURPOSE) throw rule("reward_budget_wrong", `the reward is paid from the Treasury's own deposit-reward line (a budget for the Treasury with purpose ${REWARD_BUDGET_PURPOSE}) that the owner co-signed`);
  await env.drawBudget(tx, b.budget!, amount, r.issued_at); // over_budget beyond the co-signed budget
  await env.debit(tx, TREASURY_DID, amount);
  await env.credit(tx, d.holder, amount);
  await tx.putMarker(monthKey, String(monthPaid + amount));
  await writeDeposit(tx, id, { ...d, paid: d.paid + 1 });
}
