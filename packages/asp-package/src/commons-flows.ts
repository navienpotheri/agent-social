/**
 * A welcome, a pooled goal and a boundary page (register rows DK839, DK813 and DK824; spec-deltas S1240 to S1242; docs/intake/11th-nov.md Part 3, ranks 24, 27 and 28). DK839: labelled HOUSE GREETERS answer a newcomer's
 * first reply within a target time, one inbox lists replies, grades, the handout and lesson results, and house agents are left out of the health counts. DK813: a MISSION pooled from many funders and split, on a verified
 * whole-goal result, by recorded contribution shares (a free-rider gets nothing; conservation holds; an unverified goal refunds the funders). DK824: a BOUNDARY page generated from the rules: each flow in and out, its origin
 * (intentional or emergent) and its permeability, with a refused attempt to move credits out. Pure code and scripted agents; credits are mock accounting entries.
 */

// ---- DK839 ----
export interface Reply { from: string; to: string; at: number; text: string }
export interface Agent { id: string; house: boolean }
export class Welcome {
  readonly replies: Reply[] = [];
  readonly grades: Record<string, number[]> = {};
  readonly lessons: Record<string, { lesson: string; passed: boolean }[]> = {};
  private readonly handoutFor = new Set<string>();
  private readonly pending: { newcomer: string; at: number }[] = [];
  readonly agents: Agent[] = [];
  /** Minutes within which a greeter must answer a first reply. */
  readonly targetMinutes: number;
  constructor(targetMinutes: number) { this.targetMinutes = targetMinutes; }
  join(id: string, house = false): void { this.agents.push({ id, house }); }
  /** A newcomer's first reply is queued for a greeter. */
  firstReply(newcomer: string, at: number, text: string): void {
    this.replies.push({ from: newcomer, to: "greeters", at, text });
    this.pending.push({ newcomer, at });
  }
  /** A greeter tick: each queued first reply is answered by a labelled house agent and the handout is made available. Only house agents greet. */
  greet(greeter: string, now: number): { answered: string[]; refused: boolean } {
    if (!this.agents.find((a) => a.id === greeter)?.house) return { answered: [], refused: true };
    const answered: string[] = [];
    for (const p of this.pending.splice(0)) {
      this.replies.push({ from: greeter, to: p.newcomer, at: now, text: "Welcome. Here is the handout; ask me anything." });
      this.handoutFor.add(p.newcomer);
      answered.push(p.newcomer);
    }
    return { answered, refused: false };
  }
  grade(newcomer: string, value: number): void { (this.grades[newcomer] ??= []).push(value); }
  lesson(newcomer: string, lesson: string, passed: boolean): void { (this.lessons[newcomer] ??= []).push({ lesson, passed }); }
  /** The one inbox call: replies to the agent, grades, whether the handout is available and the lesson results. */
  inbox(id: string): { replies: Reply[]; grades: number[]; handoutAvailable: boolean; lessons: { lesson: string; passed: boolean }[] } {
    return { replies: this.replies.filter((r) => r.to === id), grades: this.grades[id] ?? [], handoutAvailable: this.handoutFor.has(id), lessons: this.lessons[id] ?? [] };
  }
  /** Whether each newcomer's first reply was answered within the target. */
  slaMet(): { newcomer: string; minutes: number | null; met: boolean }[] {
    const firsts = this.replies.filter((r) => r.to === "greeters");
    return firsts.map((f) => {
      const a = this.replies.find((r) => r.to === f.from && r.at >= f.at);
      const minutes = a ? a.at - f.at : null;
      return { newcomer: f.from, minutes, met: minutes !== null && minutes <= this.targetMinutes };
    });
  }
  /** Health counts as the public sees them: house agents are not counted as members or as activity. */
  health(): { members: number; houseAgents: number; repliesByMembers: number } {
    const house = new Set(this.agents.filter((a) => a.house).map((a) => a.id));
    return { members: this.agents.filter((a) => !a.house).length, houseAgents: house.size, repliesByMembers: this.replies.filter((r) => !house.has(r.from)).length };
  }
}

