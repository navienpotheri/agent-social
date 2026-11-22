// The model-trust table's edges (register rows DK1711 and DK1605; found loose by a mutation check): a rate appears at exactly 30 runs, a settlement counts as a slash only when the bond was slashed, house agents are left out of
// every count, and a hold starts at the LATEST swap. Synthetic records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelTrust, MIN_RUNS_FOR_RATE } from "../src/model-trust.ts";

let n = 0;
const rec = (type: string, issuer: string, body: Record<string, unknown>, at: string) => ({ id: `r${++n}`, type: `asp.${type}/v0.2`, issuer, issued_at: at, body }) as never;
const day = (d: number) => new Date(Date.parse("2026-11-01T00:00:00Z") + d * 86_400_000).toISOString();
const act = (agent: string, name: string, d: number, digest?: string) => rec("action", agent, { contract: "c", scopes_used: [], metrics: { models: [{ name, provider: "p", ...(digest ? { digest } : {}) }] } }, day(d));

test("a rate appears at exactly the minimum number of runs and not one run before", () => {
  const runs = (k: number) => Array.from({ length: k }, (_, i) => act("a", "m1", i));
  assert.equal(modelTrust(runs(MIN_RUNS_FOR_RATE - 1)).models[0].per100, null, "one run short: counts only");
  assert.notEqual(modelTrust(runs(MIN_RUNS_FOR_RATE)).models[0].per100, null, "exactly the minimum: a rate");
});

test("a settlement is a slash only when the bond was slashed; house agents are in no count", () => {
  const records = [
    act("a", "m1", 0),
    rec("contract", "x", { performer: "a" }, day(0)),
    rec("settlement", "bank", { contract: "c", bond_slashed: { value: 0, unit: "credit" } }, day(1)),
  ];
  records[1] = { ...(records[1] as object), id: "c" } as never;
  const t = modelTrust(records);
  assert.equal(t.models[0].slashes, 0, "a settlement with nothing slashed is not a slash");
  const withSlash = [...records.slice(0, 2), rec("settlement", "bank", { contract: "c", bond_slashed: { value: 3, unit: "credit" } }, day(2))];
  assert.equal(modelTrust(withSlash).models[0].slashes, 1);
  const house = modelTrust(withSlash, { houseAgents: new Set(["a"]) });
  assert.equal(house.models.length, 0, "a house agent's runs and slashes are not counted");
});

test("a hold starts at the latest swap, and a passed exam after it ends the hold", () => {
  const records = [act("a", "m1", 0), act("a", "m2", 1), act("a", "m3", 2), rec("exam_result", "reg", { holder: "a", passed: false }, day(3)), rec("exam_result", "reg", { holder: "a", passed: true }, day(4))];
  const t = modelTrust(records);
  assert.equal(t.swaps.length, 2);
  assert.equal(t.holds.length, 1);
  assert.equal(t.holds[0].since, day(2), "the hold is from the latest swap, not the first");
  assert.equal(t.holds[0].to.includes("m3"), true);
  assert.deepEqual([t.holds[0].reexam, t.holds[0].passedAt], ["passed", day(4)], "a failed sitting does not end it; the first pass after the swap does");
  const early = modelTrust([act("a", "m1", 0), rec("exam_result", "reg", { holder: "a", passed: true }, day(0.5)), act("a", "m2", 1)]);
  assert.equal(early.holds[0].reexam, "pending", "a pass before the swap does not release it");
});
