// Boundary tests of the starter status (gap M9, DK1470; mutation review 2026-11-22): the pool must hold the first part for a claim to be offered, an admin gets none even with a Google sign-up, and one Google
// account that has already claimed blocks another tenant's claim but not its own look at an existing grant. Stand-in options, fake names, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTER_UPFRONT } from "@agent-social/asp-log";
import { starterStatus, type AccountOptions } from "../src/account.ts";

type T = Record<string, unknown>;
const tenant = (name: string, over: T = {}): T => ({ name, role: "tenant", tokenSha256: "x", signup: { at: "2026-11-01T00:00:00Z", addressHash: "x".repeat(24), termsVersion: "v1", google: { sub: "g-" + name, email: `${name}@example.org` } }, ...over });
const opts = (tenants: T[], left: number, waiting: string[] = []) => ({
  tenants: () => tenants, updateTenant: () => {}, owners: { of: () => ["did:key:zfake"] },
  starter: { left, waitingList: waiting, position: (n: string) => waiting.indexOf(n) + 1 },
}) as unknown as AccountOptions;

test("the first part is offered at exactly STARTER_UPFRONT left, not at one less or with none", () => {
  const t = tenant("pool-a");
  assert.equal(starterStatus(opts([t], STARTER_UPFRONT), t as never).state, "available");
  assert.equal(starterStatus(opts([t], STARTER_UPFRONT + 1), t as never).state, "available");
  assert.equal(starterStatus(opts([t], STARTER_UPFRONT - 1), t as never).state, "waiting");
  assert.equal(starterStatus(opts([t], 1), t as never).state, "waiting");
  assert.equal(starterStatus(opts([t], 0), t as never).state, "waiting");
});

test("an admin gets no starter credits even when it has a Google sign-up", () => {
  const a = tenant("adm", { role: "admin" });
  const v = starterStatus(opts([a], 10_000), a as never);
  assert.equal(v.state, "unavailable");
  assert.match(v.reason!, /admins mint credits directly/);
});

test("a Google account that has already claimed on one tenant blocks another tenant, and a claim by the same tenant does not block itself", () => {
  const first = tenant("g-one", { starter: { at: "2026-11-02T00:00:00Z", amount: 100, dids: ["did:key:zfake"], restDids: [] } });
  (first.signup as T).google = { sub: "shared", email: "s@example.org" };
  const second = tenant("g-two"); (second.signup as T).google = { sub: "shared", email: "s@example.org" };
  const both = [first, second];
  const blocked = starterStatus(opts(both, 10_000), second as never);
  assert.equal(blocked.state, "unavailable");
  assert.match(blocked.reason!, /already claimed/);
  assert.notEqual(starterStatus(opts(both, 10_000), first as never).state, "unavailable", "the claimant still sees its own grant");
  // A tenant of the same Google account that has NOT claimed does not block.
  const idle = tenant("g-idle"); (idle.signup as T).google = { sub: "shared", email: "s@example.org" };
  assert.equal(starterStatus(opts([idle, second], 10_000), second as never).state, "available");
});
