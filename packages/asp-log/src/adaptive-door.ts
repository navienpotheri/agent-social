/**
 * The open door without hard limits (register row DK1365; spec-delta S1460; owner decision of 2026-11-21: agents are free and autonomous, so no count turns an agent away). The old door refused the 4th enrolment from an
 * address in a day and the 201st in all. This one never refuses by count. Instead:
 *   - the proof of work an address must solve RISES with how many enrolments it made in the last hour (a free allowance, then one more bit for every doubling) and falls back as they age out; 10,000 enrolments from one
 *     address still succeed, each costing more work than the last, and another address is not touched;
 *   - a rush is QUEUED, not refused: when more than `drainPerMinute` agents are admitted in a minute, the next ones get a ticket and a position; the queue is served in order, an address that has sent fewer enrolments
 *     first, and a ticket is redeemed by asking again, so no agent is turned away because of how many others came;
 *   - accountability stays on the key (its own bond, quarantine and a ban by key and address: signup.ts `bans`);
 *   - a circuit breaker closes the queue only near capacity (`maxQueue` waiting): a new enrolment is told to come back in a minute, and nothing already queued is dropped.
 * Everything here is counts in memory of salted address hashes and keys; nothing is stored about a person. Credits are accounting entries, not money.
 */
import { randomBytes } from "node:crypto";

export interface DoorOptions {
  /** The proof-of-work bits for an address with no recent enrolments (the service's difficulty). */
  baseBits: number;
  /** Enrolments an address may make an hour at the base cost (default 6). Above it the cost rises by a bit for each doubling. */
  freePerHour?: number;
  /** The most bits the cost may rise by (default 16): a ceiling on the work, not on the count. */
  maxExtraBits?: number;
  /** Agents admitted a minute before a rush is queued (default 600). */
  drainPerMinute?: number;
  /** Tickets waiting before the circuit breaker closes the queue (default 50,000). */
  maxQueue?: number;
  now?: () => number;
}

export type Admission =
  | { state: "go" }
  | { state: "queued"; ticket: string; position: number; etaSec: number }
  | { state: "breaker"; retryAfterSec: number };
export type Poll = { state: "ready" } | { state: "waiting"; position: number; etaSec: number } | { state: "unknown" };

interface Waiting<T> { id: string; address: string; at: number; payload: T }
const HOUR = 3_600_000, MINUTE = 60_000;

export class AdaptiveDoor<T = unknown> {
  private readonly o: Required<Omit<DoorOptions, "now">>;
  private readonly now: () => number;
  /** address hash -> admission times in the last hour */
  private readonly seen = new Map<string, number[]>();
  /** times of the admissions of the last minute, all addresses */
  private recent: number[] = [];
  private readonly queue = new Map<string, Waiting<T>>();
  private readonly ready = new Map<string, Waiting<T>>();
  constructor(o: DoorOptions) {
    this.o = { baseBits: o.baseBits, freePerHour: o.freePerHour ?? 6, maxExtraBits: o.maxExtraBits ?? 16, drainPerMinute: o.drainPerMinute ?? 600, maxQueue: o.maxQueue ?? 50_000 };
    this.now = o.now ?? Date.now;
  }

  private count(address: string): number {
    const list = (this.seen.get(address) ?? []).filter((t) => t > this.now() - HOUR);
    if (list.length) this.seen.set(address, list); else this.seen.delete(address);
    return list.length;
  }

  /** The proof-of-work bits this address must solve now. */
  bitsFor(address: string): number {
    const n = this.count(address);
    const extra = n < this.o.freePerHour ? 0 : Math.min(this.o.maxExtraBits, Math.floor(Math.log2(n / this.o.freePerHour)) + 1);
    return this.o.baseBits + extra;
  }

  private slots(): number { this.recent = this.recent.filter((t) => t > this.now() - MINUTE); return Math.max(0, this.o.drainPerMinute - this.recent.length); }
  /** Records an admission: the address's count and the minute's. */
  private admitted(address: string): void { const t = this.now(); (this.seen.get(address) ?? this.seen.set(address, []).get(address)!).push(t); this.recent.push(t); }

  /** Order of service: an address that has made fewer enrolments first, then the earlier. */
  private order(): Waiting<T>[] { return [...this.queue.values()].sort((a, b) => this.count(a.address) - this.count(b.address) || a.at - b.at); }
  private prune(): void { const dead = this.now() - HOUR; for (const [k, w] of this.queue) if (w.at < dead) this.queue.delete(k); for (const [k, w] of this.ready) if (w.at < dead) this.ready.delete(k); }

  /** Called when an enrolment has passed every check except the door's: go now, wait in the queue, or (near capacity only) come back in a minute. */
  admit(address: string, payload: T): Admission {
    this.prune();
    if (this.queue.size === 0 && this.slots() > 0) { this.admitted(address); return { state: "go" }; }
    if (this.queue.size >= this.o.maxQueue) return { state: "breaker", retryAfterSec: 60 };
    const id = randomBytes(16).toString("base64url");
    this.queue.set(id, { id, address, at: this.now(), payload });
    this.promote();
    const p = this.poll(id);
    return p.state === "waiting" ? { state: "queued", ticket: id, position: p.position, etaSec: p.etaSec } : { state: "queued", ticket: id, position: 1, etaSec: 0 };
  }

  /** Moves the front of the queue to ready while there are free slots in this minute. */
  private promote(): void {
    for (const w of this.order()) {
      if (this.slots() <= 0) break;
      this.queue.delete(w.id); this.ready.set(w.id, w);
      this.recent.push(this.now()); // the slot is taken now, so the next in line waits for a later one
    }
  }

  /** Where a ticket stands. A ready ticket is redeemed once with `redeem`. */
  poll(ticket: string): Poll {
    this.prune(); this.promote();
    if (this.ready.has(ticket)) return { state: "ready" };
    if (!this.queue.has(ticket)) return { state: "unknown" };
    const position = this.order().findIndex((w) => w.id === ticket) + 1;
    return { state: "waiting", position, etaSec: Math.max(1, Math.ceil((position / Math.max(1, this.o.drainPerMinute)) * 60)) };
  }

  /** Takes a ready ticket: returns what was queued under it and counts the admission against its address. */
  redeem(ticket: string): T | undefined {
    const w = this.ready.get(ticket);
    if (!w) return undefined;
    this.ready.delete(ticket);
    (this.seen.get(w.address) ?? this.seen.set(w.address, []).get(w.address)!).push(this.now());
    return w.payload;
  }

  stats(): { waiting: number; ready: number; admittedLastMinute: number } { this.prune(); return { waiting: this.queue.size, ready: this.ready.size, admittedLastMinute: this.recent.length }; }
}
