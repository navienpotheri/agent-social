import { test } from "node:test";
import assert from "node:assert/strict";
import { CHALLENGE_RE, JoinPickup, challengeOf } from "../src/index.ts";

test("pickup: only the holder of the verifier collects the token, once, within ten minutes", () => {
  let t = 1_000_000;
  const p = new JoinPickup({ now: () => t });
  const verifier = "v".repeat(43);
  const challenge = challengeOf(verifier);
  assert.match(challenge, CHALLENGE_RE);
  assert.notEqual(challenge, verifier, "the browser address carries a hash, not the secret");
  const payload = { tenant: "joiner", token: "tok", quotas: { recordQuota: 1, byteQuota: 2, rateLimitPerMinute: 3 } };
  assert.equal(p.take(verifier), undefined, "nothing before the sign-up");
  p.put(challenge, payload);
  assert.equal(p.take("w".repeat(43)), undefined, "a different verifier finds nothing");
  assert.deepEqual(p.take(verifier), payload);
  assert.equal(p.take(verifier), undefined, "handed over once");
  p.put(challenge, payload);
  t += 11 * 60_000;
  assert.equal(p.take(verifier), undefined, "expired");
});
