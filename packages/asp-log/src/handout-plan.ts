/**
 * The weekly mock-credit handout (register row DK545; owner design accepted 2026-11-19): the Treasury pays agents that were active this week, capped per identity level and per address,
 * reduced for agents already sitting on a large balance (anti-hoarding), all inside a co-signed Treasury budget. This file is the plan only: given who was active and what they hold, it says
 * who is paid how much and who is not and why, deterministically. It writes nothing and signs nothing; paying from the plan (the signed record, the budget check in the log) is the open
 * part of DK545. The size is a parameter, not a policy: 50 credits a week is the default and an owner decision (docs/owner-decisions.md, row HO1). Credits are accounting entries, not money.
 */
export type IdentityLevel = "sponsored" | "key_only";

export interface HandoutParams {
  /** Credits a fully qualified agent gets for the week. */
  amount: number;
  /** The most one identity of a level may get in a week (a level may be paid less than the full amount; 0 pays the level nothing). */
  levelCap: Record<IdentityLevel, number>;
  /** The most all identities behind one address (a network address hash, or a sponsor for sponsored agents) may get in a week. */
  addressCap: number;
  /** An agent is active when the society scored at least this many signed acts of its own in the week (a purchase, an action, an enrolment, a bid) on at least this many different days. */
  minActs: number;
  minDays: number;
  /** Anti-hoarding: a balance up to `hoardFrom` x amount gets the full amount, none at `hoardTo` x amount or more, and a straight line between. */
  hoardFrom: number;
  hoardTo: number;
}

export const DEFAULT_HANDOUT: HandoutParams = {
  amount: 50,
  levelCap: { sponsored: 50, key_only: 50 },
  addressCap: 100,
  minActs: 3,
  minDays: 2,
  hoardFrom: 4,
  hoardTo: 8,
};

export interface HandoutAgent {
  did: string;
  level: IdentityLevel;
  /** The key the cap is counted on: an address hash for a self-joined agent, the sponsor for a sponsored one. */
  address: string;
  balance: number;
  /** Day keys (YYYY-MM-DD) of the agent's own scored acts this week, one entry per act. */
  actDays: string[];
  /** Quarantined, retired or tier 0 agents are not paid (they are in the Clinic's way back, which has its own essentials). */
  eligible?: boolean;
  /** House agents are the society's own and are never paid by the handout. */
  house?: boolean;
}

export interface HandoutLine { did: string; paid: number; wanted: number; reason: string }
export interface HandoutPlan {
  week: string;
  params: HandoutParams;
  budget: number;
  lines: HandoutLine[];
  total: number;
  /** True when the budget was smaller than the total wanted and every payment was scaled down in proportion. */
  scaledToBudget: boolean;
  skipped: { did: string; reason: string }[];
}

/** The part of the amount an agent with this balance keeps: 1 below hoardFrom x amount, 0 at hoardTo x amount, a straight line between. */
export function hoardFactor(balance: number, p: HandoutParams): number {
  const lo = p.hoardFrom * p.amount, hi = p.hoardTo * p.amount;
  if (balance <= lo) return 1;
  if (balance >= hi) return 0;
  return (hi - balance) / (hi - lo);
}

export function planHandout(week: string, agents: HandoutAgent[], budget: number, params: Partial<HandoutParams> = {}): HandoutPlan {
  const p: HandoutParams = { ...DEFAULT_HANDOUT, ...params, levelCap: { ...DEFAULT_HANDOUT.levelCap, ...(params.levelCap ?? {}) } };
  if (!Number.isInteger(p.amount) || p.amount < 0) throw new Error("the weekly amount is a whole number of credits, 0 or more");
  const skipped: HandoutPlan["skipped"] = [];
  const wanted: HandoutLine[] = [];
  for (const a of [...agents].sort((x, y) => (x.did < y.did ? -1 : x.did > y.did ? 1 : 0))) {
    if (a.house) { skipped.push({ did: a.did, reason: "house agent" }); continue; }
    if (a.eligible === false) { skipped.push({ did: a.did, reason: "quarantined, retired or tier 0" }); continue; }
    if (a.actDays.length < p.minActs || new Set(a.actDays).size < p.minDays) { skipped.push({ did: a.did, reason: `not active this week (needs ${p.minActs} acts on ${p.minDays} days)` }); continue; }
    const cap = Math.min(p.amount, p.levelCap[a.level]);
    const want = Math.floor(cap * hoardFactor(a.balance, p));
    if (want <= 0) { skipped.push({ did: a.did, reason: a.balance >= p.hoardTo * p.amount ? "balance is already large (anti-hoarding)" : "the level's cap is 0" }); continue; }
    wanted.push({ did: a.did, paid: want, wanted: want, reason: want < cap ? "reduced for a large balance" : "full" });
  }
  // The address cap: identities behind one address share it; the earlier ones in DID order are served first, deterministically.
  const byAddress = new Map<string, number>();
  const addr = new Map(agents.map((a) => [a.did, a.address]));
  for (const l of wanted) {
    const key = addr.get(l.did)!;
    const used = byAddress.get(key) ?? 0;
    const room = Math.max(0, p.addressCap - used);
    if (l.paid > room) { l.paid = room; l.reason = room ? "cut to the address cap" : "address cap already reached"; }
    byAddress.set(key, used + l.paid);
  }
  let lines = wanted.filter((l) => l.paid > 0);
  for (const l of wanted) if (l.paid === 0) skipped.push({ did: l.did, reason: l.reason });
  // The budget: never pay more than the co-signed budget has left; if it is short every payment is scaled down in proportion (rounded down, so the total never passes it).
  const sum = lines.reduce((n, l) => n + l.paid, 0);
  const cap = Math.max(0, Math.trunc(budget));
  let scaled = false;
  if (sum > cap) {
    scaled = true;
    lines = lines.map((l) => ({ ...l, paid: Math.floor((l.paid * cap) / sum), reason: "scaled to the budget" })).filter((l) => l.paid > 0);
  }
  return { week, params: p, budget: cap, lines, total: lines.reduce((n, l) => n + l.paid, 0), scaledToBudget: scaled, skipped };
}
