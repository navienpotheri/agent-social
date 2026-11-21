/**
 * `asp budget set | show` and `asp forecast --contract <id>` (register row US2; spec-delta S1454): the person's cost control. A standing cap for each agent (tokens in the UTC day and in the UTC month, with a warning level)
 * set once and kept by every run (the denial-of-wallet guard counts and refuses; a flag on a run still wins for that run); a statement of what an agent has used against its caps, where the month is heading at the pace so
 * far, and the credits it spent on the society's services this month (from the log); and, for a job on the market, what is at stake in credits and what a session of the performer has used. Tokens, never a price: a model's
 * price is the provider's. Credits are accounting entries, not money.
 */
import { join } from "node:path";
import { Budgets, DailyCeiling, budgetWarnings, monthProjection, type AgentBudget, type LogHandle } from "@agent-social/asp-package";

export class BudgetUsage extends Error {}

export interface BudgetOpts {
  home: string;
  io: { out: (l: string) => void };
  now: () => string;
  /** The log, for the credits an agent spent; without it the credits line says it could not be read. */
  log?: () => Promise<LogHandle>;
  flags: { agent?: string; "daily-tokens"?: string; "monthly-tokens"?: string; "warn-at"?: string; json?: boolean };
}

const parse = (name: string, v: string | undefined): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === "off") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new BudgetUsage(`--${name} is a whole number, at least 1 (or "off" to remove it)`);
  return n;
};

const num = (n: number) => n.toLocaleString("en-US");
const daysIn = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** What an agent has used against its caps, as data: the same figures the text shows. */
export async function budgetStatus(o: BudgetOpts, agent: string, b: AgentBudget) {
  const day = o.now().slice(0, 10), month = day.slice(0, 7);
  const ceiling = new DailyCeiling(join(o.home, "wakes.json"));
  const today = ceiling.tokensUsed(agent, day), spent = ceiling.monthTokens(agent, month);
  const proj = monthProjection(spent, Number(day.slice(8, 10)), daysIn(month), b.monthlyTokens);
  let credits: number | undefined;
  if (o.log) {
    try {
      const l = await o.log();
      credits = (await l.log.purchasesBy(agent)).filter((r) => r.issued_at.slice(0, 7) === month).reduce((n, r) => n + ((r.body as { amount?: { value?: number } }).amount?.value ?? 0), 0);
    } catch { credits = undefined; }
  }
  return { agent, budget: b, day, month, tokensToday: today, tokensMonth: spent, projectedMonth: proj.projected, projectedOver: proj.over, creditsThisMonth: credits, warnings: budgetWarnings(agent, b, { today, month: spent }) };
}

