/**
 * Which agent identities (DIDs) a tenant has written records as, kept at the service (blocker 1: account export and deletion). The service learns it as records are
 * accepted: the signer of each record a tenant appends or imports. It is what lets an export say "these are your agents' records, packages and commons entries" and a
 * closing account delete the right commons documents. It is a service-side record of who wrote what, not a claim about who owns a DID; the DIDs themselves belong to whoever holds their keys.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const MAX_PER_TENANT = 1000;

export class OwnerStore {
  private data: Record<string, string[]> = {};
  private path: string | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(path?: string) {
    this.path = path;
    if (path && existsSync(path)) { try { this.data = JSON.parse(readFileSync(path, "utf8")); } catch { /* start again from nothing */ } }
  }

  of(tenant: string): string[] { return [...(this.data[tenant] ?? [])]; }
  all(): Record<string, string[]> { return JSON.parse(JSON.stringify(this.data)); }

  add(tenant: string, dids: readonly string[]): void {
    const have = this.data[tenant] ?? [];
    let changed = false;
    for (const d of dids) if (typeof d === "string" && !have.includes(d) && have.length < MAX_PER_TENANT) { have.push(d); changed = true; }
    if (changed) { this.data[tenant] = have; this.save(); }
  }

  remove(tenant: string): void { if (this.data[tenant]) { delete this.data[tenant]; this.flush(); } }

  private save(): void {
    if (!this.path || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 500);
    this.timer.unref?.();
  }
  flush(): void {
    if (!this.path) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
}
