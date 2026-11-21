/**
 * Organisation tenancy (DK1359, DK1373, DK1374; docs/enterprise-fleets.md): an organisation is a tenant with people in roles, single sign-on by OpenID Connect, provisioning and deprovisioning from its own
 * identity system (just-in-time at sign-in, or a SCIM-style feed), an audit trail, and a way to take that trail out. People hold a token of their own that works only on `/org/<name>/...` and is limited by their role:
 *   owner          everything, including the sign-on configuration, roles and the provisioning token
 *   administrator  members, agents of members, deprovisioning, the audit trail; may give only the roles member and auditor
 *   member         read the organisation
 *   auditor        read the organisation and the audit trail, change nothing
 * A person who is deprovisioned loses every token at once, cannot sign in again, and (unless the request says otherwise) their agents are frozen. Every act, refused or not, is in the audit trail, a hash chain.
 * Not built here: SAML, a private log with a checkpoint in the society, a key vault, and a live check with a real identity provider (docs/gaps-register.md DK1359).
 */
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { hashToken, type Tenant } from "@agent-social/asp-log";
import { AdminAudit, type AuditEntry } from "./admin-routes.ts";
import { appendCheckpoint, findEquivocations, readCheckpoints, verifyCheckpointSignature, type LogCheckpoint } from "./checkpoint.ts";
import { didOf } from "@agent-social/asp-core";

export type OrgRole = "owner" | "administrator" | "member" | "auditor";
export const ORG_ROLES: readonly OrgRole[] = ["owner", "administrator", "member", "auditor"];
export type OrgPermission = "org.read" | "members.manage" | "roles.assign" | "sso.configure" | "audit.read" | "provision" | "checkpoint.publish";

/** What each role may do; the one table every route is checked against. */
export const PERMISSIONS: Readonly<Record<OrgRole, readonly OrgPermission[]>> = {
  owner: ["org.read", "members.manage", "roles.assign", "sso.configure", "audit.read", "provision", "checkpoint.publish"],
  administrator: ["org.read", "members.manage", "audit.read", "provision", "checkpoint.publish"],
  member: ["org.read"],
  auditor: ["org.read", "audit.read"],
};
export const can = (role: OrgRole, p: OrgPermission) => PERMISSIONS[role].includes(p);

export interface OrgMember { id: string; email?: string; sub?: string; role: OrgRole; active: boolean; via: "owner" | "sso" | "scim" | "admin"; createdAt: string; deprovisionedAt?: string; tokens: { hash: string; createdAt: string; expiresAt: string }[]; agents: string[] }
export interface OidcConfig { issuer: string; audience: string; jwks: { keys: Record<string, unknown>[] }; roleClaim?: string; roleMap?: Record<string, OrgRole>; defaultRole: OrgRole; jit: boolean }
export interface Org { /** SCIM groups (DK1373): a group name and the people in it; the group maps to a role by the sign-on's roleMap or by being a role name. */ groups?: Record<string, string[]>; /** The identity whose key signs the checkpoints of the organisation's private log (DK1359). */ privateLog?: { did: string; setAt: string }; name: string; ownerTenant: string; createdAt: string; sso?: OidcConfig; scimTokenHash?: string; members: Record<string, OrgMember> }

const sha = (t: string) => hashToken(t);
const NAME = /^[a-z][a-z0-9-]{1,38}$/;
const TOKEN_DAYS = 8;

