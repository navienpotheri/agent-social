/**
 * Organisations, Phase A, the ledger core (rows ENG128 and ENG131 area; docs/organisation-record-spec.md): a labelled SIMULATION LEDGER beside the log ("Phase A organisation ledger (not in the log)"). Phase B needs a real agent-to-organisation transfer record
 * (the spec's org_move, a protocol change with a spec-delta row and vectors); this ledger is a prototype to tune the rules. It holds: pooled founding (one share per credit invested, a pool target and a deadline, investments returned if missed), an open
 * with a treasury account, members with roles (employee, contractor, partner) who may decline, a treasury that never goes negative (an item the treasury cannot cover is recorded as unpaid, never paid short), a period close with retained profit and dividends
 * only from retained profit, a bond that is locked at opening, a wind-up (wages first, then other debts, then shareholders), a load cap of three organisations an agent may belong to and a founding cap per controller, and a sanity bound on any change per
 * period. CONSERVATION: credits in agents + treasuries + escrow stay constant except declared mints and burns (a founding fee is burned; nothing is minted here). Every movement is an entry of a hash-chained journal. Credits are mock accounting entries.
 * NOT built in this file: the tools (org_found and the others), the `--orgs` flag, the house-run payroll on the simulated clock, quorum and wake events, the report section and the statistics hook.
 */
import { createHash } from "node:crypto";

export const DEFAULTS = { loadCap: 3, foundingCapPerController: 2, foundingFee: 2, bondPerMember: 1, wageChangeBound: 0.5, wind_up_periods: 3 } as const;
export type Role = "employee" | "contractor" | "partner";
export type OrgState = "forming" | "open" | "distressed" | "winding_up" | "closed" | "failed";
export interface Org { id: string; name: string; founder: string; controller: string; poolTarget: number; deadline: number; state: OrgState; shares: Map<string, number>; treasury: number; bond: number; members: Map<string, { role: Role; wage: number }>; unpaid: Array<{ to: string; kind: "wage" | "debt"; amount: number }>; retained: number; periodsNoIncome: number; periodIncome: number; periodOut: number; period: number }
export interface JournalEntry { n: number; kind: string; org: string; who: string; amount: number; note: string; prev: string; hash: string }

export class OrgLedger {
  readonly balances = new Map<string, number>();
  readonly orgs = new Map<string, Org>();
  escrow = 0; burned = 0; minted = 0;
  readonly journal: JournalEntry[] = [];
  private seq = 0;
  private readonly cfg: { [K in keyof typeof DEFAULTS]: number };
  constructor(agents: Record<string, number>, cfg: { [K in keyof typeof DEFAULTS]: number } = { ...DEFAULTS }) { this.cfg = cfg; for (const [a, v] of Object.entries(agents)) this.balances.set(a, v); this.initial = Object.values(agents).reduce((x, y) => x + y, 0); }
  initial: number;
  /** The house grants an agent simulation credits the first time it meets the organisations (a declared mint); these are NOT the agent's credits in the log (Phase A). */
  ensure(agent: string, grant = 50): void { if (!this.balances.has(agent)) { this.balances.set(agent, grant); this.minted += grant; this.put("grant", "-", agent, grant, "simulation credits for the organisations (not in the log)"); } }
  /** The officers of an organisation: its founder and its largest other shareholder (at least two once there are two investors), so one sleeping officer does not stall a routine payment. */
  officers(id: string): string[] { const o = this.orgs.get(id); if (!o) return []; const others = [...o.shares.entries()].filter(([a]) => a !== o.founder).sort((x, y) => y[1] - x[1]).map(([a]) => a); return [o.founder, ...others.slice(0, 1)]; }
  private bal = (a: string): number => this.balances.get(a) ?? 0;
  private put(kind: string, org: string, who: string, amount: number, note: string): void { const prev = this.journal.at(-1)?.hash ?? "genesis", body = { n: ++this.seq, kind, org, who, amount, note, prev }; this.journal.push({ ...body, hash: createHash("sha256").update(JSON.stringify(body)).digest("hex") }); }
  /** The sum of every credit the ledger holds: agents, treasuries and the escrow. It equals the initial credits plus the mints minus the burns, always. */
  total(): number { return [...this.balances.values()].reduce((x, y) => x + y, 0) + [...this.orgs.values()].reduce((x, o) => x + o.treasury + o.bond, 0) + this.escrow; }
  conserved(): boolean { return Math.abs(this.total() - (this.initial + this.minted - this.burned)) < 1e-9; }
  verifyJournal(): boolean { let prev = "genesis"; for (const e of this.journal) { const { hash, ...body } = e; if (e.prev !== prev || createHash("sha256").update(JSON.stringify(body)).digest("hex") !== hash) return false; prev = hash; } return true; }
  private memberOf(a: string): number { return [...this.orgs.values()].filter((o) => o.members.has(a) && o.state !== "closed" && o.state !== "failed").length; }

