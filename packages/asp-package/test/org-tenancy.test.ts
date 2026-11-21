// DK1359, DK1373, DK1374 (the service side): an organisation's roles, sign-in through a test identity provider (OIDC), provisioning and deprovisioning (just in time and a SCIM-style feed, which freezes the
// person's agents), and the audit trail. No real identity provider was used: the provider here is a pair of keys made by the test. Fake tokens only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createSign, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashToken, type Tenant } from "@agent-social/asp-log";
import { AdminAudit } from "../src/admin-routes.ts";
import { PERMISSIONS, OrgStore, can, orgRoutes, verifyIdToken, ORG_ROLES } from "../src/org-tenancy.ts";

const ISS = "https://idp.example", AUD = "asp-acme";
const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function idp() {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = (k: KeyObject, kid: string, extra: object) => ({ ...(k.export({ format: "jwk" }) as object), kid, ...extra });
  const jwks = { keys: [jwk(rsa.publicKey, "rsa-1", { alg: "RS256", use: "sig" }), jwk(ec.publicKey, "ec-1", { alg: "ES256", use: "sig" })] };
  let clock = Date.parse("2026-11-21T10:00:00Z");
  const token = (claims: Record<string, unknown>, o: { alg?: "RS256" | "ES256" | "none"; kid?: string; key?: KeyObject } = {}) => {
    const alg = o.alg ?? "RS256";
    const head = b64({ alg, typ: "JWT", kid: o.kid ?? (alg === "ES256" ? "ec-1" : "rsa-1") });
    const body = b64({ iss: ISS, aud: AUD, exp: Math.floor(clock / 1000) + 600, ...claims });
    if (alg === "none") return `${head}.${body}.`;
    const data = Buffer.from(`${head}.${body}`);
    const sig = alg === "RS256" ? createSign("sha256").update(data).sign(o.key ?? rsa.privateKey) : cryptoSign("sha256", data, { key: o.key ?? ec.privateKey, dsaEncoding: "ieee-p1363" });
    return `${head}.${body}.${sig.toString("base64url")}`;
  };
  return { jwks, token, tick: (ms: number) => { clock += ms; }, now: () => new Date(clock).toISOString().replace(/\.\d{3}Z$/, "Z"), other: generateKeyPairSync("rsa", { modulusLength: 2048 }) };
}

async function service() {
  const dir = mkdtempSync(join(tmpdir(), "asp-org-"));
  const p = idp();
  const tenants: Tenant[] = [{ name: "acme", role: "tenant", tokenSha256: hashToken("tok-acme") }, { name: "other", role: "tenant", tokenSha256: hashToken("tok-other") }];
  const frozen: string[] = [];
  const route = orgRoutes({ store: new OrgStore(join(dir, "orgs.json")), tenants: () => tenants, auditPath: (n) => join(dir, `${n}.audit.ndjson`), now: p.now, freezeAgent: async (did) => { frozen.push(did); return true; } });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (method: string, path: string, token?: string, body?: unknown) => { const r = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, json: (await r.json()) as any }; };
  const login = async (claims: Record<string, unknown>, o?: Parameters<typeof p.token>[1]) => call("POST", "/org/acme/sso/oidc/login", undefined, { id_token: p.token(claims, o) });
  return { dir, p, call, login, frozen, close: () => server.close(), audit: () => new AdminAudit(join(dir, "acme.audit.ndjson")) };
}
async function setup() {
  const s = await service();
  assert.equal((await s.call("POST", "/org", "tok-acme", { name: "acme" })).status, 201);
  const sso = await s.call("PUT", "/org/acme/sso", "tok-acme", { issuer: ISS, audience: AUD, jwks: s.p.jwks, roleClaim: "groups", roleMap: { "asp-admins": "administrator", "asp-audit": "auditor", "asp-owners": "owner" }, defaultRole: "member", jit: true });
  assert.equal(sso.status, 200);
  return s;
}

test("the role table: owner has everything, administrator everything but roles and sign-on, member only reads, auditor reads and audits", () => {
  assert.deepEqual([...ORG_ROLES], ["owner", "administrator", "member", "auditor"]);
  assert.ok(PERMISSIONS.owner.every((p) => can("owner", p)));
  assert.equal(can("administrator", "sso.configure"), false);
  assert.equal(can("administrator", "roles.assign"), false);
  assert.equal(can("administrator", "members.manage"), true);
  assert.deepEqual([...PERMISSIONS.member], ["org.read"]);
  assert.deepEqual([...PERMISSIONS.auditor], ["org.read", "audit.read"]);
});

