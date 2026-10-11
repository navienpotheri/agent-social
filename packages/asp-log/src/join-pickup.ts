/**
 * Handing the token to the command line (launch blocker 12, `asp join`). The command makes a secret (the verifier), sends only its SHA-256 (the challenge) in the browser address,
 * and later asks for the token with the verifier; the browser address can be seen by anyone who sees the screen, but only the command that made the verifier can collect the token.
 * The token is held in memory for ten minutes and handed over once; a restart of the service loses it and the person starts again.
 */
import { createHash } from "node:crypto";

export interface PickupPayload { tenant: string; token: string; quotas: { recordQuota: number; byteQuota: number; rateLimitPerMinute: number } }
export const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export class JoinPickup {
  private held = new Map<string, { at: number; payload: PickupPayload }>();
  private ttl: number;
  private now: () => number;
  constructor(o: { ttlMs?: number; now?: () => number } = {}) { this.ttl = o.ttlMs ?? 10 * 60_000; this.now = o.now ?? Date.now; }

  private prune() { const t = this.now(); for (const [k, v] of this.held) if (t - v.at > this.ttl) this.held.delete(k); }
  put(challenge: string, payload: PickupPayload): void {
    this.prune();
    if (this.held.size >= 1000) return;
    this.held.set(challenge, { at: this.now(), payload });
  }
  /** The token for this verifier, once; undefined when it is not there (not signed in yet, expired, or already collected). */
  take(verifier: string): PickupPayload | undefined {
    this.prune();
    const key = challengeOf(verifier);
    const e = this.held.get(key);
    if (!e) return undefined;
    this.held.delete(key);
    return e.payload;
  }
}
