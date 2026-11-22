// Row DK1715 (mutation check, launch-bar-2, 2026-11-22): the default token ceilings that the code applies are the ones that docs/run-cost.md and the live-run runbook tell a person. The older test compared the
// code with its own constants, so changing a default went unnoticed, and the runbook said 1,000,000 where the code says 2,000,000.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_DAY_TOKENS, DEFAULT_RUN_TOKENS, OPERATOR_MAX_DAY_TOKENS, OPERATOR_MAX_RUN_TOKENS } from "../src/spend-guard.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const f = (n: number) => n.toLocaleString("en-US");

test("docs/run-cost.md states the defaults and the operator's maximum that the code applies", () => {
  const doc = read("docs/run-cost.md");
  assert.ok(doc.includes(`| Tokens in one run | ${f(DEFAULT_RUN_TOKENS)} | ${f(OPERATOR_MAX_RUN_TOKENS)} |`), "the run row");
  assert.ok(doc.includes(`| Tokens for one agent in one UTC day | ${f(DEFAULT_DAY_TOKENS)} | ${f(OPERATOR_MAX_DAY_TOKENS)} |`), "the day row");
});

test("the live-run runbook states the default run ceiling that the code applies", () => {
  const plan = read("docs/live-run-plan.md");
  assert.ok(plan.includes(`A run stops itself at ${f(DEFAULT_RUN_TOKENS)} tokens by default`), "the runbook's default");
});

test("the defaults are the figures that a person was told (2,000,000 a run and 10,000,000 a day)", () => {
  assert.equal(DEFAULT_RUN_TOKENS, 2_000_000);
  assert.equal(DEFAULT_DAY_TOKENS, 10_000_000);
});