/** Verifies an OpenID Connect id_token: signature (RS256 or ES256) against the configured keys, issuer, audience and expiry. Throws with the reason. */
export function verifyIdToken(token: string, c: Pick<OidcConfig, "issuer" | "audience" | "jwks">, nowMs: number): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const dec = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try { header = dec(parts[0]); claims = dec(parts[1]); } catch { throw new Error("not a JWT"); }
  if (header.alg !== "RS256" && header.alg !== "ES256") throw new Error(`the algorithm ${String(header.alg)} is not accepted (RS256 or ES256)`);
  const jwk = c.jwks.keys.find((k) => (header.kid === undefined || k.kid === header.kid) && (k.kty === (header.alg === "RS256" ? "RSA" : "EC")));
  if (!jwk) throw new Error("no key of the identity provider matches this token");
  const key = createPublicKey({ key: jwk as never, format: "jwk" });
  const ok = cryptoVerify(header.alg === "RS256" ? "sha256" : "sha256", Buffer.from(`${parts[0]}.${parts[1]}`), header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("the signature does not verify");
  if (claims.iss !== c.issuer) throw new Error("the issuer is not the configured one");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(c.audience)) throw new Error("the audience is not this service");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) throw new Error("the token has expired");
  if (typeof claims.nbf === "number" && claims.nbf * 1000 > nowMs + 60_000) throw new Error("the token is not valid yet");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("the token has no subject");
  return claims;
}

