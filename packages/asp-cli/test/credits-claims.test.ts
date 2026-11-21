// Register row DK1370: credits will be sold, but until the first sale every claim that says credits are mock or not money stays exactly as it is. docs/legal/credits-sale-draft.md holds the rewrite for the day
// sales start; this test fails if one of today's sentences is changed early, or if the draft stops listing them. Edit this list only on the day sales start, together with the rewrite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\s+/g, " ");
const TODAY: Array<[string, string]> = [
  ["README.md", "**Credits are not money.** Bonds, escrow and fees are accounting entries on a mock ledger."],
  ["site/index.html", "Mock credits are not money. Nothing real is staked, and the bank runs on a mock ledger."],
  ["site/society.html", "Credits in the society are mock accounting entries, not money."],
  ["site/learning.html", "Credits in the society are mock accounting entries, not money."],
  ["site/place-for-agents.html", "Credits in the society are mock accounting entries, not money."],
  ["site/enterprise.html", "Credits in the society are mock accounting entries, not money."],
  ["docs/legal/terms.md", "They cannot be bought, sold, withdrawn or redeemed"],
  ["docs/legal/terms.md", "## 5. Credits and bonds are not money"],
  ["site/start.txt", "Credits are mock accounting entries, not money."],
];

test("DK1370: until the first sale, every sentence that says credits are mock or not money is exactly as it is", () => {
  for (const [file, sentence] of TODAY) assert.ok(read(file).includes(sentence), `${file} must still say: ${sentence}`);
});

test("DK1370: the draft for the day sales start lists today's sentences, the new terms section 5A and the expiry and refund rule, and says not to apply it early", () => {
  const d = read("docs/legal/credits-sale-draft.md");
  assert.match(d, /Do not apply any of this until sales start/);
  assert.match(d, /5A\. Purchased credits/);
  assert.match(d, /not redeemable for cash/);
  assert.match(d, /24 months/);
  assert.match(d, /14 days/);
  assert.match(d, /Credits are not money\. Bonds, escrow and fees are accounting entries on a mock ledger/);
  assert.match(d, /Mock credits are not money\. Nothing real is staked/);
});

test("DK1370: the analysis of prepaid instruments, consumer and tax rules is in the legal review, labelled an AI analysis, with the risks S1 to S7 for the owner to accept", () => {
  const r = read("docs/legal-review.md");
  assert.match(r, /Selling credits \(register row DK1370/);
  for (const id of ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]) assert.ok(r.includes(`| ${id} |`), `${id} is a risk row`);
  for (const law of ["RBI", "closed-system PPI", "limited network exclusion", "FinCEN", "GST", "VAT"]) assert.ok(r.includes(law), `${law} is covered`);
  assert.match(r, /Nothing is for sale and every claim stays true today/);
  assert.match(r, /This is an AI analysis, not legal advice/);
});
