/**
 * The statistics office (owner decision, organisations batch): a read-only office that counts what the log and the board show, for the report and as the tool `stats_look`: a price index of the jobs on the board (the mean budget of open jobs against its
 * first reading, first reading = 100), the volume of work (house deliveries accepted and agent-posted jobs settled), the agents without work (no accepted delivery yet), the Gini coefficient and the top-3 share of the agents' credits, and the share of
 * credits held by organisations (none while the organisations are not built). A SHADOW policy rate is computed from these and shown, never applied: nothing in the society reads it. The weights of the shadow rate are stated below and are a plain
 * illustration, not a model. Credits are mock accounting entries.
 */
import type { WorldApi } from "./types.ts";

export interface Stats { jobsOpen: number; meanBudget: number; priceIndex: number; deliveriesAccepted: number; agentJobsSettled: number; agents: number; withoutWork: number; gini: number; top3: number; orgShare: number; shadowRate: number }
const baseMean = new WeakMap<object, number>();

export function gini(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b), n = v.length, s = v.reduce((a, b) => a + b, 0);
  if (n === 0 || s === 0) return 0;
  let acc = 0; for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * v[i]!;
  return acc / (n * s);
}
/** The neutral rate 2.0 percent, plus half the price index change in percent, plus a quarter of the points by which the share of agents without work is over 20 percent: computed, shown, never applied. */
export function shadowRate(priceIndex: number, withoutWorkPct: number): number { return Math.round((2 + 0.5 * (priceIndex - 100) + 0.25 * (withoutWorkPct - 20)) * 100) / 100; }

export async function statsOf(world: WorldApi): Promise<Stats | undefined> {
  const hall = world.market; if (!hall) return undefined;
  const bal = await hall.agentBalances();
  const jobs = await hall.openJobList({ did: "", handle: "", n: -1 } as never, 200);
  const mean = jobs.length ? jobs.reduce((a, j) => a + j.budget, 0) / jobs.length : 0;
  if (!baseMean.has(world) && mean > 0) baseMean.set(world, mean);
  const base = baseMean.get(world) ?? mean, index = base > 0 ? Math.round((mean / base) * 1000) / 10 : 100;
  const done = hall.workDone();
  const withoutWork = bal.filter((b) => !done.has(b.handle)).length;
  const total = bal.reduce((a, b) => a + b.balance, 0), top3 = total > 0 ? [...bal].sort((a, b) => b.balance - a.balance).slice(0, 3).reduce((a, b) => a + b.balance, 0) / total : 0;
  const pct = bal.length ? (100 * withoutWork) / bal.length : 0;
  return { jobsOpen: jobs.length, meanBudget: Math.round(mean * 100) / 100, priceIndex: index, deliveriesAccepted: hall.deliveryLog.filter((d) => d.houseAccepted).length, agentJobsSettled: hall.settledAgentJobs(), agents: bal.length, withoutWork, gini: Math.round(gini(bal.map((b) => b.balance)) * 1000) / 1000, top3: Math.round(top3 * 1000) / 1000, orgShare: (() => { const L = world.orgs; if (!L) return 0; const t = [...L.orgs.values()].reduce((x, o) => x + o.treasury, 0), a = [...L.balances.values()].reduce((x, y) => x + y, 0); return t + a > 0 ? t / (t + a) : 0; })(), shadowRate: shadowRate(index, pct) };
}
export function renderStatsText(s: Stats): string {
  return `Statistics office (counted from the log; read only; mock credits). Jobs open ${s.jobsOpen}, mean budget ${s.meanBudget}, price index ${s.priceIndex} (first reading = 100). Work: ${s.deliveriesAccepted} house deliveries accepted, ${s.agentJobsSettled} agent-posted jobs settled; ${s.withoutWork} of ${s.agents} agents have no accepted delivery yet. Credits: Gini ${s.gini}, top three hold ${Math.round(s.top3 * 100)}%, organisations hold ${Math.round(s.orgShare * 100)}% of the simulation credits of the organisation ledger. Shadow policy rate ${s.shadowRate}% (computed from the price index and the agents without work; it is never applied and nothing reads it).`;
}
export async function renderStatsReport(world: WorldApi): Promise<string> {
  const s = await statsOf(world); if (!s) return "";
  return `## Statistics office\n\n${renderStatsText(s)}\n`;
}
