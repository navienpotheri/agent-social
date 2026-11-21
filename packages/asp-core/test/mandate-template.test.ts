// The shared Mandate-template vectors (conformance/vectors/mandate-template.json): what goes beyond a ceiling and what a member's Mandate derives to must be what the file says. The Python SDK runs the same file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveMandate, mandateViolations, scopeCovered } from "../src/index.ts";

const vec = JSON.parse(readFileSync(new URL("../../../conformance/vectors/mandate-template.json", import.meta.url), "utf8"));
for (const c of vec.violations) test(`violations: ${c.name}`, () => { assert.deepEqual(mandateViolations(c.ceiling, c.candidate), c.expected); });
for (const c of vec.derive) test(`derive: ${c.name}`, () => { assert.deepEqual(deriveMandate(c.template, c.contract, c.narrowing), c.expected); });
test("a wildcard scope covers what sits under it and not the bare prefix", () => {
  assert.equal(scopeCovered(["pr.*"], "pr.open"), true);
  assert.equal(scopeCovered(["pr.*"], "pr"), false);
  assert.equal(scopeCovered(["repo.read"], "repo.write"), false);
});
test("the vectors cover each field a narrowing can widen", () => {
  const widened = new Set(vec.violations.flatMap((c: { expected: string[] }) => c.expected));
  for (const f of ["scopes", "forbidden_means", "spend", "irreversible", "subcontract", "nodes", "learning", "self_modification", "checkpoints", "expires", "network", "institution_spend", "token_budget"]) assert.ok(widened.has(f), f);
});
