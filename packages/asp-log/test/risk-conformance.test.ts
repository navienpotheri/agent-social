// The shared risk-model vectors (conformance/vectors/risk.json): the suggestion and the kill-switch rule must give what the file says. The Python SDK runs the same file (python/tests/test_conformance.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RISK_MODEL, onlyRemovesRule, suggestRisk } from "../src/market-risk.ts";

const vec = JSON.parse(readFileSync(new URL("../../../conformance/vectors/risk.json", import.meta.url), "utf8"));

test("the model's name and version are the ones the vectors were made for", () => { assert.equal(vec.model, RISK_MODEL); });
for (const c of vec.suggest) test(`suggestion: ${c.name}`, () => { assert.deepEqual(suggestRisk(c.terms, c.input), c.expected); });
for (const c of vec.onlyRemoves) test(`only removes rule: ${c.name}`, () => { assert.equal(onlyRemovesRule(c.prev, c.next), c.expected); });
test("the vectors cover the cases that matter: no model, a cap, a floor of zero, rounding up", () => {
  const names = vec.suggest.map((c: { name: string }) => c.name).join(" ");
  for (const k of ["no_model", "capped", "never_below_zero", "rounds_up"]) assert.ok(names.includes(k), k);
});
