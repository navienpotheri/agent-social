// The starter pool is sized from the launch target (register row DK74): 1,000 tenants, two identities each, 500 credits each. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StarterPool, STARTER_POOL, STARTER_LAUNCH_TENANTS, STARTER_PER_DID, STARTER_MAX_DIDS, STARTER_UPFRONT, starterPoolFor } from "../src/starter.ts";

test("DK74: the launch pool is the arithmetic of the target, and covers the whole grant of every planned tenant; the up-front parts alone are a fifth of it", () => {
  assert.equal(STARTER_LAUNCH_TENANTS, 1000);
  assert.equal(starterPoolFor(1000), 1000 * 2 * 500);
  assert.equal(STARTER_POOL, 1_000_000);
  assert.ok(STARTER_POOL >= STARTER_LAUNCH_TENANTS * STARTER_MAX_DIDS * STARTER_PER_DID, "every planned tenant can take the whole grant for both identities");
  assert.equal(STARTER_LAUNCH_TENANTS * STARTER_MAX_DIDS * STARTER_UPFRONT, 200_000, "the old default covered only the up-front parts");
  assert.equal(starterPoolFor(-5), 0);
  const pool = new StarterPool();
  assert.equal(pool.cap, 1_000_000);
  assert.equal(pool.left, 1_000_000);
});

test("DK74: the operator runbook states the launch pool and where its use is shown", () => {
  const rb = readFileSync(fileURLToPath(new URL("../../../docs/operator-runbook.md", import.meta.url)), "utf8");
  assert.match(rb, /At launch the pool is 1,000,000 credits/);
  assert.match(rb, /asp credits guard/);
  assert.match(rb, /\/economy\/supply/);
});
