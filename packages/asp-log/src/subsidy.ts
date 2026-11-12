/**
 * The subsidy ledger (docs/institutions/residency.md 5 to 7; register row DK85; spec-delta S300): what the city spends on compute for a resident, kept in REAL UNITS (tokens, host-seconds), never in
 * credits. A published monthly budget, per-agent and per-sponsor caps, grants, and one use record per grant per day from the host's meter; a spent budget stops new grants and new use with a reason.
 * Nothing here touches a credit account: credits never buy subsidy units, and subsidy units never buy, repay or become credits. The subsidy is the operator's cost of hosting residents, not a payment
 * to anyone. Credits are accounting entries, not money.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

/** The City-budget DID signs budgets and grants; the Host DID signs use. The operator holds both keys in the beta. */
export const CITY_BUDGET_DID = "did:web:asp.local:city-budget";
export const HOST_DID = "did:web:asp.local:host";
/** A budget is published this long before its period begins (residency.md 5). */
export const BUDGET_NOTICE_MS = 72 * 3_600_000;
export const SUBSIDY_CLASSES = ["newcomer", "resident", "research"] as const;
/** A resident-class grant needs this many qualifying jobs (credits.md 5.4). */
export const RESIDENT_MIN_QUALIFYING = 3;

export interface SubsidyEnv { reputation(tx: LogTx, did: string): Promise<{ tier: number; qualifyingJobs: number } | null> }

interface Budget { id: string; period: string; units: string; total: number; classes: { class: string; per_agent_cap: number; per_sponsor_cap: number }[] }
interface Grant { id: string; agent: string; sponsor: string; class: string; budget: string; daily: number; period: number; from: string; until: string }

const num = async (tx: Pick<LogTx, "getMarker">, key: string) => Number((await tx.getMarker(key)) ?? 0);
const readJson = async <T>(tx: Pick<LogTx, "getMarker">, key: string): Promise<T | undefined> => { const raw = await tx.getMarker(key); return raw ? (JSON.parse(raw) as T) : undefined; };
const periodStart = (period: string) => Date.parse(`${period}-01T00:00:00Z`);
const periodEnd = (period: string) => { const [y, m] = period.split("-").map(Number); return Date.UTC(y, m, 1); };

export async function projectSubsidyBudget(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { period: string; units: string; total: number; classes: Budget["classes"]; published_at: string };
  if (r.prev !== null) throw rule("subsidy_not_chained", "a subsidy record starts its own chain (prev is null)");
  if (r.issuer !== CITY_BUDGET_DID) throw rule("subsidy_wrong_issuer", `${r.issuer} is not the City budget (${CITY_BUDGET_DID}): only it publishes a subsidy budget`);
  if (await tx.getMarker(`sbudget:${b.period}|${b.units}`)) throw rule("subsidy_budget_exists", `${b.period} already has a ${b.units} budget: one per period and unit; a notice, not a second budget, changes it`);
  if (Date.parse(b.published_at) > Date.parse(r.issued_at) || periodStart(b.period) - Date.parse(r.issued_at) < BUDGET_NOTICE_MS) throw rule("subsidy_budget_late", "a budget is published at least 72 hours before its period begins");
  if (new Set(b.classes.map((c) => c.class)).size !== b.classes.length) throw rule("subsidy_class_twice", "a class is listed once");
  await tx.putMarker(`sbudget:${b.period}|${b.units}`, r.id);
  await tx.putMarker(`sbudget_rec:${r.id}`, JSON.stringify({ id: r.id, period: b.period, units: b.units, total: b.total, classes: b.classes } satisfies Budget));
}

