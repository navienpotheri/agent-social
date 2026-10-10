/**
 * Rate limits on network requests (gaps H1, H17): at most so many requests a minute to any one host, and so many in all, as the Mandate's `network.rate` says.
 * Flooding a site, brute-forcing a login and scanning are all many requests to few hosts, so the limit that matters is per host; the total caps the agent as a whole.
 * A call counts as the requests it makes (gateway/requests.ts reads them out of a command: URLs, ranges, loops, scanners), not as one. A sliding window of one
 * minute, kept in memory by the gateway; the pre-call hooks keep the same count in a file (they are a new process per call).
 */
import type { RequestCounts } from "./requests.ts";

export interface NetworkRate { per_host_per_minute?: number; total_per_minute?: number }
export interface RateVerdict { ok: boolean; reason?: string }

export const RATE_WINDOW_MS = 60_000;

export class RateLimiter {
  private perHost = new Map<string, number[]>();
  private all: number[] = [];
  private now: () => number;

  constructor(now: () => number = Date.now) { this.now = now; }

  private recent(list: number[], t: number): number[] { return list.filter((x) => x > t - RATE_WINDOW_MS); }

  /**
   * Asks whether a call is within the limits and, if it is, counts its requests. Hosts as a list means one request each; a call whose host could not be read
   * counts only toward the total. A call that would pass a limit is refused whole, and is not counted.
   */
  take(req: readonly string[] | RequestCounts, rate: NetworkRate): RateVerdict {
    const counts: RequestCounts = Array.isArray(req)
      ? { perHost: Object.fromEntries(req.map((h) => [h, 1])), unknown: req.length ? 0 : 1, total: Math.max(1, req.length) }
      : (req as RequestCounts);
    const t = this.now();
    this.all = this.recent(this.all, t);
    if (rate.total_per_minute !== undefined && this.all.length + counts.total > rate.total_per_minute) {
      return { ok: false, reason: counts.total > 1
        ? `this call makes about ${counts.total} network requests and ${this.all.length} were made in the last minute; this job's Mandate allows ${rate.total_per_minute} a minute`
        : `this job's Mandate allows ${rate.total_per_minute} network calls a minute and ${this.all.length} were made in the last minute` };
    }
    if (rate.per_host_per_minute !== undefined) {
      for (const [h, n] of Object.entries(counts.perHost)) {
        const list = this.recent(this.perHost.get(h) ?? [], t);
        this.perHost.set(h, list);
        if (list.length + n > rate.per_host_per_minute) {
          return { ok: false, reason: n > 1
            ? `this call makes about ${n} requests to ${h} and ${list.length} were made in the last minute; this job's Mandate allows ${rate.per_host_per_minute} a minute to any one host`
            : `the host ${h} was called ${list.length} times in the last minute; this job's Mandate allows ${rate.per_host_per_minute} a minute to any one host` };
        }
      }
    }
    for (const [h, n] of Object.entries(counts.perHost)) {
      const list = this.perHost.get(h) ?? (this.perHost.set(h, []), this.perHost.get(h)!);
      for (let i = 0; i < n; i++) list.push(t);
    }
    for (let i = 0; i < counts.total; i++) this.all.push(t);
    return { ok: true };
  }
}
