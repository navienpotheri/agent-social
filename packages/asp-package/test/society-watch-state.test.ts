/**
 * The society watcher's saved state and its purchase signal (register row DK97): a restart resumes from the saved cursor and reads only new records, a pass over a log of 1,000,000 records takes under 5 seconds,
 * a damaged state file starts over, and a burst of purchases by one sponsor's agents is found while ordinary buying is not. Fake log, fake keys.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AspRecord } from "@agent-social/asp-core";
import { SocietyWatcher } from "../src/index.ts";

type Row = { seq: number; id: string; record: AspRecord };
const rec = (type: string, issuer: string, at: string, body: Record<string, unknown>): AspRecord => ({ type, id: "x", issuer, actor: issuer, subject: null, prev: null, issued_at: at, body } as unknown as AspRecord);
/** Rows are numbered from 1 in order, so the page after `after` is a slice (a real log reads by index too). */
const reader = (rows: Row[]) => ({ since: async (after: number, limit: number) => rows.slice(after, after + limit) });
const T0 = Date.parse("2026-11-14T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const dirOf = () => mkdtempSync(join(tmpdir(), "asp-watch-state-"));

test("a pass over a log of 1,000,000 records takes under 5 seconds, and a restart with the saved state reads none of them again", async () => {
  const N = 1_000_000;
  const rows: Row[] = new Array(N);
  const filler = rec("asp.note/v0.2", "did:web:example.com:users:a", iso(T0), {});
  for (let i = 0; i < N; i++) rows[i] = { seq: i + 1, id: "i", record: filler };
  const dir = dirOf();
  const now = () => new Date(T0 + 60_000);
  const first = new SocietyWatcher({ log: reader(rows), dir, now });
  const t = Date.now();
  await first.tick();
  const took = Date.now() - t;
  assert.ok(took < 5000, `a pass over ${N} records took ${took} ms`);
  assert.equal(first.recordsRead, N);
  const second = new SocietyWatcher({ log: reader(rows), dir, now });
  await second.tick();
  assert.equal(second.recordsRead, 0, "the restart resumed from the saved cursor");
  rows.push({ seq: N + 1, id: "j", record: filler });
  await second.tick();
  assert.equal(second.recordsRead, 1, "only the new record is read");
});

test("a missing or damaged state file starts from the beginning, as before", async () => {
  const rows: Row[] = [1, 2, 3].map((n) => ({ seq: n, id: `i${n}`, record: rec("asp.note/v0.2", "did:web:example.com:users:a", iso(T0), {}) }));
  const dir = dirOf();
  const a = new SocietyWatcher({ log: reader(rows), dir, now: () => new Date(T0) });
  await a.tick();
  writeFileSync(join(dir, "state.json"), "{ not json");
  const b = new SocietyWatcher({ log: reader(rows), dir, now: () => new Date(T0) });
  await b.tick();
  assert.equal(b.recordsRead, 3);
  writeFileSync(join(dir, "state.json"), JSON.stringify({ cursor: -4, window: "no" }));
  const c = new SocietyWatcher({ log: reader(rows), dir, now: () => new Date(T0) });
  await c.tick();
  assert.equal(c.recordsRead, 3, "a state that is not a cursor and a window is ignored");
  assert.equal(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).cursor, 3);
});

const SPONSOR = "did:web:example.com:users:sponsor", HELPERS = ["one", "two", "three"].map((n) => `did:web:example.com:agents:${n}`);
const passport = (seq: number, did: string): Row => ({ seq, id: `p${seq}`, record: rec("asp.passport/v0.2", did, iso(T0), { did, sponsor: SPONSOR }) });
const purchase = (seq: number, who: string, at: number): Row => ({ seq, id: `b${seq}`, record: rec("asp.purchase/v0.2", who, iso(at), { service: "lesson", institution: "did:web:example.com:academy", quantity: 1, amount: { value: 5, unit: "credit" } }) });

test("a burst of purchases by one sponsor's agents is a signed finding naming the sponsor, the buyers and the credits; ordinary buying is not, and the burst is told once", async () => {
  const rows: Row[] = HELPERS.map((h, i) => passport(i + 1, h));
  for (let i = 0; i < 24; i++) rows.push(purchase(rows.length + 1, HELPERS[i % 3], T0 + i * 10_000)); // 24 purchases in 4 minutes
  for (let i = 0; i < 5; i++) rows.push(purchase(rows.length + 1, "did:web:example.com:users:other", T0 + i * 3_600_000)); // five an hour apart: ordinary
  const told: string[] = [];
  const w = new SocietyWatcher({ log: reader(rows), dir: dirOf(), now: () => new Date(T0 + 6 * 3_600_000), alert: (f) => { told.push(f.finding.kind); }, lookbackMs: 7 * 3_600_000 });
  const found = await w.tick();
  assert.equal(found.length, 1);
  const f = found[0].finding;
  assert.equal(f.kind, "purchase_burst");
  const d = f.detail as { sponsor: string; issuers: string[]; count: number; amount: number };
  assert.deepEqual([d.sponsor, d.issuers.length, d.count, d.amount], [SPONSOR, 3, 24, 120]);
  rows.push(purchase(rows.length + 1, HELPERS[0], T0 + 5 * 60_000)); // another tick over the same burst finds nothing new
  assert.deepEqual((await w.tick()).length, 0);
  assert.deepEqual(told, ["purchase_burst"]);
});
