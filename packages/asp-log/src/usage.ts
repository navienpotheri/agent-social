/**
 * What each tenant has written to the log (gap O2): the number of records and their size in bytes, counted at the service as they are accepted,
 * kept in a small JSON file so a restart does not forget them. A quota is checked against this before an append or import is run.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface Usage { records: number; bytes: number }
/** Reads and writes a tenant made in one UTC month (DK1474, S1416): counted by the service request layer, because a read is not in the log. */
export interface MonthUsage { reads: number; writes: number }

/**
 * What the log holds for each tenant: every record counted to the tenant that owns its issuer (the owner store lists the identities a tenant wrote as), with its size as the service counts it (the JSON of the
 * record). Records whose issuer no tenant owns are counted to nobody. Reads the log in pages, so it does not hold it in memory.
 */
export async function usageFromLog(since: (after: number, limit: number) => Promise<{ seq: number; record: unknown & { issuer?: string } }[]>, owners: Record<string, string[]>): Promise<Record<string, Usage>> {
  const tenantOf = new Map<string, string>();
  for (const [tenant, dids] of Object.entries(owners)) for (const d of dids) if (!tenantOf.has(d)) tenantOf.set(d, tenant);
  const out: Record<string, Usage> = {};
  for (let after = 0; ; ) {
    const page = await since(after, 500);
    if (!page.length) break;
    for (const r of page) {
      after = r.seq;
      const tenant = tenantOf.get((r.record as { issuer?: string }).issuer ?? "");
      if (!tenant) continue;
      const u = (out[tenant] ??= { records: 0, bytes: 0 });
      u.records++; u.bytes += JSON.stringify(r.record).length;
    }
  }
  return out;
}

export class UsageStore {
  private data: Record<string, Usage> = {};
  private months: Record<string, Record<string, MonthUsage>> = {};
  private timer: NodeJS.Timeout | undefined;
  private path: string | undefined;

  /** `path` is where the counts are kept; without one they live only as long as the process. */
  constructor(path?: string) {
    this.path = path;
    if (path && existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        this.months = (raw.__months as typeof this.months | undefined) ?? {};
        delete raw.__months;
        this.data = raw as Record<string, Usage>;
      } catch { /* an unreadable file starts again from nothing */ }
    }
  }

  /** Counts one call by a tenant in the month of `at` (an ISO time): a read or a write. */
  call(name: string, kind: "read" | "write", at: string): void {
    const m = at.slice(0, 7);
    const t = (this.months[name] ??= {});
    const u = (t[m] ??= { reads: 0, writes: 0 });
    if (kind === "read") u.reads++; else u.writes++;
    this.save();
  }
  /** The reads and writes a tenant made in a UTC month (zero when none). */
  month(name: string, month: string): MonthUsage { return { ...(this.months[name]?.[month] ?? { reads: 0, writes: 0 }) }; }
  allMonth(month: string): Record<string, MonthUsage> { const out: Record<string, MonthUsage> = {}; for (const [n, t] of Object.entries(this.months)) if (t[month]) out[n] = { ...t[month] }; return out; }

  get(name: string): Usage { return { ...(this.data[name] ?? { records: 0, bytes: 0 }) }; }
  all(): Record<string, Usage> { return JSON.parse(JSON.stringify(this.data)); }

  add(name: string, records: number, bytes: number): void {
    const u = this.data[name] ?? { records: 0, bytes: 0 };
    u.records += records; u.bytes += bytes;
    this.data[name] = u;
    this.save();
  }

  /**
   * Raises each tenant's counts to what the log itself holds for it (gap O17): the records whose issuer is an identity the tenant wrote as, and their size. The counts never go down: a tenant that wrote records
   * the log cannot attribute to it (an identity it no longer holds) keeps what the service counted. Returns how many tenants were raised. Called once when the service starts, so a lost or fresh usage file, or
   * records that were in the log before the service counted, do not give a tenant a quota it has already used.
   */
  reconcile(fromLog: Record<string, Usage>): number {
    let raised = 0;
    for (const [name, found] of Object.entries(fromLog)) {
      const u = this.data[name] ?? { records: 0, bytes: 0 };
      const records = Math.max(u.records, found.records), bytes = Math.max(u.bytes, found.bytes);
      if (records !== u.records || bytes !== u.bytes) { this.data[name] = { records, bytes }; raised++; }
    }
    if (raised) this.flush();
    return raised;
  }

  /** Forgets a tenant's counts (its account closed). */
  remove(name: string): void { if (this.data[name] || this.months[name]) { delete this.data[name]; delete this.months[name]; this.flush(); } }

  private save(): void {
    if (!this.path || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 1000);
    this.timer.unref?.();
  }

  /** Writes the counts now (the service calls this when it closes). */
  flush(): void {
    if (!this.path) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify({ ...this.data, ...(Object.keys(this.months).length ? { __months: this.months } : {}) }, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
}
