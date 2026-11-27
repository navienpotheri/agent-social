// The usage store's arithmetic and persistence (register rows DK1474 and DK1650; found loose by a mutation check): reads and writes are counted apart and by UTC month of the call, records and bytes add up, a tenant's counts
// are forgotten with its account, and a restart keeps both kinds of count; an unreadable file starts again from nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageStore } from "../src/usage.ts";

test("reads and writes are counted apart, by the UTC month of the call, and a month with nothing is zero", () => {
  const u = new UsageStore();
  u.call("a", "read", "2026-11-30T23:59:59Z"); u.call("a", "read", "2026-11-30T23:59:59Z"); u.call("a", "write", "2026-11-01T00:00:00Z");
  u.call("a", "read", "2026-12-01T00:00:00Z");
  assert.deepEqual(u.month("a", "2026-11"), { reads: 2, writes: 1 });
  assert.deepEqual(u.month("a", "2026-12"), { reads: 1, writes: 0 });
  assert.deepEqual(u.month("a", "2027-01"), { reads: 0, writes: 0 });
  assert.deepEqual(u.month("nobody", "2026-11"), { reads: 0, writes: 0 });
  u.call("b", "write", "2026-11-15T00:00:00Z");
  assert.deepEqual(u.allMonth("2026-11"), { a: { reads: 2, writes: 1 }, b: { reads: 0, writes: 1 } });
  assert.deepEqual(u.allMonth("2026-12"), { a: { reads: 1, writes: 0 } }, "a tenant with no calls that month is not listed");
  const copy = u.month("a", "2026-11"); copy.reads = 99;
  assert.equal(u.month("a", "2026-11").reads, 2, "the view is a copy");
});

test("records and bytes add up, are a copy, and are forgotten with the account (with the months)", () => {
  const u = new UsageStore();
  u.add("a", 2, 100); u.add("a", 3, 50);
  assert.deepEqual(u.get("a"), { records: 5, bytes: 150 });
  assert.deepEqual(u.get("none"), { records: 0, bytes: 0 });
  u.call("a", "read", "2026-11-01T00:00:00Z");
  u.remove("a");
  assert.deepEqual(u.get("a"), { records: 0, bytes: 0 });
  assert.deepEqual(u.month("a", "2026-11"), { reads: 0, writes: 0 });
  assert.deepEqual(u.all(), {});
});

test("a restart keeps the counts and the months; an unreadable file starts again from nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const path = join(dir, "usage.json");
  const u = new UsageStore(path);
  u.add("a", 4, 400); u.call("a", "read", "2026-11-05T00:00:00Z"); u.call("a", "write", "2026-11-05T00:00:00Z");
  u.flush();
  const again = new UsageStore(path);
  assert.deepEqual(again.get("a"), { records: 4, bytes: 400 });
  assert.deepEqual(again.month("a", "2026-11"), { reads: 1, writes: 1 });
  assert.deepEqual(Object.keys(again.all()), ["a"], "the months are not a tenant");
  writeFileSync(path, "{ not json");
  const broken = new UsageStore(path);
  assert.deepEqual(broken.all(), {});
});
