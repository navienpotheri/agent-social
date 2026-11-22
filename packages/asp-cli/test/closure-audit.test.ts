// The closure gate (docs/closure-audit-2026-11-22.md): a row is closed only on a Done line met by a passing test, so every closed row cites test files that exist, every row closed on or after 2026-11-22 cites at least
// one (a test file, or a UC id of the testing map whose row names one), the priority and status cells hold one word each, and the audit page agrees with the register. It checks the register and the page; it runs no
// test itself (the audit did that, and CI runs them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), "utf8").replace(/\r\n/g, "\n");
const tests = new Set<string>();
for (const pkg of readdirSync(new URL("packages/", root))) { const d = new URL(`packages/${pkg}/test/`, root); if (existsSync(d)) for (const f of readdirSync(d)) tests.add(f); }
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

interface Row { id: string; text: string; cells: string[] }
const rows: Row[] = [];
for (const l of read("docs/gaps-register.md").split("\n")) { const m = /^\| (\w+) \|/.exec(l); if (m) rows.push({ id: m[1]!, text: squash(l), cells: l.split("|").map((c) => c.trim()) }); }
const STATUS = ["open", "partial", "designed", "closed"];
const main = rows.filter((r) => r.cells.length >= 8 && (STATUS.includes(r.cells[r.cells.length - 2]!) || STATUS.includes(r.cells[r.cells.length - 2]!.split(" ")[0]!)));
const statusOf = (r: Row) => r.cells[r.cells.length - 2]!;
const closed = main.filter((r) => statusOf(r) === "closed");

// UC id -> the test files its testing-map row names
const ucFiles = new Map<string, string[]>();
for (const l of read("docs/testing-map.md").split("\n")) { const m = /^\| (UC-\d+) \|/.exec(l); if (m) ucFiles.set(m[1]!, [...l.matchAll(/([\w.-]+\.test\.ts)/g)].map((x) => x[1]!)); }

test("the priority and status cells of every register row hold one word, with no note in them", () => {
  const bad = main.filter((r) => !STATUS.includes(statusOf(r)) || !/^[ABC]$/.test(r.cells[r.cells.length - 3]!)).map((r) => `${r.id}: priority "${r.cells[r.cells.length - 3]!.slice(0, 24)}", status "${statusOf(r).slice(0, 24)}"`);
  assert.deepEqual(bad, [], "move the note into the Done cell");
});

test("every closed row cites only test files that exist, and every row closed on or after 2026-11-22 cites at least one", () => {
  assert.ok(closed.length > 300, `${closed.length} closed rows`);
  const missing: string[] = [], uncited: string[] = [];
  for (const r of closed) {
    const cited = [...new Set([...r.text.matchAll(/([\w.-]+\.test\.ts)/g)].map((m) => m[1]!))];
    for (const f of cited) if (!tests.has(f)) missing.push(`${r.id}: ${f}`);
    const recent = /[Cc]losed 2026-11-2[2-9]|[Bb]uilt and closed 2026-11-2[2-9]|closed on its Done line/.test(r.text);
    if (recent) {
      const viaUc = [...r.text.matchAll(/UC-\d+/g)].some((m) => (ucFiles.get(m[0]) ?? []).some((f) => tests.has(f)));
      if (!cited.length && !viaUc) uncited.push(r.id);
    }
  }
  assert.deepEqual(missing, [], "a closed row names a test file that does not exist");
  assert.deepEqual(uncited, [], "a row closed on or after 2026-11-22 cites no test");
});

test("the closure audit page agrees with the register: CONFIRMED rows are closed, REOPEN rows are not, every Done line quoted is the row's own", () => {
  const page = read("docs/closure-audit-2026-11-22.md");
  const blocks = page.split(/^### /m).slice(1);
  assert.ok(blocks.length >= 14, `${blocks.length} rows audited`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let confirmed = 0, reopened = 0;
  for (const b of blocks) {
    const m = /^(\w+) — (CONFIRMED|REOPEN)/.exec(b);
    assert.ok(m, `a heading with a row and a verdict: ${b.slice(0, 40)}`);
    const row = byId.get(m![1]!);
    assert.ok(row, `${m![1]} is a row of the register`);
    const status = row!.cells[row!.cells.length - 2];
    if (m![2] === "CONFIRMED") { confirmed++; assert.equal(status, "closed", `${m![1]} is CONFIRMED and must be closed`); }
    else { reopened++; assert.notEqual(status, "closed", `${m![1]} is REOPEN and must not be closed`); }
    const quote = /\*\*Done line:\*\* "(.+?)"\n/.exec(b)?.[1];
    assert.ok(quote && row!.text.includes(squash(quote)), `${m![1]}: the Done line quoted is part of the row`);
    for (const t of b.matchAll(/`(packages\/[a-z-]+\/test\/[\w.-]+\.test\.ts)`/g)) assert.ok(existsSync(new URL(t[1]!, root)), `${t[1]} exists`);
    assert.match(b, /\*\*Mutation evidence:\*\*/);
  }
  assert.equal(confirmed + reopened, blocks.filter((b) => /^\w+ — /.test(b)).length);
  assert.match(page, new RegExp(`${confirmed} CONFIRMED, ${reopened} REOPEN`), "the counts on the page are the blocks'");
  for (const id of ["DK1229", "DK1401", "T11", "US7", "DK1505", "DK230", "DK827"]) assert.ok(blocks.some((b) => b.startsWith(`${id} — `)), `${id} is audited`);
  for (const id of ["JO8", "DK1302"]) assert.notEqual(byId.get(id)!.cells[byId.get(id)!.cells.length - 2], "closed", `${id} stays partial`);
});
