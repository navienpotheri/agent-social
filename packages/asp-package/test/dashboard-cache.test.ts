/**
 * The dashboard reads the log incrementally (register row U11): after the first request it fetches only the records after the last one seen, none when the head has not moved, and starts over if the
 * head goes backwards. Fake log, no keys.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardHome } from "../src/dashboard.ts";
import { dashboardReads } from "../src/dashboard.ts";

function fake(n: number) {
  const stored: { id: string; seq: number; record: { type: string; issuer: string; issued_at: string; body: Record<string, unknown> } }[] = [];
  const add = (k: number) => { for (let i = 0; i < k; i++) stored.push({ id: `r${stored.length + 1}`, seq: stored.length + 1, record: { type: "asp.note/v0.2", issuer: "did:web:example.com:users:a", issued_at: "2026-11-14T10:00:00Z", body: {} } }); };
  add(n);
  const calls: number[] = [];
  const log = new Proxy({
    head: async () => ({ seq: stored.length, logHash: `h${stored.length}` }),
    since: async (after: number) => { calls.push(after); return stored.filter((s) => s.seq > after); },
  }, { get: (t, k) => (k in t ? (t as never)[k] : async () => undefined) }) as never;
  return { log, add, calls, stored };
}

test("the first request reads the whole log, a second with the head unmoved reads nothing, and a request after new records reads only those", async () => {
  const f = fake(500);
  dashboardReads.records = 0;
  assert.equal((await dashboardHome(f.log)).counts.records, 500);
  assert.equal(dashboardReads.records, 500);
  await dashboardHome(f.log); await dashboardHome(f.log);
  assert.equal(dashboardReads.records, 500, "no records read while the head has not moved");
  f.add(7);
  assert.equal((await dashboardHome(f.log)).counts.records, 507);
  assert.equal(dashboardReads.records, 507, "only the 7 new records were fetched");
  assert.ok(f.calls.includes(500), "asked for the records after seq 500");
});

test("a log whose head went backwards (another log behind the same handle) is read again from the start", async () => {
  const f = fake(40);
  await dashboardHome(f.log);
  f.stored.length = 10;
  assert.equal((await dashboardHome(f.log)).counts.records, 10);
  assert.equal(f.calls.at(-1), 0);
});

test("two logs do not share a cache", async () => {
  const a = fake(3), b = fake(5);
  assert.equal((await dashboardHome(a.log)).counts.records, 3);
  assert.equal((await dashboardHome(b.log)).counts.records, 5);
});
