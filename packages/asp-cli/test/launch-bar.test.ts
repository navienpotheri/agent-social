import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nonClosedRows } from "../../../conformance/launch-bar-rows.ts";
import { classify } from "../../../conformance/generate-launch-bar.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const bar = JSON.parse(read("docs/launch-bar.json")) as { counts: Record<string, number>; entries: { id: string; bucket: string; hours: number; claim?: string; says?: string; why: string }[] };

test("DK1312: every register row that is not closed is in the launch bar, once", () => {
  const rows = nonClosedRows(read("docs/gaps-register.md")).map((r) => r.id);
  const inBar = bar.entries.map((e) => e.id);
  assert.deepEqual(rows.filter((id) => !inBar.includes(id)), [], "add these rows: npm run launch-bar, and classify them in conformance/launch-bar-data.ts");
  assert.deepEqual(inBar.filter((id) => !rows.includes(id)), [], "these rows are closed or gone: npm run launch-bar");
  assert.equal(new Set(inBar).size, inBar.length, "a row is in exactly one bucket");
});

test("DK1312: docs/launch-bar.json is current and the page lists every row and the counts", () => {
  assert.deepEqual(classify(), bar.entries, "run npm run launch-bar");
  const md = read("docs/launch-bar.md");
  for (const e of bar.entries) assert.ok(new RegExp(`\| ${e.id} \|`).test(md), `${e.id} is in docs/launch-bar.md`);
  const c = bar.counts;
  assert.equal(c.must + c.withdraw + c.after, c.total);
  assert.ok(md.includes(`Must close before launch | ${c.must} (`), "the page's counts match the json");
});

test("DK1312: each bucket says what it must (hours, the claim and where, why it can wait)", () => {
  for (const e of bar.entries) {
    if (e.bucket === "must") assert.ok(e.hours > 0 && e.why, `${e.id} has hours and a why`);
    else if (e.bucket === "withdraw") assert.ok(e.claim, `${e.id} names the claim`);
    else assert.ok(e.says && e.why, `${e.id} says why it can wait and what the beta says`);
  }
});

test("DK1312: the alignment claim rule is stated and the row is closed only on the owner's approval (given on 2026-11-27)", () => {
  const md = read("docs/launch-bar.md");
  assert.match(md, /The alignment claim rule \(DK1332\)/);
  assert.match(md, /Status: approved by the owner on 2026-11-27/);
  assert.equal(bar.entries.find((x) => x.id === "DK1312"), undefined, "a closed row is no longer in the bar");
  assert.match(read("docs/gaps-register.md"), /\| DK1312 \|[^\n]*CLOSED 2026-11-27: the owner approved the launch bar[^\n]*\| closed \|/);
});
