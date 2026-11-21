/**
 * A standing budget for each agent (register row US2; spec-delta S1454): the person sets a cap once and every run of that agent keeps to it, instead of repeating `--daily-tokens` on each run. Two caps, tokens in the
 * UTC day and tokens in the UTC month, and a warning level (default 80 %) at which the person is told before the cap is reached. The caps are the person's, on their machine, in `budgets.json` in the asp home;
 * `DailyCeiling` (the denial-of-wallet guard, DK8) does the counting and the refusing. Tokens, never a price: a model's price is the provider's. A flag on a run still wins over the stored cap for that run.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface AgentBudget { dailyTokens?: number; monthlyTokens?: number; warnPercent?: number }
export const DEFAULT_WARN_PERCENT = 80;

/**
 * The default model-spend ceilings (register row DK1715), in tokens, never a price: every Mandate made without a token budget carries them, and the gateway keeps to them for a person who never set a cap.
 * A sponsor may lower them or raise them, but never above what the operator allows (the operator's maxima). Credits and tokens here are accounting figures, not money.
 */
export const DEFAULT_RUN_TOKENS = 1_000_000;
export const DEFAULT_DAILY_TOKENS = 3_000_000;
export const OPERATOR_MAX_RUN_TOKENS = 20_000_000;
export const OPERATOR_MAX_DAILY_TOKENS = 50_000_000;
/** The alert levels, in percent of a ceiling: each is told once. */
export const ALERT_LEVELS = [50, 80, 100] as const;

/** The levels newly reached by `used` of `cap` that are not in `told` yet (a level is told once, however far the figure jumps: only the highest new one is named, the lower ones are marked told too). */
export function newAlertLevels(used: number, cap: number, told: Set<number>): number[] {
  if (!(cap > 0)) return [];
  const pct = (used * 100) / cap;
  const reached = ALERT_LEVELS.filter((l) => pct >= l && !told.has(l));
  for (const l of reached) told.add(l);
  return reached.length ? [reached[reached.length - 1]!] : [];
}

export class Budgets {
  private data: Record<string, AgentBudget> = {};
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
    try { if (existsSync(file)) this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, AgentBudget>; } catch { this.data = {}; }
  }
  get(agent: string): AgentBudget { return { ...(this.data[agent] ?? {}) }; }
  all(): Record<string, AgentBudget> { return JSON.parse(JSON.stringify(this.data)); }
  /** Sets or clears (`null`) fields of an agent's budget; a field left out is unchanged. Returns the budget after. */
  set(agent: string, change: { dailyTokens?: number | null; monthlyTokens?: number | null; warnPercent?: number | null }): AgentBudget {
    const b: AgentBudget = { ...(this.data[agent] ?? {}) };
    const apply = (k: keyof AgentBudget, v: number | null | undefined, check: (n: number) => void) => { if (v === undefined) return; if (v === null) { delete b[k]; return; } check(v); b[k] = v; };
    apply("dailyTokens", change.dailyTokens, (n) => { if (!Number.isInteger(n) || n < 1) throw new Error("a daily token cap is a whole number, at least 1"); });
    apply("monthlyTokens", change.monthlyTokens, (n) => { if (!Number.isInteger(n) || n < 1) throw new Error("a monthly token cap is a whole number, at least 1"); });
    apply("warnPercent", change.warnPercent, (n) => { if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error("the warning level is a whole number of percent from 1 to 99"); });
    if (b.dailyTokens !== undefined && b.monthlyTokens !== undefined && b.dailyTokens > b.monthlyTokens) throw new Error(`a daily cap of ${b.dailyTokens} is above the monthly cap of ${b.monthlyTokens}: the month would run out first, so the daily cap could never be reached`);
    if (Object.keys(b).length) this.data[agent] = b; else delete this.data[agent];
    const tmp = `${this.file}.${process.pid}.part`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
    return this.get(agent);
  }
}

/** The warnings that apply to what has been spent: for each cap at or above the warning level, a sentence; for a cap that is reached, the sentence says runs are refused. */
export function budgetWarnings(agent: string, b: AgentBudget, spent: { today: number; month: number }): string[] {
  const level = b.warnPercent ?? DEFAULT_WARN_PERCENT;
  const out: string[] = [];
  const check = (cap: number | undefined, used: number, what: string) => {
    if (cap === undefined) return;
    const pct = Math.floor((used * 100) / cap);
    if (used >= cap) out.push(`${agent} has reached its ${what} cap: ${used} of ${cap} tokens (${pct}%); further runs are refused until it resets or the cap is raised (asp budget set --agent ${agent})`);
    else if (pct >= level) out.push(`${agent} has used ${pct}% of its ${what} cap: ${used} of ${cap} tokens, ${cap - used} left (warning level ${level}%; asp budget show --agent ${agent})`);
  };
  check(b.dailyTokens, spent.today, "daily");
  check(b.monthlyTokens, spent.month, "monthly");
  return out;
}

/** Where the month is heading at the pace so far: tokens at month end, and whether that is over the cap. `day` is the day of the month (1 to 31) and `daysInMonth` its length. */
export function monthProjection(used: number, day: number, daysInMonth: number, cap?: number): { projected: number; over: boolean } {
  const projected = Math.round((used / Math.max(1, day)) * daysInMonth);
  return { projected, over: cap !== undefined && projected > cap };
}
