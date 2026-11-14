/**
 * The Bank (docs/institutions/bank-insurer.md; register row DK19; spec-delta S280): a credit line for a newcomer's first bond, drawn at Bond time from the Bank's reserve, repaid automatically at Settlement,
 * and a default that debits the sponsor who guaranteed it. Interest-free by design: a line only MOVES credits that already exist in the Bank's reserve (funded by a Treasury budget payment, never a mint),
 * so it creates none. The state lives in markers written inside the append, so a refused record leaves none. Credits are accounting entries, not money.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { institutionDid } from "./economy.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

export const BANK_DID = institutionDid("bank");
/** The most a line may be, by tier (bank-insurer.md 4, proposal): none at tier 3 and above (they have a balance). */
export const LINE_LIMIT: Record<number, number> = { 1: 60, 2: 300 };
/** A line is for the first jobs: fewer than this many counted accepted jobs (credits.md 5.4). */
export const LINE_MAX_COUNTED_JOBS = 3;
/** The guarantor must hold at least this share of the line (permille). */
export const GUARANTOR_PERMILLE = 250;
/** An undrawn line lapses this long after it is issued. */
export const LINE_WINDOW_MS = 14 * 86_400_000;

export interface Line { id: string; borrower: string; guarantor: string; contract: string; amount: number; due: string; status: "open" | "drawn" | "repaid" | "owing" | "defaulted"; drawn: number; owed: number }

export interface BankEnv {
  reputation(tx: LogTx, did: string): Promise<{ tier: number; qualifyingJobs: number } | null>;
  debit(tx: LogTx, did: string, amount: number): Promise<void>;
  credit(tx: LogTx, did: string, amount: number): Promise<void>;
}

const readLine = async (tx: Pick<LogTx, "getMarker">, id: string): Promise<Line | undefined> => { const raw = await tx.getMarker(`line:${id}`); return raw ? (JSON.parse(raw) as Line) : undefined; };
const writeLine = (tx: LogTx, l: Line) => tx.putMarker(`line:${l.id}`, JSON.stringify(l));
const num = async (tx: Pick<LogTx, "getMarker">, key: string) => Number((await tx.getMarker(key)) ?? 0);
const balanceOf = async (tx: Pick<LogTx, "getAccount">, did: string) => (await tx.getAccount(did))?.balance ?? 0;
const signedBy = (r: AspRecord, did: string) => r.issuer === did || (r.cosigs ?? []).some((c) => c.kid.startsWith(`${did}#`));

