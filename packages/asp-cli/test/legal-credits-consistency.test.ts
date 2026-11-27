// Owner review, 2026-11-21: the legal review told two stories about credits (mock and not for sale; purchasable). It is one story now: mock today, prepaid platform credits only from the first sale,
// which the owner starts after signing S1 to S7. A document cannot say both: a sentence that says credits cannot be bought or are not for sale must say it is about now, and the public pages
// never say credits are or will be sold (the full text file and the command reference list the protocol's record and command names, which include the purchased-credit lot, and announce no sale) (the rewrite waits in docs/legal/credits-sale-draft.md for the day sales start).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const review = read("docs/legal-review.md");

test("the legal review has one place that says what holds now and what holds from the first sale, and keeps its cross-references and signature boxes", () => {
  assert.match(review, /^## Credits: what is true now and what is true from the first sale$/m);
  const table = review.slice(review.indexOf("## Credits: what is true now"), review.indexOf("## Cross-cutting decisions"));
  assert.match(table, /\*\*Now \(the beta\)\*\*/);
  assert.match(table, /\*\*From the first sale/);
  for (const id of ["A1", "A5", "A11", "A12", "S1", "S7"]) assert.match(review, new RegExp(`\\| ${id} \\|`), `${id} is still in the review`);
  assert.equal((review.match(/Signed: ____/g) ?? []).length, 3, "the signature boxes are intact: A1 to A11, A12 (pending) and S1 to S7");
});

test("outside the 'Selling credits' section, a sentence that says credits cannot be bought, are not sold or are mock is about now", () => {
  const before = review.slice(0, review.indexOf("## Selling credits"));
  const table = before.slice(before.indexOf("## Credits: what is true now"), before.indexOf("## Cross-cutting decisions"));
  for (const line of before.replace(table, "").split("\n")) {
    if (/cannot be bought|can(?:not|'t) be sold|nothing can be bought|sells nothing|not for sale/i.test(line)) {
      assert.match(line, /\btoday\b|\bnow\b|the beta|until the first sale|from the first sale|while they cannot/i, `says it without a time: ${line.slice(0, 140)}`);
    }
  }
});

test("a legal text that says credits cannot be bought is scoped to the beta, and no public page says credits are or will be sold", () => {
  assert.match(read("docs/legal/terms.md"), /In the beta no real money moves through the service\. If we later offer prepaid platform credits for sale/);
  const pages = [...readdirSync(new URL("site/", root)).filter((f) => /\.(html|txt)$/.test(f) && !/^(llms-full\.txt|reference\.html)$/.test(f)).map((f) => `site/${f}`), "README.md", "docs/legal/privacy.md"];
  for (const p of pages) assert.doesNotMatch(read(p), /credits (?:are|will be) sold|buy (?:prepaid )?credits|purchased credits|prepaid platform credits/i, `${p} does not announce a sale before the owner's go`);
});
