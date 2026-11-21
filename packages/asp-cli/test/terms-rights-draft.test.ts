// Row DK420: the Terms of Use section "Your rights" (docs/legal/terms-rights-draft.md) keeps to the charter: every command it names is a documented command, every right it states matches a right of the
// charter that a mechanism backs, it says what it does not promise, it states right 8 as a commitment and not a mechanism, and it is not yet part of the terms (the owner signs it first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const draft = read("docs/legal/terms-rights-draft.md");
const section = draft.slice(draft.indexOf("> ## 11. Your rights"), draft.indexOf("## What this section leaves out"));

test("the section has eight clauses, 11.1 to 11.8, and says what the rights do not promise", () => {
  const ids = [...section.matchAll(/\*\*(11\.\d) /g)].map((m) => m[1]);
  assert.deepEqual(ids, ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8"]);
  assert.match(section, /do not guarantee that the operator will never suspend or end a tenant/);
  assert.match(section, /do not make the Courts independent of the operator/);
  assert.match(section, /commitments of the operator and not mechanisms/);
});

test("every command the section names is documented, and every file the draft links exists", () => {
  const commands = read("docs/commands.md");
  for (const c of new Set([...section.matchAll(/`(asp [a-z]+(?: [a-z]+)?)`/g)].map((m) => m[1]))) assert.ok(commands.includes(`\`${c}`) || commands.includes(`${c} `) || commands.includes(`${c}|`), `${c} is documented`);
  for (const m of draft.matchAll(/\]\(([^)#]+)\)/g)) { const t = m[1]!; if (!/^https?:/.test(t)) assert.ok(existsSync(new URL(t, new URL("docs/legal/", root))), `${t} exists`); }
});

test("each right of the section is a right of the charter that names what backs it", () => {
  const charter = read("docs/legal/rights-charter-draft.md");
  for (const phrase of ["To know the rules", "To a reason", "To your data", "To your keys", "To stop", "To be heard, and to appeal", "To a say before the operator acts"]) assert.match(charter, new RegExp(`\\*\\*${phrase}`), phrase);
  assert.match(charter, /\*Backed by:\*/);
});

test("the Terms of Use do not yet carry the section: the owner signs it first", () => {
  assert.doesNotMatch(read("docs/legal/terms.md"), /^## 11\. Your rights/m);
  assert.match(draft, /It is not yet part of the Terms of Use/);
});