/** A credit line (bank-insurer.md 3, 5): the Bank issues it, the borrower and the guarantor countersign. */
export async function projectCreditLine(tx: LogTx, r: AspRecord, env: BankEnv): Promise<void> {
  const b = r.body as { borrower: string; guarantor: string; contract: string; amount: { value: number }; due: string };
  if (r.prev !== null) throw rule("line_not_chained", "a credit line starts its own chain (prev is null)");
  if (r.issuer !== BANK_DID) throw rule("line_wrong_issuer", `${r.issuer} is not the Bank (${BANK_DID}): only the Bank issues a line`);
  if (!signedBy(r, b.borrower) || !signedBy(r, b.guarantor)) throw rule("line_needs_countersigns", "a credit line is countersigned by the borrower and the guarantor");
  const passport = await tx.getPassport(b.borrower);
  if (!passport?.sponsor) throw rule("line_not_an_agent", `${b.borrower} is not an agent with a sponsor in this log`);
  if (b.guarantor !== passport.sponsor) throw rule("line_no_guarantor", `the guarantor is the agent's sponsor (${passport.sponsor}); without the sponsor's guarantee there is no line (asp bank line names it)`);
  const rep = await env.reputation(tx, b.borrower);
  const limit = rep ? LINE_LIMIT[rep.tier] : undefined;
  if (!rep || limit === undefined) throw rule("line_tier_not_eligible", `${b.borrower} is at tier ${rep?.tier ?? "none"}: a line is for tier 1 and 2 (tier 3 has a balance of its own, tier 0 is excluded)`);
  if (b.amount.value > limit) throw rule("line_over_limit", `a tier ${rep.tier} line is at most ${limit} credits, not ${b.amount.value}`);
  if (rep.qualifyingJobs >= LINE_MAX_COUNTED_JOBS) throw rule("line_not_first_job", `${b.borrower} already has ${rep.qualifyingJobs} counted jobs: a line is for the first ${LINE_MAX_COUNTED_JOBS - 1} jobs after the first, not for later ones`);
  if ((await num(tx, `bank_debt:${b.guarantor}`)) > 0 || (await tx.getMarker(`bank_default:${b.borrower}`))) throw rule("line_blocked_by_default", "a default on an earlier line blocks new lines for the borrower and for the guarantor's agents until it is cleared");
  const open = await tx.getMarker(`line_open:${b.borrower}`);
  if (open) {
    const prior = await readLine(tx, open);
    const lapsed = prior && prior.status === "open" && Date.parse(prior.due) <= Date.parse(r.issued_at);
    if (prior && !lapsed) throw rule("line_already_open", `${b.borrower} already has an open line (${open}): one at a time`);
    if (lapsed) { await writeLine(tx, { ...prior, status: "repaid" }); await tx.putMarker("bank_committed", String((await num(tx, "bank_committed")) - prior.amount)); }
  }
  const contract = await tx.getRecord(b.contract);
  const cb = contract?.record.body as { performer?: string; principal?: string } | undefined;
  if (!contract || contract.record.type !== "asp.contract/v0.2" || cb?.performer !== b.borrower) throw rule("line_contract_mismatch", `${b.contract} is not a contract that names ${b.borrower} as performer`);
  if (await tx.getEscrow(b.contract)) throw rule("line_contract_bonded", "the contract already has a Bond: a line is issued before it, to fund it");
  const principalSponsor = cb?.principal ? (await tx.getPassport(cb.principal))?.sponsor : undefined;
  if (cb?.principal === b.borrower || cb?.principal === b.guarantor || principalSponsor === b.guarantor) throw rule("line_self_dealt", "the job's principal must be independent of the borrower and the guarantor: a line for a job its own side posted is refused");
  if (Date.parse(b.due) <= Date.parse(r.issued_at) || Date.parse(b.due) - Date.parse(r.issued_at) > LINE_WINDOW_MS) throw rule("line_due_out_of_range", "an undrawn line lapses within 14 days of issue, and after it");
  const need = Math.ceil((b.amount.value * GUARANTOR_PERMILLE) / 1000);
  if ((await balanceOf(tx, b.guarantor)) < need) throw rule("line_guarantor_balance", `the guarantor holds ${await balanceOf(tx, b.guarantor)} credits; a guarantee of ${b.amount.value} needs at least ${need} (25 %)`);
  const committed = await num(tx, "bank_committed");
  if ((await balanceOf(tx, BANK_DID)) - committed < b.amount.value) throw rule("line_exceeds_reserve", `the Bank's reserve (${await balanceOf(tx, BANK_DID)}, ${committed} already promised) cannot cover ${b.amount.value}`);
  await tx.putMarker("bank_committed", String(committed + b.amount.value));
  await tx.putMarker(`line_open:${b.borrower}`, r.id);
  await tx.putMarker(`line_for:${b.contract}`, r.id);
  await writeLine(tx, { id: r.id, borrower: b.borrower, guarantor: b.guarantor, contract: b.contract, amount: b.amount.value, due: b.due, status: "open", drawn: 0, owed: 0 });
}