test("an identity provider's token is accepted only when it verifies: signature (RS256 and ES256), issuer, audience, expiry, and the algorithm none is refused", () => {
  const p = idp();
  const cfg = { issuer: ISS, audience: AUD, jwks: p.jwks };
  const now = Date.parse(p.now());
  assert.equal(verifyIdToken(p.token({ sub: "u1" }), cfg, now).sub, "u1");
  assert.equal(verifyIdToken(p.token({ sub: "u2" }, { alg: "ES256" }), cfg, now).sub, "u2");
  assert.throws(() => verifyIdToken(p.token({ sub: "u1" }, { key: p.other.privateKey }), cfg, now), /signature does not verify/);
  assert.throws(() => verifyIdToken(p.token({ sub: "u1", aud: "someone-else" }), cfg, now), /audience/);
  assert.throws(() => verifyIdToken(p.token({ sub: "u1", iss: "https://evil.example" }), cfg, now), /issuer/);
  assert.throws(() => verifyIdToken(p.token({ sub: "u1", exp: Math.floor(now / 1000) - 5 }), cfg, now), /expired/);
  assert.throws(() => verifyIdToken(p.token({ sub: "u1" }, { alg: "none" }), cfg, now), /not accepted/);
  assert.throws(() => verifyIdToken(p.token({ sub: "u1" }, { kid: "unknown" }), cfg, now), /no key of the identity provider/);
  assert.throws(() => verifyIdToken("garbage", cfg, now), /not a JWT/);
  assert.throws(() => verifyIdToken(p.token({}), cfg, now), /no subject/);
});

test("each role through a test identity provider: what a member, an auditor, an administrator and the owner may and may not do", async () => {
  const s = await setup();
  try {
    const member = (await s.login({ sub: "m1", email: "m1@acme.example" })).json;
    const auditor = (await s.login({ sub: "a1", email: "a1@acme.example", groups: ["asp-audit"] })).json;
    const admin = (await s.login({ sub: "ad1", email: "ad1@acme.example", groups: ["asp-admins"] })).json;
    assert.deepEqual([member.role, auditor.role, admin.role], ["member", "auditor", "administrator"]);
    // a group that names owner never makes an owner at sign-in
    assert.equal((await s.login({ sub: "x1", groups: ["asp-owners"] })).json.role, "member");

    // member: reads the organisation, nothing else
    assert.equal((await s.call("GET", "/org/acme", member.token)).status, 200);
    for (const [m, path] of [["GET", "/org/acme/members"], ["GET", "/org/acme/audit"]] as const) assert.equal((await s.call(m, path, member.token)).status, 403, `member: ${path}`);
    assert.equal((await s.call("PUT", "/org/acme/members/u:a1/role", member.token, { role: "administrator" })).status, 403);
    assert.equal((await s.call("PUT", "/org/acme/sso", member.token, { issuer: "x" })).status, 403);
    // auditor: reads members and the audit trail, changes nothing
    assert.equal((await s.call("GET", "/org/acme/audit", auditor.token)).status, 200);
    assert.equal((await s.call("GET", "/org/acme/members", auditor.token)).status, 200);
    assert.equal((await s.call("PUT", "/org/acme/members/u:m1/role", auditor.token, { role: "auditor" })).status, 403);
    assert.equal((await s.call("POST", "/org/acme/members/u:m1/deprovision", auditor.token, {})).status, 403);
    // administrator: manages members (member and auditor roles only), deprovisions, reads the audit trail; no sign-on, no scim token, no owner or administrator changes
    assert.equal((await s.call("PUT", "/org/acme/members/u:m1/role", admin.token, { role: "auditor" })).status, 200);
    assert.equal((await s.call("PUT", "/org/acme/members/u:m1/role", admin.token, { role: "administrator" })).status, 403, "an administrator cannot make an administrator");
    assert.equal((await s.call("PUT", "/org/acme/members/tenant:acme/role", admin.token, { role: "member" })).status, 403, "or touch the owner");
    assert.equal((await s.call("PUT", "/org/acme/sso", admin.token, { issuer: ISS, audience: AUD, jwks: s.p.jwks })).status, 403);
    assert.equal((await s.call("POST", "/org/acme/scim-token", admin.token, {})).status, 403);
    assert.equal((await s.call("GET", "/org/acme/audit", admin.token)).status, 200);
    // owner (the tenant's own token): everything, including a new administrator, but never an organisation with no owner
    assert.equal((await s.call("PUT", "/org/acme/members/u:m1/role", "tok-acme", { role: "administrator" })).status, 200);
    assert.equal((await s.call("PUT", "/org/acme/members/tenant:acme/role", "tok-acme", { role: "member" })).status, 409, "the last owner stays");
    // another tenant is nobody here
    assert.equal((await s.call("GET", "/org/acme", "tok-other")).status, 401);
    assert.equal((await s.call("GET", "/org/acme")).status, 401);
    assert.equal((await s.call("POST", "/org", "tok-other", { name: "acme" })).status, 409);
  } finally { s.close(); }
});

