// DK1470: the service's starter claim form has no total per tenant. A tenant claims for any identity it owns that has not claimed, a batch per request; each identity earns the rest on its own job. Fake values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OwnerStore, StarterPool, STARTER_PER_DID, STARTER_UPFRONT, type Tenant } from "@agent-social/asp-log";
import { claimStarter, releaseStarter, starterStatus, starterClaims, STARTER_BATCH_MAX } from "../src/account.ts";

const FLEET = Array.from({ length: 50 }, (_, i) => `did:web:fleet.example:agents:a${i}`);
const tenantOf = (): Tenant => ({ name: "fleet", role: "tenant", tokenSha256: "0".repeat(64), signup: { at: "2026-11-01T00:00:00Z", addressHash: "h", termsVersion: "v1", google: { sub: "g-fleet", email: "f@example.org" } } });

function service(opts: { jobs?: Set<string>; pool?: number } = {}) {
  const tenants: Tenant[] = [tenantOf()];
  const owners = new OwnerStore();
  owners.add("fleet", FLEET);
  const balances = new Map<string, number>();
  const o = {
    starter: new StarterPool(undefined, opts.pool ?? 1_000_000),
    owners, tenants: () => tenants,
    updateTenant: (name: string, patch: Partial<Tenant>) => { const i = tenants.findIndex((t) => t.name === name); tenants[i] = { ...tenants[i], ...patch }; },
    handle: {
      mint: async (did: string, n: number) => { balances.set(did, (balances.get(did) ?? 0) + n); return balances.get(did)!; },
      log: { reputationOf: async (did: string) => ({ qualifyingJobs: opts.jobs?.has(did) ? 1 : 0 }) },
    },
  } as never;
  return { o, tenants, balances, me: () => tenants[0] };
}

test("DK1470: a tenant with 50 owned identities claims for all of them over several requests; a request names at most one batch", async () => {
  const s = service();
  assert.equal(STARTER_BATCH_MAX, 25);
  const tooMany = await claimStarter(s.o, s.me(), FLEET);
  assert.equal(tooMany[0], 400, "a rate per request, not a total");
  assert.match(JSON.stringify(tooMany[1]), /at most 25 identities in one request/);
  const first = await claimStarter(s.o, s.me(), FLEET.slice(0, 25));
  assert.equal(first[0], 200);
  assert.equal((first[1] as { total: number }).total, 25 * STARTER_UPFRONT);
  assert.equal(starterStatus(s.o, s.me()).unclaimed, 25, "the rest of the fleet has not claimed yet");
  const second = await claimStarter(s.o, s.me(), FLEET.slice(25));
  assert.equal(second[0], 200, JSON.stringify(second[1]));
  assert.equal(starterStatus(s.o, s.me()).unclaimed, 0);
  assert.equal(starterClaims(s.me()).dids.length, 50, "50 identities, each with its own claim");
  assert.equal(s.me().starter!.amount, 50 * STARTER_UPFRONT);
  for (const d of FLEET) assert.equal(s.balances.get(d), STARTER_UPFRONT, `${d} got its own starter credits`);
});

test("DK1470: a second request for an identity that has claimed is refused; a stranger is refused; a mixed request grants only the new ones", async () => {
  const s = service();
  assert.equal((await claimStarter(s.o, s.me(), FLEET.slice(0, 3)))[0], 200);
  const again = await claimStarter(s.o, s.me(), [FLEET[0]]);
  assert.equal(again[0], 409, "the first part is claimed once per identity; the rest needs a job of that identity");
  assert.equal(s.balances.get(FLEET[0]), STARTER_UPFRONT, "nothing more was minted");
  const stranger = await claimStarter(s.o, s.me(), ["did:web:elsewhere.example:agents:x"]);
  assert.equal(stranger[0], 400);
  assert.match(JSON.stringify(stranger[1]), /NOT_YOURS/);
  const mixed = await claimStarter(s.o, s.me(), [FLEET[0], FLEET[3]]);
  assert.equal(mixed[0], 200);
  assert.deepEqual((mixed[1] as { granted: { did: string }[] }).granted.map((g) => g.did), [FLEET[3]], "only the identity that had not claimed is granted");
  assert.equal(s.balances.get(FLEET[0]), STARTER_UPFRONT);
});

test("DK1470: each identity earns the rest on its own job; one agent's job releases nothing to another", async () => {
  const s = service({ jobs: new Set([FLEET[1]]) });
  await claimStarter(s.o, s.me(), FLEET.slice(0, 3));
  const rest = await releaseStarter(s.o, s.me());
  assert.ok("released" in rest);
  assert.deepEqual((rest as { released: { did: string }[] }).released.map((r) => r.did), [FLEET[1]]);
  assert.equal(s.balances.get(FLEET[1]), STARTER_PER_DID);
  assert.equal(s.balances.get(FLEET[0]), STARTER_UPFRONT, "no job of its own, no second part");
  assert.deepEqual(starterClaims(s.me()).owed, [FLEET[0], FLEET[2]]);
  assert.equal(starterStatus(s.o, s.me()).state, "partial");
  const again = await releaseStarter(s.o, s.me());
  assert.ok("reason" in again, "released once, not again");
  assert.equal(s.balances.get(FLEET[1]), STARTER_PER_DID);
  // An identity that has not claimed can still claim after others have had the rest.
  assert.equal((await claimStarter(s.o, s.me(), [FLEET[10]]))[0], 200);
});

test("DK1470: an older record (a claim for two identities with the rest held, or fully released) is read as it was written", () => {
  const held: Tenant = { ...tenantOf(), starter: { at: "2026-11-01T00:00:00Z", amount: 200, dids: [FLEET[0], FLEET[1]], held: 400 } };
  assert.deepEqual(starterClaims(held).owed, [FLEET[0], FLEET[1]]);
  const done: Tenant = { ...tenantOf(), starter: { at: "2026-11-01T00:00:00Z", amount: 1000, dids: [FLEET[0], FLEET[1]] } };
  assert.deepEqual(starterClaims(done).owed, []);
});

test("DK1470: a pool that cannot cover a batch puts the tenant on the waiting list and mints nothing", async () => {
  const s = service({ pool: STARTER_UPFRONT * 2 });
  const r = await claimStarter(s.o, s.me(), FLEET.slice(0, 5));
  assert.equal(r[0], 503);
  assert.equal(s.balances.size, 0);
  assert.equal((s.o as { starter: StarterPool }).starter.position("fleet"), 1, "on the waiting list");
  assert.equal((await claimStarter(s.o, s.me(), FLEET.slice(0, 2)))[0], 200, "a smaller batch the pool covers is served, in its turn");
});
