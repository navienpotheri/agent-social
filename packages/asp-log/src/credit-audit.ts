/**
 * The credit audit (docs/institutions/economy/credits.md 1.1, 6.2, CR-1; register rows DK1 and DK9): the supply rule checked over the
 * whole ledger the log holds, not over accounts a caller names.
 *
 *   Σ balances (every account, the platform account included)
 * + Σ escrow, bond and court-fee reserves locked in contracts not yet settled
 * + Σ juror stakes (the Treasury, institution and Burn accounts are accounts like any other, so they are in Σ balances)
 * + Σ open report deposits
 * = M, the minted total
 *
 * Read-only. It changes no record and no signed format. Credits are accounting entries, not money.
 */
import { BURN_DID, INSTITUTION_DIDS, isReservedAccount, PLATFORM_DID, STARTER_POOL_DID, TREASURY_DID, splitParts, type Split } from "./economy.ts";
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
  /** M: the sum of every DID's minted total, signed and unsigned. */
  minted: number;
  /** Of M, minted by signed `mint` records (CR-2): a replica can recompute these from the log. */
  mintedSigned: number;
  /** Of M, minted by the old unsigned local `mint`: not reproducible from the log. `mintedSigned + mintedUnsigned = minted`. */
  mintedUnsigned: number;
  /** Mint totals by reason are in `asp credits audit --by-flow`, from the signed records. */
  /** B: the burned total, the Burn account's balance (credits.md 1.1). It stays counted in the balances, so the rule still adds up. */
  burned: number;
  /** The Treasury account's balance (a balance left in an old platform row is in `platform`). */
  treasury: number;
  /** Institution accounts (credits.md A10) with their balances. */
  institutions: { did: string; balance: number }[];
  accounts: number;
  /** Σ balances of every account. */
  balances: number;
  /** Of which a balance still held under the OLD platform account (before it became an alias of the Treasury). */
  platform: number;
  /** Balances of agent and person accounts only (credits.md 1.1 "in circulation", before locks): not the Treasury, institutions, platform or Burn. */
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

export function auditLedger(rows: LedgerRows, platformDid: string = PLATFORM_DID): CreditAudit {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const minted = sum(rows.mints.map((m) => m.totalMinted));
  const balances = sum(rows.accounts.map((a) => a.balance));
  const mintedSigned = sum(rows.mints.map((m) => m.signedMinted ?? 0));
  const bal = (did: string) => rows.accounts.find((a) => a.did === did)?.balance ?? 0;
  const platform = bal(platformDid);
  const treasury = bal(TREASURY_DID);
  const burned = bal(BURN_DID);
  const institutions = INSTITUTION_DIDS.map((did) => ({ did, balance: bal(did) })).filter((i) => i.balance !== 0 || rows.accounts.some((a) => a.did === i.did));
  const reserved = new Set<string>([platformDid, TREASURY_DID, BURN_DID, ...INSTITUTION_DIDS]);
  const circulating = sum(rows.accounts.filter((a) => !reserved.has(a.did)).map((a) => a.balance));
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
    head: rows.head, minted, mintedSigned, mintedUnsigned: minted - mintedSigned, burned, treasury, institutions,
    accounts: rows.accounts.length, balances, platform, circulating, locked,
    openContracts: open.length, accounted, difference, negativeAccounts,
    verdict: problems.length ? "mismatch" : "balanced", problems,
    notYet: [
      "minted credits by reason for the old unsigned mints (only signed mint records carry a reason; see mintedUnsigned)",
      "job tax, standing orders and credit lines (CR-15: not built); budget payments, allowances and prizes (S190) move balances, so the books balance, but the audit does not yet list them by flow",
    ],
  };
}

/** What the log's signed records say about money movement, by flow. Only flows the records carry are here. */
export interface CreditFlows {
  since: string | null;
  head: LogHead;
  /** Settlements by basis, counted from the records (a settlement with no `fees` field has 0 fees). */
  settlements: { count: number; escrowReleased: number; fees: number; bondReturned: number; bondSlashed: number; byBasis: Record<string, number> };
  /** Credits minted, whole history (signed and unsigned); the old unsigned mint carries no time, so `since` applies only to the signed ones in `mintedByReason`. */
  minted: number;
  /** Credits minted by signed `mint` records in the period, by reason (the faucets by reason, credits.md 6.1). */
  mintedByReason: Record<string, number>;
  /** Purchases in the period with the split applied: provider is what the institution accounts received, treasury the Treasury part, burned the Burn part. */
  purchases: { count: number; amount: number; provider: number; treasury: number; burned: number; byService: Record<string, { count: number; amount: number }> };
  /** Refunds paid back by receipts in the period. */
  refunds: { count: number; amount: number };
  /** Not available from the log today, with the reason. */
  unavailable: string[];
}