export class OrgStore {
  private orgs: Record<string, Org> = {};
  private readonly file: string | undefined;
  constructor(file?: string) { this.file = file; if (file && existsSync(file)) { try { this.orgs = JSON.parse(readFileSync(file, "utf8")); } catch { this.orgs = {}; } } }
  get(name: string): Org | undefined { return this.orgs[name]; }
  all(): Org[] { return Object.values(this.orgs); }
  put(o: Org): void { this.orgs[o.name] = o; this.save(); }
  save(): void { if (!this.file) return; const tmp = `${this.file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(this.orgs, null, 2) + "\n", { mode: 0o600 }); renameSync(tmp, this.file); }
}

export interface OrgRoutesOptions {
  store: OrgStore;
  /** The tenants, to recognise an organisation's owner tenant by its own token. */
  tenants: () => Tenant[];
  /** Where each organisation's audit trail is kept: one hash-chained file a name. */
  auditPath: (org: string) => string;
  now: () => string;
  /** Where each organisation's witnessed checkpoints are kept (an append-only file a name). */
  checkpointPath?: (org: string) => string;
  /** The public key of a key id in the society's log (the organisation's passport), or undefined. */
  keyOf?: (kid: string) => Promise<Uint8Array | undefined>;
  /** Freezes an agent identity (the fleet controls): called for each agent of a person who is deprovisioned. Returns whether it was frozen. */
  freezeAgent?: (did: string, by: string, at: string) => Promise<boolean>;
}

export function orgRoutes(o: OrgRoutesOptions) {
  const audits = new Map<string, AdminAudit>();
  const auditOf = (org: string) => { let a = audits.get(org); if (!a) { a = new AdminAudit(o.auditPath(org)); audits.set(org, a); } return a; };
  const log = (org: string, by: string, action: string, target: string, reason?: string) => auditOf(org).add({ at: o.now(), by, via: "api", action, target, ...(reason ? { reason } : {}) });

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/org" && !url.pathname.startsWith("/org/")) return false;
    const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); return true; };
    const fail = (status: number, code: string, message: string) => send(status, { ok: false, error: { code, message } });
    const readBody = async (): Promise<Record<string, any>> => { const chunks: Buffer[] = []; let n = 0; for await (const c of req) { n += (c as Buffer).length; if (n > 256 * 1024) return {}; chunks.push(c as Buffer); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; } };
    const bearer = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const method = req.method ?? "GET";
    const seg = url.pathname.split("/").filter(Boolean);                     // ["org", name, ...]

    // Creating an organisation: the caller is a tenant, which becomes its owner.
    if (seg.length === 1) {
      if (method !== "POST") return fail(405, "METHOD", "POST /org {name}");
      const t = o.tenants().find((x) => !x.closed && x.tokenSha256 && x.tokenSha256 === sha(bearer));
      if (!t) return fail(401, "UNAUTHORIZED", "a tenant's bearer token is needed to create an organisation");
      const b = await readBody();
      if (typeof b.name !== "string" || !NAME.test(b.name)) return fail(400, "BAD_NAME", "an organisation's name is 2 to 39 characters: lower-case letters, digits and hyphens, starting with a letter");
      if (o.store.get(b.name)) return fail(409, "NAME_TAKEN", `an organisation called ${b.name} already exists`);
      const at = o.now();
      const owner: OrgMember = { id: `tenant:${t.name}`, role: "owner", active: true, via: "owner", createdAt: at, tokens: [], agents: [] };
      o.store.put({ name: b.name, ownerTenant: t.name, createdAt: at, members: { [owner.id]: owner } });
      log(b.name, owner.id, "org.create", b.name);
      return send(201, { ok: true, organisation: b.name, owner: t.name, roles: ORG_ROLES });
    }

    const org = o.store.get(seg[1]);
    if (!org) return fail(404, "NO_SUCH_ORG", "no such organisation");
    const rest = seg.slice(2).join("/");

    // Signing in through the organisation's identity provider: no token yet.
    if (method === "POST" && rest === "sso/oidc/login") {
      const b = await readBody();
      const cfg = org.sso;
      if (!cfg) return fail(400, "NO_SSO", "this organisation has not configured single sign-on");
      let claims: Record<string, unknown>;
      try { claims = verifyIdToken(String(b.id_token ?? ""), cfg, Date.parse(o.now())); } catch (e) { log(org.name, "anonymous", "login.refused", "oidc", (e as Error).message); return fail(401, "LOGIN_REFUSED", `the identity provider's token was refused: ${(e as Error).message}`); }
      const sub = String(claims.sub), email = typeof claims.email === "string" ? claims.email : undefined;
      let m = Object.values(org.members).find((x) => x.sub === sub);
      const wanted = ((): OrgRole => { const raw = cfg.roleClaim ? claims[cfg.roleClaim] : undefined; const list = Array.isArray(raw) ? raw.map(String) : raw === undefined ? [] : [String(raw)]; for (const g of list) { const r = cfg.roleMap?.[g] ?? (ORG_ROLES.includes(g as OrgRole) && g !== "owner" ? (g as OrgRole) : undefined); if (r) return r === "owner" ? cfg.defaultRole : r; } return cfg.defaultRole; })();
      if (!m) {
        if (!cfg.jit) { log(org.name, sub, "login.refused", sub, "not provisioned and just-in-time provisioning is off"); return fail(403, "NOT_PROVISIONED", "this person is not provisioned in the organisation"); }
        m = { id: `u:${sub}`, sub, ...(email ? { email } : {}), role: wanted === "owner" ? "member" : wanted, active: true, via: "sso", createdAt: o.now(), tokens: [], agents: [] };
        org.members[m.id] = m;
        log(org.name, m.id, "member.provision", m.id, `just in time as ${m.role}`);
      }
      if (!m.active) { log(org.name, m.id, "login.refused", m.id, "deprovisioned"); return fail(403, "DEPROVISIONED", "this person was deprovisioned: ask the organisation's administrator"); }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.parse(o.now()) + TOKEN_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
      m.tokens = [...m.tokens.filter((t) => Date.parse(t.expiresAt) > Date.parse(o.now())), { hash: sha(token), createdAt: o.now(), expiresAt }];
      o.store.put(org);
      log(org.name, m.id, "login", m.id, `role ${m.role}`);
      return send(200, { ok: true, token, member: m.id, role: m.role, expiresAt, note: "Shown once. It works on this organisation's routes, limited by the role." });
    }

