// The per-Google-account tenant limit (gap M9, mutation review 2026-11-22): a closed tenant no longer counts, the limit is exact, and the default is three. Fake names; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Signup } from "../src/signup.ts";

const body = (name: string) => ({ name, accept_terms: true, terms_version: "t", declaration: "adult_or_guardian" });
const google = { sub: "g-limit", email: "a@example.org" };
const make = (tenants: { name: string; closed?: boolean; signup?: unknown }[], per?: number) =>
  new Signup({ tenants: () => tenants as never, add: (t) => { tenants.push(t as never); }, termsVersion: "t", difficulty: 0, perAddressPerDay: 100, dailyCap: 100, ...(per ? { perGoogleAccount: per } : {}) });

test("a closed tenant frees a place under the Google account's limit; an open one does not", () => {
  const tenants: { name: string; closed?: boolean; signup?: unknown }[] = [];
  const s = make(tenants, 2);
  assert.equal(s.registerVerified("203.0.113.1", body("one-a"), google).ok, true);
  assert.equal(s.registerVerified("203.0.113.1", body("one-b"), google).ok, true);
  const third = s.registerVerified("203.0.113.1", body("one-c"), google);
  assert.equal(third.ok, false);
  assert.equal((third as { code: string }).code, "GOOGLE_LIMIT");
  tenants.find((t) => t.name === "one-a")!.closed = true;
  assert.equal(s.registerVerified("203.0.113.1", body("one-c"), google).ok, true, "closing one frees one place");
  assert.equal((s.registerVerified("203.0.113.1", body("one-d"), google) as { code?: string }).code, "GOOGLE_LIMIT");
});

test("the default limit is three tenants for one Google account", () => {
  const tenants: { name: string; closed?: boolean }[] = [];
  const s = make(tenants);
  for (const n of ["def-a", "def-b", "def-c"]) assert.equal(s.registerVerified("203.0.113.1", body(n), google).ok, true);
  assert.equal((s.registerVerified("203.0.113.1", body("def-d"), google) as { code?: string }).code, "GOOGLE_LIMIT");
});
