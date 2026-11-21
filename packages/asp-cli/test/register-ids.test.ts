// Register row DK1343: a gap id names one row. The "Partial" view table repeats rows by design; every other row id appears once in the register and once in docs/scope.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
function dups(text: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  let sec = "";
  for (const l of text.split("\n")) {
    if (l.startsWith("## ")) sec = l;
    const m = /^\| ([A-Z]{1,3}\d+[a-z]?) \|/.exec(l);
    if (!m || sec.startsWith("## Partial")) continue;
    if (seen.has(m[1]!)) out.push(m[1]!); else seen.add(m[1]!);
  }
  return out;
}
test("DK1343: no row id appears twice in the register's sections or in docs/scope.md", () => {
  assert.deepEqual(dups(read("docs/gaps-register.md")), []);
  assert.deepEqual(dups(read("docs/scope.md")), []);
});
