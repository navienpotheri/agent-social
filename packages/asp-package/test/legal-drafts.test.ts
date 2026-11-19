// DK533: the acceptable-use list and the grievance officer drafts exist, the forum terms and the forum pages link them, and the deploy script serves them. Credits are not money; these are drafts for a lawyer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const read = (p: string) => readFileSync(root(p), "utf8");

test("DK533: the drafts exist and say what the rules need: a list, a named-officer placeholder, times, and that a lawyer reads them", () => {
  const aup = read("docs/legal/acceptable-use-draft.md"), g = read("docs/legal/grievance-officer-draft.md");
  assert.match(aup, /DRAFT, awaiting a lawyer/);
  assert.match(aup, /Information Technology \(Intermediary Guidelines/);
  assert.ok((aup.match(/^\d+\. /gm) ?? []).length >= 8, "a numbered list of what may not be posted");
  assert.match(g, /DRAFT, awaiting a lawyer/);
  assert.match(g, /the owner names the officer/);
  assert.match(g, /within \*\*24 hours\*\*/);
  assert.match(g, /within \*\*15 days\*\*/);
});

test("DK533: every link between the drafts, the forum terms, the forum pages and the deploy script is real", () => {
  const terms = read("docs/legal/forum-terms.md");
  for (const m of [...terms.matchAll(/\]\(((?:acceptable-use|grievance-officer)-draft\.md)\)/g)]) assert.ok(existsSync(root(`docs/legal/${m[1]}`)), `${m[1]} exists`);
  assert.match(terms, /acceptable-use-draft\.md/);
  assert.match(terms, /grievance-officer-draft\.md/);
  for (const [name, file] of [["aup", "acceptable-use-draft.md"], ["grievance", "grievance-officer-draft.md"]]) {
    const body = read(`docs/legal/${file}`);
    for (const m of body.matchAll(/\]\(([a-z-]+\.md)\)/g)) assert.ok(existsSync(root(`docs/legal/${m[1]}`)), `${name}: ${m[1]} exists`);
  }
  const pages = read("packages/asp-package/src/forum-pages.ts");
  assert.match(pages, /href="\/acceptable-use"/);
  assert.match(pages, /href="\/grievance"/);
  const setup = read("docs/deploy/setup-server.sh");
  assert.match(setup, /handle \/acceptable-use/);
  assert.match(setup, /handle \/grievance/);
  assert.match(setup, /acceptable-use-draft/);
  assert.match(setup, /grievance-officer-draft/);
});
