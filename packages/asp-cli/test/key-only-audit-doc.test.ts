// The key-only audit page (docs/key-only-audit.md) against the register and the probe test: the gap rows it names exist, are priority A and are not closed without a test, every test file it names exists, and the
// page keeps the beta statements. It checks the page; the probes themselves are packages/asp-log/test/key-only-audit.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), "utf8").replace(/\r\n/g, "\n");
const page = read("docs/key-only-audit.md");
const rows = new Map<string, string[]>();
for (const l of read("docs/gaps-register.md").split("\n")) { const m = /^\| (\w+) \|/.exec(l); if (m) rows.set(m[1]!, l.split("|").map((c) => c.trim())); }

test("every gap the audit names (KO1 to KO3) is a priority A row of the register, and a row that is closed names a test", () => {
  const named = [...new Set([...page.matchAll(/\bKO\d+\b/g)].map((m) => m[0]))];
  assert.deepEqual(named.sort(), ["KO1", "KO2", "KO3"]);
  for (const id of named) {
    const c = rows.get(id);
    assert.ok(c, `${id} is a row of the register`);
    assert.equal(c![c!.length - 3], "A", `${id} is priority A`);
    if (c![c!.length - 2] === "closed") assert.match(c!.join("|"), /\.test\.ts/, `${id} is closed only with a test named`);
  }
});

test("the audit names only files that exist, states that a key-only agent is its own sponsor, and keeps the beta statements", () => {
  for (const m of page.matchAll(/`((?:packages|docs)\/[\w./-]+\.(?:ts|md))`/g)) assert.ok(existsSync(new URL(m[1]!, root)), `${m[1]} exists`);
  assert.match(page, /names itself as its sponsor/);
  assert.match(page, /Credits are mock accounting entries, not money/);
  assert.match(page, /no outside security review/);
  assert.match(page, /Nothing here claims that agents become more aligned/);
  for (const w of ["works", "works differently, stated", "gap"]) assert.ok(page.includes(w), w);
});
