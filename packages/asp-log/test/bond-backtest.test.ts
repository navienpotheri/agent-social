// The back-test of the bond model on a log's own history (register row DK1333): runs are settled contracts, an event is a slash or blocked attempts, the model's expectation is taken BEFORE each run is counted, and the report
// compares it with what happened. Synthetic records, no signing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtestBond } from "../src/bond-backtest.ts";

let n = 0;
const day = (d: number) => new Date(Date.parse("2026-01-01T00:00:00Z") + d * 86_400_000).toISOString();
const run = (agent: string, d: number, o: { slashed?: boolean; blocked?: boolean } = {}) => {
  const c = `c${++n}`;
  return [
    { id: c, type: "asp.contract/v0.2", issuer: "p", issued_at: day(d), body: { performer: agent } },
    ...(o.blocked ? [{ id: `a${++n}`, type: "asp.action/v0.2", issuer: agent, issued_at: day(d + 0.1), body: { contract: c, blocked_attempts: [{ scope: "x", count: 1 }] } }] : []),
    { id: `s${++n}`, type: "asp.settlement/v0.2", issuer: "bank", issued_at: day(d + 0.2), body: { contract: c, bond_slashed: { value: o.slashed ? 5 : 0, unit: "credit" } } },
  ];
};

test("runs and events are counted from settlements, slashes and blocked attempts; the first run is judged on the prior alone", () => {
  const recs = [...run("a", 0), ...run("a", 1, { slashed: true }), ...run("a", 2, { blocked: true }), ...run("b", 3)];
  const r = backtestBond(recs);
  assert.deepEqual([r.runs, r.events, r.agents], [4, 2, 2]);
  assert.equal(r.observedRate, 0.5);
  assert.ok(r.meanPredicted > 0 && r.meanPredicted < 0.2, "the model expected events to be rare");
  assert.match(r.note, /only 4 runs/);
});

test("the records are replayed in time order whatever order they are given in", () => {
  const recs = [...run("a", 0), ...run("a", 1, { slashed: true }), ...run("a", 2)];
  const shuffled = [...recs].reverse();
  assert.deepEqual(backtestBond(shuffled), backtestBond(recs));
});

test("a clean population is predicted well and every agent ends inside its upper bound; a model that expects rare events scores worse on a reckless one", () => {
  const clean = Array.from({ length: 10 }, (_, a) => Array.from({ length: 10 }, (_, i) => run(`agent${a}`, a * 20 + i)).flat()).flat();
  const c = backtestBond(clean);
  assert.equal(c.runs, 100);
  assert.equal(c.events, 0);
  assert.equal(c.agentsWithin, 10);
  assert.ok(c.brier < 0.02, "rare events were expected and none happened");
  const reckless = Array.from({ length: 10 }, (_, a) => Array.from({ length: 10 }, (_, i) => run(`bad${a}`, a * 20 + i, { slashed: i % 2 === 0 })).flat()).flat();
  const w = backtestBond(reckless);
  assert.ok(w.observedRate === 0.5 && w.meanPredicted < 0.5, "the model learns slowly but expected fewer events than happened");
  assert.ok(w.brier > c.brier);
  assert.equal(backtestBond([]).runs, 0);
});

test("a settlement for a contract the log does not hold is not a run", () => {
  const r = backtestBond([{ id: "s1", type: "asp.settlement/v0.2", issuer: "bank", issued_at: day(0), body: { contract: "unknown", bond_slashed: { value: 0 } } }]);
  assert.equal(r.runs, 0);
});

test("the log reads its own history: a real log with a few settled jobs reports its runs", async () => {
  const { Kit } = await import("./academy-kit.ts");
  const kit = new Kit();
  const sponsor = await kit.person("bt-sponsor");
  const agent = await kit.agent("bt-agent", sponsor);
  const principal = await kit.person("bt-principal");
  await kit.acceptedJob(principal, agent);
  await kit.acceptedJob(principal, agent);
  const r = await kit.log.bondBacktest();
  assert.equal(r.runs, 2);
  assert.equal(r.events, 0);
  assert.equal(r.agents, 1);
});

test("an earlier event raises what the model expects of an agent afterwards, and an agent whose rate is above its bound is not counted as within it", () => {
  const slipped = [...run("a", 0, { slashed: true }), ...run("a", 1), ...run("a", 2), ...run("a", 3)];
  const clean = [...run("b", 0), ...run("b", 1), ...run("b", 2), ...run("b", 3)];
  assert.ok(backtestBond(slipped).meanPredicted > backtestBond(clean).meanPredicted, "after a slash the next runs are expected to be riskier");
  // an agent slashed on every run: its observed rate (1) is above the bound the model gave it before its last run
  const bad = Array.from({ length: 5 }, (_, i) => run("c", i, { slashed: true })).flat();
  assert.equal(backtestBond(bad).agentsWithin, 0);
});
