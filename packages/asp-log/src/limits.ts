/**
 * Limits for the log service (gaps O1, O2): what one tenant, and one network address, may ask of it.
 *
 *  - a token bucket per tenant for all requests, and a second, smaller one for writes (append, import), so a runaway agent cannot flood the log;
 *  - a cap on requests in flight per tenant;
 *  - a lockout per address after repeated failed sign-ins, so a token cannot be guessed at speed;
 *  - an overall bucket per address, which also covers requests that never authenticate.
 *
 * Buckets are in memory and per process: a service run as several processes limits each one separately. Idle entries are swept, so memory follows the active
 * tenants and addresses, not every address ever seen.
 *
 * The lockout after failed sign-ins is the exception (gaps O2, O19): it is what stops a token being guessed at speed, so with `stateFile` set it is kept in a file that every process
 * on the machine reads and writes under a lock, and it survives a restart. Addresses are stored only as a salted hash (a random salt kept beside the file), so the file holds no
 * address. It is written only when a sign-in fails, which an honest client rarely does; it cannot be shared with another machine (that needs the database, left in O2).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
  /** A file that keeps the failed-sign-in lockouts across restarts and shares them between the processes of one service on a machine (default none: in memory, per process). */
  stateFile?: string;
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

/** Runs fn with the state file locked: a folder is made next to it, which only one process can do at a time; a lock older than five seconds is a crashed process's and is taken over. */
function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const deadline = Date.now() + 3000;
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") break;
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() > deadline) break;
      sleep(5 + Math.floor(Math.random() * 15));
    }
  }
  try { return fn(); } finally { try { rmSync(lock, { recursive: true, force: true }); } catch { /* already gone */ } }
}

/** Failure records kept at most this many, newest first, so a flood of addresses cannot grow the file for ever. */
const MAX_STATE_ENTRIES = 5000;
type Failure = { times: number[]; lockedUntil: number };

export class Limits {
  private o: Required<Omit<LimitOptions, "now" | "stateFile">>;
  private stateFile?: string;
  private salt = "";
  private stamp = "";
  private now: () => number;
  private tenant = new Map<string, Bucket>();
  private append = new Map<string, Bucket>();
  private address = new Map<string, Bucket>();
  private inFlight = new Map<string, number>();
  private failures = new Map<string, Failure>();
  private ops = 0;

  constructor(o: LimitOptions = {}) {
    this.o = {
      tenantPerMinute: o.tenantPerMinute ?? 600, appendPerMinute: o.appendPerMinute ?? 120, maxInFlight: o.maxInFlight ?? 16,
      addressPerMinute: o.addressPerMinute ?? 1200, failedAuthMax: o.failedAuthMax ?? 10, failedAuthWindowSec: o.failedAuthWindowSec ?? 300,
    };
    this.now = o.now ?? Date.now;
    if (o.stateFile) {
      this.stateFile = o.stateFile;
      mkdirSync(dirname(o.stateFile), { recursive: true });
      const saltFile = `${o.stateFile}.salt`;
      if (!existsSync(saltFile)) { try { writeFileSync(saltFile, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" }); } catch { /* another process made it first */ } }
      this.salt = readFileSync(saltFile, "utf8").trim();
      this.syncIn();
    }
  }

  /** How an address is named in the failure records: itself in memory, a salted hash when they are kept in a file. */
  private key(address: string): string { return this.stateFile ? createHash("sha256").update(`${this.salt}:${address}`).digest("hex").slice(0, 32) : address; }

  /** Takes in what other processes (or an earlier run) wrote. Cheap when the file has not changed. */
  private syncIn(): void {
    if (!this.stateFile) return;
    let st;
    try { st = statSync(this.stateFile); } catch { return; }
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (stamp === this.stamp) return;
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, "utf8")) as { failures?: Record<string, Failure> };
      // The file is the record: every process writes it under a lock after reading it, so what is in it already holds what this process wrote. (Merging by value would count two failures in the same millisecond as one.)
      this.failures = new Map(Object.entries(saved.failures ?? {}));
      this.stamp = stamp;
    } catch { /* a half-written or damaged file is ignored; the next write replaces it */ }
  }

  /** Writes the failures that still matter, whole, under a temporary name. */
  private syncOut(): void {
    if (!this.stateFile) return;
    const t = this.now();
    const live = [...this.failures].filter(([, f]) => f.lockedUntil > t || (f.times.at(-1) ?? 0) > t - this.o.failedAuthWindowSec * 1000)
      .sort((a, b) => Math.max(b[1].lockedUntil, b[1].times.at(-1) ?? 0) - Math.max(a[1].lockedUntil, a[1].times.at(-1) ?? 0)).slice(0, MAX_STATE_ENTRIES);
    this.failures = new Map(live);
    try {
      const part = `${this.stateFile}.${process.pid}.part`;
      writeFileSync(part, JSON.stringify({ failures: Object.fromEntries(live) }), { mode: 0o600 });
      renameSync(part, this.stateFile);
      const st = statSync(this.stateFile); this.stamp = `${st.mtimeMs}:${st.size}`;
    } catch { /* an unwritable state file must not stop the service: the lockout still holds in memory */ }
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
    this.syncIn();
    const t = this.now();
    const f = this.failures.get(this.key(address));
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
    const record = () => {
      this.syncIn();
      const t = this.now();
      const k = this.key(address);
      const f = this.failures.get(k) ?? { times: [], lockedUntil: 0 };
      f.times = [...f.times.filter((x) => x > t - this.o.failedAuthWindowSec * 1000), t];
      if (f.times.length >= this.o.failedAuthMax) { f.lockedUntil = t + this.o.failedAuthWindowSec * 1000; f.times = []; }
      this.failures.set(k, f);
      this.syncOut();
    };
    if (this.stateFile) { try { withLock(this.stateFile, record); } catch { /* an unwritable state file must not stop the service: the lockout still holds in memory */ } } else record();
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