test("sign-in is refused for a bad token, and for a person who is not provisioned when just-in-time provisioning is off", async () => {
  const s = await setup();
  try {
    assert.equal((await s.login({ sub: "m1" }, { key: s.p.other.privateKey })).status, 401);
    assert.equal((await s.login({ sub: "m1", aud: "other" })).status, 401);
    assert.equal((await s.call("PUT", "/org/acme/sso", "tok-acme", { issuer: ISS, audience: AUD, jwks: s.p.jwks, jit: false })).status, 200);
    const r = await s.login({ sub: "stranger" });
    assert.deepEqual([r.status, r.json.error.code], [403, "NOT_PROVISIONED"]);
    assert.equal((await s.call("POST", "/org/acme/sso/oidc/login", undefined, {})).status, 401);
  } finally { s.close(); }
});

test("provisioning and deprovisioning from the identity system: a feed provisions a person, they sign in, a deprovision ends every token, freezes their agents, and refuses sign-in until the feed re-activates them", async () => {
  const s = await setup();
  try {
    const scim = (await s.call("POST", "/org/acme/scim-token", "tok-acme", {})).json.token as string;
    assert.ok(scim);
    assert.equal((await s.call("POST", "/org/acme/scim/Users", "wrong", { userName: "p@acme.example" })).status, 401);
    const made = await s.call("POST", "/org/acme/scim/Users", scim, { userName: "p@acme.example", externalId: "p-sub", role: "auditor" });
    assert.deepEqual([made.status, made.json.role], [201, "auditor"]);
    // signs in as that person (the subject matches the feed's externalId): the role the feed gave
    const login = (await s.login({ sub: "p-sub" })).json;
    assert.deepEqual([login.member, login.role], ["u:p-sub", "auditor"]);
    assert.equal((await s.call("GET", "/org/acme/audit", login.token)).status, 200);
    // the person's agents
    assert.equal((await s.call("POST", "/org/acme/members/u:p-sub/agents", login.token, { did: "did:web:acme.example:agents:p1" })).status, 200);
    assert.equal((await s.call("POST", "/org/acme/members/u:p-sub/agents", "tok-acme", { did: "did:web:acme.example:agents:p2" })).status, 200);
    // the feed deprovisions: tokens end at once, the agents are frozen, sign-in is refused
    const gone = await s.call("PATCH", "/org/acme/scim/Users/u:p-sub", scim, { active: false });
    assert.deepEqual([gone.status, gone.json.active, gone.json.agentsFrozen], [200, false, ["did:web:acme.example:agents:p1", "did:web:acme.example:agents:p2"]]);
    assert.deepEqual(s.frozen, ["did:web:acme.example:agents:p1", "did:web:acme.example:agents:p2"]);
    assert.equal((await s.call("GET", "/org/acme", login.token)).status, 401, "the token ended at once");
    const again = await s.login({ sub: "p-sub" });
    assert.deepEqual([again.status, again.json.error.code], [403, "DEPROVISIONED"]);
    // just-in-time provisioning does not bring a deprovisioned person back; the feed does
    assert.equal((await s.call("PATCH", "/org/acme/scim/Users/u:p-sub", scim, { active: true })).json.active, true);
    assert.equal((await s.login({ sub: "p-sub" })).status, 200);
    // an administrator's deprovision can leave the agents running; an owner is never deprovisioned
    const m = (await s.login({ sub: "q-sub" })).json;
    await s.call("POST", "/org/acme/members/u:q-sub/agents", "tok-acme", { did: "did:web:acme.example:agents:q1" });
    const admin = (await s.login({ sub: "ad", groups: ["asp-admins"] })).json;
    const dep = await s.call("POST", "/org/acme/members/u:q-sub/deprovision", admin.token, { agents: false });
    assert.deepEqual([dep.status, dep.json.agentsFrozen], [200, []]);
    assert.equal((await s.call("GET", "/org/acme", m.token)).status, 401);
    assert.equal((await s.call("POST", "/org/acme/members/tenant:acme/deprovision", admin.token, {})).status, 409);
    assert.equal((await s.call("DELETE", "/org/acme/scim/Users/u:q-sub", scim)).status, 200);
  } finally { s.close(); }
});

