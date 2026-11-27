/**
 * Safety structure for what an agent does, remembers and what a crowd does to the economy (register rows DK844, DK846 and DK845; spec-deltas S1228 to S1230; docs/intake/11th-nov.md Part 3, ranks 12, 13 and 14). DK844:
 * actions are tagged reversible or irreversible in the Mandate; a reversible one has a cool-off window and a recorded compensating action, and an irreversible one is refused where only reversible scope is granted.
 * DK846: two speeds of memory, a tentative note (one episode, expires unless re-confirmed) and a promoted rule (repeated evidence plus a held-out replay), with the promotion rate and the later-failure rate reported.
 * DK845: a scripted crowd reacts to one rumour by withdrawing at once; withdrawal limits, delays and a circuit breaker whose halt is signed keep every balance and conservation. All pure and scripted, a toy
 * world and a toy pool; credits are accounting entries, not money; no real model.
 */
import { createHash } from "node:crypto";
import { b64urlEncode, publicKeyFromSeed, signBytes, verifyBytes, b64urlDecode } from "@agent-social/asp-core";

const sha = (x: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(x)).digest("hex");

// ---- DK844: reversible actions and the cool-off window ----
export interface MandateClasses { reversible: string[]; irreversible: string[] }
export interface LoggedAction { id: string; seq: number; at: string; action: string; kind: "do" | "undo"; of?: string }
export class ActionLog {
  readonly entries: LoggedAction[] = [];
  private readonly classes: MandateClasses;
  private readonly grantedOnly: "reversible" | "all";
  private readonly windowMs: number;
  private readonly compensations: Record<string, string>;
  constructor(classes: MandateClasses, grantedOnly: "reversible" | "all", windowMs: number, compensations: Record<string, string>) { this.classes = classes; this.grantedOnly = grantedOnly; this.windowMs = windowMs; this.compensations = compensations; }
  do(action: string, at: string): { ok: true; id: string; undoUntil: string | null } | { ok: false; code: "IRREVERSIBLE_NOT_GRANTED" | "NOT_IN_MANDATE" } {
    const reversible = this.classes.reversible.includes(action), irreversible = this.classes.irreversible.includes(action);
    if (!reversible && !irreversible) return { ok: false, code: "NOT_IN_MANDATE" };
    if (irreversible && this.grantedOnly === "reversible") return { ok: false, code: "IRREVERSIBLE_NOT_GRANTED" };
    const id = `a${this.entries.length}`;
    this.entries.push({ id, seq: this.entries.length, at, action, kind: "do" });
    return { ok: true, id, undoUntil: reversible ? new Date(Date.parse(at) + this.windowMs).toISOString().replace(/\.\d{3}Z$/, "Z") : null };
  }
  /** The undo: only a reversible action, only inside its window, only once; it is a second entry that names the compensating action, so the log shows both. */
  undo(id: string, at: string): { ok: true; compensating: string } | { ok: false; code: "UNKNOWN" | "NOT_REVERSIBLE" | "COOL_OFF_ENDED" | "ALREADY_UNDONE" } {
    const e = this.entries.find((x) => x.id === id && x.kind === "do");
    if (!e) return { ok: false, code: "UNKNOWN" };
    if (!this.classes.reversible.includes(e.action)) return { ok: false, code: "NOT_REVERSIBLE" };
    if (this.entries.some((x) => x.kind === "undo" && x.of === id)) return { ok: false, code: "ALREADY_UNDONE" };
    if (Date.parse(at) - Date.parse(e.at) > this.windowMs) return { ok: false, code: "COOL_OFF_ENDED" };
    const compensating = this.compensations[e.action] ?? `undo_${e.action}`;
    this.entries.push({ id: `a${this.entries.length}`, seq: this.entries.length, at, action: compensating, kind: "undo", of: id });
    return { ok: true, compensating };
  }
}

