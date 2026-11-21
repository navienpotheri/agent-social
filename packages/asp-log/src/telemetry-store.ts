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
export const TELEMETRY_NOTICE = "The service keeps a copy of your agent's trajectories, messages and free text in a separate store, to study how agents behave and to carry continuity. This is part of what the society gets back for the compute it spends, and it is not optional for an agent. Only a hash of each is written to the signed log, never the text. You can see what is stored (asp telemetry list) and delete it (asp telemetry delete --all); deleting removes the text and keeps the hash. Nothing is stored for a young person's tenant.";

export interface TelemetryEntry { hash: string; kind: TelemetryKind; at: string; bytes: number; did?: string; deletedAt?: string }
/** A deletion receipt (DK1378): what an erasure removed and what it kept, with an id that is the hash of its own content, so it can be shown again and checked. Not signed: the service holds no operator key. */
export interface DeletionReceipt { v: "asp.deletion-receipt/v0"; id: string; tenant: string; at: string; deleted: Array<{ hash: string; kind: TelemetryKind }>; kept: string; note: string }
interface State { entries: TelemetryEntry[]; receipts?: DeletionReceipt[] }
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

  /** Stores content for a tenant, unless the tenant is held for a young person (collection is not optional for an adult, DK1303). Returns the hash the signed log may carry. */
  put(tenant: string, kind: unknown, content: unknown, o: { minor?: boolean; did?: string; at: string }): PutResult {
    if (o.minor) return { ok: false, status: 403, code: "minor_tenant_no_telemetry", message: "this tenant is held for a young person: nothing is stored for it" };
    if (!TELEMETRY_KINDS.includes(kind as TelemetryKind)) return { ok: false, status: 400, code: "BAD_KIND", message: `kind is one of ${TELEMETRY_KINDS.join(", ")}` };
    if (typeof content !== "string" || !content) return { ok: false, status: 400, code: "BAD_CONTENT", message: "content is a non-empty string" };
    if (Buffer.byteLength(content) > TELEMETRY_MAX_ITEM_BYTES) return { ok: false, status: 413, code: "TOO_BIG", message: `one item is at most ${TELEMETRY_MAX_ITEM_BYTES} bytes` };
    const s = this.slot(tenant);
    const hash = telemetryHash(content);
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
  /** Deletes what the hashes name (all of the tenant's text when none are named) and issues a receipt of it, kept with the tenant so it can be read again. No receipt when nothing was deleted. */
  deleteWithReceipt(tenant: string, at: string, hashes?: string[]): { deleted: number; receipt?: DeletionReceipt } {
    const slot = this.slot(tenant);
    const targets = (hashes ?? slot.state.entries.filter((e) => !e.deletedAt).map((e) => e.hash));
    const gone: Array<{ hash: string; kind: TelemetryKind }> = [];
    for (const h of targets) { const e = slot.state.entries.find((x) => x.hash === h); if (e && !e.deletedAt && this.delete(tenant, h, at)) gone.push({ hash: h, kind: e.kind }); }
    if (!gone.length) return { deleted: 0 };
    const body = { v: "asp.deletion-receipt/v0" as const, tenant, at, deleted: gone, kept: "for each item the hash, the kind and the date it was deleted, and nothing else; the signed log's records stay, as the log is append-only", note: "The text was removed from the telemetry store. A copy in a backup clears within 35 days." };
    const receipt: DeletionReceipt = { ...body, id: `sha256:${createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex")}` };
    const st = this.slot(tenant);
    st.state.receipts = [...(st.state.receipts ?? []), receipt];
    this.save(tenant, st);
    return { deleted: gone.length, receipt };
  }
  receipts(tenant: string): DeletionReceipt[] { return [...(this.slot(tenant).state.receipts ?? [])]; }
  deleteAll(tenant: string, at: string): number {
    let n = 0;
    for (const e of this.slot(tenant).state.entries) if (!e.deletedAt && this.delete(tenant, e.hash, at)) n++;
    return n;
  }
}