export async function budgetCmd(sub: string | undefined, o: BudgetOpts): Promise<number> {
  const f = o.flags;
  const budgets = new Budgets(join(o.home, "budgets.json"));
  if (sub === "set") {
    if (!f.agent) throw new BudgetUsage("asp budget set --agent <did> [--daily-tokens <n|off>] [--monthly-tokens <n|off>] [--warn-at <percent>]");
    const change = { dailyTokens: parse("daily-tokens", f["daily-tokens"]), monthlyTokens: parse("monthly-tokens", f["monthly-tokens"]), warnPercent: parse("warn-at", f["warn-at"]) };
    if (change.dailyTokens === undefined && change.monthlyTokens === undefined && change.warnPercent === undefined) throw new BudgetUsage("name a cap to set: --daily-tokens <n>, --monthly-tokens <n> or --warn-at <percent> (a value of off removes it)");
    let b: AgentBudget;
    try { b = budgets.set(f.agent, change); } catch (e) { throw new BudgetUsage((e as Error).message); }
    o.io.out(`${f.agent}: ${b.dailyTokens !== undefined ? `daily cap ${num(b.dailyTokens)} tokens` : "no daily cap"}, ${b.monthlyTokens !== undefined ? `monthly cap ${num(b.monthlyTokens)} tokens` : "no monthly cap"}${b.warnPercent !== undefined ? `, warning at ${b.warnPercent}%` : ""}. Every run of this agent keeps to it; a flag on a run (--daily-tokens) wins for that run. asp budget show --agent ${f.agent} says where it stands.`);
    return 0;
  }
  if (sub === "show" || sub === undefined) {
    const all = budgets.all();
    const agents = f.agent ? [f.agent] : Object.keys(all).sort();
    if (!agents.length) { o.io.out("no agent has a standing budget yet: asp budget set --agent <did> --daily-tokens <n> --monthly-tokens <n>"); return 0; }
    const rows = [];
    for (const a of agents) rows.push(await budgetStatus(o, a, all[a] ?? {}));
    if (f.json) { o.io.out(JSON.stringify(rows, null, 2)); return 0; }
    for (const r of rows) {
      const b = r.budget;
      o.io.out(r.agent);
      o.io.out(`  today  ${num(r.tokensToday)} tokens${b.dailyTokens !== undefined ? ` of ${num(b.dailyTokens)} (${Math.floor((r.tokensToday * 100) / b.dailyTokens)}%)` : " (no daily cap)"}`);
      o.io.out(`  month  ${num(r.tokensMonth)} tokens${b.monthlyTokens !== undefined ? ` of ${num(b.monthlyTokens)} (${Math.floor((r.tokensMonth * 100) / b.monthlyTokens)}%)` : " (no monthly cap)"}; at this pace ${num(r.projectedMonth)} by the end of ${r.month}${r.projectedOver ? ", OVER the cap" : ""}`);
      o.io.out(`  credits  ${r.creditsThisMonth === undefined ? "not read (no log here)" : `${num(r.creditsThisMonth)} spent this month on the society's services (asp spend ${r.agent} has the lines)`}`);
      for (const w of r.warnings) o.io.out(`  WARNING  ${w}`);
    }
    o.io.out("Tokens, never a price: a model's price is the provider's. Credits are accounting entries, not money.");
    return 0;
  }
  throw new BudgetUsage("asp budget set | show");
}

/** The forecast for one job on the market: what is at stake in credits, and what a session of its performer has used on this machine. */
export async function jobForecast(o: { log: LogHandle; io: { out: (l: string) => void }; contract: string; forecast: { agent: string; sessions: number; tokensMedian: number; tokensP90: number }[]; days: number }): Promise<number> {
  const rec = (await o.log.log.get(o.contract))?.record;
  if (!rec || rec.type !== "asp.contract/v0.2") throw new BudgetUsage(`${o.contract} is not a contract in the log (asp market board lists them)`);
  const b = rec.body as { principal: string; performer: string; price?: { value: number } };
  const state = (await o.log.log.chainInfo(o.contract))?.state ?? "unknown";
  const esc = await o.log.log.escrow(o.contract);
  const short = (d: string) => d.split(":").slice(-1)[0] ?? d;
  const mine = o.forecast.find((x) => x.agent === short(b.performer));
  o.io.out(`job ${o.contract.slice(0, 15)}: ${b.performer} for ${b.principal}, ${state}`);
  o.io.out(`  price    ${b.price ? `${num(b.price.value)} credits` : "not stated"}`);
  o.io.out(esc ? `  at stake  ${num(esc.escrowLocked)} credits in escrow (paid by ${esc.escrowPayer}) and ${num(esc.bondLocked)} as the performer's bond (${esc.backer})${esc.settled ? "; settled" : "; returned if the job is delivered and accepted, the bond slashed if it is lost"}` : "  at stake  nothing is locked yet (the bond and the escrow come before the work)");
  o.io.out(mine ? `  a session of ${short(b.performer)} has used about ${num(mine.tokensMedian)} tokens, a bad one ${num(mine.tokensP90)} (from ${mine.sessions} finished session${mine.sessions === 1 ? "" : "s"} in the last ${o.days} days on this machine)` : `  no finished session of ${short(b.performer)} on this machine in the last ${o.days} days to forecast tokens from`);
  o.io.out("  A cap on one run is --token-cap; a standing cap for the agent is asp budget set. Tokens, never a price: a model's price is the provider's. Credits are accounting entries, not money.");
  return 0;
}
