/**
 * The Market completeness audit's table (register row DK1728; docs/institutions/market-completeness-audit.md): every BI and CR id in the design documents is either mapped to a test file that exists and contains the stated word,
 * or in the list of unmapped ids that the row DK1729 carries. A word shows a test mentions a requirement, not that it covers all of it; the page says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const doc = readFileSync(join(root, "docs/institutions/market-completeness-audit.md"), "utf8").replace(/\r/g, "");
const tests = new Map<string, string>();
for (const p of readdirSync(join(root, "packages"))) {
  const d = join(root, "packages", p, "test");
  if (existsSync(d)) for (const f of readdirSync(d)) tests.set(f, join(d, f));
}

test("every mapped requirement names a test file that exists and contains its word", () => {
  const rows = [...doc.matchAll(/^\| ((?:BI|CR)-\d+) \| built and tested \| ([^|]+) \| ([^|]+) \|$/gm)];
  assert.ok(rows.length >= 35, `${rows.length} mapped`);
  for (const [, id, file, word] of rows) {
    const p = tests.get(file.trim());
    assert.ok(p, `${id}: ${file} is not a test file`);
    assert.ok(readFileSync(p!, "utf8").toLowerCase().includes(word.trim().toLowerCase()), `${id}: ${file} does not contain "${word.trim()}"`);
  }
});

test("every BI and CR id in the design documents is in the audit: mapped, or listed as unmapped", () => {
  const ids = new Set<string>();
  for (const f of ["docs/institutions/bank-insurer.md", "docs/institutions/economy/credits.md"])
    for (const m of readFileSync(join(root, f), "utf8").replace(/\r/g, "").matchAll(/^\| ((?:BI|CR)-\d+) \|/gm)) ids.add(m[1]);
  assert.ok(ids.size >= 40, `${ids.size} ids in the design documents`);
  const unmapped = (doc.match(/## Unmapped[^\n]*\n\n([^\n]+)/) ?? [])[1] ?? "";
  for (const id of ids) assert.ok(new RegExp(`^\\| ${id} \\|`, "m").test(doc) || unmapped.includes(id), `${id} is neither mapped nor listed as unmapped`);
});
