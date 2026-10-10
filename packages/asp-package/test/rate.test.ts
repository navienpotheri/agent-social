import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/gateway/rate.ts";

test("RateLimiter: calls to one host are counted over a sliding minute, hosts are counted apart, and the total caps them all", () => {
  let t = 1_000_000;
  const r = new RateLimiter(() => t);
  const rate = { per_host_per_minute: 3, total_per_minute: 5 };
  assert.deepEqual([1, 2, 3].map(() => r.take(["a.example"], rate).ok), [true, true, true]);
  const refused = r.take(["a.example"], rate);
  assert.equal(refused.ok, false);
  assert.match(refused.reason!, /a.example was called 3 times in the last minute; this job's Mandate allows 3 a minute to any one host/);
  assert.equal(r.take(["b.example"], rate).ok, true, "another host has its own count");
  assert.equal(r.take(["b.example"], rate).ok, true);
  const total = r.take(["c.example"], rate);
  assert.equal(total.ok, false, "five calls have been made in the minute");
  assert.match(total.reason!, /allows 5 network calls a minute and 5 were made/);
  // The window slides: a minute on, the first host is open again.
  t += 61_000;
  assert.equal(r.take(["a.example"], rate).ok, true);
  // A call with no readable host counts only toward the total.
  const u = new RateLimiter(() => t);
  assert.deepEqual([1, 2, 3, 4].map(() => u.take([], { per_host_per_minute: 1, total_per_minute: 3 }).ok), [true, true, true, false]);
  // A refused call is not counted.
  const w = new RateLimiter(() => t);
  w.take(["x.example"], { per_host_per_minute: 1 });
  for (let i = 0; i < 5; i++) w.take(["x.example"], { per_host_per_minute: 1 });
  t += 61_000;
  assert.equal(w.take(["x.example"], { per_host_per_minute: 1 }).ok, true, "the refused calls did not extend the wait");
});