// ---- DK813 ----
export type SettleCode = "NOT_OPEN" | "NO_FUNDING" | "NO_CONTRIBUTIONS_RECORDED";
export class Mission {
  readonly funding = new Map<string, number>();
  readonly contributions = new Map<string, number>();
  status: "open" | "paid" | "refunded" = "open";
  fund(did: string, amount: number): void { if (this.status === "open" && amount > 0) this.funding.set(did, (this.funding.get(did) ?? 0) + amount); }
  /** A recorded contribution, in units of verified work. */
  contribute(did: string, units: number): void { if (this.status === "open" && units > 0) this.contributions.set(did, (this.contributions.get(did) ?? 0) + units); }
  pool(): number { return [...this.funding.values()].reduce((a, b) => a + b, 0); }
  /**
   * On a verified whole-goal result the pool is split by recorded contribution shares (largest-remainder, so the whole pool is paid and nothing is created); someone with no recorded contribution gets nothing.
   * Without a verified result the funders are refunded what they put in. `paid` is what leaves the pool.
   */
  settle(verified: boolean): { ok: true; payouts: Record<string, number> } | { ok: false; code: SettleCode } {
    if (this.status !== "open") return { ok: false, code: "NOT_OPEN" };
    const pool = this.pool();
    if (pool === 0) return { ok: false, code: "NO_FUNDING" };
    if (!verified) { this.status = "refunded"; return { ok: true, payouts: Object.fromEntries(this.funding) }; }
    const total = [...this.contributions.values()].reduce((a, b) => a + b, 0);
    if (total === 0) return { ok: false, code: "NO_CONTRIBUTIONS_RECORDED" };
    const rows = [...this.contributions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([did, u]) => ({ did, exact: (pool * u) / total }));
    const out: Record<string, number> = Object.fromEntries(rows.map((r) => [r.did, Math.floor(r.exact)]));
    let left = pool - Object.values(out).reduce((a, b) => a + b, 0);
    for (const r of [...rows].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || a.did.localeCompare(b.did))) { if (left <= 0) break; out[r.did]++; left--; }
    this.status = "paid";
    return { ok: true, payouts: out };
  }
}

// ---- DK824 ----
export interface BoundaryRules { creditsOut: "none" | "allowed"; informationIn: "untrusted" | "trusted"; jobsIn: "people_only" | "open" }
export interface Flow { flow: string; direction: "in" | "out"; origin: "intentional" | "emergent"; permeability: "closed" | "screened" | "open"; rule: string }
/** The flows are derived from the rules; the page is rendered from the flows, never written by hand. */
export function flowsFrom(r: BoundaryRules): Flow[] {
  return [
    { flow: "credits", direction: "out", origin: "intentional", permeability: r.creditsOut === "none" ? "closed" : "open", rule: `creditsOut=${r.creditsOut}` },
    { flow: "information", direction: "in", origin: "intentional", permeability: r.informationIn === "untrusted" ? "screened" : "open", rule: `informationIn=${r.informationIn}` },
    { flow: "jobs", direction: "in", origin: "intentional", permeability: r.jobsIn === "people_only" ? "screened" : "open", rule: `jobsIn=${r.jobsIn}` },
    { flow: "reputation", direction: "out", origin: "emergent", permeability: "open", rule: "a public record anyone can read; not a rule the service sets" },
    { flow: "attention", direction: "in", origin: "emergent", permeability: "open", rule: "who visits and who follows is not controlled" },
  ];
}
export function attemptFlow(rules: BoundaryRules, flow: string, direction: "in" | "out"): { ok: true } | { ok: false; code: "BOUNDARY_CLOSED"; rule: string } {
  const f = flowsFrom(rules).find((x) => x.flow === flow && x.direction === direction);
  return !f || f.permeability !== "closed" ? { ok: true } : { ok: false, code: "BOUNDARY_CLOSED", rule: f.rule };
}
export function boundaryPage(rules: BoundaryRules): string {
  const rows = flowsFrom(rules).map((f) => `<tr><td>${f.flow}</td><td>${f.direction}</td><td>${f.origin}</td><td>${f.permeability}</td><td>${f.rule}</td></tr>`).join("");
  const none = flowsFrom(rules).filter((f) => f.direction === "out" && f.flow === "credits").map((f) => (f.permeability === "closed" ? "Credits out: none." : "Credits out: allowed.")).join("");
  return `<h1>The boundary</h1><p>${none} Information in: ${rules.informationIn}. Jobs in: ${rules.jobsIn === "people_only" ? "people only" : "open"}.</p><table><tr><th>flow</th><th>direction</th><th>origin</th><th>permeability</th><th>rule</th></tr>${rows}</table>`;
}
