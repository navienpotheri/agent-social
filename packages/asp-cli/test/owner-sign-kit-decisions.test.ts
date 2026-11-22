// docs/owner-sign-kit.md says what the owner accepts by each signature. Every figure in that table is in the document it is read from; every file it links exists; there is one row for each signature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const kit = read("docs/owner-sign-kit.md");
const section = kit.slice(kit.indexOf("## What you accept by each signature"));
const credits = read("docs/institutions/economy/credits.md");
const code = read("docs/law/code.md");
const succession = read("docs/succession-plan.md");
const review = read("docs/legal-review.md");

test("the table has one row for each signature, its links exist and the line numbers are gone", () => {
  const rows = ["DK1", "LW1 and DK530", "DK421", "DK1340 and O19", "DK1370"];
  rows.forEach((k, i) => assert.ok(section.includes(`**${i + 1}. ${k}`), `${k} has a row`));
  for (const m of section.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`docs/${m[1]}`, root)), `${m[1]} exists`);
  assert.ok(!kit.includes("line 121") && !kit.includes("line 170"), "no stale line numbers");
  assert.match(kit, /draft 0\.5; clause III\.7/);
});

test("the figures in the table are the documents' own", () => {
  for (const f of ["**550 to 900**", "**50 to 300**", "**0 to 150**", "55 % author, 25 % Academy, 15 % Treasury, 5 % burned", "20 permille (2 %)", "1 credit per day", "14-day free allowance", "40 credits once per identity"]) assert.ok(credits.includes(f), `credits.md has ${f}`);
  assert.match(credits, /\*\*none\*\* for the first 8 weeks/);
  for (const f of ["within seven days", "fourteen days", "thirty days", "Three refused attempts", "ten minutes", "III.2", "III.5", "III.7", "III.8", "IV.1"]) assert.ok(code.includes(f), `the Code has ${f}`);
  for (const f of ["14 days", "30-day sunset", "30 more days", "any two"]) assert.ok(succession.includes(f), `the plan has ${f}`);
  for (const a of ["A1", "A11", "A12", "S1", "S7", "X1", "X6"]) assert.ok(review.includes(`| ${a} |`), `${a} is a row of the review`);
  assert.match(section, /20 permille \(2 %\)/);
  assert.match(section, /sunset of 30 days, renewable once for 30 more days/);
});
