/**
 * The credit audit (docs/institutions/economy/credits.md 1.1, 6.2, CR-1; register rows DK1 and DK9): the supply rule checked over the
 * whole ledger the log holds, not over accounts a caller names.
 *
 *   Σ balances (every account, the platform account included)
 * + Σ escrow, bond and court-fee reserves locked in contracts not yet settled
 * + Σ juror stakes
 * + Σ open report deposits
 * = M, the minted total
 *
 * Read-only. It changes no record and no signed format. Credits are accounting entries, not money.
 */
import type { AccountRow, EscrowRow, JurorRow, LogHead, MintRow, ReportRow, Store } from "./store.ts";

/** Everything the audit reads, taken from one consistent view of the store. */
export interface LedgerRows {
  head: LogHead;
  accounts: AccountRow[];
  mints: MintRow[];
  escrows: EscrowRow[];
  jurors: JurorRow[];
  reports: ReportRow[];
}

export interface CreditAudit {
  /** The log head the figures were read at. */
  head: LogHead;
  /** M: the sum of every DID's minted total. Not a signed record yet (CR-2), so it is the log's own counter. */
  minted: number;
  accounts: number;
  /** Σ balances of every account. */
  balances: number;
  /** Of which the platform account (settlement fees; nothing can spend them yet). */
  platform: number;
  /** Balances of agent and person accounts only (credits.md 1.1 "in circulation", before locks). */
  circulating: number;
  locked: { escrow: number; bond: number; feeReserves: number; jurorStakes: number; reportDeposits: number; total: number };
  openContracts: number;
  /** balances + locked. */
  accounted: number;
  /** accounted − minted: 0 when the books balance. */
  difference: number;
  /** DIDs whose balance is negative (never allowed). */
  negativeAccounts: string[];
  verdict: "balanced" | "mismatch";
  /** Why the verdict is "mismatch", in words. */
  problems: string[];
  /** What the spec's audit has and this log cannot report yet. */
  notYet: string[];
}

export function auditLedger(rows: LedgerRows, platformDid: string): CreditAudit {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const minted = sum(rows.mints.map((m) => m.totalMinted));
  const balances = sum(rows.accounts.map((a) => a.balance));
  const platform = rows.accounts.find((a) => a.did === platformDid)?.balance ?? 0;
  const open = rows.escrows.filter((e) => !e.settled);
  const locked = {
    escrow: sum(open.map((e) => e.escrowLocked)),
    bond: sum(open.map((e) => e.bondLocked)),
    feeReserves: sum(open.map((e) => e.feeReservePrincipal + e.feeReserveBacker)),
    jurorStakes: sum(rows.jurors.map((j) => j.staked)),
    reportDeposits: sum(rows.reports.filter((r) => r.status === "open").map((r) => r.deposit)),
    total: 0,
  };
  locked.total = locked.escrow + locked.bond + locked.feeReserves + locked.jurorStakes + locked.reportDeposits;
  const accounted = balances + locked.total;
  const difference = accounted - minted;
  const negativeAccounts = rows.accounts.filter((a) => a.balance < 0).map((a) => a.did);
  const problems: string[] = [];
  if (difference > 0) problems.push(`${difference} credit(s) more are held than were ever minted: credits were created`);
  if (difference < 0) problems.push(`${-difference} credit(s) were minted and are in no account or lock: credits were lost`);
  if (negativeAccounts.length) problems.push(`negative balance: ${negativeAccounts.join(", ")}`);
  return {
    head: rows.head, minted, accounts: rows.accounts.length, balances, platform, circulating: balances - platform, locked,
    openContracts: open.length, accounted, difference, negativeAccounts,
    verdict: problems.length ? "mismatch" : "balanced", problems,
    notYet: [
      "the burned total (there is no Burn account; nothing burns today)",
      "Treasury and institution accounts (CR-3): none exist, so none are listed",
      "minted credits by reason (the mint is not a signed record yet; CR-2)",
    ],
  };
}

/** What the log's signed records say about money movement, by flow. Only flows the records carry are here. */
export interface CreditFlows {
  since: string | null;
  head: LogHead;
  /** Settlements by basis, counted from the records (a settlement with no `fees` field has 0 fees). */
  settlements: { count: number; escrowReleased: number; fees: number; bondReturned: number; bondSlashed: number; byBasis: Record<string, number> };
  /** Credits minted, whole history: mints carry no time or reason, so `since` does not apply to them. */
  minted: number;
  /** Not available from the log today, with the reason. */
  unavailable: string[];
}

export async function creditFlowsOf(store: Store, since?: string): Promise<CreditFlows> {
  const from = since ? Date.parse(since) : undefined;
  if (since && !Number.isFinite(from)) throw new Error(`not a time: ${since}`);
  const s = { count: 0, escrowReleased: 0, fees: 0, bondReturned: 0, bondSlashed: 0, byBasis: {} as Record<string, number> };
  const head = await store.logHead();
  for (let after = 0; ; ) {
    const page = await store.since(after, 500);
    if (!page.length) break;
    for (const r of page) {
      after = r.seq;
      if (r.record.type !== "asp.settlement/v0.2" || (from !== undefined && Date.parse(r.appendedAt) < from)) continue;
      const b = r.record.body as { basis: string; escrow_released: { value: number }; fees?: { value: number }; bond_returned: { value: number }; bond_slashed: { value: number } };
      s.count++;
      s.escrowReleased += b.escrow_released.value; s.fees += b.fees?.value ?? 0; s.bondReturned += b.bond_returned.value; s.bondSlashed += b.bond_slashed.value;
      s.byBasis[b.basis] = (s.byBasis[b.basis] ?? 0) + 1;
    }
  }
  return {
    since: since ?? null, head, settlements: s, minted: (await store.allMints()).reduce((n, m) => n + m.balance, 0),
    unavailable: [
      "faucets by reason (the mint carries no reason; CR-2)",
      "purchases, price lists, receipts, taxes and the institution split (not built: CR-4 to CR-7)",
      "burns, refunds, prizes and budgets (no Burn account, no such records)",
      "credit lines, premiums, claims and reserves of the Bank and the Insurer (not built)",
      "panel fees paid to jurors (derived inside a ruling settlement, not stored)",
    ],
  };
}
