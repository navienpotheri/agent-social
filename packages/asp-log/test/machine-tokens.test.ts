import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticate, hashToken, type Tenant } from "../src/index.ts";

const req = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as any;

test("authenticate: a machine token signs in as its tenant, marked as a machine; an expired, revoked or unknown one, and one of a closed tenant, does not", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const tenants: Tenant[] = [
    { name: "team", role: "tenant", tokenSha256: hashToken("person-token"), machineTokens: [
      { name: "ci", tokenSha256: hashToken("ci-token"), createdAt: past, expiresAt: future },
      { name: "old", tokenSha256: hashToken("old-token"), createdAt: past, expiresAt: past },
      { name: "gone", tokenSha256: hashToken("gone-token"), createdAt: past, expiresAt: future, revoked: past },
    ] },
    { name: "shut", role: "tenant", tokenSha256: "", closed: { at: past, retainUntil: future }, machineTokens: [{ name: "ci", tokenSha256: hashToken("shut-token"), createdAt: past, expiresAt: future }] },
  ];
  const as = (t: string) => authenticate(req(t), { tenants });
  assert.equal(as("person-token")?.machine, undefined);
  assert.deepEqual([as("ci-token")?.name, as("ci-token")?.machine], ["team", "ci"]);
  for (const t of ["old-token", "gone-token", "shut-token", "nope"]) assert.equal(as(t), undefined, t);
});
