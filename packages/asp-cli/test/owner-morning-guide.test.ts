// docs/owner-morning-guide.md is the owner's first page. Its numbers are read from docs/launch-bar.json and docs/launch-bar.md, never typed by hand; every file it names exists; it keeps the standing statements.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const guide = read("docs/owner-morning-guide.md");
const bar = JSON.parse(read("docs/launch-bar.json")) as { counts: { must: number; withdraw: number; after: number; total: number }; mustWorkerHours: number };

test("the numbers in the guide are the launch bar's", () => {
  assert.ok(guide.includes(`${bar.counts.total} register rows`));
  assert.ok(guide.includes(`${bar.counts.must} must close`));
  assert.ok(guide.includes(`${bar.mustWorkerHours} worker-hours`));
  assert.ok(guide.includes(`${bar.counts.withdraw} rows are claims`));
  assert.ok(guide.includes(`${bar.counts.after} are after launch`));
  const closed = /\*\*Closed on 2026-11-22: (\d+) rows/.exec(read("docs/launch-bar.md"))?.[1];
  assert.ok(closed && guide.includes(`${closed} rows were closed on 2026-11-22`), "the closed count is the launch bar's");
});

test("every file the guide names exists", () => {
  const missing: string[] = [];
  for (const m of guide.matchAll(/\]\(([^)#]+)\)/g)) { const t = m[1]!; if (!/^https?:/.test(t) && !existsSync(new URL(`docs/${t}`, root))) missing.push(t); }
  for (const m of guide.matchAll(/`(scripts\/[^`]+)`/g)) if (!existsSync(new URL(m[1]!, root))) missing.push(m[1]!);
  assert.deepEqual(missing, []);
});

test("the guide keeps the standing statements and tells the owner what to do with each item", () => {
  assert.match(guide, /Credits are mock accounting entries, not money/);
  assert.match(guide, /no outside security review/);
  assert.match(guide, /there is no sandbox/);
  for (const w of ["DK1340", "DK1", "LW1", "DK421", "DK420", "U8", "O12", "evening-rehearsal.ps1"]) assert.ok(guide.includes(w), `${w} is named`);
  assert.equal([...guide.matchAll(/^\| (\d+) \|/gm)].length, 10);
});

test("the guide gives the order of signing and tonight's steps in one place", () => {
  assert.match(guide, /any edit after it breaks the signature/);
  const order = guide.indexOf("block 4 (the legal review");
  assert.ok(order > 0 && order < guide.indexOf("block 1 (the monetary policy") && guide.indexOf("block 1 (the monetary policy") < guide.indexOf("block 3 (the successor") && guide.indexOf("block 3 (the successor") < guide.indexOf("block 2 last"), "the blocks are in the order 4, 1, 3, 2");
  assert.match(guide, /Tonight's live run, in one place/);
  assert.match(guide, /evening-rehearsal\.ps1/);
  assert.match(guide, /stop --all/);
});

test("the numbers sit between markers that the launch-bar generator writes, so they cannot go stale by hand", () => {
  assert.match(guide, /<!-- BEGIN NUMBERS -->\nThe launch bar lists \d+ register rows[^\n]*\n<!-- END NUMBERS -->/);
  assert.match(read("conformance/generate-launch-bar.ts"), /BEGIN NUMBERS/);
});