test("the audit trail: sign-ins (accepted and refused), role changes, provisioning, deprovisioning and refused access are in it, in a hash chain that verifies and shows an edit", async () => {
  const s = await setup();
  try {
    const m = (await s.login({ sub: "m1" })).json;
    await s.login({ sub: "m1" }, { key: s.p.other.privateKey });                  // refused sign-in
    await s.call("GET", "/org/acme/audit", m.token);                              // refused access
    await s.call("PUT", "/org/acme/members/u:m1/role", "tok-acme", { role: "auditor" });
    await s.call("POST", "/org/acme/members/u:m1/deprovision", "tok-acme", {});
    const out = (await s.call("GET", "/org/acme/audit", "tok-acme")).json;
    const actions = out.entries.map((e: { action: string }) => e.action);
    for (const a of ["org.create", "sso.configure", "member.provision", "login", "login.refused", "access.refused", "role.change", "member.deprovision"]) assert.ok(actions.includes(a), `${a} is in the audit trail`);
    assert.equal(out.verify.ok, true);
    assert.equal((await s.call("GET", "/org/acme/audit?after=3", "tok-acme")).json.entries[0].seq, 4);
    // an edit to the file is seen
    const file = join(s.dir, "acme.audit.ndjson");
    writeFileSync(file, readFileSync(file, "utf8").replace('"role.change"', '"login"'));
    assert.equal(s.audit().verify().ok, false);
  } finally { s.close(); }
});

test("DK1373: SCIM groups give their members a role, a person who leaves the group goes back to the default, an owner is never changed, and a group that maps to no role is refused", async () => {
  const s = await setup();
  try {
    const scim = (await s.call("POST", "/org/acme/scim-token", "tok-acme", {})).json.token as string;
    for (const u of ["g1", "g2", "g3"]) await s.call("POST", "/org/acme/scim/Users", scim, { userName: `${u}@acme.example`, externalId: u });
    const role = async (id: string) => (await s.call("GET", "/org/acme/members", "tok-acme")).json.members.find((m: { id: string }) => m.id === id).role;
    assert.deepEqual([await role("u:g1"), await role("u:g2")], ["member", "member"]);
    // a group named for a role
    assert.equal((await s.call("POST", "/org/acme/scim/Groups", scim, { displayName: "auditor", members: [{ value: "u:g1" }, { value: "u:g2" }] })).status, 201);
    assert.deepEqual([await role("u:g1"), await role("u:g2")], ["auditor", "auditor"]);
    // the group's members change: g2 leaves and goes back to the default, g3 joins
    await s.call("POST", "/org/acme/scim/Groups", scim, { displayName: "auditor", members: [{ value: "u:g1" }, { value: "u:g3" }] });
    assert.deepEqual([await role("u:g1"), await role("u:g2"), await role("u:g3")], ["auditor", "member", "auditor"]);
    // a group mapped by the sign-on's roleMap
    await s.call("POST", "/org/acme/scim/Groups", scim, { displayName: "asp-admins", members: [{ value: "u:g2" }] });
    assert.equal(await role("u:g2"), "administrator");
    // the owner is never changed by a group, and a group that maps to nothing (or to owner) is refused
    assert.equal((await s.call("POST", "/org/acme/scim/Groups", scim, { displayName: "auditor", members: [{ value: "tenant:acme" }] })).status, 201);
    assert.equal(await role("tenant:acme"), "owner");
    assert.equal((await s.call("POST", "/org/acme/scim/Groups", scim, { displayName: "engineering", members: [] })).status, 400);
    assert.equal((await s.call("POST", "/org/acme/scim/Groups", scim, { displayName: "owner", members: [{ value: "u:g1" }] })).status, 400);
    assert.equal((await s.call("POST", "/org/acme/scim/Groups", "wrong", { displayName: "auditor", members: [] })).status, 401);
    // deleting a group returns its people to the default; each change is in the audit trail
    assert.equal((await s.call("DELETE", "/org/acme/scim/Groups/asp-admins", scim)).status, 200);
    assert.equal(await role("u:g2"), "member");
    const actions = (await s.call("GET", "/org/acme/audit", "tok-acme")).json.entries.map((e: { action: string }) => e.action);
    assert.ok(actions.includes("group.set") && actions.includes("role.change"));
  } finally { s.close(); }
});
