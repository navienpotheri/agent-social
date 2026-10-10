/**
 * Rate limits on network calls (gap H1): at most so many calls a minute to any one host, and so many in all, as the Mandate's `network.rate` says.
 * Flooding a site, brute-forcing a login and scanning are all many calls to few hosts, so the limit that matters is per host; the total caps the
 * agent as a whole. A sliding window of one minute, kept in memory by the gateway; the pre-call hooks keep the same count in a file (they are a new process per call).
 */

export interface NetworkRate { per_host_per_minute?: number; total_per_minute?: number }
export interface RateVerdict { ok: boolean; reason?: string }

export const RATE_WINDOW_MS = 60_000;

export class RateLimiter {
  private perHost = new Map<string, number[]>();
  private all: number[] = [];
  private now: () => number;

  constructor(now: () => number = Date.now) { this.now = now; }

  private recent(list: number[], t: number): number[] {
    const kept = list.filter((x) => x > t - RATE_WINDOW_MS);
    return kept;
  }

  /** Asks whether one more call to these hosts is within the limits and, if it is, counts it. A call whose host could not be read counts only toward the total. */
  take(hosts: readonly string[], rate: NetworkRate): RateVerdict {
    const t = this.now();
    this.all = this.recent(this.all, t);
    if (rate.total_per_minute !== undefined && this.all.length >= rate.total_per_minute) {
      return { ok: false, reason: `this job's Mandate allows ${rate.total_per_minute} network calls a minute and ${this.all.length} were made in the last minute` };
    }
    if (rate.per_host_per_minute !== undefined) {
      for (const h of hosts) {
        const list = this.recent(this.perHost.get(h) ?? [], t);
        this.perHost.set(h, list);
        if (list.length >= rate.per_host_per_minute) {
          return { ok: false, reason: `the host ${h} was called ${list.length} times in the last minute; this job's Mandate allows ${rate.per_host_per_minute} a minute to any one host` };
        }
      }
    }
    for (const h of hosts) (this.perHost.get(h) ?? (this.perHost.set(h, []), this.perHost.get(h)!)).push(t);
    this.all.push(t);
    return { ok: true };
  }
}