export async function creditFlowsOf(store: Store, since?: string): Promise<CreditFlows> {
  const from = since ? Date.parse(since) : undefined;
  if (since && !Number.isFinite(from)) throw new Error(`not a time: ${since}`);
  const s = { count: 0, escrowReleased: 0, fees: 0, bondReturned: 0, bondSlashed: 0, byBasis: {} as Record<string, number> };
  const mintedByReason: Record<string, number> = {};
  const purchases: CreditFlows["purchases"] = { count: 0, amount: 0, provider: 0, treasury: 0, burned: 0, byService: {} };
  const refunds = { count: 0, amount: 0 };
  const head = await store.logHead();
  for (let after = 0; ; ) {
    const page = await store.since(after, 500);
    if (!page.length) break;
    for (const r of page) {
      after = r.seq;
      if (from !== undefined && Date.parse(r.appendedAt) < from) continue;
      if (r.record.type === "asp.mint/v0.2") {
        const m = r.record.body as { reason: string; amount: { value: number } };
        mintedByReason[m.reason] = (mintedByReason[m.reason] ?? 0) + m.amount.value;
        continue;
      }
      if (r.record.type === "asp.purchase/v0.2") {
        const p = r.record.body as { service: string; amount: { value: number }; price_list: string };
        const item = ((await store.getRecord(p.price_list))?.record.body as { items: { service: string; split: Split }[] } | undefined)?.items.find((i) => i.service === p.service);
        const parts = item && splitParts(p.amount.value, item.split);
        purchases.count++; purchases.amount += p.amount.value;
        if (parts) { purchases.treasury += parts.treasury; purchases.burned += parts.burn; purchases.provider += p.amount.value - parts.treasury - parts.burn; }
        const by = (purchases.byService[p.service] ??= { count: 0, amount: 0 }); by.count++; by.amount += p.amount.value;
        continue;
      }
      if (r.record.type === "asp.receipt/v0.2") {
        const rc = r.record.body as { refund_amount?: { value: number } };
        if (rc.refund_amount) { refunds.count++; refunds.amount += rc.refund_amount.value; }
        continue;
      }
      if (r.record.type !== "asp.settlement/v0.2") continue;
      const b = r.record.body as { basis: string; escrow_released: { value: number }; fees?: { value: number }; bond_returned: { value: number }; bond_slashed: { value: number } };
      s.count++;
      s.escrowReleased += b.escrow_released.value; s.fees += b.fees?.value ?? 0; s.bondReturned += b.bond_returned.value; s.bondSlashed += b.bond_slashed.value;
      s.byBasis[b.basis] = (s.byBasis[b.basis] ?? 0) + 1;
    }
  }
  return {
    since: since ?? null, head, settlements: s, minted: (await store.ledgerRows()).mints.reduce((n, m) => n + m.totalMinted, 0), mintedByReason, purchases, refunds,
    unavailable: [
      "faucets by reason for the old unsigned mints (they carry no reason; signed mints do, see mintedByReason)",
      "job tax, standing orders and auto-refunds (not built: CR-15, CR-23); budget payments, allowances and prizes (S190) are not yet listed by flow",
      "credit lines, premiums, claims and reserves of the Bank and the Insurer (not built)",
      "panel fees paid to jurors (derived inside a ruling settlement, not stored)",
    ],
  };
}

/** Share of circulation held by the top slice of accounts (credits.md 5.6, G5): a figure only, never which DIDs. */
export interface BalanceConcentration {
  accountsConsidered: number;
  topCount: number;
  topShare: number;
}

export function topBalanceShare(rows: LedgerRows, topFraction: number): BalanceConcentration {
  const balances = rows.accounts.filter((a) => !isReservedAccount(a.did) && a.balance > 0).map((a) => a.balance).sort((a, b) => b - a);
  const total = balances.reduce((a, b) => a + b, 0);
  if (!balances.length || total <= 0) return { accountsConsidered: balances.length, topCount: 0, topShare: 0 };
  const topCount = Math.max(1, Math.ceil(balances.length * topFraction));
  const top = balances.slice(0, topCount).reduce((a, b) => a + b, 0);
  return { accountsConsidered: balances.length, topCount, topShare: top / total };
}

/** The starter pool as the ledger rows hold it (credits.md 5.6, G2): what the operator funded with signed mints and what is left. Zero funded means no signed pool yet. The log itself derives the figures from its mint and claim records (`EventLog.starterPoolState`, DK70) and uses this as the cross-check. */
export interface StarterPoolState {
  funded: number; balance: number; used: number;
  /** From the records (DK70): true when the ledger's balance of the pool equals every signed mint to it less every starter claim; false means the ledger and the records disagree (an unsigned mint, a stray transfer). */
  consistent?: boolean;
}

export function starterPoolOf(rows: LedgerRows): StarterPoolState {
  const funded = rows.mints.find((m) => m.did === STARTER_POOL_DID)?.signedMinted ?? 0;
  const balance = rows.accounts.find((a) => a.did === STARTER_POOL_DID)?.balance ?? 0;
  return { funded, balance, used: Math.max(0, funded - balance) };
}
