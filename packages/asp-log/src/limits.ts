/**
 * Limits for the log service (gaps O1, O2): what one tenant, and one network address, may ask of it.
 *
 *  - a token bucket per tenant for all requests, and a second, smaller one for writes (append, import), so a runaway agent cannot flood the log;
 *  - a cap on requests in flight per tenant;
 *  - a lockout per address after repeated failed sign-ins, so a token cannot be guessed at speed;
 *  - an overall bucket per address, which also covers requests that never authenticate.
 *
 * All in memory and per process: a service run as several processes limits each one separately. Idle entries are swept, so memory follows the active
 * tenants and addresses, not every address ever seen.
 */

export interface LimitOptions {
  /** Requests a tenant may make per minute (default 600; 0 turns the limit off). A tenant's own `rateLimitPerMinute` overrides it. */
  tenantPerMinute?: number;
  /** Writes (append, import) a tenant may make per minute (default 120; 0 off). */
  appendPerMinute?: number;
  /** Requests one tenant may have in flight at once (default 16; 0 off). */
  maxInFlight?: number;
  /** Requests one address may make per minute, signed in or not (default 1200; 0 off). */
  addressPerMinute?: number;
  /** Failed sign-ins from one address within the window before it is locked out (default 10; 0 off). */
  failedAuthMax?: number;
  /** The window, and the length of the lockout, in seconds (default 300). */
  failedAuthWindowSec?: number;
  /** Only for tests: the clock. */
  now?: () => number;
}

export interface Verdict { ok: boolean; retryAfterSec?: number; why?: string }
const OK: Verdict = { ok: true };

class Bucket {
  private tokens: number;
  private last: number;
  private perMinute: number;
  private burst: number;
  constructor(perMinute: number, burst: number, now: number) { this.perMinute = perMinute; this.burst = burst; this.tokens = burst; this.last = now; }
  take(now: number): Verdict {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 60_000) * this.perMinute);
    this.last = now;
    if (this.tokens >= 1) { this.tokens -= 1; return OK; }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - this.tokens) / this.perMinute) * 60)) };
  }
  idleSince(now: number): number { return now - this.last; }
}

export class Limits {
  private o: Required<Omit<LimitOptions, "now">>;
  private now: () => number;
  private tenant = new Map<string, Bucket>();
  private append = new Map<string, Bucket>();
  private address = new Map<string, Bucket>();
  private inFlight = new Map<string, number>();
  private failures = new Map<string, { times: number[]; lockedUntil: number }>();
  private ops = 0;

  constructor(o: LimitOptions = {}) {
    this.o = {
      tenantPerMinute: o.tenantPerMinute ?? 600, appendPerMinute: o.appendPerMinute ?? 120, maxInFlight: o.maxInFlight ?? 16,
      addressPerMinute: o.addressPerMinute ?? 1200, failedAuthMax: o.failedAuthMax ?? 10, failedAuthWindowSec: o.failedAuthWindowSec ?? 300,
    };
    this.now = o.now ?? Date.now;
  }

  private bucket(map: Map<string, Bucket>, key: string, perMinute: number): Bucket {
    let b = map.get(key);
    if (!b) { b = new Bucket(perMinute, Math.max(1, Math.ceil(perMinute / 4)), this.now()); map.set(key, b); }
    return b;
  }

  private sweep(): void {
    if (++this.ops % 500 !== 0) return;
    const t = this.now();
    for (const m of [this.tenant, this.append, this.address]) for (const [k, b] of m) if (b.idleSince(t) > 10 * 60_000) m.delete(k);
    for (const [k, f] of this.failures) if (f.lockedUntil < t && (f.times.at(-1) ?? 0) < t - this.o.failedAuthWindowSec * 1000) this.failures.delete(k);
  }

  /** Before anything else: an address that is locked out, or is asking too much. */
  checkAddress(address: string): Verdict {
    this.sweep();
    const t = this.now();
    const f = this.failures.get(address);
    if (f && f.lockedUntil > t) return { ok: false, retryAfterSec: Math.ceil((f.lockedUntil - t) / 1000), why: "too many failed sign-ins from this address" };
    if (this.o.addressPerMinute > 0) {
      const v = this.bucket(this.address, address, this.o.addressPerMinute).take(t);
      if (!v.ok) return { ...v, why: "too many requests from this address" };
    }
    return OK;
  }

  /** A request carried no valid token. After `failedAuthMax` of them inside the window, the address is locked out for the window. */
  authFailed(address: string): void {
    if (this.o.failedAuthMax <= 0) return;
    const t = this.now();
    const f = this.failures.get(address) ?? { times: [], lockedUntil: 0 };
    f.times = [...f.times.filter((x) => x > t - this.o.failedAuthWindowSec * 1000), t];
    if (f.times.length >= this.o.failedAuthMax) { f.lockedUntil = t + this.o.failedAuthWindowSec * 1000; f.times = []; }
    this.failures.set(address, f);
  }

  /** A signed-in tenant's request. `perMinute` is the tenant's own limit, when it has one. */
  checkTenant(name: string, perMinute?: number): Verdict {
    const rate = perMinute ?? this.o.tenantPerMinute;
    if (rate <= 0) return OK;
    const v = this.bucket(this.tenant, name, rate).take(this.now());
    return v.ok ? v : { ...v, why: "this tenant is making too many requests" };
  }

  /** A write (append, import) by a signed-in tenant, on top of the general check. */
  checkWrite(name: string): Verdict {
    if (this.o.appendPerMinute <= 0) return OK;
    const v = this.bucket(this.append, name, this.o.appendPerMinute).take(this.now());
    return v.ok ? v : { ...v, why: "this tenant is writing too fast" };
  }

  /** Takes a place among the tenant's in-flight requests; call the returned function when the request ends. Undefined means refused. */
  enter(name: string): (() => void) | undefined {
    const n = this.inFlight.get(name) ?? 0;
    if (this.o.maxInFlight > 0 && n >= this.o.maxInFlight) return undefined;
    this.inFlight.set(name, n + 1);
    let done = false;
    return () => { if (done) return; done = true; const m = (this.inFlight.get(name) ?? 1) - 1; if (m <= 0) this.inFlight.delete(name); else this.inFlight.set(name, m); };
  }
}

/** The address a request came from: the socket's, or with a trusted proxy in front, the first hop it reports. */
export function clientAddress(req: { socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}
