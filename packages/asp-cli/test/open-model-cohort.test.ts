// docs/open-model-cohort.md is a plan for a second cohort on open-weight models. It names no price: the only money figures in it are the one that was measured (USD 0.0044 of a USD 10 credit, row CM5, which the register
// states) and the live run's cap of USD 5. Every file, script and row it names exists, it keeps the standing statements and it states what the cohort would not claim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const plan = read("docs/open-model-cohort.md");

test("every link, script and row that the plan names exists", () => {
  for (const m of plan.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`docs/${m[1]}`, root)), `${m[1]} exists`);
  for (const m of plan.matchAll(/`(evals\/[A-Za-z0-9_.-]+)`/g)) assert.ok(existsSync(new URL(m[1]!, root)), `${m[1]} exists`);
  const register = read("docs/gaps-register.md");
  for (const id of ["CM5", "CM8"]) assert.match(register, new RegExp(`^\| ${id} \|`, "m"), `${id} is a register row`);
  assert.match(read("evals/long-horizon.mjs"), /UC-36/, "the driver is UC-36");
  assert.match(read("docs/model-matrix.md"), /2026-10-10/);
});

test("the plan states no price: only the measured figure and the live run's cap appear as money", () => {
  const amounts = [...plan.matchAll(/USD [0-9][0-9.,]*/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(amounts)].sort(), ["USD 0.0044", "USD 10", "USD 5"].sort());
  assert.doesNotMatch(plan, /\$ ?[0-9]/, "no dollar sign with a figure");
  const register = read("docs/gaps-register.md");
  assert.ok(register.includes("$0.0044 of the $10"), "the measured figure is the register's own");
  assert.match(plan, /none exists today, and this document names no figure/);
});

test("the plan keeps the standing statements and says what the cohort would not claim", () => {
  assert.match(plan, /Credits are mock accounting entries, not money/);
  assert.match(plan, /no outside security review/);
  assert.match(plan, /Nothing here has been run/);
  assert.match(plan, /Nothing in the plan trains a model's weights/);
  assert.match(plan, /## 6\. What the cohort would not claim/);
  assert.match(plan, /on Windows there is no sandbox/);
  assert.equal([...plan.matchAll(/^\| \d \| /gm)].length >= 4, true, "four decisions with defaults");
});
