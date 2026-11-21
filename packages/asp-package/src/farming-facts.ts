/**
 * What the hosted service knows about sponsors and the log does not (register row DK1472; spec-delta S1415), handed to the anti-farming report: two tenants that signed up from one address, or with one Google account,
 * hold sponsors that are one controller. The values are opaque salted hashes made here, never the address or the account id, and they never enter the log: only a signed `common_control` record the operator writes
 * after reading the report does, and it names the basis (`address`, `account`), not the value. A sponsor belongs to a tenant by its DID (did:web:<domain>:u:<tenant>[:name] or ...:a:<tenant>:<name>).
 */
import { createHash } from "node:crypto";
import type { ExternalFacts, Tenant } from "@agent-social/asp-log";

const enc = (domain: string) => domain.replace(/:/g, "%3A");

/** The tenant a DID lives under on this service, or undefined (a did:key or another domain). */
export function tenantOfDid(did: string, domain: string): string | undefined {
  const m = new RegExp(`^did:web:${enc(domain).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(?:u|a):([a-z][a-z0-9-]{2,31})(?::|$)`).exec(did);
  return m?.[1];
}

const salted = (salt: string, kind: string, v: string): string => createHash("sha256").update(`${salt}|${kind}|${v}`).digest("hex").slice(0, 32);

/**
 * Facts per sponsor DID. Only tenants that share a value are interesting, but every sponsor of a tenant is listed so the detector can join them. A tenant without a signup record (an old token) contributes nothing.
 * `salt` is a secret of the service (it never leaves it), so the values cannot be matched against another service's.
 */
export function serviceFarmingFacts(tenants: Tenant[], domain: string, sponsors: string[], salt: string): ExternalFacts {
  const byName = new Map(tenants.map((t) => [t.name, t]));
  const out: ExternalFacts & { account?: Record<string, string> } = { address: {}, account: {} };
  for (const did of sponsors) {
    const name = tenantOfDid(did, domain);
    const t = name ? byName.get(name) : undefined;
    const s = (t as { signup?: { addressHash?: string; google?: { sub?: string } } } | undefined)?.signup;
    if (!s) continue;
    if (s.addressHash) out.address![did] = salted(salt, "address", s.addressHash);
    if (s.google?.sub) out.account![did] = salted(salt, "account", s.google.sub);
  }
  return out;
}
