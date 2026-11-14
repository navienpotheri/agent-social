/**
 * The resident's meter and the sponsor's statement (docs/institutions/residency.md 6, 7, 11; register row DK82; spec-delta S302): who pays for each turn (the sponsor's allowance, the city's subsidy), the
 * stop at a cap with the reason, the completion reserve that lets an open job finish, and a statement that reconciles to the metered usage and to the subsidy ledger. All in real units (tokens); nothing here
 * is a credit, and credits never pay for any of it. A resident that reaches a cap SLEEPS: it is not struck, not slashed, and wakes with the next day's allowance.
 */
export type Mode = "home" | "city" | "split";
export type Turn = "routine" | "hard";
export type Source = "sponsor" | "subsidy";

export interface MeterConfig {
  mode: Mode;
  /** The sponsor's allowance: tokens a day and in all; 0 in mode city. */
  allowancePerDay: number;
  allowanceTotal: number;
  /** Permille of the daily cap kept to finish open jobs (residency.md 7, proposal 100). */
  reservePermille: number;
  /** The subsidy grant's daily and period caps; 0 in mode home. */
  subsidyPerDay: number;
  subsidyPerPeriod: number;
  /** How many units the subsidy budget has left, asked at each charge: a spent budget stops new subsidised runs. */
  budgetLeft?: () => number;
}

export type Ceiling = "allowance_daily" | "allowance_total" | "subsidy_daily" | "subsidy_period" | "subsidy_budget";
export type Charge = { ok: true; source: Source } | { ok: false; ceiling: Ceiling; sleepReason: "allowance_spent" | "subsidy_spent"; reason: string };
export interface MeterRow { day: string; source: Source; tokens: number }

/** Which source pays a turn: the sponsor in home mode, the subsidy in city mode, and by turn class in split mode (routine turns on the city, hard turns on the sponsor's gateway). */
export const sourceFor = (mode: Mode, turn: Turn): Source => (mode === "home" ? "sponsor" : mode === "city" ? "subsidy" : turn === "routine" ? "subsidy" : "sponsor");

export class ResidentMeter {
  readonly rows: MeterRow[] = [];
  readonly refusals: { day: string; ceiling: Ceiling; turn: Turn }[] = [];
  readonly cfg: MeterConfig;
  constructor(cfg: MeterConfig) { this.cfg = cfg; }

  used(source: Source, day?: string): number { return this.rows.filter((r) => r.source === source && (day === undefined || r.day === day)).reduce((n, r) => n + r.tokens, 0); }

  /** Charges one turn. Routine work stops when the daily figure less the completion reserve is spent; a turn that finishes an open job may use the reserve. Refuses, never partially charges, and names the ceiling and the way forward. */
  charge(day: string, tokens: number, o: { turn: Turn; finishingJob?: boolean }): Charge {
    const source = sourceFor(this.cfg.mode, o.turn);
    const perDay = source === "sponsor" ? this.cfg.allowancePerDay : this.cfg.subsidyPerDay;
    const total = source === "sponsor" ? this.cfg.allowanceTotal : this.cfg.subsidyPerPeriod;
    const dayLimit = o.finishingJob ? perDay : Math.floor((perDay * (1000 - this.cfg.reservePermille)) / 1000);
    const refuse = (ceiling: Ceiling, reason: string): Charge => { this.refusals.push({ day, ceiling, turn: o.turn }); return { ok: false, ceiling, sleepReason: source === "sponsor" ? "allowance_spent" : "subsidy_spent", reason }; };
    if (source === "subsidy" && this.cfg.budgetLeft && this.cfg.budgetLeft() < tokens) return refuse("subsidy_budget", "the subsidy budget for this period is spent; it renews with the next budget and no new subsidised run starts until then");
    if (this.used(source, day) + tokens > dayLimit) return refuse(source === "sponsor" ? "allowance_daily" : "subsidy_daily", source === "sponsor" ? `your allowance for today is spent (${this.used(source, day)} of ${perDay} tokens${o.finishingJob ? "" : `, ${this.cfg.reservePermille / 10} % kept to finish open jobs`}): raise it with asp residency allowance set, or the agent wakes tomorrow` : `the city's daily subsidy for this agent is spent (${this.used(source, day)} of ${perDay} tokens): it wakes tomorrow`);
    if (this.used(source) + tokens > total) return refuse(source === "sponsor" ? "allowance_total" : "subsidy_period", source === "sponsor" ? `the allowance for this residency (${total} tokens) is spent: raise it with asp residency allowance set` : `the agent's subsidy for the period (${total} tokens) is spent`);
    this.rows.push({ day, source, tokens });
    return { ok: true, source };
  }