/** At Bond time: if the backer has an open line for this contract, the Bank's reserve funds the bond lock (the credits move from the Bank to the backer, then the bond debits the backer, in one step). */
export async function drawAtBond(tx: LogTx, r: AspRecord, env: BankEnv): Promise<void> {
  const b = r.body as { contract: string; backer: string; amount: { value: number } };
  const id = await tx.getMarker(`line_for:${b.contract}`);
  const line = id ? await readLine(tx, id) : undefined;
  if (!line || line.status !== "open" || line.borrower !== b.backer) return;
  if (Date.parse(line.due) <= Date.parse(r.issued_at)) throw rule("line_expired", `the line ${line.id} lapsed at ${line.due}: ask the Bank for a new one`);
  const draw = Math.min(b.amount.value, line.amount);
  await env.debit(tx, BANK_DID, draw);
  await env.credit(tx, b.backer, draw);
  await tx.putMarker("bank_committed", String((await num(tx, "bank_committed")) - line.amount));
  await writeLine(tx, { ...line, status: "drawn", drawn: draw, owed: draw });
}

/** At Settlement: the borrower's pay and returned bond repay the Bank first, up to what is owed; a balance left owing waits for the Bank's signed default. `inflow` is what this settlement credited to the borrower. */
export async function repayAtSettlement(tx: LogTx, contract: string, inflow: number, env: BankEnv): Promise<void> {
  const id = await tx.getMarker(`line_for:${contract}`);
  const line = id ? await readLine(tx, id) : undefined;
  if (!line || line.status !== "drawn") return;
  const repaid = Math.min(line.owed, inflow, await balanceOf(tx, line.borrower));
  await env.debit(tx, line.borrower, repaid);
  await env.credit(tx, BANK_DID, repaid);
  const owed = line.owed - repaid;
  await writeLine(tx, { ...line, owed, status: owed === 0 ? "repaid" : "owing" });
  if (owed === 0 && (await tx.getMarker(`line_open:${line.borrower}`)) === line.id) await tx.putMarker(`line_open:${line.borrower}`, "");
}

/** A default (bank-insurer.md 3): the Bank records what a settlement left unpaid; the guarantor is debited up to what it holds, the rest is a signed debt that blocks new lines for its agents. */
export async function projectCreditDefault(tx: LogTx, r: AspRecord, env: BankEnv): Promise<void> {
  const b = r.body as { line: string; unpaid: { value: number }; against: string };
  if (r.prev !== null) throw rule("default_not_chained", "a default starts its own chain (prev is null)");
  if (r.issuer !== BANK_DID) throw rule("default_wrong_issuer", `${r.issuer} is not the Bank (${BANK_DID}): only the Bank records a default`);
  const line = await readLine(tx, b.line);
  if (!line) throw rule("default_unknown_line", `${b.line} is not a credit line in this log`);
  if (line.status !== "owing") throw rule("default_not_owed", `the line ${b.line} is ${line.status}: a default follows a settlement that left credits unpaid`);
  if (b.unpaid.value !== line.owed) throw rule("default_wrong_amount", `the settlement left ${line.owed} unpaid, not ${b.unpaid.value}`);
  if (b.against !== line.guarantor) throw rule("default_wrong_guarantor", `the loss is against the guarantor (${line.guarantor})`);
  const paid = Math.min(line.owed, await balanceOf(tx, line.guarantor));
  await env.debit(tx, line.guarantor, paid);
  await env.credit(tx, BANK_DID, paid);
  const debt = line.owed - paid;
  if (debt > 0) await tx.putMarker(`bank_debt:${line.guarantor}`, String((await num(tx, `bank_debt:${line.guarantor}`)) + debt));
  await tx.putMarker(`bank_default:${line.borrower}`, line.id);
  await tx.putMarker(`line_open:${line.borrower}`, "");
  await writeLine(tx, { ...line, status: "defaulted", owed: debt });
}

