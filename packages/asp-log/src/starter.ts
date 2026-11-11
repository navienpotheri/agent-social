/**
 * The starter-credit pool (launch blocker 3: a newcomer's first job; gap M9: not to be drained). Only an operator can mint credits, so a new tenant could not post an escrow or a bond and
 * nothing in the market could move. A tenant that signed up with a verified Google account may claim a starter grant once, for up to two of the identities it has written as (a principal and
 * an agent). The grant comes in two parts: STARTER_UPFRONT at once, which is enough for a first job (an escrow and a bond), and the rest when one of those identities has had a job accepted.
 * This counts how many credits have been minted that way, so the operator's cap on the whole pool holds; when the pool cannot cover a claim the tenant joins a waiting list, served in order
 * after the operator tops the pool up on purpose (`asp serve starter`). Credits are accounting entries in the protocol, not money (the terms say so).
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

/** The whole grant for each identity, and how much of it comes at once. */
export const STARTER_PER_DID = 500;
export const STARTER_UPFRONT = 100;
export const STARTER_MAX_DIDS = 2;
export const STARTER_POOL = 200_000;

/** Where the operator's change to the pool's size is kept (written by `asp serve starter`, read by the service on each use, so no restart). */
export const starterCapFile = (poolFile: string) => `${poolFile}.cap.json`;

export class StarterPool {
  private minted = 0;
  private waiting: string[] = [];
  private path: string | undefined;
  private baseCap: number;
  private capSeen: { mtime: number; cap?: number } = { mtime: -1 };

  /**
   * `cap` is the size the service starts with. It is kept in the state file, so the operator's command (which does not know the start-up flag) reads the same size, and left out it takes the one
   * kept there (or STARTER_POOL when there is none yet).
   */
  constructor(path?: string, cap?: number) {
    this.path = path;
    let stored: number | undefined;
    if (path && existsSync(path)) {
      try {
        const j = JSON.parse(readFileSync(path, "utf8"));
        this.minted = Number(j.minted) || 0;
        if (Array.isArray(j.waiting)) this.waiting = j.waiting.filter((x: unknown): x is string => typeof x === "string");
        if (Number.isFinite(Number(j.cap))) stored = Number(j.cap);
      } catch { /* start again from nothing */ }
    }
    this.baseCap = cap ?? stored ?? STARTER_POOL;
    if (path && cap !== undefined && cap !== stored) this.save();
  }

  /** The size of the pool: the operator's setting if there is one, else the start-up value. */
  get cap(): number {
    if (!this.path) return this.baseCap;
    const f = starterCapFile(this.path);
    try {
      const m = existsSync(f) ? statSync(f).mtimeMs : -2;
      if (m !== this.capSeen.mtime) {
        const c = m === -2 ? undefined : Number(JSON.parse(readFileSync(f, "utf8")).cap);
        this.capSeen = { mtime: m, ...(Number.isFinite(c) && c! >= 0 ? { cap: c } : {}) };
      }
    } catch { /* keep the start-up value */ }
    return this.capSeen.cap ?? this.baseCap;
  }

  get used(): number { return this.minted; }
  get left(): number { return Math.max(0, this.cap - this.minted); }
  /** The tenants waiting for the pool, in the order they asked. */
  get waitingList(): readonly string[] { return this.waiting; }

  /** Takes `n` credits from the pool; false (and nothing taken) when it would pass the cap. */
  take(n: number): boolean {
    if (this.minted + n > this.cap) return false;
    this.minted += n;
    this.save();
    return true;
  }
  /** Puts credits back (a mint that failed after they were taken). */
  give(n: number): void { this.minted = Math.max(0, this.minted - n); this.save(); }

  /** Puts a tenant on the waiting list (once) and says its place, counted from 1. */
  enqueue(tenant: string): number {
    if (!this.waiting.includes(tenant)) { this.waiting.push(tenant); this.save(); }
    return this.waiting.indexOf(tenant) + 1;
  }
  /** A tenant's place on the waiting list, counted from 1, or 0 when it is not on it. */
  position(tenant: string): number { return this.waiting.indexOf(tenant) + 1; }
  dequeue(tenant: string): void {
    const i = this.waiting.indexOf(tenant);
    if (i >= 0) { this.waiting.splice(i, 1); this.save(); }
  }

  private save(): void {
    if (!this.path) return;
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify({ minted: this.minted, cap: this.baseCap, ...(this.waiting.length ? { waiting: this.waiting } : {}) }) + "\n");
    renameSync(tmp, this.path);
  }
}