    // Who is calling: a person's token, the owner tenant's own token, or (SCIM routes only) the provisioning token.
    const nowMs = Date.parse(o.now());
    const person = bearer ? Object.values(org.members).find((m) => m.active && m.tokens.some((t) => t.hash === sha(bearer) && Date.parse(t.expiresAt) > nowMs)) : undefined;
    const ownerTenant = !person && bearer ? o.tenants().find((t) => t.name === org.ownerTenant && !t.closed && !t.suspended && t.tokenSha256 === sha(bearer)) : undefined;
    const caller = person ?? (ownerTenant ? org.members[`tenant:${ownerTenant.name}`] : undefined);
    const isScim = seg[2] === "scim" && !!org.scimTokenHash && !!bearer && org.scimTokenHash === sha(bearer);
    if (!caller && !isScim) { log(org.name, "anonymous", "access.refused", rest || "/", "no valid token"); return fail(401, "UNAUTHORIZED", "a person's token, the owner's token or the provisioning token is needed"); }
    const by = caller ? caller.id : "scim";
    const need = (p: OrgPermission): boolean => { if (caller && can(caller.role, p)) return true; log(org.name, by, "access.refused", rest || "/", `${caller?.role ?? "provisioning token"} lacks ${p}`); fail(403, "FORBIDDEN", `your role (${caller?.role ?? "provisioning token"}) does not allow this`); return false; };
    const publicMember = (m: OrgMember) => ({ id: m.id, ...(m.email ? { email: m.email } : {}), role: m.role, active: m.active, via: m.via, createdAt: m.createdAt, ...(m.deprovisionedAt ? { deprovisionedAt: m.deprovisionedAt } : {}), agents: m.agents });

    const deprovision = async (m: OrgMember, who: string, freeze: boolean, why: string) => {
      m.active = false; m.deprovisionedAt = o.now(); m.tokens = [];
      const frozen: string[] = [];
      if (freeze && o.freezeAgent) for (const did of m.agents) if (await o.freezeAgent(did, who, o.now())) { frozen.push(did); log(org.name, who, "agent.freeze", did, `owner ${m.id} deprovisioned`); }
      o.store.put(org);
      log(org.name, who, "member.deprovision", m.id, why);
      return frozen;
    };

