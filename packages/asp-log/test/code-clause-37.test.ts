// Row DK530: the Code 1.0 draft (docs/law/code.md, clause III.7) and the log agree. The Code promises no payment to an outside party and names the three remedies the log's abuse rule accepts;
// the same rule refuses a ruling that pays restitution (abuse-case.test.ts). The owner signs the Code once, as 1.0, with LW1; nothing is re-signed before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const code = readFileSync(new URL("docs/law/code.md", root), "utf8");
const rules = readFileSync(new URL("packages/asp-log/src/courts-rules.ts", root), "utf8");

test("clause III.7 of the Code draft pays no credits to an outside party and names the operator's three remedies", () => {
  const clause = /\*\*III\.7 Third Parties\.\*\*([^\n]*)/.exec(code)?.[1] ?? "";
  assert.ok(clause, "clause III.7 exists");
  assert.match(clause, /No credits are paid to an outside party/);
  assert.doesNotMatch(clause, /paid restitution/);
  for (const remedy of ["a takedown", "a suspension of the Agent", "a written response"]) assert.ok(clause.includes(remedy), `III.7 names ${remedy}`);
  // The log's rule accepts exactly these three, and refuses a payout.
  assert.match(rules, /takedown, suspension or written_response/);
  assert.match(rules, /abuse_restitution_off/);
});

test("the draft records the owner's decision and says it is not signed or in force", () => {
  assert.match(code, /^# The Code of the City: draft 0\.5/m);
  assert.match(code, /Not in force\. Not signed\./);
  assert.match(code, /register row DK530/);
});
