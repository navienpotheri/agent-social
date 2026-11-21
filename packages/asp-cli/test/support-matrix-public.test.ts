/** The public support matrix (register row P8; spec-delta S413): the README and the site say what the code says about each runtime, and each runtime has a named test row that exists. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIMES, supportMatrix } from "@agent-social/asp-package";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("P8: the README table has one row per runtime, and each row's words match the code's evidence level and whether calls are prevented", () => {
  const readme = read("README.md");
  const rows = new Map(readme.split("\n").filter((l) => l.startsWith("| ") && l.includes("`asp run ")).map((l) => [/`asp run (\S+)`/.exec(l)![1], l]));
  assert.deepEqual([...rows.keys()].sort(), RUNTIMES.map((r) => r.name).sort());
  for (const r of RUNTIMES) {
    const row = rows.get(r.name)!;
    if (r.evidence.level === "live") assert.match(row, /Tested live/, r.name);
    else assert.ok(!/Tested live/.test(row), `${r.name} is not live`);
    if (r.evidence.level === "stand-in") assert.match(row, /stand-in/, r.name);
    if (r.evidence.level === "partial") assert.match(row, /Tested in part/, r.name);
    if (r.preventsCalls) assert.ok(!/not prevented/i.test(row), r.name); else assert.match(row, /Observed, not prevented/, r.name);
    if (r.reach === "hook" && r.preventsCalls) assert.match(row, /pre-call hook/, r.name);
    if (r.reach === "gateway") assert.match(row, /gateway/i, r.name);
  }
  assert.match(readme, /a test fails if this table and the code disagree/);
});

test("P8: the site's count of runtimes and of live-tested ones is what the code says, and the one that is only observed is named", () => {
  const html = read("site/index.html");
  const live = RUNTIMES.filter((r) => r.evidence.level === "live").length;
  const words = ["Zero", "One", "Two", "Three", "Four", "Five"];
  assert.match(html, new RegExp(`<b>${RUNTIMES.length}</b><span>Agent runtimes started by <code>asp run</code>\. ${words[live]} have been tested live`));
  assert.equal(RUNTIMES.filter((r) => !r.preventsCalls).length, 1);
  assert.match(html, /one is observed, not prevented/);
  for (const r of RUNTIMES) assert.ok(html.includes(r.title.replace(/ \(agy\)/, "")), r.title);
});

test("P8: each runtime points at a testing-map row whose test file exists, and `asp runtimes` prints that row", () => {
  const map = read("docs/testing-map.md");
  for (const r of RUNTIMES) {
    const line = map.split("\n").find((l) => l.startsWith(`| ${r.evidence.row} |`));
    assert.ok(line, `${r.evidence.row} is in the testing map`);
    const file = /\| (packages\/[^ |]+\.test\.ts)/.exec(line!)?.[1];
    assert.ok(file && existsSync(join(root, file)), `${r.name}: ${file} exists`);
    assert.ok(supportMatrix().some((l) => l.split(/\s{2,}/).slice(0, 5).join("|") === [r.name, r.reach, r.assurance, r.evidence.level, r.evidence.row].join("|")), `asp runtimes prints the row for ${r.name}`);
  }
});
