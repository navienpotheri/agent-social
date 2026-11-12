import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGuardReport, topBalanceShare, starterPoolOf, type LedgerRows } from "../src/index.ts";
import { STARTER_POOL_DID, TREASURY_DID } from "../src/index.ts";

// The monetary guard measures (credits.md 5.6, CR-19; DK1): thresholds are the specification's proposals; every measure only reads.
const rows = (accounts: [string, number][], mints: { did: string; totalMinted: number; signedMinted?: number }[] = []): LedgerRows => ({ head: { seq: 1, logHash: "h" }, accounts: accounts.map(([did, balance]) => ({ did, balance })), mints, escrows: [], jurors: [], reports: [] } as unknown as LedgerRows);
const people = (n: number, each: number) => Array.from({ length: n }, (_, i) => [`did:web:example.com:u:p${i}`, each] as [string, number]);

test("hoarding (G5): the share held by the top 1 % of accounts, leaving out the society's own accounts", () => {
  const even = topBalanceShare(rows([...people(100, 10), [TREASURY_DID, 5000]]), 0.01);
  assert.deepEqual([even.accountsConsidered, even.topCount], [100, 1]);
  assert.ok(Math.abs(even.topShare - 0.01) < 1e-9, "the Treasury is not counted as a hoarder");
  const hoard = topBalanceShare(rows([...people(99, 1), ["did:web:example.com:u:whale", 1000]]), 0.01);
  assert.ok(hoard.topShare > 0.9);
  assert.deepEqual(topBalanceShare(rows([]), 0.01), { accountsConsidered: 0, topCount: 0, topShare: 0 });
});

test("the starter pool as the log holds it: funded by signed mints, used by claims; nothing funded means nothing to measure", () => {
  assert.deepEqual(starterPoolOf(rows([])), { funded: 0, balance: 0, used: 0 });
  assert.deepEqual(starterPoolOf(rows([[STARTER_POOL_DID, 150]], [{ did: STARTER_POOL_DID, totalMinted: 250, signedMinted: 250 }])), { funded: 250, balance: 150, used: 100 });
});

function handle(o: { circulating?: number; treasury?: number; verdict?: "balanced" | "mismatch"; mintedByReason?: Record<string, number>; top?: number; pool?: { funded: number; balance: number; used: number } }) {
  return {
    log: {
      creditAudit: async () => ({ circulating: o.circulating ?? 1000, treasury: o.treasury ?? 0, verdict: o.verdict ?? "balanced" }),
      creditFlows: async () => ({ mintedByReason: o.mintedByReason ?? {} }),
      creditConcentration: async () => ({ accountsConsidered: 100, topCount: 1, topShare: o.top ?? 0.05 }),
      starterPoolState: async () => o.pool ?? { funded: 0, balance: 0, used: 0 },
    },
  } as never;
}
const byId = (r: Awaited<ReturnType<typeof computeGuardReport>>, id: string) => r.measures.find((m) => m.id === id);

test("a healthy society triggers nothing, and the measures the log cannot compute are named with their reasons, not guessed", async () => {
  const r = await computeGuardReport({ handle: handle({}), now: () => Date.parse("2026-11-12T00:00:00Z") });
  assert.equal(r.anyTriggered, false);
  assert.deepEqual(r.measures.map((m) => m.id), ["G1", "G5", "G6", "G8"]);
  assert.deepEqual(r.unavailable.map((u) => u.id).sort(), ["G2", "G3", "G4", "G7"]);
  assert.match(r.unavailable.find((u) => u.id === "G2")!.reason, /asp credits grant --to did:web:asp.local:starter-pool/);
  assert.match(r.unavailable.find((u) => u.id === "G7")!.reason, /upkeep/);
});

test("each trigger fires at its own threshold: issuance above 10 %, starter pool above 80 %, hoarding above 50 %, Treasury above 25 %, any mismatch", async () => {
  const at = () => Date.parse("2026-11-12T00:00:00Z");
  assert.equal(byId(await computeGuardReport({ handle: handle({ circulating: 1000, mintedByReason: { test: 100 } }), now: at }), "G1")!.triggered, false, "exactly 10 % is not above it");
  assert.equal(byId(await computeGuardReport({ handle: handle({ circulating: 1000, mintedByReason: { test: 80, repair: 21 } }), now: at }), "G1")!.triggered, true);
  const pool = await computeGuardReport({ handle: handle({ pool: { funded: 1000, balance: 190, used: 810 } }), now: at });
  assert.equal(byId(pool, "G2")!.triggered, true);
  assert.ok(!pool.unavailable.some((u) => u.id === "G2"), "once the pool is funded G2 is a measure");
  assert.equal(byId(await computeGuardReport({ handle: handle({ pool: { funded: 1000, balance: 500, used: 500 } }), now: at }), "G2")!.triggered, false);
  assert.equal(byId(await computeGuardReport({ handle: handle({ top: 0.51 }), now: at }), "G5")!.triggered, true);
  assert.equal(byId(await computeGuardReport({ handle: handle({ circulating: 1000, treasury: 260 }), now: at }), "G6")!.triggered, true);
  const mismatch = await computeGuardReport({ handle: handle({ verdict: "mismatch" }), now: at });
  assert.equal(byId(mismatch, "G8")!.triggered, true);
  assert.equal(mismatch.anyTriggered, true);
  assert.match(byId(mismatch, "G8")!.action, /stop institution purchases/);
});

test("with nothing in circulation no ratio divides by zero", async () => {
  const r = await computeGuardReport({ handle: handle({ circulating: 0, treasury: 50, mintedByReason: { test: 10 } }) });
  assert.equal(byId(r, "G1")!.value, 0);
  assert.equal(byId(r, "G6")!.value, 0);
});
