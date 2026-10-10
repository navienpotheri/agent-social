/**
 * The starter-credit pool (launch blocker 3: a newcomer's first job). Only an operator can mint credits, so a new tenant could not post an escrow or a bond and
 * nothing in the market could move. A tenant that signed up with a verified Google account may claim a small starter grant once, for up to two of the identities
 * it has written as (a principal and an agent); this counts how many credits have been minted that way, so the operator's cap on the whole pool holds.
 * Credits are accounting entries in the protocol, not money (the terms say so).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export const STARTER_PER_DID = 500;
export const STARTER_MAX_DIDS = 2;
export const STARTER_POOL = 200_000;

export class StarterPool {
  private minted = 0;
  private path: string | undefined;
  readonly cap: number;

  constructor(path?: string, cap: number = STARTER_POOL) {
    this.path = path;
    this.cap = cap;
    if (path && existsSync(path)) { try { this.minted = Number(JSON.parse(readFileSync(path, "utf8")).minted) || 0; } catch { /* start again from nothing */ } }
  }

  get used(): number { return this.minted; }
  get left(): number { return Math.max(0, this.cap - this.minted); }

  /** Takes `n` credits from the pool; false (and nothing taken) when it would pass the cap. */
  take(n: number): boolean {
    if (this.minted + n > this.cap) return false;
    this.minted += n;
    this.save();
    return true;
  }
  /** Puts credits back (a mint that failed after they were taken). */
  give(n: number): void { this.minted = Math.max(0, this.minted - n); this.save(); }

  private save(): void {
    if (!this.path) return;
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify({ minted: this.minted }) + "\n");
    renameSync(tmp, this.path);
  }
}