  found(id: string, founder: string, name: string, poolTarget: number, deadline: number, controller = founder): { ok: boolean; why?: string } {
    if (this.orgs.has(id)) return { ok: false, why: "that organisation id exists" };
    if (poolTarget < 1) return { ok: false, why: "the pool target is at least 1" };
    if ([...this.orgs.values()].filter((o) => o.controller === controller && o.state !== "closed" && o.state !== "failed").length >= this.cfg.foundingCapPerController) return { ok: false, why: "a controller may found at most " + this.cfg.foundingCapPerController + " organisations at a time" };
    if (this.bal(founder) < this.cfg.foundingFee) return { ok: false, why: "the founder cannot pay the founding fee" };
    this.balances.set(founder, this.bal(founder) - this.cfg.foundingFee); this.burned += this.cfg.foundingFee; // the founding fee is a declared burn
    this.orgs.set(id, { id, name, founder, controller, poolTarget, deadline, state: "forming", shares: new Map(), treasury: 0, bond: 0, members: new Map(), unpaid: [], retained: 0, periodsNoIncome: 0, periodIncome: 0, periodOut: 0, period: 0 });
    this.put("org_found", id, founder, this.cfg.foundingFee, `founded ${name}, pool target ${poolTarget}`); return { ok: true };
  }
  invest(id: string, agent: string, amount: number, now: number): { ok: boolean; why?: string } {
    const o = this.orgs.get(id); if (!o || o.state !== "forming") return { ok: false, why: "the organisation is not forming" };
    if (now > o.deadline) return { ok: false, why: "the deadline has passed" };
    if (amount < 1 || amount > this.bal(agent)) return { ok: false, why: "not enough credits" };
    const pooled = [...o.shares.values()].reduce((x, y) => x + y, 0); if (pooled + amount > o.poolTarget) return { ok: false, why: "the pool would pass its target" };
    this.balances.set(agent, this.bal(agent) - amount); this.escrow += amount; o.shares.set(agent, (o.shares.get(agent) ?? 0) + amount); this.put("org_invest", id, agent, amount, "one share per credit, locked in escrow"); return { ok: true };
  }
  /** The house opens an organisation whose pool is met by its deadline (a treasury account; the bond is set aside from the pool), or fails it and returns every investment. */
  settleFounding(id: string, now: number): "open" | "failed" | "waiting" {
    const o = this.orgs.get(id); if (!o || o.state !== "forming") return "waiting";
    const pooled = [...o.shares.values()].reduce((x, y) => x + y, 0);
    if (pooled >= o.poolTarget) { const bond = Math.min(pooled, this.cfg.bondPerMember * Math.max(1, o.shares.size)); this.escrow -= pooled; o.treasury = pooled - bond; o.bond = bond; o.state = "open"; this.put("org_open", id, "house", pooled, `treasury ${o.treasury}, bond ${bond}`); return "open"; }
    if (now > o.deadline) { for (const [a, s] of o.shares) { this.balances.set(a, this.bal(a) + s); this.put("org_refund", id, a, s, "the pool was not met: investment returned"); } this.escrow -= pooled; o.shares.clear(); o.state = "failed"; return "failed"; }
    return "waiting";
  }
  join(id: string, agent: string, role: Role, wage: number): { ok: boolean; why?: string } {
    const o = this.orgs.get(id); if (!o || o.state !== "open") return { ok: false, why: "the organisation is not open" };
    if (this.memberOf(agent) >= this.cfg.loadCap) return { ok: false, why: "an agent belongs to at most " + this.cfg.loadCap + " organisations" };
    if (wage < 0) return { ok: false, why: "a wage is not negative" };
    o.members.set(agent, { role, wage }); this.put("org_member", id, agent, wage, `joined as ${role}`); return { ok: true };
  }
  leave(id: string, agent: string): boolean { const o = this.orgs.get(id); if (!o?.members.delete(agent)) return false; this.put("org_member", id, agent, 0, "left"); return true; }
  /** Income: a credit moves from an agent (a customer) into the treasury. */
  income(id: string, from: string, amount: number): { ok: boolean; why?: string } {
    const o = this.orgs.get(id); if (!o || o.state === "closed" || o.state === "failed" || o.state === "forming") return { ok: false, why: "the organisation is not trading" };
    if (amount < 1 || amount > this.bal(from)) return { ok: false, why: "not enough credits" };
    this.balances.set(from, this.bal(from) - amount); o.treasury += amount; o.periodIncome += amount; this.put("org_move", id, from, amount, "contract_income"); return { ok: true };
  }
  /** A payment from the treasury; one the treasury cannot cover is NOT made and is recorded as unpaid (the treasury never goes negative). */
  pay(id: string, to: string, amount: number, kind: "wage" | "dividend" | "debt"): { paid: boolean; note: string } {
    const o = this.orgs.get(id); if (!o) return { paid: false, note: "no such organisation" };
    if (kind === "dividend" && amount > o.retained) return { paid: false, note: "a dividend is paid only from retained profit" };
    if (amount > o.treasury) { if (kind !== "dividend") o.unpaid.push({ to, kind: kind === "wage" ? "wage" : "debt", amount }); this.put("org_unpaid", id, to, amount, `the treasury holds ${o.treasury}: recorded as unpaid`); return { paid: false, note: "recorded as unpaid" }; }
    if (kind === "wage") { const m = o.members.get(to); if (m && amount > m.wage * (1 + this.cfg.wageChangeBound)) return { paid: false, note: "beyond the sanity bound for a change in a wage" }; }
    o.treasury -= amount; if (kind === "dividend") o.retained -= amount; this.balances.set(to, this.bal(to) + amount); o.periodOut += amount; this.put("org_move", id, to, amount, kind); return { paid: true, note: "paid" };
  }
  /** The house closes a period: pays the wages (house-run, agents are not continuous), records retained profit (income less outgoings), and moves toward distress when there was no income and the unpaid debts pass the treasury. */
  closePeriod(id: string): { income: number; out: number; retained: number } {
    const o = this.orgs.get(id)!; for (const [a, m] of o.members) this.pay(id, a, m.wage, "wage");
    const income = o.periodIncome, out = o.periodOut, retained = Math.max(0, income - out); o.retained += retained; o.periodsNoIncome = income === 0 ? o.periodsNoIncome + 1 : 0;
    const owed = o.unpaid.reduce((x, y) => x + y.amount, 0); if (o.periodsNoIncome >= this.cfg.wind_up_periods && owed > o.treasury && o.state === "open") { o.state = "distressed"; this.put("org_distress", id, "house", owed, `${o.periodsNoIncome} periods without income`); }
    this.put("org_period_close", id, "house", retained, `period ${o.period} income ${income} out ${out}`); o.period++; o.periodIncome = 0; o.periodOut = 0; return { income, out, retained };
  }
  /** The report section: the organisations of the run, labelled as a simulation ledger beside the log. */
  render(): string {
    const L = ["## Organisations", "", "Phase A organisation ledger (not in the log): a simulation ledger beside the log, with simulation credits granted by the house; Phase B needs a real agent-to-organisation transfer record.", ""];
    if (!this.orgs.size) { L.push("No organisation was founded."); return L.join("\n") + "\n"; }
    L.push("| Organisation | State | Treasury | Shares held (concentration) | Members | Wages paid | Dividends | Unpaid |", "|---|---|---|---|---|---|---|---|");
    for (const o of this.orgs.values()) {
      const tot = [...o.shares.values()].reduce((x, y) => x + y, 0), top = [...o.shares.values()].sort((a, b) => b - a)[0] ?? 0;
      const paid = (kind: string): number => this.journal.filter((e) => e.org === o.id && e.kind === "org_move" && e.note === kind).reduce((x, e) => x + e.amount, 0);
      L.push(`| ${o.id} ${o.name} | ${o.state} | ${o.treasury} | ${tot ? `${Math.round((100 * top) / tot)}% held by the largest` : "none"} | ${o.members.size} | ${paid("wage")} | ${paid("dividend")} | ${o.unpaid.reduce((x, u) => x + u.amount, 0)} |`);
    }
    const open = [...this.orgs.values()].filter((o) => o.state === "open").length, failed = [...this.orgs.values()].filter((o) => o.state === "failed").length, closed = [...this.orgs.values()].filter((o) => o.state === "closed").length, distress = [...this.orgs.values()].filter((o) => o.state === "distressed").length;
    L.push("", `${this.orgs.size} founded, ${open} open, ${failed} failed to open (investments returned), ${distress} in distress, ${closed} wound up. The journal has ${this.journal.length} entries and ${this.verifyJournal() ? "verifies" : "DOES NOT verify"}; credits held ${this.total()} against ${this.initial + this.minted - this.burned} expected (${this.conserved() ? "conserved" : "NOT conserved"}).`);
    return L.join("\n") + "\n";
  }
  /** Wind-up: wages first, then other debts, then the bond and what is left to the shareholders by shares; the organisation closes. */
  windUp(id: string): { ok: boolean; why?: string } {
    const o = this.orgs.get(id); if (!o || (o.state !== "distressed" && o.state !== "open")) return { ok: false, why: "not in a state to wind up" };
    if (o.state === "open") return { ok: false, why: "the wind-up trigger is not met" };
    o.state = "winding_up"; o.treasury += o.bond; o.bond = 0;
    for (const kind of ["wage", "debt"] as const) for (const u of o.unpaid.filter((x) => x.kind === kind)) { const p = Math.min(u.amount, o.treasury); o.treasury -= p; this.balances.set(u.to, this.bal(u.to) + p); u.amount -= p; this.put("org_move", id, u.to, p, `wind-up ${kind}`); }
    const shares = [...o.shares.values()].reduce((x, y) => x + y, 0); const left = o.treasury;
    if (shares > 0 && left > 0) { let given = 0; const holders = [...o.shares.entries()]; holders.forEach(([a, s], i) => { const part = i === holders.length - 1 ? left - given : Math.floor((left * s) / shares); given += part; this.balances.set(a, this.bal(a) + part); this.put("org_move", id, a, part, "wind-up to shareholders"); }); o.treasury = 0; }
    o.state = "closed"; this.put("org_close", id, "house", left, "closed"); return { ok: true };
  }
}