/** The credits a backer has locked in Bonds not yet settled, one entry for each contract, kept beside the escrow rows so a statement can be checked against them (DK181). A null bond removes the entry. */
export async function noteLock(tx: LogTx, backer: string, contract: string, bond: number | null): Promise<void> {
  const key = `locks_of:${backer}`;
  const m = JSON.parse((await tx.getMarker(key)) ?? "{}") as Record<string, number>;
  if (bond === null || bond <= 0) delete m[contract]; else m[contract] = bond;
  await tx.putMarker(key, JSON.stringify(m));
}

/** A guarantor clears what it still owes after a default (DK181; spec-delta S462): the credits move from the guarantor to the Bank, the debt falls, and at zero the block on the guarantor's agents is lifted. */
export async function projectDebtPayment(tx: LogTx, r: AspRecord, env: BankEnv): Promise<void> {
  const b = r.body as { line: string; amount: { value: number } };
  if (r.prev !== null) throw rule("debt_payment_not_chained", "a debt payment starts its own chain (prev is null)");
  const line = await readLine(tx, b.line);
  if (!line) throw rule("debt_unknown_line", `${b.line} is not a credit line in this log`);
  if (line.status !== "defaulted" || line.owed <= 0) throw rule("debt_nothing_owed", `the line ${b.line} is ${line.status} and owes nothing to clear`);
  if (r.issuer !== line.guarantor) throw rule("debt_not_the_guarantor", `only the guarantor (${line.guarantor}) clears its debt`);
  if (b.amount.value < 1) throw rule("amount_not_positive", "a payment is at least 1 credit");
  if (b.amount.value > line.owed) throw rule("debt_overpaid", `the debt on this line is ${line.owed}, not ${b.amount.value}`);
  await env.debit(tx, line.guarantor, b.amount.value); // refused with insufficient_balance when the guarantor cannot cover it
  await env.credit(tx, BANK_DID, b.amount.value);
  await writeLine(tx, { ...line, owed: line.owed - b.amount.value });
  await tx.putMarker(`bank_debt:${line.guarantor}`, String(Math.max(0, (await num(tx, `bank_debt:${line.guarantor}`)) - b.amount.value)));
}

/** A statement (bank-insurer.md 3): the Bank states what a holder has and owes; the log checks it against its own ledger, so a wrong statement is refused, not corrected later. */
export async function projectBankStatement(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { holder: string; balance: { value: number }; owed: { value: number }; locks?: { contract: string; bond: { value: number } }[] };
  if (r.prev !== null) throw rule("statement_not_chained", "a statement starts its own chain (prev is null)");
  if (r.issuer !== BANK_DID) throw rule("statement_wrong_issuer", `${r.issuer} is not the Bank (${BANK_DID}): only the Bank issues a statement`);
  const balance = await balanceOf(tx, b.holder);
  if (b.balance.value !== balance) throw rule("statement_balance_mismatch", `${b.holder} holds ${balance} credits in the log, not ${b.balance.value}`);
  const id = await tx.getMarker(`line_open:${b.holder}`);
  const line = id ? await readLine(tx, id) : undefined;
  const owed = line && (line.status === "drawn" || line.status === "owing") ? line.owed : 0;
  if (b.owed.value !== owed) throw rule("statement_owed_mismatch", `${b.holder} owes the Bank ${owed} credits in the log, not ${b.owed.value}`);
  if (b.locks) {
    const held = JSON.parse((await tx.getMarker(`locks_of:${b.holder}`)) ?? "{}") as Record<string, number>;
    const stated = Object.fromEntries(b.locks.map((l) => [l.contract, l.bond.value]));
    if (b.locks.length !== Object.keys(stated).length) throw rule("statement_locks_duplicate", "a contract is listed twice in the locks");
    const keys = new Set([...Object.keys(held), ...Object.keys(stated)]);
    for (const k of keys) if (held[k] !== stated[k]) throw rule("statement_locks_mismatch", `the locks of ${b.holder} in the log are ${JSON.stringify(held)}, not ${JSON.stringify(stated)}`);
  }
}
