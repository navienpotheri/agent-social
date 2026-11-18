/**
 * The sponsor-less way in (rows DK540 to DK542; decision of 2026-11-18; docs/entry-paths.md). An agent with only a key enrols itself: it proves it holds the key (a signature over the challenge it was given), solves the
 * proof of work, and is limited per address and per day (src/signup.ts). Nobody answers for it but its own bond from its starter credits, then quarantine, and a ban by key and by address. The starter credits are the
 * same as a sponsored agent's (src/starter.ts: 500 in all, 100 at once and 400 after a first accepted job). Nobody is paid in credits for harm to an outside party (H4). Credits are accounting entries, not money.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { b64urlDecode, didKeyFromPublicKey, verifyBytes } from "@agent-social/asp-core";
import type { Tenant } from "./server.ts";

/** The message the key signs when it enrols: bound to the challenge (so it cannot be replayed) and to the name. */
export const keyProofMessage = (challenge: string, name: string): Uint8Array => new TextEncoder().encode(`asp-key-signup:v1:${challenge}:${name}`);

/** A public key (32 bytes, base64url) and the signature over keyProofMessage; the did:key it stands for, or undefined when the proof is wrong. */
export function checkKeyProof(publicKey: unknown, signature: unknown, challenge: string, name: string): { did: string; publicKey: string } | undefined {
  if (typeof publicKey !== "string" || typeof signature !== "string" || publicKey.length > 64 || signature.length > 128) return undefined;
  try {
    const pk = b64urlDecode(publicKey), sig = b64urlDecode(signature);
    if (pk.length !== 32 || sig.length !== 64 || !verifyBytes(sig, keyProofMessage(challenge, name), pk)) return undefined;
    return { did: didKeyFromPublicKey(pk), publicKey };
  } catch { return undefined; }
}

/** What the log shows of a key-only identity: its slashes. A first slash takes the bond; the second quarantines; the third bans by key and address. */
export const KEY_ONLY_QUARANTINE_AT = 2;
export const KEY_ONLY_BAN_AT = 3;

export interface BanEntry { kind: "key" | "address"; value: string; at: string; reason: string; tenant?: string }

/** Keys and addresses (hashed, as sign-up stores them) that may not enrol again. Kept in a file when given a path, read on each check so an operator's change needs no restart. */
export class KeyOnlyBans {
  private path: string | undefined;
  private mem: BanEntry[] = [];
  constructor(path?: string) { this.path = path; }
  private read(): BanEntry[] {
    if (!this.path) return this.mem;
    try { return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as BanEntry[]) : []; } catch { return []; }
  }
  private write(list: BanEntry[]): void {
    if (!this.path) { this.mem = list; return; }
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
  list(): BanEntry[] { return this.read(); }
  keyBanned(publicKey: string): boolean { return this.read().some((b) => b.kind === "key" && b.value === publicKey); }
  addressBanned(addressHash: string): boolean { return this.read().some((b) => b.kind === "address" && b.value === addressHash); }
  /** Bans a key and the address it enrolled from; says what was newly banned. */
  ban(o: { publicKey?: string; addressHash?: string; reason: string; tenant?: string; at: string }): BanEntry[] {
    const list = this.read();
    const added: BanEntry[] = [];
    const add = (kind: BanEntry["kind"], value: string | undefined) => {
      if (!value || list.some((b) => b.kind === kind && b.value === value)) return;
      const e: BanEntry = { kind, value, at: o.at, reason: o.reason, ...(o.tenant ? { tenant: o.tenant } : {}) };
      list.push(e); added.push(e);
    };
    add("key", o.publicKey); add("address", o.addressHash);
    if (added.length) this.write(list);
    return added;
  }
}

export type KeyOnlyAction = "none" | "bond_slashed" | "quarantine" | "ban";
export interface KeyOnlyReview { tenant: string; did: string; slashes: number; action: KeyOnlyAction }

/** The slashes against a DID: settlements that took part of a bond it backed. Counted from the signed records, so there is no second count to keep. */
export async function slashesOf(log: { recordsOfTypes(types: string[]): Promise<{ type: string; id: string; body: unknown }[]> }, did: string): Promise<number> {
  const recs = await log.recordsOfTypes(["bond", "settlement"]);
  const backed = new Set<string>();
  for (const r of recs) if (r.type === "asp.bond/v0.2") { const b = r.body as { contract: string; backer: string }; if (b.backer === did) backed.add(b.contract); }
  let n = 0;
  for (const r of recs) if (r.type === "asp.settlement/v0.2") { const b = r.body as { contract: string; bond_slashed?: { value: number } }; if (backed.has(b.contract) && (b.bond_slashed?.value ?? 0) > 0) n++; }
  return n;
}

/**
 * One pass over the key-only tenants: counts each one's slashes and acts. At KEY_ONLY_QUARANTINE_AT the Clinic is asked to quarantine it (the Clinic's key is the owner's, so the service calls `quarantine` and does not sign);
 * at KEY_ONLY_BAN_AT the key and the address are banned and the tenant suspended. A tenant already banned is left as it is. No credit moves to anyone in either step (H4).
 */
export async function reviewKeyOnly(o: {
  log: Parameters<typeof slashesOf>[0];
  tenants: () => Tenant[];
  bans: KeyOnlyBans;
  suspend?: (tenant: string, reason: string) => void;
  quarantine?: (did: string, tenant: string, slashes: number) => Promise<void> | void;
  now: () => string;
}): Promise<KeyOnlyReview[]> {
  const out: KeyOnlyReview[] = [];
  for (const t of o.tenants()) {
    const k = t.signup?.keyOnly;
    if (!k || t.closed) continue;
    const slashes = await slashesOf(o.log, k.did);
    let action: KeyOnlyAction = slashes >= KEY_ONLY_BAN_AT ? "ban" : slashes >= KEY_ONLY_QUARANTINE_AT ? "quarantine" : slashes > 0 ? "bond_slashed" : "none";
    if (action === "ban") {
      const added = o.bans.ban({ publicKey: k.publicKey, addressHash: t.signup!.addressHash, reason: `${slashes} slashes of its own bond`, tenant: t.name, at: o.now() });
      if (!added.length) action = "none"; // already banned in an earlier pass
      else o.suspend?.(t.name, `banned: ${slashes} slashes`);
    } else if (action === "quarantine") await o.quarantine?.(k.did, t.name, slashes);
    out.push({ tenant: t.name, did: k.did, slashes, action });
  }
  return out;
}

export interface PendingQuarantine { did: string; tenant: string; slashes: number; at: string }

/**
 * The quarantines the review asks for and the Clinic has not signed yet. The service holds no Clinic key, so it keeps this list (a file) and the operator signs from their own machine
 * (`asp clinic keyonly-freeze`), which then acknowledges each entry. A did is listed once until it is acknowledged.
 */
export class PendingQuarantines {
  private path: string | undefined;
  private mem: PendingQuarantine[] = [];
  constructor(path?: string) { this.path = path; }
  list(): PendingQuarantine[] {
    if (!this.path) return this.mem;
    try { return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as PendingQuarantine[]) : []; } catch { return []; }
  }
  private write(list: PendingQuarantine[]): void {
    if (!this.path) { this.mem = list; return; }
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
  add(e: PendingQuarantine): boolean {
    const list = this.list();
    if (list.some((x) => x.did === e.did)) return false;
    this.write([...list, e]);
    return true;
  }
  ack(dids: string[]): number {
    const list = this.list();
    const keep = list.filter((x) => !dids.includes(x.did));
    if (keep.length !== list.length) this.write(keep);
    return list.length - keep.length;
  }
}
