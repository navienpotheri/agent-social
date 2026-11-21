/**
 * The active Bank (register row DK1458; spec-delta S1405; the owner's decision of 2026-11-21, docs/institutions/credit-structure.md 3): agents hold credits at the Bank without a lock, the Bank lends at most 70 % of what it
 * holds, including to the Treasury (up to 50 % of what it holds, for the Treasury's own budget lines), the Treasury pays the Bank a stated interest EVERY WEEK out of that week's income (job tax and fees) and never by a mint, the
 * Bank keeps 20 % of the interest and pays 80 % to its depositors by balance and days held, and the Insurer's reserve earns interest as a depositor. Unpaid interest carries to the next week. Withdrawals the Bank cannot pay at once
 * are paid in the order asked as loans are repaid. Every flow is a move of credits that already exist: supply is unchanged (minted = circulating + locked + burned).
 *
 * The record is `asp.bank_act/v0.2` (a new record type; the older `deposit_act`, with its 30-day lock and fixed reward, replays as it always did). State lives in markers written inside the append. Credits are accounting entries, not money.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { INSURER_DID } from "./insurer.ts";
import { TREASURY_DID, institutionDid, isReservedAccount } from "./economy.ts";
import type { LogTx } from "./store.ts";

const BANK = institutionDid("bank");
const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const DAY = 86_400_000;

/** The numbers the owner confirmed on 2026-11-21 (docs/owner-decisions.md): permille unless said. */
export const BANK_NUMBERS = {
  /** The Treasury's borrowing rate per week, in ten-thousandths of the principal (0.25 %). */
  treasuryRatePerWeekBp: 25,
  /** The Bank's share of the interest it receives, permille (20 %); the rest goes to depositors. */
  bankSharePermille: 200,
  /** The most the Bank lends out of what it holds (70 %): the rest stays as the reserve that pays withdrawals. */
  maxLentPermille: 700,
  /** The most the Treasury may owe the Bank, of what the Bank holds (50 %). */
  maxTreasuryPermille: 500,
} as const;

export interface BankEnv {
  debit(tx: LogTx, did: string, n: number): Promise<void>;
  credit(tx: LogTx, did: string, n: number): Promise<void>;
}

const num = async (tx: Pick<LogTx, "getMarker">, k: string) => Number((await tx.getMarker(k)) ?? 0);
const bal = async (tx: Pick<LogTx, "getAccount">, did: string) => (await tx.getAccount(did))?.balance ?? 0;
const list = async (tx: Pick<LogTx, "getMarker">, k: string): Promise<string[]> => ((await tx.getMarker(k)) ?? "").split(",").filter(Boolean);

/** The ISO week (YYYY-Www, Monday first, UTC) a time falls in. */
export function isoWeekOf(ms: number): string {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0);
  const dow = (d.getUTCDay() + 6) % 7; // Monday 0
  const thursday = new Date(d.getTime() + (3 - dow) * DAY);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / (7 * DAY)) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
/** The Monday 00:00 UTC (in ms) that starts an ISO week. */
export function mondayOfWeek(week: string): number {
  const m = /^(\d{4})-W(\d{2})$/.exec(week)!;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (Number(m[2]) - 1) * 7 * DAY;
}

/** The Treasury's income of a week, from the three places credits come to it by earning: the job tax, the Treasury's share of every purchase (and premium and shop sale). Never a mint, never a loan. */
export async function noteIncome(tx: LogTx, amount: number, at: string): Promise<void> {
  if (amount <= 0) return;
  const key = `tr_income:${isoWeekOf(Date.parse(at))}`;
  await tx.putMarker(key, String((await num(tx, key)) + amount));
}

