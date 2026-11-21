/**
 * What each tenant has written to the log (gap O2): the number of records and their size in bytes, counted at the service as they are accepted,
 * kept in a small JSON file so a restart does not forget them. A quota is checked against this before an append or import is run.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface Usage { records: number; bytes: number }
/** Reads and writes a tenant made in one UTC month (DK1474, S1416): counted by the service request layer, because a read is not in the log. */
export interface MonthUsage { reads: number; writes: number }

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
