/**
 * The telemetry content store (owner answer TM1, 2026-11-19; row DK651). Trajectories, messages and free text an agent produces are kept here, in a store of their own, never in the signed log. The log carries
 * only the hash (`sha256:<hex>` of the content), so a record can point at content that may later be deleted. It is ON by default and a tenant turns it off in one step; deleting content removes the text and keeps the
 * hash (and when and what kind), so a signed record that cites it still verifies as "deleted", not as "forged". Nothing is stored for a tenant held for a young person. Credits and standing never depend on it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TelemetryKind = "trajectory" | "message" | "text";
export const TELEMETRY_KINDS: readonly TelemetryKind[] = ["trajectory", "message", "text"];
export const TELEMETRY_MAX_ITEM_BYTES = 256 * 1024;
export const TELEMETRY_MAX_ITEMS = 5000;

/** What a person is told, in plain words, wherever they join or look at their account. */
export const TELEMETRY_NOTICE = "By default the service keeps a copy of your agent's trajectories, messages and free text in a separate store, to study how agents behave. Only a hash of each is written to the signed log, never the text. You can turn this off in one step (asp telemetry off) and delete what is stored (asp telemetry delete --all); deleting removes the text and keeps the hash. Nothing is stored for a young person's tenant.";

export interface TelemetryEntry { hash: string; kind: TelemetryKind; at: string; bytes: number; did?: string; deletedAt?: string }
interface State { optedOut?: { at: string }; entries: TelemetryEntry[] }
export type PutResult = { ok: true; hash: string; stored: boolean } | { ok: false; status: number; code: string; message: string };

const TENANT = /^[a-z][a-z0-9-]{2,31}$/;
export const telemetryHash = (content: string) => `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

export class TelemetryStore {
  private dir: string | undefined;
  private mem = new Map<string, { state: State; content: Map<string, string> }>();
  constructor(dir?: string) { this.dir = dir; }

  private slot(tenant: string): { state: State; content: Map<string, string> } {
    if (!TENANT.test(tenant)) throw new Error("not a tenant name");
    if (this.dir) {
      const f = join(this.dir, tenant, "state.json");
      let state: State = { entries: [] };
      try { if (existsSync(f)) state = JSON.parse(readFileSync(f, "utf8")); } catch { /* start empty */ }
      return { state, content: new Map() };
    }
    let m = this.mem.get(tenant);
    if (!m) { m = { state: { entries: [] }, content: new Map() }; this.mem.set(tenant, m); }
    return m;
  }
  private save(tenant: string, s: { state: State }): void {
    if (!this.dir) return;
    const d = join(this.dir, tenant);
    mkdirSync(join(d, "content"), { recursive: true });
    const tmp = join(d, `state.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(s.state, null, 2) + "\n");
    renameSync(tmp, join(d, "state.json"));
  }
  private file(tenant: string, hash: string) { return join(this.dir!, tenant, "content", `${hash.slice("sha256:".length)}.txt`); }

  /** Whether the tenant has turned collection off. */
  optedOut(tenant: string): boolean { return !!this.slot(tenant).state.optedOut; }
  /** Turns collection off (and, if asked, deletes what is stored) or back on. One step each. */
  setOptOut(tenant: string, off: boolean, at: string, alsoDelete = false): { deleted: number } {
    const s = this.slot(tenant);
    if (off) s.state.optedOut = { at }; else delete s.state.optedOut;
    this.save(tenant, s);
    return { deleted: off && alsoDelete ? this.deleteAll(tenant, at) : 0 };
  }

  /** Stores content for a tenant, unless it opted out or is held for a young person. Returns the hash the signed log may carry. */
  put(tenant: string, kind: unknown, content: unknown, o: { minor?: boolean; did?: string; at: string }): PutResult {
    if (o.minor) return { ok: false, status: 403, code: "minor_tenant_no_telemetry", message: "this tenant is held for a young person: nothing is stored for it" };
    if (!TELEMETRY_KINDS.includes(kind as TelemetryKind)) return { ok: false, status: 400, code: "BAD_KIND", message: `kind is one of ${TELEMETRY_KINDS.join(", ")}` };
    if (typeof content !== "string" || !content) return { ok: false, status: 400, code: "BAD_CONTENT", message: "content is a non-empty string" };
    if (Buffer.byteLength(content) > TELEMETRY_MAX_ITEM_BYTES) return { ok: false, status: 413, code: "TOO_BIG", message: `one item is at most ${TELEMETRY_MAX_ITEM_BYTES} bytes` };
    const s = this.slot(tenant);
    const hash = telemetryHash(content);
    if (s.state.optedOut) return { ok: false, status: 409, code: "TELEMETRY_OFF", message: `this tenant turned telemetry off; nothing was stored (the hash is still yours to use: ${hash})` };
    const known = s.state.entries.find((e) => e.hash === hash);
    if (known && !known.deletedAt) return { ok: true, hash, stored: false };
    if (!known && s.state.entries.length >= TELEMETRY_MAX_ITEMS) return { ok: false, status: 429, code: "STORE_FULL", message: `at most ${TELEMETRY_MAX_ITEMS} items are kept for a tenant` };
    if (known) delete known.deletedAt;
    else s.state.entries.push({ hash, kind: kind as TelemetryKind, at: o.at, bytes: Buffer.byteLength(content), ...(o.did ? { did: o.did } : {}) });
    if (this.dir) { mkdirSync(join(this.dir, tenant, "content"), { recursive: true }); writeFileSync(this.file(tenant, hash), content); } else s.content.set(hash, content);
    this.save(tenant, s);
    return { ok: true, hash, stored: true };
  }

  /** The content, or the entry alone when it was deleted (the hash is kept), or undefined when this tenant never stored it. */
  get(tenant: string, hash: string): { entry: TelemetryEntry; content?: string } | undefined {
    const s = this.slot(tenant);
    const entry = s.state.entries.find((e) => e.hash === hash);
    if (!entry) return undefined;
    if (entry.deletedAt) return { entry };
    const content = this.dir ? (existsSync(this.file(tenant, hash)) ? readFileSync(this.file(tenant, hash), "utf8") : undefined) : s.content.get(hash);
    return content !== undefined && telemetryHash(content) === hash ? { entry, content } : { entry };
  }
  list(tenant: string): TelemetryEntry[] { return this.slot(tenant).state.entries.map((e) => ({ ...e })); }

  /** Removes the content and keeps the hash, the kind and when it was deleted. */
  delete(tenant: string, hash: string, at: string): boolean {
    const s = this.slot(tenant);
    const e = s.state.entries.find((x) => x.hash === hash);
    if (!e || e.deletedAt) return false;
    e.deletedAt = at;
    if (this.dir) rmSync(this.file(tenant, hash), { force: true }); else s.content.delete(hash);
    this.save(tenant, s);
    return true;
  }
  deleteAll(tenant: string, at: string): number {
    let n = 0;
    for (const e of this.slot(tenant).state.entries) if (!e.deletedAt && this.delete(tenant, e.hash, at)) n++;
    return n;
  }
}