/** The credits the Bank has lent that are not back: draws on lines not yet repaid, plus what the Treasury owes. Lines keep their own marker (`bank_lent`). */
const lentOf = async (tx: LogTx) => (await num(tx, "bank_lent")) + (await num(tx, "tr_principal"));
/** What the Bank holds: its account (deposits and reserve) plus what it has lent. */
const holdsOf = async (tx: LogTx) => (await bal(tx, BANK)) + (await lentOf(tx));
/** What counts against the lending ceiling: what is lent and what is promised to credit lines not yet drawn. */
const committedOf = (tx: LogTx) => num(tx, "bank_committed");
/** What can be paid out now without touching a credit line the Bank has promised. */
const freeOf = async (tx: LogTx) => Math.max(0, (await bal(tx, BANK)) - (await num(tx, "bank_committed")));

export const bankIsActive = async (tx: Pick<LogTx, "getMarker">) => (await tx.getMarker("bank_active")) === "1";

/** The Bank's lending ceiling once it is active (70 % of what it holds): a credit line or a Treasury loan that would take the lent total above it is refused. */
export async function checkLendingCeiling(tx: LogTx, extra: number): Promise<void> {
  if (!(await bankIsActive(tx))) return;
  const lent = (await lentOf(tx)) + (await committedOf(tx)), holds = await holdsOf(tx);
  if ((lent + extra) * 1000 > holds * BANK_NUMBERS.maxLentPermille) throw rule("bank_liquidity", `the Bank holds ${holds} credits and has lent ${lent}; ${extra} more would take it above ${BANK_NUMBERS.maxLentPermille / 10} % of what it holds, which stays as the reserve that pays withdrawals`);
}

/** Records credits lent out on a line (`+`) or back (`-`), so the lending ceiling reads one number. Called by the line code. */
export async function noteLent(tx: LogTx, delta: number): Promise<void> { await tx.putMarker("bank_lent", String(Math.max(0, (await num(tx, "bank_lent")) + delta))); }

/** Pays queued withdrawals in the order asked, as far as the Bank can pay without touching a promised line. Called after every act and every inflow to the Bank. */
export async function serveQueue(tx: LogTx, env: BankEnv, at: string): Promise<void> {
  if (!(await bankIsActive(tx))) return;
  const queue = JSON.parse((await tx.getMarker("bank_queue")) ?? "[]") as { holder: string; amount: number; id: string }[];
  if (!queue.length) return;
  let free = await freeOf(tx);
  const rest: typeof queue = [];
  for (const q of queue) {
    const pay = Math.min(q.amount, free);
    if (pay > 0) { await pay_(tx, env, q.holder, pay, at); free -= pay; }
    if (q.amount - pay > 0) rest.push({ ...q, amount: q.amount - pay });
  }
  await tx.putMarker("bank_queue", JSON.stringify(rest));
}

const event = async (tx: LogTx, holder: string, at: string, delta: number) => {
  const key = `bank_ev:${holder}`;
  const ev = JSON.parse((await tx.getMarker(key)) ?? "[]") as [number, number][];
  await tx.putMarker(key, JSON.stringify([...ev, [Date.parse(at), delta]].slice(-400)));
};
/** Pays `n` of a holder's deposit out of the Bank's account (the holder's liability falls by the same). */
async function pay_(tx: LogTx, env: BankEnv, holder: string, n: number, at: string): Promise<void> {
  await env.debit(tx, BANK, n);
  await env.credit(tx, holder, n);
  await tx.putMarker(`bankdep:${holder}`, String((await num(tx, `bankdep:${holder}`)) - n));
  await event(tx, holder, at, -n);
}

/** What a holder has at the Bank: its deposit, and how much of a withdrawal it has asked for that is still waiting. */
export async function bankHolding(tx: Pick<LogTx, "getMarker">, holder: string): Promise<{ deposit: number; waiting: number }> {
  const queue = JSON.parse((await tx.getMarker("bank_queue")) ?? "[]") as { holder: string; amount: number }[];
  return { deposit: await num(tx, `bankdep:${holder}`), waiting: queue.filter((q) => q.holder === holder).reduce((n, q) => n + q.amount, 0) };
}

