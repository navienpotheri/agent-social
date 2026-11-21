/**
 * The controls an organisation has over its own fleet (register row DK1361): a freeze switch for the whole fleet or one member, and a monthly cap in mock credits and in tokens for the fleet and for one member. The state is service
 * policy kept in a file beside the tokens (each change with who made it, when and what: an audit trail), not a record in the log, so it can be changed at once and never widens what a Mandate allows. `fleetGuard` is the check the
 * service runs before a write: a record signed by a frozen member is refused (`FLEET_FROZEN`), a purchase that would take a member or the fleet past its credit cap is refused (`FLEET_CAP`), and so is an action report once the token cap is
 * reached. Only the tenant that owns the fleet's organisation (or an operator) may change the controls. Credits are accounting entries, not money.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { emptyControls, monthOf, type CapPair, type FleetControlState, type Spend } from "./fleet-dashboard.ts";
import type { StoredRec } from "./society-story.ts";

export class FleetControls {
  private state: Record<string, FleetControlState> = {};
  private readonly file: string | undefined;
  constructor(file?: string) {
    this.file = file;
    if (file) { try { this.state = JSON.parse(readFileSync(file, "utf8")) as Record<string, FleetControlState>; } catch { this.state = {}; } }
  }
  get(fleet: string): FleetControlState { return this.state[fleet] ?? emptyControls(); }
  private touch(fleet: string): FleetControlState { return (this.state[fleet] ??= emptyControls()); }
  private save(): void { if (!this.file) return; const tmp = `${this.file}.tmp`; writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 }); renameSync(tmp, this.file); }

  /** Freezes the fleet (no target) or one member. */
  freeze(fleet: string, by: string, at: string, target?: string, detail?: string): void {
    const s = this.touch(fleet);
    if (target) { if (!s.frozenMembers.includes(target)) s.frozenMembers.push(target); } else s.frozen = true;
    s.audit.push({ at, by, act: "freeze", ...(target ? { target } : {}), ...(detail ? { detail: detail.slice(0, 200) } : {}) });
    this.save();
  }
  unfreeze(fleet: string, by: string, at: string, target?: string): void {
    const s = this.touch(fleet);
    if (target) s.frozenMembers = s.frozenMembers.filter((m) => m !== target); else s.frozen = false;
    s.audit.push({ at, by, act: "unfreeze", ...(target ? { target } : {}) });
    this.save();
  }
  /** Sets (or, with an empty pair, removes) the cap of the fleet or of one member: a whole number of credits and of tokens a month. */
  setCap(fleet: string, by: string, at: string, caps: CapPair, target?: string): void {
    for (const k of ["credits", "tokens"] as const) { const v = caps[k]; if (v !== undefined && !(Number.isInteger(v) && v >= 0)) throw new Error(`the ${k} cap is a whole number of ${k} a month, 0 or more`); }
    const s = this.touch(fleet);
    const clean: CapPair = { ...(caps.credits !== undefined ? { credits: caps.credits } : {}), ...(caps.tokens !== undefined ? { tokens: caps.tokens } : {}) };
    if (target) { if (Object.keys(clean).length) s.caps.members[target] = clean; else delete s.caps.members[target]; } else s.caps.fleet = clean;
    s.audit.push({ at, by, act: "cap", ...(target ? { target } : {}), detail: JSON.stringify(clean) });
    this.save();
  }
}

type Rec = { type?: string; issuer?: string; body?: { amount?: { value?: number }; metrics?: { tokens_in?: number; tokens_out?: number } } };

export interface FleetGuardOptions {
  controls: FleetControls;
  /** The records after a log sequence number, in order (the log's `since`). The guard folds each record once, so a write costs a lookup, not a scan of the log. */
  since: (afterSeq: number, limit: number) => Promise<StoredRec[]>;
  now: () => string;
}

/**
 * The guard the service runs before a tenant's write (the `guard` option of `createLogServer`). It keeps the fleets, the members and each month's spend by folding the log's records incrementally (a member is counted in the fleet it
 * belongs to when the record is made), so at 10,000 agents and many writes a second a check is a few map lookups.
 */
