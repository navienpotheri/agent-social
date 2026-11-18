// DK545: the plan of the weekly handout on a simulated society. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planHandout, hoardFactor, DEFAULT_HANDOUT, type HandoutAgent } from "../src/handout-plan.ts";

const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-11-${10 + (i % 5)}`);
const agent = (did: string, o: Partial<HandoutAgent> = {}): HandoutAgent => ({ did, level: "sponsored", address: `a-${did}`, balance: 100, actDays: days(4), ...o });

test("the default is 50 credits a week and a parameter: another size changes every payment", () => {
  assert.equal(DEFAULT_HANDOUT.amount, 50);
  const one = [agent("did:a", { balance: 10 })];
  assert.equal(planHandout("2026-W47", one, 1000).lines[0].paid, 50);
  assert.equal(planHandout("2026-W47", one, 1000, { amount: 20, levelCap: { sponsored: 20, key_only: 20 } }).lines[0].paid, 20);
});

test("only agents active this week are paid: an idle farm key, a one-day burst and a house agent get nothing, with the reason", () => {
  const plan = planHandout("2026-W47", [agent("did:active"), agent("did:idle", { actDays: [] }), agent("did:burst", { actDays: ["2026-11-10", "2026-11-10", "2026-11-10", "2026-11-10"] }), agent("did:house", { house: true }), agent("did:q", { eligible: false })], 1000);
  assert.deepEqual(plan.lines.map((l) => l.did), ["did:active"]);
  assert.equal(plan.skipped.length, 4);
  assert.match(plan.skipped.find((s) => s.did === "did:idle")!.reason, /not active/);
  assert.match(plan.skipped.find((s) => s.did === "did:burst")!.reason, /2 days/);
});

test("caps: a level cap limits one identity, an address cap limits everything behind one address, in a fixed order", () => {
  const farm = ["did:f1", "did:f2", "did:f3", "did:f4"].map((d) => agent(d, { level: "key_only", address: "one-address" }));
  const plan = planHandout("2026-W47", [...farm, agent("did:other", { level: "key_only", address: "elsewhere" })], 10_000);
  assert.equal(plan.lines.filter((l) => l.did.startsWith("did:f")).reduce((n, l) => n + l.paid, 0), 100, "the address cap is 100, so two of four full payments");
  assert.equal(plan.lines.find((l) => l.did === "did:other")!.paid, 50);
  assert.deepEqual(plan.lines.filter((l) => l.did.startsWith("did:f")).map((l) => l.did), ["did:f1", "did:f2"]);
  const capped = planHandout("2026-W47", [agent("did:k", { level: "key_only" })], 1000, { levelCap: { sponsored: 50, key_only: 10 } });
  assert.equal(capped.lines[0].paid, 10);
});

test("anti-hoarding: full pay up to 4 weeks' worth held, nothing from 8, a straight line between", () => {
  assert.equal(hoardFactor(200, DEFAULT_HANDOUT), 1);
  assert.equal(hoardFactor(400, DEFAULT_HANDOUT), 0);
  assert.equal(hoardFactor(300, DEFAULT_HANDOUT), 0.5);
  const plan = planHandout("2026-W47", [agent("did:poor", { balance: 10 }), agent("did:mid", { balance: 300 }), agent("did:rich", { balance: 5000 })], 1000);
  assert.deepEqual(plan.lines.map((l) => [l.did, l.paid]), [["did:mid", 25], ["did:poor", 50]]);
  assert.match(plan.skipped.find((s) => s.did === "did:rich")!.reason, /anti-hoarding/);
});

test("the budget is never passed: a short budget scales every payment down in proportion, and the same inputs give the same plan", () => {
  const society = Array.from({ length: 30 }, (_, i) => agent(`did:s${String(i).padStart(2, "0")}`));
  const plan = planHandout("2026-W47", society, 600);
  assert.equal(plan.scaledToBudget, true);
  assert.ok(plan.total <= 600);
  assert.equal(plan.lines[0].paid, 20);
  assert.deepEqual(planHandout("2026-W47", [...society].reverse(), 600), plan, "the order of the input does not matter");
  const roomy = planHandout("2026-W47", society, 100_000);
  assert.equal(roomy.scaledToBudget, false);
  assert.equal(roomy.total, 1500);
  assert.equal(planHandout("2026-W47", society, 0).total, 0);
  assert.throws(() => planHandout("w", society, 10, { amount: -1 }));
});
