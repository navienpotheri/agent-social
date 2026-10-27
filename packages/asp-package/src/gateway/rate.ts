/**
 * Rate limits on network requests (gaps H1, H17, H15): at most so many requests a minute to any one host, and so many in all, as the Mandate's `network.rate` says.
 * Flooding a site, brute-forcing a login and scanning are all many requests to few hosts, so the limit that matters is per host; the total caps the agent as a whole.
 * A call counts as the requests it makes (gateway/requests.ts reads them out of a command: URLs, ranges, loops, scanners), not as one. A sliding window of one
 * minute. One gateway keeps it in memory (RateLimiter). Copies of an agent run as separate gateways, each with its own allowance, so n copies made n times the calls (H15);
 * SharedRateLimiter keeps the same count in a file that all the gateways on this machine that share a key (one Mandate, or one person's whole fleet) write under a lock.
 * The pre-call hooks keep a count in a file too (they are a new process per call), in the run's own folder.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RequestCounts } from "./requests.ts";

export interface NetworkRate { per_host_per_minute?: number; total_per_minute?: number }
export interface RateVerdict { ok: boolean; reason?: string }
/** Anything the gateway can ask "is this call within the limits?". `who` names whose allowance it is, for the message. */
export interface Limiter { take(req: readonly string[] | RequestCounts, rate: NetworkRate, who?: string): RateVerdict }

export const RATE_WINDOW_MS = 60_000;

const countsOf = (req: readonly string[] | RequestCounts): RequestCounts => Array.isArray(req)
  ? { perHost: Object.fromEntries((req as readonly string[]).map((h) => [h, 1])), unknown: req.length ? 0 : 1, total: Math.max(1, req.length) }
  : (req as RequestCounts);

/** The decision, given how many requests were made in the last minute in all and to each host. */
function verdict(made: number, hostMade: (h: string) => number, counts: RequestCounts, rate: NetworkRate, who = "this job's Mandate"): RateVerdict {
  if (rate.total_per_minute !== undefined && made + counts.total > rate.total_per_minute) {
    return { ok: false, reason: counts.total > 1
      ? `this call makes about ${counts.total} network requests and ${made} were made in the last minute; ${who} allows ${rate.total_per_minute} a minute`
      : `${who} allows ${rate.total_per_minute} network calls a minute and ${made} were made in the last minute` };
  }
  if (rate.per_host_per_minute !== undefined) {
    for (const [h, n] of Object.entries(counts.perHost)) {
      const before = hostMade(h);
      if (before + n > rate.per_host_per_minute) {
        return { ok: false, reason: n > 1
          ? `this call makes about ${n} requests to ${h} and ${before} were made in the last minute; ${who} allows ${rate.per_host_per_minute} a minute to any one host`
          : `the host ${h} was called ${before} times in the last minute; ${who} allows ${rate.per_host_per_minute} a minute to any one host` };
      }
    }
  }
  return { ok: true };
}

export class RateLimiter implements Limiter {
  private perHost = new Map<string, number[]>();
  private all: number[] = [];
  private now: () => number;

  constructor(now: () => number = Date.now) { this.now = now; }

  private recent(list: number[], t: number): number[] { return list.filter((x) => x > t - RATE_WINDOW_MS); }

  /**
   * Asks whether a call is within the limits and, if it is, counts its requests. Hosts as a list means one request each; a call whose host could not be read
   * counts only toward the total. A call that would pass a limit is refused whole, and is not counted.
   */
  take(req: readonly string[] | RequestCounts, rate: NetworkRate, who?: string): RateVerdict {
    const counts = countsOf(req);
    const t = this.now();
    this.all = this.recent(this.all, t);
    for (const h of Object.keys(counts.perHost)) this.perHost.set(h, this.recent(this.perHost.get(h) ?? [], t));
    const v = verdict(this.all.length, (h) => this.perHost.get(h)?.length ?? 0, counts, rate, who);
    if (!v.ok) return v;
    for (const [h, n] of Object.entries(counts.perHost)) {
      const list = this.perHost.get(h) ?? (this.perHost.set(h, []), this.perHost.get(h)!);
      for (let i = 0; i < n; i++) list.push(t);
    }
    for (let i = 0; i < counts.total; i++) this.all.push(t);
    return { ok: true };
  }
}

/** Runs fn with the ledger locked: a folder is made next to it, which only one process can do at a time; a lock older than five seconds is a crashed process's and is taken over. */
function withLock<T>(ledger: string, fn: () => T): T {
  const lock = `${ledger}.lock`;
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const deadline = Date.now() + 3000;
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") break; // not writable: count without a lock rather than not at all
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() > deadline) break;
      sleep(5 + Math.floor(Math.random() * 15));
    }
  }
  try { return fn(); } finally { try { rmSync(lock, { recursive: true, force: true }); } catch { /* already gone */ } }
}

/**
 * The same limits, counted in a file shared by every gateway on this machine that uses the same ledger (gap H15). One line a call: when, requests in all, requests per host.
 * Used with a key per Mandate (the copies of one agent under one job share one allowance) and a key per person (the whole fleet shares one). It cannot see another machine:
 * a person's agents on two machines each have their own count until the service counts them (left in H15).
 */
export class SharedRateLimiter implements Limiter {
  private ledger: string;
  private now: () => number;

  constructor(ledger: string, now: () => number = Date.now) {
    this.ledger = ledger;
    this.now = now;
    mkdirSync(dirname(ledger), { recursive: true });
  }

  take(req: readonly string[] | RequestCounts, rate: NetworkRate, who?: string): RateVerdict {
    const counts = countsOf(req);
    const t = this.now();
    return withLock(this.ledger, () => {
      const recent: { t: number; total?: number; perHost?: Record<string, number> }[] = [];
      let lines = 0;
      if (existsSync(this.ledger)) {
        for (const line of readFileSync(this.ledger, "utf8").split("\n")) {
          if (!line) continue;
          lines++;
          try { const e = JSON.parse(line); if (e.t > t - RATE_WINDOW_MS) recent.push(e); } catch { /* a half-written line is not a call yet */ }
        }
      }
      const made = recent.reduce((n, e) => n + (e.total ?? 1), 0);
      const v = verdict(made, (h) => recent.reduce((k, e) => k + (e.perHost?.[h] ?? 0), 0), counts, rate, who);
      if (!v.ok) return v;
      // Keep the file short: when most of it is older than the window, rewrite it with what is still live.
      if (lines > 200 && recent.length < lines / 2) {
        const part = `${this.ledger}.part`;
        writeFileSync(part, recent.map((e) => JSON.stringify(e)).join("\n") + "\n");
        renameSync(part, this.ledger);
      }
      appendFileSync(this.ledger, JSON.stringify({ t, perHost: counts.perHost, total: counts.total }) + "\n");
      return { ok: true };
    });
  }
}