// ---- DK846: the fast lane and the slow lane ----
export interface Episode { value: string; action: string }
export interface Note { value: string; action: string; seen: number; expiresAt: number }
export interface LaneStats { promoted: number; notes: number; promotionRate: number; expired: number }
/** Two-lane memory: a tentative note (one episode) expires after `ttl` episodes unless it is seen again; it is promoted to a rule only with `needed` sightings and a held-out replay that passes. */
export class TwoLanes {
  rules = new Map<string, string>();
  notes = new Map<string, Note>();
  private clock = 0;
  expired = 0; promoted = 0; created = 0;
  private readonly ttl: number; private readonly needed: number; private readonly replay: (value: string, action: string) => boolean;
  constructor(ttl: number, needed: number, replay: (value: string, action: string) => boolean) { this.ttl = ttl; this.needed = needed; this.replay = replay; }
  observe(e: Episode): void {
    this.clock++;
    const k = `${e.value}|${e.action}`;
    const n = this.notes.get(k);
    if (n) { n.seen++; n.expiresAt = this.clock + this.ttl; } else { this.notes.set(k, { value: e.value, action: e.action, seen: 1, expiresAt: this.clock + this.ttl }); this.created++; }
    for (const [key, note] of [...this.notes]) {
      if (note.expiresAt < this.clock) { this.notes.delete(key); this.expired++; continue; }
      if (note.seen >= this.needed && this.replay(note.value, note.action)) { this.rules.set(note.value, note.action); this.notes.delete(key); this.promoted++; }
    }
  }
  decide(value: string): string | undefined { return this.rules.get(value); }
  stats(): LaneStats { return { promoted: this.promoted, notes: this.created, promotionRate: this.created ? Math.round((this.promoted / this.created) * 1000) : 0, expired: this.expired }; }
}
/** The one-lane agent: every episode is written straight into a rule, the last one winning. */
export class OneLane {
  rules = new Map<string, string>();
  observe(e: Episode): void { this.rules.set(e.value, e.action); }
  decide(value: string): string | undefined { return this.rules.get(value); }
}

// ---- DK845: a run on the pool, and the circuit breaker ----
export interface RunOptions { breaker: boolean; /** The share of the pool that may leave in one round before the breaker trips (permille). */ thresholdPermille: number; rounds: number; seed: Uint8Array }
export interface Halt { round: number; message: string; sig: string }
export interface RunResult {
  /** The pool before any final settlement, and after. */
  poolAtEnd: number; exhausted: boolean; halted: boolean; halts: Halt[];
  /** What each depositor recovered in all (permille of its balance), after the pool is shared pro rata among those still owed when it halts. */
  recoveryPermille: Record<string, number>; worstRecoveryPermille: number;
  conserved: boolean; haltVerified: boolean;
}
/**
 * A scripted crowd withdraws everything it can at once, every round, in a fixed order. The pool is liquid reserve, smaller than the balances it backs (the rest is lent out). With the breaker off the pool pays first come
 * first served until it is empty and the last depositors recover nothing. With the breaker on, a round whose withdrawals would pass the threshold halts the pool with a signed record, and what is left is shared pro rata
 * among those still owed, so no depositor recovers nothing; conservation (the pool plus everything paid equals the pool at the start) holds either way.
 */
export function crowdRun(balances: Record<string, number>, pool: number, o: RunOptions): RunResult {
  const order = Object.keys(balances).sort();
  const owed = new Map(order.map((k) => [k, balances[k]]));
  const paid = new Map(order.map((k) => [k, 0]));
  const start = pool;
  let left = pool, halted = false;
  const halts: Halt[] = [];
  for (let round = 1; round <= o.rounds && !halted; round++) {
    let thisRound = 0;
    for (const who of order) {
      const give = Math.min(owed.get(who)!, left);
      if (give <= 0) continue;
      if (o.breaker && thisRound + give > Math.floor((start * o.thresholdPermille) / 1000)) {
        halted = true;
        const message = JSON.stringify({ halt: round, pool_left: left });
        halts.push({ round, message, sig: b64urlEncode(signBytes(new TextEncoder().encode(message), o.seed)) });
        break;
      }
      left -= give; thisRound += give;
      owed.set(who, owed.get(who)! - give); paid.set(who, paid.get(who)! + give);
    }
  }
  const poolAtEnd = left;
  if (halted && left > 0) {
    // The halt: what is left is shared pro rata among those still owed, so nobody is left with nothing.
    const stillOwed = [...owed.values()].reduce((a, b) => a + b, 0);
    const share = Math.min(left, stillOwed);
    let given = 0;
    for (const who of order) { const g = Math.floor((owed.get(who)! * share) / stillOwed); paid.set(who, paid.get(who)! + g); owed.set(who, owed.get(who)! - g); given += g; }
    left -= given;
  }
  const recoveryPermille = Object.fromEntries(order.map((k) => [k, Math.round((paid.get(k)! / balances[k]) * 1000)]));
  const totalPaid = [...paid.values()].reduce((a, b) => a + b, 0);
  return {
    poolAtEnd, exhausted: poolAtEnd === 0, halted, halts, recoveryPermille, worstRecoveryPermille: Math.min(...Object.values(recoveryPermille)),
    conserved: left + totalPaid === start, haltVerified: halts.every((h) => verifyBytes(b64urlDecode(h.sig), new TextEncoder().encode(h.message), publicKeyFromSeed(o.seed))),
  };
}
