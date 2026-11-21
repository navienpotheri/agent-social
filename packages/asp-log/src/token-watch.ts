/**
 * Use-anomaly detection for tenant tokens (register row DK1717; spec-delta S1425): a token that is used from a place or at a rate far from its own history raises a flag, an alert to the sponsor and, for the writes it would make, a HELD state.
 * Nothing here stores an address: the history holds salted hashes of address RANGES (a /24 for IPv4, a /48 for IPv6), the salt is the service's secret, and the hashes cannot be matched against another service's. The rules:
 *  - a NEW RANGE for a token that has an established history is "quiet" (an ordinary new network: reads go on, writes wait for the sponsor's confirmation code or for a stated time) or, with a BURST from that range (many requests in five
 *    minutes, far above the tenant's own median), "stolen_pattern" (writes are held until the sponsor confirms with the code; no timeout);
 *  - a RATE SPIKE from a known range (an hour of requests far above the median) is also held until confirmed;
 *  - a record signed by an identity that another tenant owns is flagged `foreign_key_use` (an agent key in the wrong hands), an alert and no hold.
 * The sponsor gets the confirmation code out of band (the service's mail); a thief with the token has no way to read it. Revoke and rotate is `asp serve reset-token`, which also forgets the history (`forget`). Pure of the network and the clock:
 * addresses and times are passed in. Credits are accounting entries, not money.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export const QUIET_HOLD_MS = 30 * 60_000;
export const MIN_RANGES_FOR_HISTORY = 2;
export const BURST_WINDOW_MS = 5 * 60_000;
export const BURST_MIN = 30;
export const BURST_FACTOR = 10;
export const SPIKE_MIN = 300;
export const SPIKE_FACTOR = 20;
const HOUR = 3_600_000;

export type Kind = "quiet_new_range" | "stolen_pattern" | "rate_spike" | "foreign_key_use";
export interface Flag { kind: Kind; at: string; range?: string; detail: string }
export interface Held { kind: Exclude<Kind, "foreign_key_use">; since: number; codeHash: string; until?: number }
interface History { ranges: string[]; hours: Record<string, number>; recent: { at: number; range: string }[]; held?: Held; flags: Flag[]; firstSeen: number }
export interface Verdict { writesAllowed: boolean; flag?: Flag; code?: string; held?: Held }

export const rangeOf = (address: string): string => {
  if (address.includes(":") && !address.includes(".")) return address.split(":").slice(0, 3).join(":");
  const v4 = address.replace(/^::ffff:/, "").split(".");
  return v4.length === 4 ? v4.slice(0, 3).join(".") : address;
};
const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export class TokenWatch {
  private data: Record<string, History> = {};
  private readonly salt: string;
  private readonly path: string | undefined;
  constructor(o: { salt: string; path?: string }) {
    this.salt = o.salt; this.path = o.path;
    if (o.path && existsSync(o.path)) { try { this.data = JSON.parse(readFileSync(o.path, "utf8")); } catch { /* start again from nothing */ } }
  }
  private h(kind: string, v: string): string { return createHash("sha256").update(`${this.salt}|${kind}|${v}`).digest("hex").slice(0, 20); }
  private hist(tenant: string, at: number): History { return (this.data[tenant] ??= { ranges: [], hours: {}, recent: [], flags: [], firstSeen: at }); }

  /** One request by a token. `isWrite` says whether it would write; the verdict says whether writes may go on, and carries a flag (and a code for the sponsor) when something new was noticed. */
  observe(tenant: string, address: string, atMs: number, isWrite: boolean): Verdict {
    const hist = this.hist(tenant, atMs);
    const range = this.h("range", rangeOf(address));
    const hourKey = String(Math.floor(atMs / HOUR));
    if (hist.hours[hourKey] === undefined) for (const k of Object.keys(hist.hours)) if (Number(k) < Math.floor(atMs / HOUR) - 24 * 14) delete hist.hours[k];
    hist.hours[hourKey] = (hist.hours[hourKey] ?? 0) + 1;
    hist.recent.push({ at: atMs, range });
    hist.recent = hist.recent.filter((r) => r.at >= atMs - BURST_WINDOW_MS);
    const iso = new Date(atMs).toISOString();
    const typicalNow = () => median(Object.entries(hist.hours).filter(([k]) => k !== hourKey).map(([, v]) => v));
    let flag: Flag | undefined, code: string | undefined;
    const hold = (kind: Held["kind"], detail: string, until?: number) => {
      if (hist.held) return;
      code = randomBytes(5).toString("hex");
      hist.held = { kind, since: atMs, codeHash: this.h("code", code), ...(until ? { until } : {}) };
      flag = { kind, at: iso, range, detail }; hist.flags.push(flag);
    };
    if (!hist.ranges.includes(range)) {
      const established = hist.ranges.length >= MIN_RANGES_FOR_HISTORY;
      hist.ranges.push(range);
      if (established) hold("quiet_new_range", `first request from a new address range (${hist.ranges.length} known now)`, atMs + QUIET_HOLD_MS);
    }
    const fromThisRange = hist.recent.filter((r) => r.range === range).length;
    if (hist.held?.kind === "quiet_new_range" && fromThisRange >= BURST_MIN && fromThisRange >= BURST_FACTOR * Math.ceil(typicalNow() / 12)) {
      const typical = typicalNow();
      // the same new range now bursts: a quiet new network became a stolen pattern, held until confirmed
      code = randomBytes(5).toString("hex");
      hist.held = { kind: "stolen_pattern", since: atMs, codeHash: this.h("code", code) };
      flag = { kind: "stolen_pattern", at: iso, range, detail: `${fromThisRange} requests in five minutes from a new range, against a usual ${typical} an hour` }; hist.flags.push(flag);
    }
    if (!hist.held && hist.hours[hourKey] >= SPIKE_MIN) { const typical = typicalNow(); if (typical > 0 && hist.hours[hourKey] >= SPIKE_FACTOR * typical) hold("rate_spike", `${hist.hours[hourKey]} requests this hour against a usual ${typical}`); }
    const held = hist.held && (!hist.held.until || hist.held.until > atMs) ? hist.held : undefined;
    if (hist.held && hist.held.until && hist.held.until <= atMs) delete hist.held;
    if (flag) this.save();
    return { writesAllowed: !isWrite || !held, ...(flag ? { flag } : {}), ...(code ? { code } : {}), ...(held ? { held } : {}) };
  }

  /** Whether this tenant's writes may go on now (S1425): false while a hold stands; a quiet hold ends by itself after its time. Reads are never held. */
  writesAllowed(tenant: string, atMs: number): boolean {
    const h = this.data[tenant]?.held;
    if (!h) return true;
    if (h.until && h.until <= atMs) { delete this.data[tenant].held; this.save(); return true; }
    return false;
  }

  /** A record signed by an identity another tenant owns (an agent key in the wrong hands): flagged, alerted, never held (S1425). */
  noteForeignSigner(tenant: string, issuer: string, ownerTenant: string, atMs: number): Flag | undefined {
    if (ownerTenant === tenant) return undefined;
    const hist = this.hist(tenant, atMs);
    const key = this.h("foreign", `${tenant}|${issuer}`);
    if (hist.flags.some((f) => f.detail.includes(key))) return undefined;
    const flag: Flag = { kind: "foreign_key_use", at: new Date(atMs).toISOString(), detail: `a record signed by an identity of tenant ${ownerTenant} came in on this token [${key}]` };
    hist.flags.push(flag); this.save();
    return flag;
  }

  /** The sponsor's confirmation: the code that went to them lifts the hold and makes the range known. Returns whether it was right. */
  confirm(tenant: string, code: string): boolean {
    const hist = this.data[tenant];
    if (!hist?.held || this.h("code", code) !== hist.held.codeHash) return false;
    delete hist.held; this.save();
    return true;
  }
  /** Forgets a tenant's history (a token reset, the account closed). */
  forget(tenant: string): void { delete this.data[tenant]; this.save(); }
  held(tenant: string): Held | undefined { return this.data[tenant]?.held; }
  flagsOf(tenant: string): Flag[] { return [...(this.data[tenant]?.flags ?? [])]; }
  all(): Record<string, { flags: Flag[]; held: boolean; ranges: number }> { return Object.fromEntries(Object.entries(this.data).map(([n, h]) => [n, { flags: h.flags, held: !!h.held, ranges: h.ranges.length }])); }
  /** What is stored for a tenant, for the privacy test: hashes and counts, never an address. */
  raw(tenant: string): string { return JSON.stringify(this.data[tenant] ?? {}); }
  save(): void {
    if (!this.path) return;
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data) + "\n");
    renameSync(tmp, this.path);
  }
}
