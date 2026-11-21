// DK1472 (S1415): the service's own facts (an address hash, a Google account) reach the anti-farming report through GET /society/farming, for an operator only, and two sponsors that share one are found as one controller. Stand-in log for the route; fake tokens.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createLogServer, hashToken, commonControl, type Tenant } from "../src/index.ts";
import { serviceFarmingFacts, tenantOfDid } from "../../asp-package/src/farming-facts.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };

const D = "svc.example";
const tenants = [
  { name: "ops", role: "admin", tokenSha256: hashToken("op-token") },
  { name: "alpha", role: "tenant", tokenSha256: hashToken("t1"), signup: { at: "2026-11-01T00:00:00Z", addressHash: "addr-1", termsVersion: "v1", google: { sub: "g-1" } } },
  { name: "bravo", role: "tenant", tokenSha256: hashToken("t2"), signup: { at: "2026-11-02T00:00:00Z", addressHash: "addr-1", termsVersion: "v1", google: { sub: "g-2" } } },
  { name: "carol", role: "tenant", tokenSha256: hashToken("t3"), signup: { at: "2026-11-03T00:00:00Z", addressHash: "addr-3", termsVersion: "v1", google: { sub: "g-1" } } },
  { name: "delta", role: "tenant", tokenSha256: hashToken("t4"), signup: { at: "2026-11-04T00:00:00Z", addressHash: "addr-4", termsVersion: "v1", google: { sub: "g-4" } } },
] as unknown as Tenant[];
const sponsors = ["alpha", "bravo", "carol", "delta"].map((n) => `did:web:${D}:u:${n}`).concat(["did:web:svc.example:u:alpha:second", "did:web:other.example:u:alpha", "did:key:z6Mkabc"]);

test("a DID belongs to a tenant by its namespace; the facts are salted hashes, shared exactly when the address or the account is shared", () => {
  assert.equal(tenantOfDid(`did:web:${D}:u:alpha`, D), "alpha");
  assert.equal(tenantOfDid(`did:web:${D}:u:alpha:second`, D), "alpha");
  assert.equal(tenantOfDid(`did:web:${D}:a:bravo:bot`, D), "bravo");
  assert.equal(tenantOfDid("did:web:other.example:u:alpha", D), undefined, "another domain");
  assert.equal(tenantOfDid("did:key:z6Mkabc", D), undefined);
  const f = serviceFarmingFacts(tenants, D, sponsors, "salt-one") as { address: Record<string, string>; account: Record<string, string> };
  const a = (n: string) => `did:web:${D}:u:${n}`;
  assert.equal(f.address[a("alpha")], f.address[a("bravo")], "one address");
  assert.notEqual(f.address[a("alpha")], f.address[a("delta")]);
  assert.equal(f.account[a("alpha")], f.account[a("carol")], "one Google account");
  assert.equal(f.address[`did:web:${D}:u:alpha:second`], f.address[a("alpha")], "a tenant's further people share its facts");
  assert.ok(!JSON.stringify(f).includes("addr-1") && !JSON.stringify(f).includes("g-1"), "the address hash and the account id never appear: only salted hashes");
  const other = serviceFarmingFacts(tenants, D, sponsors, "salt-two") as { address: Record<string, string> };
  assert.notEqual(other.address[a("alpha")], f.address[a("alpha")], "another salt, other values: not matchable across services");
  assert.equal(did(f, "did:web:other.example:u:alpha"), undefined);
});
const did = (f: { address: Record<string, string> }, d: string) => f.address[d];

test("the detector joins the sponsors the facts join (address, then account, into one cluster of three), and leaves the fourth alone", () => {
  const passports = sponsors.slice(0, 4).map((s, i) => ({ id: `p${i}`, type: "asp.passport/v0.2", issuer: s, issued_at: "2026-11-01T00:00:00Z", body: { did: s, kind: "human", keys: [{ id: `${s}#k`, type: "Ed25519", public_key: `k-${i}` }] } })) as Parameters<typeof commonControl>[0];
  const { clusters } = commonControl(passports, serviceFarmingFacts(tenants, D, sponsors.slice(0, 4), "s"));
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].sponsors, ["alpha", "bravo", "carol"].map((n) => `did:web:${D}:u:${n}`));
  assert.deepEqual(clusters[0].basis, ["account", "address"]);
});

test("GET /society/farming gives the report to an operator with the service's facts, and refuses everyone else", async () => {
  let seen: unknown;
  const handle = { append: async () => ({ id: "x", seq: 1 }), log: { farmingReport: async (o: { external?: unknown }) => { seen = o.external; return { at: "x", clusters: [], findings: [], flaggedSponsors: [], sponsors: 0, jobs: 0 }; } } } as never;
  const server = createLogServer({ handle, tenants, noAuth: false, farmingFacts: () => serviceFarmingFacts(tenants, D, sponsors, "s") });
  const url = await listen(server);
  assert.equal((await fetch(`${url}/society/farming`)).status, 401);
  assert.equal((await fetch(`${url}/society/farming`, { headers: { authorization: "Bearer t1" } })).status, 403, "a tenant is not an operator");
  const ok = await fetch(`${url}/society/farming`, { headers: { authorization: "Bearer op-token" } });
  assert.equal(ok.status, 200);
  assert.ok(Object.keys((seen as { address: object }).address).length >= 4, "the log was handed the service's facts");
});
