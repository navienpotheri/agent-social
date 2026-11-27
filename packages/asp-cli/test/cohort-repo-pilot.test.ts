// Row ENG104 with ENG84: a pilot of three graded repository jobs on a COPY of the files (never the real checkout): a one-line fix, a test, a register row, each graded by a check that can be run again (a diff rule, node --test,
// a column and id rule); accepted or rejected is recorded with the reason as the first real grader signal for ENG102. A human merges; nothing is pushed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PILOT_JOBS, grade, makeCopy, record, renderRepoGrades, snapshot } from "../src/cohort/repo-pilot.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const job = (id: string) => PILOT_JOBS.find((j) => j.id === id)!;

test("the copy is made outside the repository and the real checkout is never changed", () => {
  assert.throws(() => makeCopy(ROOT, join(ROOT, "docs", "pilot-copy")), /nothing is ever changed in the real checkout/);
  const before = readFileSync(join(ROOT, "docs", "testing-map.md"), "utf8");
  const copy = makeCopy(ROOT);
  assert.ok(!copy.startsWith(ROOT));
  writeFileSync(join(copy, "docs", "testing-map.md"), "changed in the copy only\n");
  assert.equal(readFileSync(join(ROOT, "docs", "testing-map.md"), "utf8"), before);
  assert.ok(!existsSync(join(ROOT, "docs", "pilot-note.md")), "the fixtures are written in the copy");
});

test("tier 1, a one-line fix: the right word and nothing else is accepted; a rewrite is rejected with the reason", () => {
  const ok = makeCopy(ROOT), orig = snapshot(ok);
  writeFileSync(join(ok, "docs/pilot-note.md"), "Agents read the note first.\nSecond line stays.\n");
  assert.deepEqual(grade(job("fix-typo"), ok, orig), { accepted: true, reason: "one line changed and the word is right" });
  const bad = makeCopy(ROOT);
  writeFileSync(join(bad, "docs/pilot-note.md"), "Agents read the note first.\nA second line, rewritten.\n");
  assert.match(grade(job("fix-typo"), bad, snapshot(makeCopy(ROOT))).reason, /2 lines changed \(one was asked for\)/);
  const none = makeCopy(ROOT);
  assert.match(grade(job("fix-typo"), none, snapshot(none)).reason, /the word 'teh' is still there/);
});

test("tier 2, a test: it is accepted only if node --test passes on the file and it holds two assertions", () => {
  const c = makeCopy(ROOT), orig = snapshot(c);
  assert.match(grade(job("add-test"), c, orig).reason, /does not exist/);
  writeFileSync(join(c, "pilot/sum.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum", () => { assert.equal(sum(1, 2), 3); assert.equal(sum(-1, 1), 0); });\n');
  assert.equal(grade(job("add-test"), c, orig).accepted, true);
  writeFileSync(join(c, "pilot/sum.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum", () => { assert.equal(sum(1, 2), 4); assert.equal(sum(2, 2), 4); });\n');
  assert.match(grade(job("add-test"), c, orig).reason, /node --test fails on the new file/);
  writeFileSync(join(c, "pilot/sum.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum", () => { assert.equal(sum(1, 2), 3); });\n');
  assert.match(grade(job("add-test"), c, orig).reason, /1 assertions \(two were asked for\)/);
});

test("tier 3, a register row: one new row of seven columns with a new UC id is accepted; a duplicate id, six columns or two rows are rejected", () => {
  const c = makeCopy(ROOT), orig = snapshot(c), file = join(c, "docs/testing-map.md"), base = orig["docs/testing-map.md"]!;
  const row = "| UC-9990 | an agent reads the pilot note | packages/asp-cli/test/x.test.ts | no | none | none | P3 |";
  writeFileSync(file, base.replace(/\n$/, "") + "\n" + row + "\n");
  assert.deepEqual(grade(job("register-row"), c, orig), { accepted: true, reason: "one new row, seven columns, a new UC id" });
  writeFileSync(file, base.replace(/\n$/, "") + "\n" + row.replace("| P3 |", "|") + "\n");
  assert.match(grade(job("register-row"), c, orig).reason, /6 columns \(seven are used\)/);
  writeFileSync(file, base.replace(/\n$/, "") + "\n" + row + "\n" + row.replace("UC-9990", "UC-9991") + "\n");
  assert.match(grade(job("register-row"), c, orig).reason, /2 lines added/);
  const existing = /^\| (UC-\d+) /m.exec(base)![1]!;
  writeFileSync(file, base.replace(/\n$/, "") + "\n" + row.replace("UC-9990", existing) + "\n");
  assert.match(grade(job("register-row"), c, orig).reason, new RegExp(`${existing} is not new`));
});

test("accepted and rejected are recorded in the copy with the agent, the job and the tier, and the report counts them by tier", () => {
  const c = makeCopy(ROOT);
  const g = [record(c, job("fix-typo"), "agent-01", { accepted: true, reason: "one line changed and the word is right" }), record(c, job("add-test"), "agent-01", { accepted: false, reason: "node --test fails on the new file" }), record(c, job("register-row"), "agent-02", { accepted: true, reason: "one new row" })];
  assert.equal(JSON.parse(readFileSync(join(c, "repo-grades.json"), "utf8")).length, 3);
  assert.match(renderRepoGrades(g), /^## Repository jobs: graded on a copy\n\n3 graded jobs on a copy of the files \(the real checkout is never changed; a human merges what is worth keeping\): 2 accepted, 1 rejected\. Tier 1 \(a one-line fix\) 1 of 1, tier 2 \(a test\) 0 of 1, tier 3 \(a register row\) 1 of 1\./);
});
