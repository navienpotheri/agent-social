// Every rule of docs/institutions/treasury.md is a numbered rule with a named test, or the document says why it is not built (register row DK99). This file is the index and the check: it fails if a rule
// has no test, if a test was renamed or removed, if the rule name the log answers with no longer appears in the test that shows it, if the document's table and this index disagree, or if a rule that is
// not built has no reason and no register row. The tests themselves are in the files named here. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (f: string) => fileURLToPath(new URL(`./${f}`, import.meta.url));
const doc = (f: string) => fileURLToPath(new URL(`../../../docs/${f}`, import.meta.url));
const ES = "economy-slice.test.ts", CL = "closed-loop.test.ts";

interface Rule { id: string; rule: string; where: string; status: "tested" | "stricter" | "not built"; file?: string; title?: string; names?: string[]; why?: string; row?: string }

export const TREASURY_RULES: Rule[] = [
  { id: "TRL-1", rule: "Tax is by rule: a settlement's fee is the price list's rate times what is released, and no agent is taxed more than another at the same price", where: "5", status: "tested", file: ES, title: "with a price list in force, the fee on a paid settlement is the list's rate", names: ["fees_not_job_tax"] },
  { id: "TRL-2", rule: "Every part of a price (provider, Treasury, burn) sums to the price at every price from 1 to 1,000", where: "9", status: "tested", file: ES, title: "every part sums to the price at every price from 1 to 1000" },
  { id: "TRL-3", rule: "A budget is signed by the Treasury alone", where: "3", status: "tested", file: CL, title: "a budget is the Treasury's alone", names: ["budget_wrong_issuer"] },
  { id: "TRL-4", rule: "One budget per institution per month", where: "3", status: "tested", file: CL, title: "a budget is the Treasury's alone", names: ["budget_already_set"] },
  { id: "TRL-5", rule: "A budget is refused when it would promise more than the Treasury holds, less the budgets already committed (over budget)", where: "3, 4", status: "tested", file: CL, title: "a budget is the Treasury's alone", names: ["budget_exceeds_treasury"] },
  { id: "TRL-6", rule: "The first budget of an institution, and a later one more than a quarter above the last, needs the owner's co-signature", where: "3", status: "tested", file: CL, title: "a later budget needs the owner only for a rise of more than a quarter", names: ["budget_needs_cosign"] },
  { id: "TRL-7", rule: "A payment goes only to the budget's own institution, never to another institution or an agent", where: "3, 5", status: "tested", file: CL, title: "a budget is the Treasury's alone", names: ["treasury_payment_not_allowed"] },
  { id: "TRL-8", rule: "A payment is signed by the Treasury, names a budget that exists, and falls inside the budget's month", where: "3", status: "tested", file: CL, title: "a budget is the Treasury's alone", names: ["treasury_payment_wrong_issuer", "budget_unknown", "budget_period_closed"] },
  { id: "TRL-9", rule: "The payments of a budget never add up to more than its amount (a payment over budget is refused)", where: "3, 5", status: "tested", file: CL, title: "a budget is the Treasury's alone", names: ["over_budget"] },
  { id: "TRL-10", rule: "The allowance is paid once per identity, for exactly the amount in force, and a sponsor's second identity gets none", where: "3, 5", status: "tested", file: CL, title: "a newcomer with a first course claims the allowance once", names: ["allowance_already_paid", "allowance_amount"] },
  { id: "TRL-11", rule: "The allowance is exactly the allowance in force, from the allowance budget, in the budget's own month", where: "3", status: "tested", file: CL, title: "the allowance does not pay in another month than its budget's", names: ["budget_period_closed"] },
  { id: "TRL-12", rule: "The allowance needs a passport under 90 days old and a first course or first bond", where: "3, 5", status: "tested", file: CL, title: "the first identity of a sponsor only; a passport over 90 days old", names: ["allowance_not_newcomer", "allowance_not_earned"] },
  { id: "TRL-13", rule: "A slashed agent is refused the allowance (stricter than treasury.md: any slash, not only one in the last 30 days)", where: "3, 5", status: "stricter", file: CL, title: "the first identity of a sponsor only; a passport over 90 days old", names: ["allowance_slashed"], why: "the reputation row carries no date for a slash, so the log cannot tell a slash 29 days ago from one 31 days ago", row: "DK230" },
  { id: "TRL-14", rule: "A public-works job has the Treasury as principal and follows the ordinary lifecycle and settlement", where: "3, 5", status: "tested", file: ES, title: "(T11) a public-works job" },
  { id: "TRL-15", rule: "A payment outside a record is impossible: an institution does not pay an agent, and the Treasury pays an agent only by allowance, a public-works job or a refund", where: "4, 5", status: "tested", file: CL, title: "R3 still holds", names: ["budget_wrong_issuer"] },
  { id: "TRL-16", rule: "A budget is refused for an institution with no published charter", where: "5", status: "not built", why: "no institution has a charter record yet (register row DK40 is open), so there is nothing to check against", row: "DK231" },
  { id: "TRL-17", rule: "Budgets are shares of the income actually received, not fixed amounts", where: "4", status: "not built", why: "a budget is capped by the Treasury's balance (TRL-5); a share of income needs the monthly income by source, which the statement (TRL-18) carries", row: "DK231" },
  { id: "TRL-18", rule: "A monthly treasury statement whose arithmetic and sums over the log reconcile, and that is refused when one credit is off", where: "3, 5, 9", status: "not built", why: "the `treasury_statement` record and its schema do not exist; the nightly audit (credits audit) checks the supply rule over the whole log in the meantime", row: "DK232" },
  { id: "TRL-19", rule: "The reserve is never below one month of approved budgets (guard G6, drained side)", where: "4", status: "not built", why: "needs the statement (TRL-18) and a month of approved budgets in the log; the Treasury-to-circulation ratio (G6, high side) is measured", row: "DK232" },
];