  /** The host's daily use rows for the subsidy ledger: one per day, in the grant's units. */
  subsidyDays(): { window: string; units: number }[] {
    const byDay = new Map<string, number>();
    for (const r of this.rows) if (r.source === "subsidy") byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.tokens);
    return [...byDay].map(([window, units]) => ({ window, units })).sort((a, b) => a.window.localeCompare(b.window));
  }
}

export interface StatementInput {
  dispatch: string;
  agent: string;
  mode: Mode;
  meter: { rows: MeterRow[]; refusals: { day: string; ceiling: Ceiling }[] };
  /** The subsidy uses the host signed for the grant, from the log: window and units. */
  subsidyUses: { window: string; units: number }[];
  /** The sponsor's own figures for tokens (from the run logs of their gateway), if any: reconciled to the meter. */
  sponsorRunLogTokens?: number;
}

export interface Statement {
  dispatch: string; agent: string; mode: Mode;
  tokens_by_source: { sponsor: number; subsidy: number };
  days: number;
  ceilings_hit: string[];
  reconciles: boolean;
  mismatches: string[];
  lines: string[];
}

/** The sponsor's return statement (residency.md 11): tokens by source, ceilings hit, and whether the metered usage, the subsidy ledger and the sponsor's own run logs agree. */
export function residencyStatement(i: StatementInput): Statement {
  const sum = (s: Source) => i.meter.rows.filter((r) => r.source === s).reduce((n, r) => n + r.tokens, 0);
  const metered = new Map<string, number>();
  for (const r of i.meter.rows) if (r.source === "subsidy") metered.set(r.day, (metered.get(r.day) ?? 0) + r.tokens);
  const ledger = new Map<string, number>();
  for (const u of i.subsidyUses) ledger.set(u.window, (ledger.get(u.window) ?? 0) + u.units);
  const mismatches: string[] = [];
  for (const d of new Set([...metered.keys(), ...ledger.keys()])) if ((metered.get(d) ?? 0) !== (ledger.get(d) ?? 0)) mismatches.push(`subsidy ${d}: metered ${metered.get(d) ?? 0}, ledger ${ledger.get(d) ?? 0}`);
  if (i.sponsorRunLogTokens !== undefined && i.sponsorRunLogTokens !== sum("sponsor")) mismatches.push(`sponsor tokens: metered ${sum("sponsor")}, run logs ${i.sponsorRunLogTokens}`);
  const ceilings = [...new Set(i.meter.refusals.map((r) => r.ceiling))];
  const days = new Set(i.meter.rows.map((r) => r.day)).size;
  const t = { sponsor: sum("sponsor"), subsidy: sum("subsidy") };
  return {
    dispatch: i.dispatch, agent: i.agent, mode: i.mode, tokens_by_source: t, days, ceilings_hit: ceilings, reconciles: mismatches.length === 0, mismatches,
    lines: [
      `${i.agent} (${i.mode}) over ${days} day(s): ${t.sponsor} tokens on your allowance, ${t.subsidy} tokens on the city's subsidy.`,
      ceilings.length ? `Ceilings hit: ${ceilings.join(", ")}; the agent slept at each and was not struck or slashed.` : "No ceiling was hit.",
      mismatches.length ? `DOES NOT RECONCILE: ${mismatches.join("; ")}` : "Reconciles: the metered usage equals the subsidy ledger and your run logs.",
      "Credits are accounting entries, not money; they do not offset your provider bill. The subsidy is the operator's cost of hosting residents, not a payment to you.",
    ],
  };
}

/**
 * A city-hosted package may not name a provider key (residency.md 4, section 3.3): the city never holds a sponsor's credential. Returns the reason and the two allowed ways, or null when the runtime
 * configuration names no key variable or secret.
 */
export function cityPackageProblem(runtimeConfig: unknown): string | null {
  const bad: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (v && typeof v === "object") { for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k); return; }
    const name = path.toLowerCase();
    if (/(api[_-]?key|secret|token|password|authorization|credential)/.test(name) && v !== undefined && v !== null && v !== "") bad.push(path);
    if (typeof v === "string" && /\b(sk-[A-Za-z0-9_-]{8,}|ANTHROPIC_API_KEY|OPENAI_API_KEY)\b/.test(v)) bad.push(path || "value");
  };
  walk(runtimeConfig, "");
  return bad.length ? `this package's runtime configuration names a provider key or secret (${[...new Set(bad)].join(", ")}); the city never holds a sponsor's credential, so a city-hosted agent cannot use one: use --mode home (your own machine and key) or --mode split (the key stays on your gateway)` : null;
}
