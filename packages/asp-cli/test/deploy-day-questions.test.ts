// docs/deploy-day-questions.md is the short list of the ten deployment decisions, ready to ask. It carries the same ten questions and the same defaults as section 0 of docs/deployment-plan.md, each with a reason,
// and it keeps the standing statements.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const plan = read("docs/deployment-plan.md");
const list = read("docs/deploy-day-questions.md");
const rows = (text: string) => [...text.matchAll(/^\| (\d+) \| (.+?) \| (.+?) \|(?: (.+?) \|)?$/gm)].filter((m) => !Number.isNaN(Number(m[1])));

test("the list has the plan's ten questions with the plan's defaults, each with a reason", () => {
  const sec = plan.slice(plan.indexOf("## 0. "), plan.indexOf("## 1. "));
  const fromPlan = rows(sec);
  const fromList = rows(list);
  assert.equal(fromPlan.length, 10);
  assert.equal(fromList.length, 10);
  fromPlan.forEach((p, i) => {
    assert.equal(fromList[i]![2], p[2], `question ${i + 1}`);
    assert.equal(fromList[i]![3], p[3], `default ${i + 1}`);
    assert.ok((fromList[i]![4] ?? "").length > 30, `a reason for ${i + 1}`);
  });
});

test("the list keeps the standing statements and says that the keys and the pushes stay the owner's", () => {
  assert.match(list, /Credits are mock accounting entries, not money/);
  assert.match(list, /there has been no outside security review/);
  assert.match(list, /the go for each push and each signature, which stay yours/);
  assert.match(list, /before the live run of tonight has been recorded/);
});

test("the owner's answers of 2026-11-22 are recorded in the four places, decision 7 stays open, and nothing open is taken as answered", () => {
  const decisions = read("docs/owner-decisions.md");
  const all = read("docs/owner-questions-all.md");
  const sec = decisions.slice(decisions.indexOf("## Deployment decisions, answered 2026-11-22"));
  assert.ok(sec.length > 200, "owner-decisions.md has the section");
  for (const doc of [sec, list, all]) {
    assert.match(doc, /update the running server in place after a disk snapshot|in-place update after a snapshot/);
    assert.match(doc, /Delhi region/);
    assert.match(doc, /key-only sign-up (ON|on)/);
    assert.match(doc, /600 credits a month/);
  }
  assert.match(sec, /\*\*Still open: 7\*\* \(the operator and owner DIDs/);
  for (const doc of [sec, list, plan]) { assert.match(doc, /thedeeptransformation\.com/); }
  assert.ok(sec.includes("navien@thedeeptransformation.com") && list.includes("navien@thedeeptransformation.com") && all.includes("navien@thedeeptransformation.com") && plan.includes("navien@thedeeptransformation.com"), "the operator's mail address is recorded in the four places");
  const state = list.slice(list.indexOf("| Q | State |"));
  const answered = [...state.matchAll(/^\| Q(\d+) \| answered \|/gm)].map((m) => Number(m[1]));
  const open = [...state.matchAll(/^\| Q(\d+) \| \*\*open\*\* \|/gm)].map((m) => Number(m[1]));
  assert.deepEqual(answered, [1, 2, 3, 4, 5, 6, 8, 9, 10]);
  assert.deepEqual(open, [7]);
  assert.match(plan, /\*\*Still open: 7\.\*\*/);
  assert.match(all, /still open: 7, the operator and owner DIDs/);
});
