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
