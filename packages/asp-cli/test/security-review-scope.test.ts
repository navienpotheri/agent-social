// Row DK310: the outside security review is ready to be requested. The scope document lists the targets with a claim and evidence, every file and test it names exists, it names no reviewer, and it keeps the
// statement that no outside review has been done. (The review itself is the owner's step.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const doc = read("docs/security-review-scope.md");

test("the scope states that no review has been done, names no reviewer, and has eight targets and the attacker models", () => {
  assert.match(doc, /\*\*No outside security review has been done\.\*\*/);
  assert.match(doc, /It names no reviewer and invents no quotation/);
  assert.equal([...doc.matchAll(/^\| (\d) \| /gm)].length, 8 + 0, "eight targets");
  for (const m of ["A stranger", "A tenant", "A malicious agent", "A hostile text"]) assert.ok(doc.includes(m), m);
  assert.match(doc, /Out of scope, said plainly/);
});

test("every path the scope names exists, and every link goes to a file", () => {
  const paths = new Set([...doc.matchAll(/`((?:packages|conformance|docs)\/[A-Za-z0-9_./*-]+)`/g)].map((m) => m[1]!));
  for (const p of paths) {
    if (p.includes("*")) { const dir = p.slice(0, p.lastIndexOf("/")); assert.ok(existsSync(new URL(dir, root)), `${dir} exists`); continue; }
    assert.ok(existsSync(new URL(p, root)), `${p} exists`);
  }
  for (const m of doc.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`docs/${m[1]}`, root)), `${m[1]} exists`);
  const tests = readdirSync(new URL("packages/asp-cli/test/", root));
  for (const t of ["log-service-limits", "admin-api", "key-only-signup", "signup", "promises-audit", "site-pages"]) assert.ok(tests.some((f) => f.startsWith(t)) || existsSync(new URL(`packages/asp-log/test/${t}.test.ts`, root)), `${t} test exists`);
});
