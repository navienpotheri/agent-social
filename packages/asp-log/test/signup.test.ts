import { test } from "node:test";
import assert from "node:assert/strict";
import { Signup, leadingZeroBits, powOk, solveChallenge, type Tenant } from "../src/index.ts";

function make(over: Record<string, unknown> = {}) {
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: "0".repeat(64) }];
  let t = Date.parse("2026-10-10T12:00:00Z");
  const s = new Signup({ tenants: () => tenants, add: (x) => { tenants.push(x); }, termsVersion: "v1", termsUrl: "https://example.org/terms", difficulty: 8, secret: Buffer.alloc(32, 7), now: () => t, ...over });
  const go = (address: string, name: string, extra: Record<string, unknown> = {}) => {
    const ch = s.challenge(address);
    return s.register(address, { name, accept_terms: true, terms_version: "v1", challenge: ch.challenge, nonce: solveChallenge(ch.salt, ch.difficulty), ...extra });
  };
  return { s, tenants, go, advance: (ms: number) => { t += ms; } };
}
const code = (r: ReturnType<Signup["register"]>) => (r.ok ? "ok" : r.code);

test("proof of work: leading zero bits are counted, and a solved challenge passes while a wrong nonce does not", () => {
  assert.equal(leadingZeroBits(Buffer.from([0, 0, 0x10])), 19);
  assert.equal(leadingZeroBits(Buffer.from([0x80])), 0);
  const nonce = solveChallenge("salt", 12);
  assert.ok(powOk("salt", nonce, 12));
  assert.ok(!powOk("other", nonce, 12) || nonce === solveChallenge("other", 12), "bound to the salt");
  assert.ok(powOk("anything", "x", 0), "difficulty 0 asks for nothing");
});

test("sign-up: a person gets a tenant with small starting quotas and a token shown once; only the hash is stored, and the terms and a hashed address are recorded", () => {
  const { go, tenants } = make();
  const r = go("203.0.113.5", "alice-bot", { contact: "alice@example.org" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(r.token, /^[A-Za-z0-9_-]{43}$/);
  const t = tenants.find((x) => x.name === "alice-bot")!;
  assert.equal(t.role, "tenant");
  assert.notEqual(t.tokenSha256, r.token);
  assert.deepEqual([t.recordQuota, t.rateLimitPerMinute], [2000, 120]);
  assert.equal(t.signup?.termsVersion, "v1");
  assert.equal(t.signup?.contact, "alice@example.org");
  assert.ok(!JSON.stringify(t).includes("203.0.113.5"), "the address itself is not stored");
});

test("sign-up refuses: no terms, a bad or reserved or taken name, a challenge for another address, reused, expired, or unsolved", () => {
  const { s, go, advance } = make();
  assert.equal(code(go("1.1.1.1", "bob-bot", { accept_terms: false })), "TERMS_NOT_ACCEPTED");
  assert.equal(code(go("1.1.1.1", "bob-bot", { terms_version: "v0" })), "TERMS_NOT_ACCEPTED");
  for (const n of ["ab", "Bob", "9bob", "bob_bot", "x".repeat(33)]) assert.equal(code(go("1.1.1.1", n)), "BAD_NAME", n);
  assert.equal(code(go("1.1.1.1", "admin")), "NAME_TAKEN");
  assert.equal(code(go("1.1.1.1", "bob-bot", { contact: "x".repeat(121) })), "BAD_CONTACT");
  assert.equal(code(go("1.1.1.1", "bob-bot")), "ok");
  assert.equal(code(go("2.2.2.2", "bob-bot")), "NAME_TAKEN");
  const ch = s.challenge("3.3.3.3");
  const nonce = solveChallenge(ch.salt, ch.difficulty);
  const body = { name: "carol-bot", accept_terms: true, terms_version: "v1", challenge: ch.challenge, nonce };
  assert.equal(code(s.register("4.4.4.4", body)), "BAD_CHALLENGE", "another address cannot use it");
  assert.equal(code(s.register("3.3.3.3", { ...body, nonce: "zzzzzzzz" })), "BAD_PROOF");
  assert.equal(code(s.register("3.3.3.3", body)), "ok");
  assert.equal(code(s.register("3.3.3.3", { ...body, name: "dave-bot" })), "CHALLENGE_USED");
  const old = s.challenge("5.5.5.5");
  advance(11 * 60_000);
  assert.equal(code(s.register("5.5.5.5", { name: "erin-bot", accept_terms: true, terms_version: "v1", challenge: old.challenge, nonce: solveChallenge(old.salt, old.difficulty) })), "CHALLENGE_EXPIRED");
  assert.equal(code(s.register("5.5.5.5", { name: "erin-bot", accept_terms: true, terms_version: "v1" })), "BAD_CHALLENGE");
});

test("sign-up limits: three a day from one address, a cap on the day in all, counted from the tenants themselves and clearing after a day; the operator can close it", () => {
  const { s, go, advance, tenants } = make({ dailyCap: 5, perAddressPerDay: 3 });
  for (const n of ["a-one", "a-two", "a-three"]) assert.equal(code(go("9.9.9.9", n)), "ok");
  const fourth = go("9.9.9.9", "a-four");
  assert.deepEqual([code(fourth), !fourth.ok && fourth.status], ["ADDRESS_LIMIT", 429]);
  assert.equal(code(go("8.8.8.8", "b-one")), "ok");
  assert.equal(code(go("7.7.7.7", "c-one")), "ok");
  const full = go("6.6.6.6", "d-one");
  assert.deepEqual([code(full), !full.ok && full.status], ["SIGNUP_FULL", 503]);
  assert.equal(s.info().open, false);
  advance(25 * 3600_000);
  assert.equal(s.info().open, true);
  assert.equal(code(go("9.9.9.9", "a-four")), "ok");
  assert.equal(tenants.filter((x) => x.signup).length, 6);
  // The operator's switch, read on each request.
  let control: { open?: boolean; dailyCap?: number; reason?: string } | undefined = { open: false, reason: "maintenance" };
  const k = make({ control: () => control });
  const closed = k.go("1.2.3.4", "late-bot");
  assert.deepEqual([code(closed), !closed.ok && /maintenance/.test(closed.message)], ["SIGNUP_CLOSED", true]);
  control = { dailyCap: 0 };
  assert.equal(code(k.go("1.2.3.4", "late-bot")), "SIGNUP_FULL");
  control = undefined;
  assert.equal(code(k.go("1.2.3.4", "late-bot")), "ok");
});
