/**
 * Identities in the tenant's own namespace (launch blocker 12, step 1). A tenant is the account; each person and agent under it is a DID. On the hosted service a tenant's DIDs
 * live under its own name on the service's domain, so an agent is tied to the account by its name and nobody can create an identity that looks like another account's:
 *
 *   person   did:web:<domain>:u:<tenant>            and further people  did:web:<domain>:u:<tenant>:<name>
 *   agent    did:web:<domain>:a:<tenant>:<name>
 *
 * The service publishes each identity's DID document at the address did:web gives it (https://<domain>/u/<tenant>/did.json, /a/<tenant>/<name>/did.json), built from the keys in
 * the identity's current passport, so anyone, another service included, can check an identity's keys against its own DID. A did:key identity is self-certifying and
 * needs no namespace; a did:web identity on any other domain is refused during the beta, because nothing proves the tenant controls that domain.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogHandle, Tenant } from "@agent-social/asp-log";

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TENANT = /^[a-z][a-z0-9-]{2,31}$/;

const enc = (domain: string) => domain.replace(/:/g, "%3A");

/** The identities a tenant may create: its person, further people, and its agents. */
export function namespaceOf(domain: string, tenant: string) {
  return { person: `did:web:${enc(domain)}:u:${tenant}`, personPrefix: `did:web:${enc(domain)}:u:${tenant}:`, agentPrefix: `did:web:${enc(domain)}:a:${tenant}:` };
}

/** Whether a DID is one this tenant may create. did:key is always allowed; did:web only inside the tenant's namespace. */
export function didAllowed(did: string, domain: string, tenant: string): boolean {
  if (did.startsWith("did:key:")) return true;
  const ns = namespaceOf(domain, tenant);
  if (did === ns.person) return true;
  const rest = did.startsWith(ns.personPrefix) ? did.slice(ns.personPrefix.length) : did.startsWith(ns.agentPrefix) ? did.slice(ns.agentPrefix.length) : undefined;
  return rest !== undefined && NAME.test(rest);
}

/** The DID a tenant's `--name` stands for: a person, or an agent. */
export function didFor(domain: string, tenant: string, kind: "human" | "agent", name?: string): string {
  const ns = namespaceOf(domain, tenant);
  if (kind === "human") return name ? ns.personPrefix + name : ns.person;
  if (!name) throw new Error("an agent needs a name");
  return ns.agentPrefix + name;
}

type Rec = { type?: string; body?: { did?: string } };
/** A write guard (see createLogServer): a non-admin tenant may register passports only for identities in its own namespace. */
export function namespaceGuard(o: { domain: string }) {
  return async (c: { tenant: Tenant; method: string; args: unknown[] }): Promise<string | undefined> => {
    if (c.tenant.role === "admin") return undefined;
    const recs: Rec[] = c.method === "importRecords" ? ((c.args[0] as { record?: Rec }[] | undefined) ?? []).map((x) => x?.record ?? {}) : c.method === "append" ? [c.args[0] as Rec] : [];
    for (const r of recs) {
      if (typeof r?.type !== "string" || !r.type.startsWith("asp.passport/")) continue;
      const did = r.body?.did;
      if (typeof did !== "string" || didAllowed(did, o.domain, c.tenant.name)) continue;
      const ns = namespaceOf(o.domain, c.tenant.name);
      return `${did} is not an identity this tenant may create: during the beta identities live in your own namespace on this service (a person: ${ns.person}, an agent: ${ns.agentPrefix}<name>), or are did:key`;
    }
    return undefined;
  };
}

/** The DID a document path stands for, or undefined: /u/<tenant>/did.json, /u/<tenant>/<name>/did.json, /a/<tenant>/<name>/did.json. */
export function didOfPath(domain: string, path: string): string | undefined {
  const m = /^\/(u|a)\/([^/]+)(?:\/([^/]+))?\/did\.json$/.exec(path);
  if (!m) return undefined;
  const [, kind, tenant, name] = m;
  if (!TENANT.test(tenant) || (name !== undefined && !NAME.test(name)) || (kind === "a" && name === undefined)) return undefined;
  return `did:web:${enc(domain)}:${kind}:${tenant}${name ? ":" + name : ""}`;
}

/** The DID document for an identity: its current passport keys as Ed25519 JWKs. */
export function didDocument(did: string, keys: { id: string; public_key: string }[]) {
  const ids = keys.map((k) => k.id);
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/jws-2020/v1"],
    id: did,
    verificationMethod: keys.map((k) => ({ id: k.id, type: "JsonWebKey2020", controller: did, publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: k.public_key } })),
    authentication: ids, assertionMethod: ids,
  };
}

/** `publicRoutes` for createLogServer: serves the DID documents of the namespace. */
export function didDocumentRoutes(o: { handle: LogHandle; domain: string }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const path = (req.url ?? "/").split("?")[0];
    if (!/^\/(u|a)\//.test(path)) return false;
    const did = didOfPath(o.domain, path);
    const send = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/did+json", "content-length": Buffer.byteLength(text), "cache-control": "public, max-age=60", ...extra });
      res.end(req.method === "HEAD" ? undefined : text);
      return true;
    };
    if (!did) return send(404, { error: "not an identity document address" });
    const p = await o.handle.log.passport(did).catch(() => undefined);
    const rec = p ? await o.handle.log.get(p.head).catch(() => undefined) : undefined;
    const keys = (rec?.record.body as { keys?: { id: string; public_key: string }[] } | undefined)?.keys;
    if (!keys) return send(404, { error: "no such identity" });
    return send(200, didDocument(did, keys));
  };
}