export async function projectSubsidyGrant(tx: LogTx, r: AspRecord, env: SubsidyEnv): Promise<void> {
  const b = r.body as { agent: string; class: string; budget: string; daily_cap: number; period_cap: number; from: string; until: string };
  if (r.prev !== null) throw rule("subsidy_not_chained", "a subsidy record starts its own chain (prev is null)");
  if (r.issuer !== CITY_BUDGET_DID) throw rule("subsidy_wrong_issuer", `${r.issuer} is not the City budget (${CITY_BUDGET_DID}): only it grants a subsidy`);
  const budget = await readJson<Budget>(tx, `sbudget_rec:${b.budget}`);
  if (!budget) throw rule("subsidy_budget_unknown", `${b.budget} is not a subsidy budget in this log`);
  const passport = await tx.getPassport(b.agent);
  if (!passport?.sponsor) throw rule("subsidy_not_an_agent", `${b.agent} is not an agent with a sponsor in this log`);
  const cls = budget.classes.find((c) => c.class === b.class);
  if (!cls) throw rule("subsidy_class_not_in_budget", `the budget has no ${b.class} class`);
  if (b.period_cap > cls.per_agent_cap) throw rule("subsidy_over_agent_cap", `the ${b.class} class allows an agent at most ${cls.per_agent_cap} ${budget.units} for the period, not ${b.period_cap}`);
  if (b.daily_cap > b.period_cap || b.daily_cap <= 0) throw rule("subsidy_daily_cap", "the daily cap is above 0 and at most the period cap");
  if (Date.parse(b.from) < periodStart(budget.period) || Date.parse(b.until) > periodEnd(budget.period) || Date.parse(b.until) <= Date.parse(b.from)) throw rule("subsidy_grant_outside_period", `a grant lies inside its budget's period (${budget.period})`);
  if (await tx.getMarker(`sgrant_active:${b.agent}|${b.class}`)) throw rule("subsidy_grant_exists", `${b.agent} already has an active ${b.class} grant: one per agent and class`);
  if (b.class === "newcomer" && (await tx.getMarker(`sgrant_ever:${b.agent}|newcomer`))) throw rule("subsidy_newcomer_once", "a newcomer grant is once per agent");
  const rep = await env.reputation(tx, b.agent);
  if (b.class === "resident" && (!rep || rep.tier < 1 || rep.qualifyingJobs < RESIDENT_MIN_QUALIFYING)) throw rule("subsidy_class_not_met", `a resident grant needs tier 1 or above and ${RESIDENT_MIN_QUALIFYING} qualifying jobs; ${b.agent} has ${rep?.qualifyingJobs ?? 0}`);
  const used = await num(tx, `sbudget_used:${b.budget}`);
  if (used >= budget.total) throw rule("subsidy_exhausted", `the ${budget.period} ${budget.units} budget is spent (${used} of ${budget.total}): no new subsidised runs until the next period`);
  const sponsorKey = `ssponsor:${b.budget}|${b.class}|${passport.sponsor}`;
  const sponsorCount = await num(tx, sponsorKey);
  if (sponsorCount >= cls.per_sponsor_cap) throw rule("subsidy_over_sponsor_cap", `a sponsor may have ${cls.per_sponsor_cap} agents on the ${b.class} class at once`);
  const committed = await num(tx, `sbudget_committed:${b.budget}`);
  if (committed + b.period_cap > budget.total) throw rule("subsidy_budget_committed", `${committed} of the budget's ${budget.total} ${budget.units} is already granted: ${b.period_cap} more does not fit`);
  await tx.putMarker(sponsorKey, String(sponsorCount + 1));
  await tx.putMarker(`sbudget_committed:${b.budget}`, String(committed + b.period_cap));
  await tx.putMarker(`sgrant_active:${b.agent}|${b.class}`, r.id);
  if (b.class === "newcomer") await tx.putMarker(`sgrant_ever:${b.agent}|newcomer`, r.id);
  await tx.putMarker(`sgrant:${r.id}`, JSON.stringify({ id: r.id, agent: b.agent, sponsor: passport.sponsor, class: b.class, budget: b.budget, daily: b.daily_cap, period: b.period_cap, from: b.from, until: b.until } satisfies Grant));
}