    if (method === "GET" && rest === "") { if (!need("org.read")) return true; const by_role: Record<string, number> = {}; for (const m of Object.values(org.members)) if (m.active) by_role[m.role] = (by_role[m.role] ?? 0) + 1; return send(200, { ok: true, organisation: org.name, owner: org.ownerTenant, you: caller ? { id: caller.id, role: caller.role } : undefined, members: by_role, sso: org.sso ? { type: "oidc", issuer: org.sso.issuer, jit: org.sso.jit, defaultRole: org.sso.defaultRole } : null, scim: !!org.scimTokenHash }); }
    if (method === "GET" && rest === "members") { if (!(caller && (can(caller.role, "members.manage") || can(caller.role, "audit.read")))) { need("members.manage"); return true; } return send(200, { ok: true, members: Object.values(org.members).map(publicMember) }); }
    if (method === "PUT" && rest === "sso") {
      if (!need("sso.configure")) return true;
      const b = await readBody();
      if (typeof b.issuer !== "string" || typeof b.audience !== "string" || !Array.isArray(b.jwks?.keys) || !b.jwks.keys.length) return fail(400, "BAD_SSO", "issuer, audience and jwks ({ keys: [...] }) are needed");
      const defaultRole: OrgRole = ORG_ROLES.includes(b.defaultRole) && b.defaultRole !== "owner" ? b.defaultRole : "member";
      org.sso = { issuer: b.issuer, audience: b.audience, jwks: b.jwks, ...(typeof b.roleClaim === "string" ? { roleClaim: b.roleClaim } : {}), ...(b.roleMap && typeof b.roleMap === "object" ? { roleMap: b.roleMap } : {}), defaultRole, jit: b.jit !== false };
      o.store.put(org); log(org.name, by, "sso.configure", b.issuer);
      return send(200, { ok: true, sso: { type: "oidc", issuer: b.issuer, jit: org.sso.jit, defaultRole } });
    }
    if (method === "POST" && rest === "scim-token") {
      if (!need("sso.configure")) return true;
      const token = randomBytes(32).toString("base64url");
      org.scimTokenHash = sha(token); o.store.put(org); log(org.name, by, "scim.token", "scim");
      return send(201, { ok: true, token, note: "Shown once: the identity system's provisioning feed uses it on /org/<name>/scim/Users." });
    }
    // The organisation's private log (DK1359): its records stay in a log of its own; the society witnesses signed checkpoints of it, so the organisation cannot later show a different history.
    if (method === "PUT" && rest === "private-log") {
      if (!need("sso.configure")) return true;
      const b = await readBody();
      if (typeof b.did !== "string" || !b.did.startsWith("did:")) return fail(400, "BAD_DID", "did is the identity whose key signs the checkpoints");
      org.privateLog = { did: b.did, setAt: o.now() }; o.store.put(org); log(org.name, by, "private_log.set", b.did);
      return send(200, { ok: true, privateLog: org.privateLog });
    }
    if (rest === "checkpoints" && o.checkpointPath) {
      const file = o.checkpointPath(org.name);
      if (method === "GET") { if (!(caller && (can(caller.role, "audit.read") || can(caller.role, "checkpoint.publish")))) { need("audit.read"); return true; } const all = readCheckpoints(file); return send(200, { ok: true, privateLog: org.privateLog ?? null, checkpoints: all, latest: all.at(-1) ?? null, equivocations: findEquivocations(all).length }); }
      if (method === "POST") {
        if (!need("checkpoint.publish")) return true;
        if (!org.privateLog) return fail(409, "NO_PRIVATE_LOG", "no private log is declared: PUT /org/<name>/private-log { did } first");
        const cp = (await readBody()) as Partial<LogCheckpoint>;
        if (!Number.isInteger(cp.seq) || typeof cp.logHash !== "string" || typeof cp.signedAt !== "string" || typeof cp.signer !== "string" || typeof cp.sig !== "string") return fail(400, "BAD_CHECKPOINT", "a checkpoint has seq, logHash, signedAt, signer and sig");
        if (didOf(cp.signer) !== org.privateLog.did) { log(org.name, by, "checkpoint.refused", String(cp.seq), "signed by another identity"); return fail(403, "WRONG_SIGNER", `checkpoints of this private log are signed by ${org.privateLog.did}`); }
        const key = o.keyOf ? await o.keyOf(cp.signer) : undefined;
        if (!key || !verifyCheckpointSignature(cp as LogCheckpoint, key, org.privateLog.did)) { log(org.name, by, "checkpoint.refused", String(cp.seq), "the signature does not verify"); return fail(401, "BAD_SIGNATURE", "the signature does not verify against the key in the society's log"); }
        const all = readCheckpoints(file);
        const same = all.find((c) => c.seq === cp.seq);
        if (same && same.logHash !== cp.logHash) { log(org.name, by, "checkpoint.equivocation", String(cp.seq), "two different hashes at one seq"); return fail(409, "EQUIVOCATION", `the log already has a signed checkpoint at seq ${cp.seq} with a different hash: a private log cannot show two histories`); }
        if (all.length && (cp.seq as number) < (all.at(-1)?.seq ?? 0)) return fail(409, "BEHIND", `a checkpoint at seq ${cp.seq} is behind the latest (${all.at(-1)!.seq}): a log only grows`);
        if (!same) { appendCheckpoint(file, cp as LogCheckpoint); log(org.name, by, "checkpoint.publish", String(cp.seq), cp.logHash); }
        return send(same ? 200 : 201, { ok: true, witnessed: cp.seq, logHash: cp.logHash, total: same ? all.length : all.length + 1 });
      }
    }
    const roleM = /^members\/([^/]+)\/role$/.exec(rest);
    if (method === "PUT" && roleM) {
      if (!need("members.manage")) return true;
      const b = await readBody();
      const m = org.members[decodeURIComponent(roleM[1])];
      if (!m) return fail(404, "NO_SUCH_MEMBER", "no such member");
      if (!ORG_ROLES.includes(b.role)) return fail(400, "BAD_ROLE", `role is one of ${ORG_ROLES.join(", ")}`);
      // an administrator gives only the roles member and auditor, and does not change an owner or another administrator; the owner may do anything but leave the organisation without an owner
      if (caller && caller.role === "administrator" && (!["member", "auditor"].includes(b.role) || ["owner", "administrator"].includes(m.role))) { log(org.name, by, "role.refused", m.id, `an administrator may only give member or auditor to a member or auditor`); return fail(403, "FORBIDDEN", "an administrator gives only the roles member and auditor, and does not change an owner or another administrator"); }
      if (m.role === "owner" && b.role !== "owner" && Object.values(org.members).filter((x) => x.role === "owner" && x.active).length < 2) return fail(409, "LAST_OWNER", "the organisation needs an owner: make another owner first");
      const before = m.role; m.role = b.role; o.store.put(org); log(org.name, by, "role.change", m.id, `${before} to ${b.role}`);
      return send(200, { ok: true, member: publicMember(m) });
    }
    const agentsM = /^members\/([^/]+)\/agents$/.exec(rest);
    if (method === "POST" && agentsM) {
      const m = org.members[decodeURIComponent(agentsM[1])];
      if (!m) return fail(404, "NO_SUCH_MEMBER", "no such member");
      if (!(caller && caller.id === m.id) && !need("members.manage")) return true;
      const b = await readBody();
      if (typeof b.did !== "string" || !b.did.startsWith("did:")) return fail(400, "BAD_DID", "did is an identity");
      if (!m.agents.includes(b.did)) m.agents.push(b.did);
      o.store.put(org); log(org.name, by, "agent.link", b.did, `to ${m.id}`);
      return send(200, { ok: true, member: publicMember(m) });
    }
    const depM = /^members\/([^/]+)\/deprovision$/.exec(rest);
    if (method === "POST" && depM) {
      if (!need("provision")) return true;
      const m = org.members[decodeURIComponent(depM[1])];
      if (!m) return fail(404, "NO_SUCH_MEMBER", "no such member");
      if (m.role === "owner") return fail(409, "OWNER", "an owner is not deprovisioned: change the role first");
      const b = await readBody();
      const frozen = await deprovision(m, by, b.agents !== false, "by an administrator");
      return send(200, { ok: true, member: publicMember(m), agentsFrozen: frozen });
    }
    if (method === "GET" && (rest === "audit" || rest === "audit/export")) {
      if (!need("audit.read")) return true;
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      const a = auditOf(org.name);
      const entries = a.read().filter((e) => e.seq > after);
      return send(200, { ok: true, organisation: org.name, entries, verify: a.verify(), head: a.read().at(-1)?.hash ?? null });
    }

