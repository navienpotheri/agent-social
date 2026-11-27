/**
 * The Market completeness audit's table (register rows DK1728 and DK1729; docs/institutions/market-completeness-audit.md): every BI and CR id in the design documents is mapped to a test file that exists and contains the stated word,
 * or to a register row that exists and is not closed (a requirement not built or not run). A word shows a test mentions a requirement, not that it covers all of it; the page says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (f: string): string => readFileSync(join(root, f), "utf8").replace(/\r/g, "");
const doc = read("docs/institutions/market-completeness-audit.md");
const tests = new Map<string, string>();
for (const p of readdirSync(join(root, "packages"))) {
  const d = join(root, "packages", p, "test");
  if (existsSync(d)) for (const f of readdirSync(d)) tests.set(f, join(d, f));
}

test("every mapped requirement names a test file that exists and contains its word", () => {
  const rows = [...doc.matchAll(/^\| ((?:BI|CR)-\d+) \| built and tested \| ([^|]+) \| ([^|]+) \|$/gm)];
  assert.ok(rows.length >= 38, `${rows.length} mapped`);
  for (const [, id, file, word] of rows) {
    const p = tests.get(file.trim());
    assert.ok(p, `${id}: ${file} is not a test file`);
    assert.ok(readFileSync(p!, "utf8").toLowerCase().includes(word.trim().toLowerCase()), `${id}: ${file} does not contain "${word.trim()}"`);
  }
});

test("every BI and CR id in the design documents is in the audit: mapped to a test, or to a register row that exists and is not closed", () => {
  const ids = new Set<string>();
  for (const f of ["docs/institutions/bank-insurer.md", "docs/institutions/economy/credits.md"])
    for (const m of read(f).matchAll(/^\| ((?:BI|CR)-\d+) \|/gm)) ids.add(m[1]);
  assert.ok(ids.size >= 40, `${ids.size} ids in the design documents`);
  const register = read("docs/gaps-register.md").split("\n");
  for (const m of doc.matchAll(/^\| ((?:BI|CR)-\d+) \| (DK\d+) \|/gm)) {
    const line = register.find((l) => l.startsWith(`| ${m[2]} |`));
    assert.ok(line, `${m[1]}: row ${m[2]} is not in the register`);
    assert.ok(!/\| closed \|$/.test(line!.trim()), `${m[1]}: row ${m[2]} is closed, so the requirement should be mapped to its test`);
  }
  for (const id of ids) assert.ok(new RegExp(`^\\| ${id} \\|`, "m").test(doc), `${id} is not in the audit`);
});