export function fleetGuard(o: FleetGuardOptions) {
  let lastSeq = 0;
  const fleetName = new Map<string, string>();
  const memberOf = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  const spend = new Map<string, Map<string, Spend>>();
  const fleetSpend = new Map<string, Map<string, Spend>>();
  const bump = (m: Map<string, Map<string, Spend>>, month: string, key: string, credits: number, tokens: number) => {
    const inner = m.get(month) ?? m.set(month, new Map()).get(month)!;
    const cur = inner.get(key) ?? { credits: 0, tokens: 0 };
    cur.credits += credits; cur.tokens += tokens; inner.set(key, cur);
  };
  const apply = (s: StoredRec) => {
    const r = s.record, b = r.body as Record<string, any>;
    if (r.type === "asp.fleet/v0.2") fleetName.set(b.did, b.name);
    else if (r.type === "asp.passport/v0.2" && b.kind === "agent") {
      const was = memberOf.get(b.did);
      const now = typeof b.fleet === "string" && fleetName.has(b.fleet) ? b.fleet : undefined;
      if (was && was !== now) members.get(was)?.delete(b.did);
      if (now) { memberOf.set(b.did, now); (members.get(now) ?? members.set(now, new Set()).get(now)!).add(b.did); } else memberOf.delete(b.did);
    } else if (r.type === "asp.purchase/v0.2" || r.type === "asp.action/v0.2") {
      const credits = r.type === "asp.purchase/v0.2" ? Number(b.amount?.value ?? 0) : 0;
      const tokens = r.type === "asp.action/v0.2" ? Number(b.metrics?.tokens_in ?? 0) + Number(b.metrics?.tokens_out ?? 0) : 0;
      const month = monthOf(r.issued_at);
      bump(spend, month, r.issuer, credits, tokens);
      const f = memberOf.get(r.issuer);
      if (f) bump(fleetSpend, month, f, credits, tokens);
    }
  };
  const refresh = async () => { for (;;) { const page = await o.since(lastSeq, 2000); for (const s of page) { apply(s); lastSeq = Math.max(lastSeq, s.seq); } if (page.length < 2000) return; } };
  return async (c: { tenant: { role?: string }; method: string; args: unknown[] }): Promise<string | undefined> => {
    if (c.method !== "append" && c.method !== "importRecords") return undefined;
    if (c.tenant.role === "admin") return undefined;
    const recs: Rec[] = c.method === "importRecords" ? ((c.args[0] as { record?: Rec }[] | undefined) ?? []).map((x) => x?.record).filter((r): r is Rec => !!r) : [c.args[0] as Rec];
    if (!recs.some((r) => typeof r?.issuer === "string")) return undefined;
    await refresh();
    const month = monthOf(o.now());
    for (const r of recs) {
      const did = r?.issuer;
      const fid = did ? memberOf.get(did) : undefined;
      if (!did || !fid) continue; // not a fleet member: no fleet policy applies
      const name = fleetName.get(fid) ?? fid;
      const ctl = o.controls.get(fid);
      if (ctl.frozen) return `FLEET_FROZEN: the fleet ${name} is frozen by its organisation: writes by its agents are refused until it is unfrozen`;
      if (ctl.frozenMembers.includes(did)) return `FLEET_FROZEN: ${did} is frozen by its organisation: its writes are refused until it is unfrozen`;
      const mine = spend.get(month)?.get(did) ?? { credits: 0, tokens: 0 };
      const fleetUsed = fleetSpend.get(month)?.get(fid) ?? { credits: 0, tokens: 0 };
      if (r.type === "asp.purchase/v0.2") {
        const amount = Number(r.body?.amount?.value ?? 0);
        const mCap = ctl.caps.members[did]?.credits, fCap = ctl.caps.fleet.credits;
        if (mCap !== undefined && mine.credits + amount > mCap) return `FLEET_CAP: this purchase of ${amount} credits would take ${did} past its monthly credit cap of ${mCap} (${mine.credits} spent)`;
        if (fCap !== undefined && fleetUsed.credits + amount > fCap) return `FLEET_CAP: this purchase of ${amount} credits would take the fleet ${name} past its monthly credit cap of ${fCap} (${fleetUsed.credits} spent)`;
      } else if (r.type === "asp.action/v0.2") {
        const mCap = ctl.caps.members[did]?.tokens, fCap = ctl.caps.fleet.tokens;
        if (mCap !== undefined && mine.tokens >= mCap) return `FLEET_CAP: ${did} has reached its monthly token cap of ${mCap}: a run report is refused until next month or until the cap is raised`;
        if (fCap !== undefined && fleetUsed.tokens >= fCap) return `FLEET_CAP: the fleet ${name} has reached its monthly token cap of ${fCap}: a run report is refused until next month or until the cap is raised`;
      }
    }
    return undefined;
  };
}
