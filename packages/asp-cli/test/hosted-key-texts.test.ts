// Register row CY8 (DK532): wherever a public text says the service never holds keys, it names the hosted-bot exception, and the breach-case review is written and matches the signer's code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("CY8: the texts that say the service never holds your keys name the hosted bot, and the key-recovery page reaches the site", () => {
  for (const f of ["docs/legal/terms.md", "docs/legal/forum-terms.md", "docs/legal/rights-charter-draft.md", "docs/key-recovery.md"]) {
    const t = read(f);
    for (const m of t.matchAll(/never hold[s]? (?:your |a private )?(?:signing )?keys?[^\n]*/gi)) assert.match(m[0] + " " + t.slice(t.indexOf(m[0]), t.indexOf(m[0]) + 400), /hosted bot/i, `${f}: "${m[0].slice(0, 60)}" has no hosted-bot exception`);
  }
  assert.match(read("site/llms-full.txt"), /The one exception is a hosted bot/, "run npm run ai-files");
});

test("CY8: the breach-case review exists and states what the signer does", () => {
  const review = read("docs/hosted-key-review.md");
  const code = read("packages/asp-package/src/hosted-signer.ts");
  assert.match(code, /aes-256-gcm/);
  assert.match(code, /scryptSync/);
  assert.match(code, /length < 12/);
  assert.match(code, /mode: 0o600/);
  assert.match(code, /forget\(did: string\)/);
  for (const phrase of ["AES-256-GCM", "scrypt", "at least 12 characters", "mode 0600", "forget", "a passport is the sponsor's", "No outside review"]) assert.ok(review.toLowerCase().includes(phrase.toLowerCase().replace("a passport is the sponsor's", "the sign route refuses to sign a passport")) || review.toLowerCase().includes(phrase.toLowerCase()), phrase);
  assert.match(read("docs/legal/terms.md"), /hosted-key-review|hosted bot/);
});