/** The weight of a holder's week: balance times time, in credit-days x 1000 (an integer), from its recorded events and what it held at the start of the week. */
async function weekWeight(tx: Pick<LogTx, "getMarker">, holder: string, startMs: number, endMs: number): Promise<number> {
  const ev = JSON.parse((await tx.getMarker(`bank_ev:${holder}`)) ?? "[]") as [number, number][];
  let balance = 0, w = 0, t = startMs;
  for (const [at, d] of ev) if (at <= startMs) balance += d;
  for (const [at, d] of ev) {
    if (at <= startMs || at >= endMs) continue;
    w += balance * (at - t); t = at; balance += d;
  }
  w += balance * (endMs - t);
  return Math.floor(w / (DAY / 1000));
}

export async function projectBankAct(tx: LogTx, r: AspRecord, env: BankEnv): Promise<void> {
  const b = r.body as { act: "deposit" | "withdraw" | "borrow" | "repay" | "interest"; holder?: string; amount?: { value: number }; week?: string };
  if (r.prev !== null) throw rule("bank_act_not_chained", "a bank act starts its own chain (prev is null)");
  const at = r.issued_at, now = Date.parse(at);

  // The event time must be the record's own: the weight of a week reads it.
  const ledgerEvent = (holder: string, delta: number) => event(tx, holder, at, delta);

  if (b.act === "deposit") {
    if (r.issuer !== b.holder) throw rule("bank_not_the_holder", "the holder signs its own deposit");
    if (isReservedAccount(b.holder!) || b.holder === INSURER_DID) throw rule("bank_reserved_account", "an account of the society does not make a deposit (the Insurer's reserve earns interest as it is)");
    const n = b.amount!.value;
    if (n < 1) throw rule("amount_not_positive", "a deposit is at least 1 credit");
    await env.debit(tx, b.holder!, n);
    await env.credit(tx, BANK, n);
    await tx.putMarker("bank_active", "1");
    await tx.putMarker(`bankdep:${b.holder}`, String((await num(tx, `bankdep:${b.holder}`)) + n));
    const dep = await list(tx, "bank_depositors");
    if (!dep.includes(b.holder!)) await tx.putMarker("bank_depositors", [...dep, b.holder!].join(","));
    await ledgerEvent(b.holder!, n);
    await serveQueue(tx, env, at);
    return;
  }

  if (b.act === "withdraw") {
    if (r.issuer !== b.holder) throw rule("bank_not_the_holder", "only the holder withdraws its deposit");
    const n = b.amount!.value;
    if (n < 1) throw rule("amount_not_positive", "a withdrawal is at least 1 credit");
    const h = await bankHolding(tx, b.holder!);
    if (n > h.deposit - h.waiting) throw rule("withdraw_exceeds_deposit", `${b.holder} holds ${h.deposit} at the Bank and ${h.waiting} of it is already waiting to be paid: ${n} is more than is left`);
    const waitingQueue = JSON.parse((await tx.getMarker("bank_queue")) ?? "[]") as unknown[];
    const pay = waitingQueue.length ? 0 : Math.min(n, await freeOf(tx)); // in the order asked: nobody is paid ahead of someone already waiting
    if (pay > 0) { await env.debit(tx, BANK, pay); await env.credit(tx, b.holder!, pay); await tx.putMarker(`bankdep:${b.holder}`, String(h.deposit - pay)); await ledgerEvent(b.holder!, -pay); }
    if (n - pay > 0) {
      const queue = JSON.parse((await tx.getMarker("bank_queue")) ?? "[]");
      await tx.putMarker("bank_queue", JSON.stringify([...queue, { holder: b.holder, amount: n - pay, id: r.id }]));
    }
    return;
  }

  // The Treasury's loan and its repayment, and the weekly interest, are the Treasury's acts.
  if (r.issuer !== TREASURY_DID) throw rule("bank_act_not_treasury", `${r.issuer} is not the Treasury (${TREASURY_DID}): only the Treasury borrows, repays and pays the Bank's interest`);

  if (b.act === "borrow") {
    const n = b.amount!.value;
    if (n < 1) throw rule("amount_not_positive", "a loan is at least 1 credit");
    if (!(await bankIsActive(tx))) throw rule("bank_not_active", "the Bank holds no deposit yet: there is nothing for it to lend to the Treasury");
    const principal = await num(tx, "tr_principal"), holds = await holdsOf(tx);
    if ((principal + n) * 1000 > holds * BANK_NUMBERS.maxTreasuryPermille) throw rule("treasury_borrow_cap", `the Treasury may owe the Bank at most ${BANK_NUMBERS.maxTreasuryPermille / 10} % of what it holds (${holds}); it owes ${principal} and asks ${n} more`);
    await checkLendingCeiling(tx, n);
    if ((await bal(tx, BANK)) - (await num(tx, "bank_committed")) < n) throw rule("bank_liquidity", "the Bank has not that much free: the rest is promised to credit lines");
    await env.debit(tx, BANK, n);
    await env.credit(tx, TREASURY_DID, n);
    await tx.putMarker("tr_principal", String(principal + n));
    return;
  }

  if (b.act === "repay") {
    const n = b.amount!.value;
    const principal = await num(tx, "tr_principal");
    if (n < 1) throw rule("amount_not_positive", "a repayment is at least 1 credit");
    if (n > principal) throw rule("repay_exceeds_loan", `the Treasury owes ${principal}, not ${n}`);
    await env.debit(tx, TREASURY_DID, n);
    await env.credit(tx, BANK, n);
    await tx.putMarker("tr_principal", String(principal - n));
    await serveQueue(tx, env, at);
    return;
  }

  // interest: one payment for each completed ISO week, once, from the Monday after it.
  const week = b.week!;
  const monday = mondayOfWeek(week);
  if (now < monday + 7 * DAY) throw rule("interest_week_open", `week ${week} ends at ${new Date(monday + 7 * DAY).toISOString()}: its interest is paid from then`);
  if (await tx.getMarker(`interest_paid:${week}`)) throw rule("interest_already_paid", `the interest for ${week} was already paid`);
  const principal = await num(tx, "tr_principal"), carry = await num(tx, "tr_carry");
  const due = Math.floor((principal * BANK_NUMBERS.treasuryRatePerWeekBp) / 10_000) + carry;
  const income = await num(tx, `tr_income:${week}`);
  const pay = Math.max(0, Math.min(due, income, await bal(tx, TREASURY_DID)));
  const bankShare = Math.floor((pay * BANK_NUMBERS.bankSharePermille) / 1000);
  const pool = pay - bankShare;
  // The depositors' shares by balance and days held in the week; the Insurer's reserve counts as a deposit at what it holds now, for the whole week.
  const holders = await list(tx, "bank_depositors");
  const weights: { did: string; w: number }[] = [];
  for (const h of holders) { const w = await weekWeight(tx, h, monday, monday + 7 * DAY); if (w > 0) weights.push({ did: h, w }); }
  const insurerHeld = await bal(tx, INSURER_DID);
  if (insurerHeld > 0) weights.push({ did: INSURER_DID, w: insurerHeld * 7 * 1000 });
  const total = weights.reduce((n, x) => n + x.w, 0);
  let paidOut = 0;
  const payouts: { did: string; amount: number }[] = [];
  if (pay > 0) {
    await env.debit(tx, TREASURY_DID, pay);
    if (total > 0) for (const x of weights) { const a = Math.floor((pool * x.w) / total); if (a > 0) { await env.credit(tx, x.did, a); payouts.push({ did: x.did, amount: a }); paidOut += a; } }
    await env.credit(tx, BANK, pay - paidOut); // the Bank's 20 %, the rounding, and everything when nobody holds a deposit
  }
  await tx.putMarker("tr_carry", String(due - pay));
  await tx.putMarker(`interest_paid:${week}`, JSON.stringify({ record: r.id, due, income, paid: pay, carry: due - pay, bank: pay - paidOut, depositors: paidOut, payouts }));
  await serveQueue(tx, env, at);
}
