/**
 * What each tenant has written to the log (gap O2): the number of records and their size in bytes, counted at the service as they are accepted,
 * kept in a small JSON file so a restart does not forget them. A quota is checked against this before an append or import is run.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface Usage { records: number; bytes: number }

export class UsageStore {
  private data: Record<string, Usage> = {};
  private timer: NodeJS.Timeout | undefined;
  private path: string | undefined;

  /** `path` is where the counts are kept; without one they live only as long as the process. */
  constructor(path?: string) {
    this.path = path;
    if (path && existsSync(path)) {
      try { this.data = JSON.parse(readFileSync(path, "utf8")); } catch { /* an unreadable file starts again from nothing */ }
    }
  }

  get(name: string): Usage { return { ...(this.data[name] ?? { records: 0, bytes: 0 }) }; }
  all(): Record<string, Usage> { return JSON.parse(JSON.stringify(this.data)); }

  add(name: string, records: number, bytes: number): void {
    const u = this.data[name] ?? { records: 0, bytes: 0 };
    u.records += records; u.bytes += bytes;
    this.data[name] = u;
    this.save();
  }

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
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
}
