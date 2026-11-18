// DK543: the measure of how fast agents spend the starter, on a simulated cohort of fast spenders, never-spenders and run-outs. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AspRecord } from "@agent-social/asp-core";
import { starterSpendOf, computeGuardReport } from "../src/index.ts";
import { economySupplyRoutes } from "../../asp-package/src/economy-supply.ts";

const DAY = 86_400_000, NOW = Date.parse("2026-11-19T00:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const claim = (who: string, daysAgo: number) => ({ type: "asp.starter_claim/v0.2", id: `c-${who}`, issuer: who, actor: who, subject: null, body: { part: "upfront", amount: { value: 100, unit: "credit" } }, prev: null, issued_at: at(daysAgo) }) as unknown as AspRecord;
let n = 0;
const buy = (who: string, daysAgo: number, v: number) => ({ type: "asp.purchase/v0.2", id: `p${n++}`, issuer: who, actor: who, subject: null, body: { service: "x", amount: { value: v, unit: "credit" } }, prev: null, issued_at: at(daysAgo) }) as unknown as AspRecord;

function cohort(fast: number, never: number, runout: number, steady: number): AspRecord[] {
  const r: AspRecord[] = [];
  for (let i = 0; i < fast; i++) { const w = `did:f${i}`; r.push(claim(w, 30), buy(w, 28, 200), buy(w, 25, 250), buy(w, 1, 10)); }   // 90 percent of 500 in 5 days, still buying
  for (let i = 0; i < never; i++) r.push(claim(`did:n${i}`, 30));
  for (let i = 0; i < runout; i++) { const w = `did:r${i}`; r.push(claim(w, 30), buy(w, 20, 460)); }                       // spent it all 10 days after claiming, stopped
  for (let i = 0; i < steady; i++) { const w = `did:s${i}`; r.push(claim(w, 30), buy(w, 20, 100), buy(w, 2, 50)); }        // slow, still going
  return r;
}

test("DK543: the measure computes days to spend 90 percent (median, p90), never-spenders and run-outs from a simulated cohort", () => {
  const rep = starterSpendOf(cohort(10, 5, 5, 10), NOW);
  assert.equal(rep.claimed, 30);
  assert.equal(rep.mature, 30);
  assert.equal(rep.daysToSpend90.reached, 15);
  assert.equal(rep.daysToSpend90.median, 5);   // ten fast spenders at 5 days, five run-outs at 10: the 8th of 15 is a fast one
  assert.equal(rep.daysToSpend90.p90, 10);
  assert.equal(rep.neverSpentShare, 5 / 30);
  assert.equal(rep.runOutShare, 5 / 30, "only the run-outs that stopped; the fast ones still buy");
  assert.equal(rep.verdict, "keep_starter");
  assert.doesNotMatch(JSON.stringify(rep), /did:/, "figures only, no identity");
});

test("DK543: a high run-out share tells the owner to raise the starter; too few mature agents says so instead of guessing; new claims are not judged", () => {
  assert.equal(starterSpendOf(cohort(2, 2, 20, 2), NOW).verdict, "raise_starter");
  const few = starterSpendOf(cohort(1, 1, 3, 1), NOW);
  assert.equal(few.verdict, "too_little_data");
  const fresh = starterSpendOf([claim("did:new", 3)], NOW);
  assert.deepEqual([fresh.claimed, fresh.mature, fresh.runOutShare], [1, 0, 0]);
  assert.deepEqual(starterSpendOf([], NOW).daysToSpend90, { reached: 0, median: null, p90: null });
});

test("DK543: the guard shows G9 with the threshold, and the supply page shows the figures in HTML and JSON", async () => {
  const recs = cohort(2, 2, 20, 2);
  const handle = { log: {
    creditAudit: async () => ({ circulating: 1000, treasury: 0, verdict: "balanced" }), creditFlows: async () => ({ mintedByReason: {} }),
    creditConcentration: async () => ({ accountsConsidered: 100, topCount: 1, topShare: 0.05 }), starterPoolState: async () => ({ funded: 0, balance: 0, used: 0 }),
    starterSpend: async (t: number) => starterSpendOf(recs, t),
  } } as never;
  const g = await computeGuardReport({ handle, now: () => NOW });
  const g9 = g.measures.find((m) => m.id === "G9")!;
  assert.equal(g9.triggered, true);
  assert.match(g9.threshold, /above 0\.3/);
  assert.match(g9.action, /raising the starter/);
  const audit = { head: { seq: 1, logHash: "sha256:" + "0".repeat(64) }, minted: 0, mintedSigned: 0, mintedUnsigned: 0, burned: 0, treasury: 0, institutions: [], accounts: 0, balances: 0, circulating: 0, locked: { escrow: 0, bond: 0, feeReserves: 0, jurorStakes: 0, reportDeposits: 0, total: 0 }, verdict: "balanced" as const, problems: [] };
  const route = economySupplyRoutes({ audit: async () => audit, starterSpend: async () => starterSpendOf(recs, NOW) });
  const call = async (q: string) => { let body = ""; const res = { writeHead() {}, end(b?: string) { body = b ?? ""; } } as never; await route({ url: "/economy/supply" + q, method: "GET", headers: {} } as never, res); return body; };
  assert.match(await call(""), /Starter spending[\s\S]*Spent it and stopped: 7[0-9] percent/);
  assert.equal(JSON.parse(await call("?format=json")).starterSpend.verdict, "raise_starter");
});
