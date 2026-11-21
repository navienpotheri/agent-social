// The closed loop has a named test for every movement (register row DK71; credits.md 5.2, CR-8): each allowed movement T1 to T12 and each refused movement R1 to R13 is tied to a test whose title carries
// its id, and each refusal to the rule name the log answers with. This file is the index and the check: it fails if a movement has no test, if a test was renamed or removed, or if the rule named for a
// refusal no longer appears in the test that is meant to show it. The tests themselves are in the files named here. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (f: string) => fileURLToPath(new URL(`./${f}`, import.meta.url));
const ES = "economy-slice.test.ts", CL = "closed-loop.test.ts", REP = "reputation.test.ts";

interface Movement { id: string; what: string; file: string; title: string; rule?: string }

const MOVEMENTS: Movement[] = [
  { id: "T1", what: "settlement of a job", file: ES, title: "(T1, T3, T6, T12) a job is accepted and earns credits" },
  { id: "T2", what: "bond return or slash", file: REP, title: "(T2) a slash demotes tier by one" },
  { id: "T3", what: "purchase from an institution by the split", file: ES, title: "(T1, T3, T6, T12) a job is accepted and earns credits" },
  { id: "T4", what: "prize against a signed result", file: CL, title: "prizes (T4, R3)" },
  { id: "T5", what: "newcomer allowance", file: CL, title: "the newcomer allowance (T5)" },
  { id: "T6", what: "tax: the Treasury share and the job tax", file: ES, title: "(T1, T3, T6, T12) a job is accepted and earns credits" },
  { id: "T7", what: "refund", file: ES, title: "(T7) receipts: only the seller signs" },
  { id: "T8", what: "sponsor funding of its own agent", file: ES, title: "sponsor funding (credits.md 5.2 T8, R1" },
  { id: "T9", what: "juror stake lock and unlock", file: ES, title: "(T9) juror stake" },
  { id: "T10", what: "Treasury budget payment to an institution", file: CL, title: "Treasury budgets and payments (T10, R4, R5)" },
  { id: "T11", what: "public-works job: the Treasury as principal of an ordinary job", file: ES, title: "(T11) a public-works job" },
  { id: "T12", what: "burn, by the split only", file: ES, title: "(T1, T3, T6, T12) a job is accepted and earns credits" },
  { id: "T13", what: "a credit line from the Bank: draw at Bond time, repayment at settlement, a default against the guarantor", file: "bank.test.ts", title: "(T13)" },
  { id: "T14", what: "insurance: the premium split and a claim payout from the reserve", file: "insurer.test.ts", title: "(T14)" },
  { id: "T15", what: "a Bank deposit and its withdrawal: a lock and an unlock", file: "deposits.test.ts", title: "(T15)" },
  { id: "T16", what: "the deposit reward: a Treasury move within a co-signed budget", file: "deposits.test.ts", title: "(T16)" },
  { id: "R1", what: "a free transfer between unrelated parties", file: ES, title: "sponsor funding (credits.md 5.2 T8, R1", rule: "transfer_not_allowed" },
  { id: "R2", what: "anything that turns credits into money or out of the society", file: ES, title: "(R2) credits cannot leave the society" },
  { id: "R3", what: "an institution paying an agent outside a prize, refund, share or budget", file: CL, title: "R3 still holds", rule: "institution_payment_not_allowed" },
  { id: "R4", what: "one institution paying another", file: CL, title: "Treasury budgets and payments (T10, R4, R5)", rule: "institution_payment_not_allowed" },
  { id: "R5", what: "the Treasury paying an agent outside the allowance, a public-works job or a refund", file: CL, title: "Treasury budgets and payments (T10, R4, R5)", rule: "treasury_payment_not_allowed" },
  { id: "R6", what: "a purchase from an institution not in the buyer's Mandate", file: ES, title: "(R6 institution_not_in_mandate) default-deny", rule: "institution_not_in_mandate" },
  { id: "R7", what: "a purchase at any price other than the one in force", file: ES, title: "R7 price_mismatch", rule: "price_mismatch" },
  { id: "R8", what: "a tier 0 purchase of anything but an essential or remedial item", file: ES, title: "R8 tier_excluded", rule: "tier_excluded" },
  { id: "R9", what: "a purchase whose payee is the buyer's own side, for an item that gives standing", file: CL, title: "(R9)", rule: "self_dealing" },
  { id: "R10", what: "a debit larger than the balance; a zero or negative amount", file: ES, title: "R10 amount_not_positive", rule: "insufficient_balance" },
  { id: "R11", what: "a mint by anyone but the operator", file: ES, title: "R11 mint_unauthorised", rule: "mint_unauthorised" },
  { id: "R12", what: "any debit of the Burn account", file: ES, title: "R3, R5, R12:", rule: "burn_account_locked" },
  { id: "R13", what: "a transfer of locked credits outside their own record path", file: CL, title: "locked credits move only by their own records (R13)", rule: "insufficient_balance" },
];

test("every closed-loop movement, T1 to T12 and R1 to R13, has a test whose title carries its id, and each refusal names the rule the log answers with", () => {
  assert.deepEqual(MOVEMENTS.map((m) => m.id), [...Array.from({ length: 16 }, (_, i) => `T${i + 1}`), ...Array.from({ length: 13 }, (_, i) => `R${i + 1}`)], "the table lists T1 to T16 and R1 to R13, in order");
  for (const m of MOVEMENTS) {
    const path = here(m.file);
    assert.ok(existsSync(path), `${m.id}: ${m.file} exists`);
    const text = readFileSync(path, "utf8");
    assert.ok(text.includes(m.title), `${m.id} (${m.what}): a test titled "${m.title}" is in ${m.file}`);
    assert.ok(new RegExp(`(test|describe)\\([^\\n]*${m.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text), `${m.id}: that text is a test or describe title`);
    if (m.rule) assert.ok(text.includes(m.rule), `${m.id}: the rule ${m.rule} appears in ${m.file}`);
  }
});

test("the movement table matches the rows of credits.md 5.2: every T and R id there is in this index, and the refusal rule names agree", () => {
  const doc = readFileSync(fileURLToPath(new URL("../../../docs/institutions/economy/credits.md", import.meta.url)), "utf8");
  for (const m of MOVEMENTS) {
    assert.match(doc, new RegExp(`^\\| ${m.id} \\|`, "m"), `${m.id} is a row of credits.md`);
    if (m.rule) {
      const row = doc.split("\n").find((l) => l.startsWith(`| ${m.id} |`))!;
      assert.ok(row.includes(m.rule), `credits.md names ${m.rule} for ${m.id}`);
    }
  }
});