const read = (f: string) => readFileSync(here(f), "utf8");

test("every rule that is built is tied to a test whose title is in the named file, and to the rule names the log answers with", () => {
  for (const r of TREASURY_RULES.filter((x) => x.status !== "not built")) {
    assert.ok(r.file && existsSync(here(r.file)), `${r.id}: the test file ${r.file} exists`);
    const src = read(r.file!);
    assert.ok(src.includes(r.title!), `${r.id}: a test titled "${r.title}" is in ${r.file}`);
    for (const n of r.names ?? []) assert.ok(src.includes(`"${n}"`), `${r.id}: ${r.file} shows the refusal ${n}`);
  }
});

test("every rule that is not built, or is built stricter, says why and names its register row; the row exists in the register", () => {
  const register = readFileSync(doc("gaps-register.md"), "utf8");
  for (const r of TREASURY_RULES.filter((x) => x.status !== "tested")) {
    assert.ok(r.why && r.why.length > 20, `${r.id}: a reason`);
    assert.ok(r.row && register.includes(`| ${r.row} |`), `${r.id}: the register row ${r.row} exists`);
  }
});

test("the rule names in the log's Treasury code are each in the index, so a rule added without a test fails here", () => {
  const log = readFileSync(fileURLToPath(new URL("../src/log.ts", import.meta.url)), "utf8");
  const section = log.slice(log.indexOf("private async projectBudget"), log.indexOf("private async projectPrize"));
  const names = [...new Set([...section.matchAll(/rule\("([a-z_]+)"/g)].map((m) => m[1]))].filter((n) => /^(budget_|treasury_payment_|over_budget|allowance_)/.test(n));
  const indexed = new Set(TREASURY_RULES.flatMap((r) => r.names ?? []));
  // Rules that are chain or shape checks, covered by the schema and the record tests rather than one named case each.
  const shape = new Set(["budget_not_chained", "treasury_payment_not_chained", "allowance_not_chained", "budget_bad_line", "budget_period_past", "allowance_no_passport", "allowance_reserved", "allowance_budget_wrong", "budget_unknown_institution", "budget_institution_closed"]);
  const missing = names.filter((n) => !indexed.has(n) && !shape.has(n));
  assert.deepEqual(missing, [], `Treasury rule names with no numbered rule: ${missing.join(", ")}`);
});

test("the document's table of numbered rules and this index agree: same ids, same status", () => {
  const md = readFileSync(doc("institutions/treasury.md"), "utf8");
  const rows = [...md.matchAll(/^\| (TRL-\d+) \|.*\| (tested|stricter|not built) \|/gm)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(rows.sort(), TREASURY_RULES.map((r) => `${r.id}:${r.status}`).sort());
});
