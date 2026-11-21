/**
 * The sponsor's spend guard (DK1715): a run carries default ceilings in tokens, so a person who never set a cap is still covered. A run may use at most DEFAULT_RUN_TOKENS and one agent DEFAULT_DAY_TOKENS in a
 * UTC day; a sponsor may raise or lower either, but never above what the operator allows (OPERATOR_MAX_*; the operator sets ASP_MAX_RUN_TOKENS and ASP_MAX_DAY_TOKENS). The gateway tells the person at 50, 80 and
 * 100 percent of the run's ceiling and refuses the next model call once it is reached. Tokens, not money; credits here are mock.
 */
export const DEFAULT_RUN_TOKENS = 2_000_000;
export const DEFAULT_DAY_TOKENS = 10_000_000;
export const OPERATOR_MAX_RUN_TOKENS = 20_000_000;
export const OPERATOR_MAX_DAY_TOKENS = 100_000_000;

export interface SpendCeilings { perRun: number; perDay: number; clamped: string[] }

const num = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = Math.trunc(Number(v));
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} is a whole number of tokens, at least 1`);
  return n;
};

/** The ceilings for a run: the sponsor's figures (flags), else the defaults, each clamped to what the operator allows (the environment may lower or raise the operator's own maximum). */
export function ceilingsFor(flags: { "token-cap"?: string; "daily-tokens"?: string }, env: Record<string, string | undefined> = {}, mandate?: { per_run?: number; per_day?: number }): SpendCeilings {
  const maxRun = num(env.ASP_MAX_RUN_TOKENS, "ASP_MAX_RUN_TOKENS") ?? OPERATOR_MAX_RUN_TOKENS;
  const maxDay = num(env.ASP_MAX_DAY_TOKENS, "ASP_MAX_DAY_TOKENS") ?? OPERATOR_MAX_DAY_TOKENS;
  const clamped: string[] = [];
  let perRun = num(flags["token-cap"], "--token-cap") ?? DEFAULT_RUN_TOKENS;
  let perDay = num(flags["daily-tokens"], "--daily-tokens") ?? DEFAULT_DAY_TOKENS;
  if (perRun > maxRun) { clamped.push(`--token-cap ${perRun} is above what the operator allows for a run (${maxRun}): using ${maxRun}`); perRun = maxRun; }
  if (perDay > maxDay) { clamped.push(`--daily-tokens ${perDay} is above what the operator allows for a day (${maxDay}): using ${maxDay}`); perDay = maxDay; }
  // The Mandate's own token budget (its `token_budget`) is a ceiling too: the run keeps to the smaller of it and the sponsor's figure.
  if (mandate?.per_run !== undefined && mandate.per_run < perRun) { clamped.push(`the Mandate's token budget for one run is ${mandate.per_run}: using it`); perRun = mandate.per_run; }
  if (mandate?.per_day !== undefined && mandate.per_day < perDay) { clamped.push(`the Mandate's token budget for one day is ${mandate.per_day}: using it`); perDay = mandate.per_day; }
  return { perRun, perDay, clamped };
}

/** The line a person reads at each threshold. */
export const alertLine = (e: { percent: number; used: number; cap: number }) =>
  e.percent >= 100 ? `this run has used all ${e.cap} tokens of its ceiling: the next model call is refused (raise it with --token-cap if you mean it)` : `this run has used ${e.percent}% of its token ceiling (${e.used} of ${e.cap})`;