    // SCIM groups: a group gives its members a role (the roleMap of the sign-on, or the group is named for a role other than owner); a person leaving a group goes back to the default role.
    if (seg[2] === "scim" && seg[3] === "Groups") {
      if (!isScim && !need("provision")) return true;
      const who = isScim ? "scim" : by;
      const roleOf = (g: string): OrgRole | undefined => { const r = org.sso?.roleMap?.[g] ?? (ORG_ROLES.includes(g as OrgRole) ? (g as OrgRole) : undefined); return r && r !== "owner" ? r : undefined; };
      const fallback = org.sso?.defaultRole ?? "member";
      const setGroup = (name: string, members: string[]) => {
        const role = roleOf(name);
        if (!role) return false;
        const before = org.groups?.[name] ?? [];
        org.groups = { ...(org.groups ?? {}), [name]: members };
        for (const id of members) { const m = org.members[id]; if (m && m.role !== "owner" && m.active) { if (m.role !== role) log(org.name, who, "role.change", id, `${m.role} to ${role} by group ${name}`); m.role = role; } }
        for (const id of before.filter((x) => !members.includes(x))) { const m = org.members[id]; if (m && m.role === role) { m.role = fallback; log(org.name, who, "role.change", id, `${role} to ${fallback}: left group ${name}`); } }
        o.store.put(org); log(org.name, who, "group.set", name, `${members.length} member(s)`);
        return true;
      };
      if ((method === "POST" || method === "PUT") && seg.length === 4) {
        const b = await readBody();
        if (typeof b.displayName !== "string" || !b.displayName) return fail(400, "BAD_GROUP", "displayName is needed");
        const ids = (Array.isArray(b.members) ? b.members : []).map((x: { value?: string } | string) => (typeof x === "string" ? x : String(x?.value ?? ""))).filter(Boolean);
        if (!setGroup(b.displayName, ids)) return fail(400, "UNMAPPED_GROUP", `the group ${b.displayName} maps to no role: name it for a role (administrator, member, auditor) or map it in the sign-on's roleMap; owner is never given by a group`);
        return send(201, { id: b.displayName, displayName: b.displayName, members: ids.length, role: roleOf(b.displayName) });
      }
      if (method === "DELETE" && seg.length === 5) {
        const name = decodeURIComponent(seg[4]);
        if (!org.groups?.[name]) return fail(404, "NO_SUCH_GROUP", "no such group");
        setGroup(name, []); delete org.groups[name]; o.store.put(org);
        return send(200, { id: name, deleted: true });
      }
      if (method === "GET" && seg.length === 5) { const name = decodeURIComponent(seg[4]); return org.groups?.[name] ? send(200, { id: name, displayName: name, members: org.groups[name] }) : fail(404, "NO_SUCH_GROUP", "no such group"); }
      return fail(405, "METHOD", "POST /scim/Groups, GET or DELETE /scim/Groups/<name>");
    }
    // The provisioning feed, SCIM-style: Users with userName, active and optionally a role.
    if (seg[2] === "scim" && seg[3] === "Users") {
      if (!isScim && !need("provision")) return true;
      const who = isScim ? "scim" : by;
      if (method === "POST" && seg.length === 4) {
        const b = await readBody();
        if (typeof b.userName !== "string" || !b.userName) return fail(400, "BAD_USER", "userName is needed");
        const role: OrgRole = ORG_ROLES.includes(b.role) && b.role !== "owner" ? b.role : (org.sso?.defaultRole ?? "member");
        const id = `u:${b.externalId ?? b.userName}`;
        const existing = org.members[id];
        const m: OrgMember = existing ?? { id, ...(b.userName.includes("@") ? { email: b.userName } : {}), ...(typeof b.externalId === "string" ? { sub: b.externalId } : {}), role, active: true, via: "scim", createdAt: o.now(), tokens: [], agents: [] };
        if (existing) { existing.active = true; delete existing.deprovisionedAt; existing.role = existing.role === "owner" ? "owner" : role; }
        org.members[id] = m; o.store.put(org); log(org.name, who, "member.provision", id, `by the provisioning feed as ${m.role}`);
        return send(201, { id, userName: b.userName, active: true, role: m.role });
      }
      const idm = seg[4] ? decodeURIComponent(seg[4]) : "";
      const m = org.members[idm] ?? Object.values(org.members).find((x) => x.sub === idm || x.email === idm);
      if (seg.length === 5 && !m) return fail(404, "NO_SUCH_MEMBER", "no such user");
      if (m && method === "GET") return send(200, { id: m.id, userName: m.email ?? m.id, active: m.active, role: m.role });
      if (m && (method === "DELETE" || method === "PATCH")) {
        const patch = method === "PATCH" ? await readBody() : {};
        if (method === "DELETE" || patch.active === false) {
          if (m.role === "owner") return fail(409, "OWNER", "an owner is not deprovisioned: change the role first");
          const frozen = await deprovision(m, who, true, "by the provisioning feed");
          return send(200, { id: m.id, active: false, agentsFrozen: frozen });
        }
        if (patch.active === true) { m.active = true; delete m.deprovisionedAt; o.store.put(org); log(org.name, who, "member.provision", m.id, "re-activated by the provisioning feed"); }
        return send(200, { id: m.id, active: m.active, role: m.role });
      }
      return fail(405, "METHOD", "POST /scim/Users, PATCH or DELETE /scim/Users/<id>");
    }
    return fail(404, "NOT_FOUND", "no such organisation route");
  };
}

export type { AuditEntry };
/** A fixed hash of a string, for tests that need one. */
export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
