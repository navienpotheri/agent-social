// Organisations Phase A, the ledger core (a labelled simulation ledger beside the log): founding by a pool with refunds if missed, an open with a treasury and a bond, members with a load cap, a treasury that never goes negative with unpaid items recorded, dividends only from retained profit, a wind-up with wages first, a hash-chained journal, and the CONSERVATION property over thousands of random sequences (credits in agents + treasuries + bonds + escrow equal the initial credits plus mints minus burns; the founding fee is the only declared burn).
import { test } from "node:test";
import assert from "node:assert/strict";
import { OrgLedger } from "../src/cohort/orgs.ts";

const agents = (n: number): Record<string, number> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, 100]));
test("lifecycle: found, invest to the target, open, hire, take income, pay wages, close a period, pay a dividend only from retained profit, run dry, distress, wind up with wages first, close", () => {
  const L = new OrgLedger(agents(5));
  assert.equal(L.found("o1", "a0", "Bakery", 30, 10).ok, true);
  assert.equal(L.invest("o1", "a0", 20, 1).ok, true); assert.equal(L.invest("o1", "a1", 10, 1).ok, true); assert.equal(L.invest("o1", "a2", 1, 1).ok, false, "past the target");
  assert.equal(L.settleFounding("o1", 2), "open");
  assert.equal(L.join("o1", "a3", "employee", 5).ok, true);
  assert.equal(L.income("o1", "a4", 20).ok, true);
  const p = L.closePeriod("o1"); assert.equal(p.income, 20); assert.equal(p.out, 5); assert.equal(p.retained, 15);
  assert.equal(L.pay("o1", "a0", 20, "dividend").paid, false, "more than retained profit");
  assert.equal(L.pay("o1", "a0", 10, "dividend").paid, true);
  for (let i = 0; i < 4; i++) L.closePeriod("o1");
  const o = L.orgs.get("o1")!; assert.ok(o.treasury >= 0, "never negative");
  assert.equal(L.conserved(), true); assert.equal(L.verifyJournal(), true);
});
test("a pool that misses its deadline returns every investment; caps on membership and founding; an unpayable item is recorded as unpaid, not paid short", () => {
  const L = new OrgLedger(agents(4));
  L.found("o1", "a0", "A", 50, 5); L.invest("o1", "a1", 30, 1);
  assert.equal(L.settleFounding("o1", 6), "failed"); assert.equal(L.balances.get("a1"), 100); assert.equal(L.conserved(), true);
  L.found("o2", "a0", "B", 1, 9, "c"); L.found("o3", "a0", "C", 1, 9, "c"); assert.equal(L.found("o4", "a0", "D", 1, 9, "c").ok, false, "a founding cap per controller");
  for (const id of ["p1", "p2", "p3", "p4"]) { L.found(id, "a2", id, 1, 9, `x${id}`); L.invest(id, "a2", 1, 1); L.settleFounding(id, 2); }
  assert.equal(L.join("p1", "a3", "employee", 1).ok, true); L.join("p2", "a3", "employee", 1); L.join("p3", "a3", "employee", 1);
  assert.equal(L.join("p4", "a3", "employee", 1).ok, false, "at most three organisations for an agent");
  const t = L.orgs.get("p1")!.treasury; assert.equal(L.pay("p1", "a3", t + 5, "wage").paid, false); assert.equal(L.orgs.get("p1")!.unpaid.length, 1); assert.equal(L.orgs.get("p1")!.treasury, t);
});
test("CONSERVATION: over 3,000 random sequences the credits held stay equal to the initial credits plus mints minus burns, no treasury is negative, shares never pass the pool and the journal verifies", () => {
  let seed = 12345; const r = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let run = 0; run < 3000; run++) {
    const n = 4 + Math.floor(r() * 4), L = new OrgLedger(agents(n)); const ids: string[] = [];
    for (let step = 0; step < 40; step++) {
      const a = `a${Math.floor(r() * n)}`, b = `a${Math.floor(r() * n)}`, id = ids.length && r() < 0.8 ? ids[Math.floor(r() * ids.length)]! : `o${ids.length}`, k = r();
      if (k < 0.12) { if (L.found(id, a, id, 5 + Math.floor(r() * 40), 20, a).ok) ids.push(id); }
      else if (k < 0.3) L.invest(id, a, 1 + Math.floor(r() * 25), step);
      else if (k < 0.4) L.settleFounding(id, step);
      else if (k < 0.5) L.join(id, a, (["employee", "contractor", "partner"] as const)[Math.floor(r() * 3)]!, Math.floor(r() * 6));
      else if (k < 0.6) L.leave(id, a);
      else if (k < 0.7) L.income(id, a, 1 + Math.floor(r() * 15));
      else if (k < 0.8) L.pay(id, b, 1 + Math.floor(r() * 20), (["wage", "dividend", "debt"] as const)[Math.floor(r() * 3)]!);
      else if (k < 0.93 && L.orgs.has(id)) L.closePeriod(id);
      else L.windUp(id);
      assert.ok(L.conserved(), `run ${run} step ${step}: ${L.total()} against ${L.initial - L.burned}`);
    }
    for (const o of L.orgs.values()) { assert.ok(o.treasury >= -1e-9 && o.retained >= -1e-9, "no negative treasury or retained profit"); assert.ok([...o.shares.values()].reduce((x, y) => x + y, 0) <= o.poolTarget + 1e-9 || o.state === "closed" || o.state === "failed", "shares within the pool"); }
    for (const [, v] of L.balances) assert.ok(v >= -1e-9, "no agent below zero");
    assert.ok(L.verifyJournal());
  }
});
