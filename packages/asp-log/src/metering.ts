/**
 * Metering and statements (register row DK1379; spec-delta S1414; docs/enterprise-fleets.md): what a fleet's or an organisation's agents used in a UTC month, counted from the signed log, priced by a signed plan, with tax
 * lines, as a statement (an invoice, by contract first). Pure integer arithmetic: no clock, no store, no floating point. Money is in minor units of the plan's currency (cents, paise). Rounding: a started unit of
 * overage is a whole unit, and a tax line rounds half up. Reads are not in the log: the service passes its own counter in. Credits are accounting entries; the payment itself is another lane's part of DK1370.
 */
import type { AspRecord } from "@agent-social/asp-core";

export interface Usage { month: string; activeAgents: number; writes: number; actions: number; tokensIn: number; tokensOut: number; modelRequests: number; toolCalls: number; storageBytes: number; reads: number | null }
export interface AgentUsage { did: string; writes: number; actions: number; tokens: number; storageBytes: number; active: boolean }
export interface Plan {
  plan: string; name: string; currency: string;
  /** Minor units per active agent in the month (an agent that signed at least one record that month). */
  agent_month: number;
  writes_included: number; writes_per_1000: number;
  /** Millions of tokens, in and out together. */
  tokens_included_m: number; tokens_per_m: number;
  storage_included_mb: number; storage_per_gb: number;
  /** The hosted dashboard, a flat monthly price (0 when included). */
  dashboard_month: number;
  /** Minor units one purchased credit settles (0 or absent: a statement is not paid with credits). */
  credit_value?: number;
}
export interface Line { item: string; quantity: number; unit_price: number; amount: number }
export interface TaxLine { name: string; rate_bp: number; amount: number }
export interface Priced { lines: Line[]; subtotal: number; tax: TaxLine[]; total: number }

type Rec = Pick<AspRecord, "id" | "type" | "issuer" | "body" | "issued_at">;
const monthOf = (at: string) => at.slice(0, 7);
const MB = 1_000_000, GB = 1_000_000_000;

/** The usage of a set of agents in a month, from the records, and each agent's share. `reads` is the service's own counter, or null. */
export function meterOf(records: Rec[], members: Set<string>, month: string, reads: number | null = null): { total: Usage; perAgent: AgentUsage[] } {
  const per = new Map<string, AgentUsage>();
  for (const m of members) per.set(m, { did: m, writes: 0, actions: 0, tokens: 0, storageBytes: 0, active: false });
  let tokensIn = 0, tokensOut = 0, modelRequests = 0, toolCalls = 0, actions = 0, writes = 0, storage = 0;
  const end = `${month}-31T23:59:59Z`;
  for (const r of records) {
    const a = per.get(r.issuer);
    if (!a) continue;
    if (r.issued_at <= end) a.storageBytes += JSON.stringify(r.body).length; // everything stored up to the end of the month
    if (monthOf(r.issued_at) !== month) continue;
    a.active = true; a.writes++; writes++;
    if (r.type === "asp.action/v0.2") {
      const m = (r.body as { metrics?: { tokens_in?: number; tokens_out?: number; model_requests?: number; tool_calls?: number } }).metrics;
      a.actions++; actions++;
      if (m) { const ti = m.tokens_in ?? 0, to = m.tokens_out ?? 0; tokensIn += ti; tokensOut += to; a.tokens += ti + to; modelRequests += m.model_requests ?? 0; toolCalls += m.tool_calls ?? 0; }
    }
  }
  const perAgent = [...per.values()].sort((x, y) => (x.did < y.did ? -1 : 1));
  for (const a of perAgent) storage += a.storageBytes;
  return { total: { month, activeAgents: perAgent.filter((a) => a.active).length, writes, actions, tokensIn, tokensOut, modelRequests, toolCalls, storageBytes: storage, reads }, perAgent };
}

const units = (over: number, per: number): number => (over <= 0 ? 0 : Math.ceil(over / per));

/** Prices a month: the lines, the subtotal, the tax lines (half up) and the total, all in minor units. */
export function priceStatement(plan: Plan, u: Usage, taxes: { name: string; rate_bp: number }[] = []): Priced {
  const lines: Line[] = [];
  const add = (item: string, quantity: number, unit_price: number) => { if (quantity > 0 && unit_price > 0) lines.push({ item, quantity, unit_price, amount: quantity * unit_price }); };
  add("active agents", u.activeAgents, plan.agent_month);
  add("writes over the included allowance (per started thousand)", units(u.writes - plan.writes_included, 1000), plan.writes_per_1000);
  add("tokens over the included allowance (per started million)", units(u.tokensIn + u.tokensOut - plan.tokens_included_m * 1_000_000, 1_000_000), plan.tokens_per_m);
  add("stored data over the included allowance (per started gigabyte)", units(u.storageBytes - plan.storage_included_mb * MB, GB), plan.storage_per_gb);
  if (plan.dashboard_month > 0 && u.activeAgents > 0) add("hosted dashboard", 1, plan.dashboard_month);
  const subtotal = lines.reduce((n, l) => n + l.amount, 0);
  const tax = taxes.map((t) => ({ name: t.name, rate_bp: t.rate_bp, amount: Math.floor((subtotal * t.rate_bp + 5000) / 10000) }));
  return { lines, subtotal, tax, total: subtotal + tax.reduce((n, t) => n + t.amount, 0) };
}

/** The most credits a statement may be paid with: whole credits worth no more than the total. */
export const creditsFor = (plan: Plan, total: number): number => (plan.credit_value && plan.credit_value > 0 ? Math.floor(total / plan.credit_value) : 0);
