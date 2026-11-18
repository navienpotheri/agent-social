// Rows DK540 and DK541 at the account: a key-only tenant is held to its own namespace, and its starter status is the same as a sponsored agent's, for its own identity. Fake values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StarterPool, STARTER_PER_DID, STARTER_UPFRONT, type Tenant } from "@agent-social/asp-log";
import { namespaceGuard } from "../src/namespace.ts";
import { starterStatus } from "../src/account.ts";

const keyOnly = (name: string): Tenant => ({ name, role: "tenant", tokenSha256: "0".repeat(64), signup: { at: "2026-11-01T00:00:00Z", addressHash: "h", termsVersion: "v1", keyOnly: { publicKey: "k", did: "did:key:zFake" } } });

test("DK540: a key-only tenant cannot register an identity outside its own namespace", async () => {
  const guard = namespaceGuard({ domain: "society.example" });
  const t = keyOnly("lone-agent");
  const outside = { type: "asp.passport/v0.2", body: { did: "did:web:society.example:u:somebody-else" } };
  assert.match((await guard({ tenant: t, method: "append", args: [outside] })) ?? "", /not an identity this tenant may create/);
  const inside = { type: "asp.passport/v0.2", body: { did: "did:web:society.example:a:lone-agent:helper" } };
  assert.equal(await guard({ tenant: t, method: "append", args: [inside] }), undefined);
  assert.equal(await guard({ tenant: t, method: "append", args: [{ type: "asp.passport/v0.2", body: { did: "did:key:zFake" } }] }), undefined, "its own did:key is its identity");
});

test("DK541: the starter status of a key-only tenant is the same grant as a sponsored agent's: 100 at once, the rest after a first accepted job; a tenant with neither Google nor a key gets none", () => {
  const tenants: Tenant[] = [];
  const o = { starter: new StarterPool(), updateTenant: () => undefined, tenants: () => tenants } as never;
  const t = keyOnly("lone-agent");
  const st = starterStatus(o, t);
  assert.equal(st.state, "available");
  assert.equal(st.upfront, STARTER_UPFRONT);
  assert.equal(st.perDid, STARTER_PER_DID);
  assert.equal(st.amount, STARTER_UPFRONT, "one identity, 100 at once");
  const empty = { starter: new StarterPool(undefined, 0), updateTenant: () => undefined, tenants: () => tenants } as never;
  const waiting = starterStatus(empty, t);
  assert.equal(waiting.state, "waiting", "a key-only claim the pool cannot cover goes to the waiting list like any other");
  const plain: Tenant = { name: "no-route", role: "tenant", tokenSha256: "0".repeat(64), signup: { at: "2026-11-01T00:00:00Z", addressHash: "h", termsVersion: "v1" } };
  assert.equal(starterStatus(o, plain).state, "unavailable");
  const claimed: Tenant = { ...t, starter: { at: "2026-11-02T00:00:00Z", amount: STARTER_UPFRONT, dids: ["did:key:zFake"], held: STARTER_PER_DID - STARTER_UPFRONT } };
  assert.equal(starterStatus(o, claimed).state, "partial");
  assert.equal(starterStatus(o, claimed).held, 400);
});
