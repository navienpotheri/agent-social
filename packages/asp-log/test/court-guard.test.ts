import { test } from "node:test";
import assert from "node:assert/strict";
import { OwnerStore, courtGuard, type Tenant } from "../src/index.ts";

const tenant = (name: string, google?: string): Tenant => ({ name, role: "tenant", tokenSha256: "1".repeat(64), ...(google ? { signup: { at: "2026-10-11T00:00:00Z", addressHash: "x", termsVersion: "v1", google: { sub: google, email: `${name}@example.org` } } } : {}) });
const admin: Tenant = { name: "ops", role: "admin", tokenSha256: "2".repeat(64) };
const juror = (did: string, stake: number) => ({ type: "asp.juror/v0.2", issuer: did, body: { did, stake: { value: stake } } });
const ruling = (about: string) => ({ type: "asp.attestation/v0.2", issuer: "did:x:j", body: { kind: "ruling", about } });

function make(mode: "operator-only" | "verified", seated: Record<string, number> = {}, panel: string[] = ["a", "b", "c"]) {
  const tenants = [tenant("t1", "g-1"), tenant("t1b", "g-1"), tenant("t2", "g-2"), tenant("t3"), admin];
  const owners = new OwnerStore();
  owners.add("t1", ["did:a", "did:a2"]); owners.add("t1b", ["did:b"]); owners.add("t2", ["did:c"]); owners.add("t3", ["did:d"]);
  const guard = courtGuard({ mode, minStake: 100, tenants: () => tenants, owners, log: { juror: async (d) => (seated[d] ? { staked: seated[d] } : undefined), drawPanel: async () => panel } });
  const t = (name: string) => tenants.find((x) => x.name === name)!;
  return { guard, t, call: (name: string, rec: unknown) => guard({ tenant: t(name), method: "append", args: [rec] }) };
}

test("court guard, operator-only: tenants cannot register jurors (not even through an import), an admin can", async () => {
  const { call, guard, t } = make("operator-only");
  assert.match((await call("t1", juror("did:a", 500)))!, /run by the operator/);
  assert.match((await guard({ tenant: t("t1"), method: "importRecords", args: [[{ record: juror("did:a", 500) }]] }))!, /cannot be imported/);
  assert.equal(await call("ops", juror("did:court1", 500)), undefined);
  assert.equal(await guard({ tenant: t("t1"), method: "append", args: [{ type: "asp.passport/v0.2", issuer: "did:a", body: {} }] }), undefined, "other records are not the court's business");
});

test("court guard, verified: a Google account, one of its own identities, a minimum stake, one seat for each Google account", async () => {
  const { call } = make("verified", { "did:b": 300 });
  assert.match((await call("t3", juror("did:d", 500)))!, /verified Google account/);
  assert.match((await call("t2", juror("did:a", 500)))!, /identity this tenant has written as/);
  assert.match((await call("t2", juror("did:c", 50)))!, /at least 100/);
  assert.equal(await call("t2", juror("did:c", 100)), undefined, "a different Google account may seat");
  // t1 and t1b share a Google account and did:b (t1b's) is seated: t1 cannot seat another.
  assert.match((await call("t1", juror("did:a", 500)))!, /already has a juror seated/);
  assert.equal(await call("t1b", juror("did:b", 400)), undefined, "the seated identity may update its own stake");
});

test("court guard: no ruling is accepted while no panel can be drawn (the mocked fallback is never used on the service); one is when a panel exists", async () => {
  assert.match((await make("operator-only", {}, []).call("t1", ruling("c1")))!, /no court panel can be drawn/);
  assert.equal(await make("operator-only", {}, ["a"]).call("t1", ruling("c1")), undefined);
});