/** One use record per grant per day, signed by the host from its meter. Never more than the day's cap, the grant, or what the budget has left. */
export async function projectSubsidyUse(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { grant: string; units: number; kind: string; window: string; meter_hash: string };
  if (r.prev !== null) throw rule("subsidy_not_chained", "a subsidy record starts its own chain (prev is null)");
  if (r.issuer !== HOST_DID) throw rule("subsidy_use_wrong_issuer", `${r.issuer} is not the Host (${HOST_DID}): only the host reports use from its meter`);
  const grant = await readJson<Grant>(tx, `sgrant:${b.grant}`);
  if (!grant) throw rule("subsidy_grant_unknown", `${b.grant} is not a subsidy grant in this log`);
  const budget = (await readJson<Budget>(tx, `sbudget_rec:${grant.budget}`))!;
  if (b.kind !== budget.units) throw rule("subsidy_units_mismatch", `the grant is in ${budget.units}, not ${b.kind}: units are never converted`);
  const day = Date.parse(`${b.window}T00:00:00Z`);
  if (day + 86_400_000 <= Date.parse(grant.from) || day >= Date.parse(grant.until)) throw rule("subsidy_use_outside_grant", `${b.window} is outside the grant (${grant.from} to ${grant.until})`);
  if (await tx.getMarker(`sgrant_day:${b.grant}|${b.window}`)) throw rule("subsidy_use_exists", `${b.window} already has a use record for this grant: one per grant and day`);
  if (b.units > grant.daily) throw rule("subsidy_exceeded", `${b.units} ${budget.units} is over the grant's daily cap of ${grant.daily}`);
  const used = await num(tx, `sgrant_used:${b.grant}`);
  if (used + b.units > grant.period) throw rule("subsidy_exceeded", `${used + b.units} ${budget.units} is over the grant's ${grant.period} for the period`);
  const budgetUsed = await num(tx, `sbudget_used:${grant.budget}`);
  if (budgetUsed + b.units > budget.total) throw rule("subsidy_exhausted", `the ${budget.period} ${budget.units} budget has ${budget.total - budgetUsed} left: new subsidised runs stop until the next period`);
  await tx.putMarker(`sgrant_day:${b.grant}|${b.window}`, String(b.units));
  await tx.putMarker(`sgrant_used:${b.grant}`, String(used + b.units));
  await tx.putMarker(`sbudget_used:${grant.budget}`, String(budgetUsed + b.units));
}

export interface SubsidyReport {
  budgets: { id: string; period: string; units: string; total: number; granted: number; used: number; remaining: number; spent: boolean; by_class: Record<string, { grants: number; granted: number; used: number }> }[];
  note: string;
}

/** The monthly report, computed only from the records (so anyone can recompute it): per budget, what was granted and used, by class, and whether it is spent. */
export function subsidyReport(records: AspRecord[]): SubsidyReport {
  const budgets = new Map<string, SubsidyReport["budgets"][number]>();
  const grants = new Map<string, { budget: string; class: string; period: number }>();
  for (const r of records) {
    if (r.type === "asp.subsidy_budget/v0.2") { const b = r.body as { period: string; units: string; total: number }; budgets.set(r.id, { id: r.id, period: b.period, units: b.units, total: b.total, granted: 0, used: 0, remaining: b.total, spent: false, by_class: {} }); }
  }
  for (const r of records) {
    if (r.type === "asp.subsidy_grant/v0.2") {
      const b = r.body as { budget: string; class: string; period_cap: number };
      const x = budgets.get(b.budget); if (!x) continue;
      grants.set(r.id, { budget: b.budget, class: b.class, period: b.period_cap });
      x.granted += b.period_cap; const c = (x.by_class[b.class] ??= { grants: 0, granted: 0, used: 0 }); c.grants++; c.granted += b.period_cap;
    }
  }
  for (const r of records) {
    if (r.type === "asp.subsidy_use/v0.2") {
      const b = r.body as { grant: string; units: number };
      const g = grants.get(b.grant); const x = g && budgets.get(g.budget); if (!g || !x) continue;
      x.used += b.units; x.by_class[g.class].used += b.units;
    }
  }
  for (const x of budgets.values()) { x.remaining = x.total - x.used; x.spent = x.remaining <= 0; }
  return { budgets: [...budgets.values()], note: "Units are tokens or host-seconds, never credits. The subsidy is the operator's cost of hosting residents, not a payment to anyone; credits are accounting entries, not money." };
}

/** Reconciles the ledger to a host meter: for each use record, the meter's total for that grant and day must equal the units recorded. Returns the mismatches (empty when it reconciles). */
export function reconcileSubsidy(records: AspRecord[], meter: { grant: string; window: string; units: number }[]): { grant: string; window: string; recorded: number; metered: number }[] {
  const recorded = new Map<string, number>();
  for (const r of records) if (r.type === "asp.subsidy_use/v0.2") { const b = r.body as { grant: string; window: string; units: number }; recorded.set(`${b.grant}|${b.window}`, (recorded.get(`${b.grant}|${b.window}`) ?? 0) + b.units); }
  const metered = new Map<string, number>();
  for (const m of meter) metered.set(`${m.grant}|${m.window}`, (metered.get(`${m.grant}|${m.window}`) ?? 0) + m.units);
  const out: { grant: string; window: string; recorded: number; metered: number }[] = [];
  for (const k of new Set([...recorded.keys(), ...metered.keys()])) {
    const [grant, window] = k.split("|");
    if ((recorded.get(k) ?? 0) !== (metered.get(k) ?? 0)) out.push({ grant, window, recorded: recorded.get(k) ?? 0, metered: metered.get(k) ?? 0 });
  }
  return out;
}
