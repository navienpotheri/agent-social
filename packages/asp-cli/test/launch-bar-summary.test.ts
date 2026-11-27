import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const md = readFileSync(new URL("docs/launch-bar.md", root), "utf8").replace(/\r\n/g, "\n");
const json = JSON.parse(readFileSync(new URL("docs/launch-bar.json", root), "utf8")) as { counts: { must: number; withdraw: number; after: number; total: number }; mustWorkerHours: number; entries: { bucket: string; flags: string; pri: string }[] };
const summary = /<!-- BEGIN SUMMARY -->\n([\s\S]*?)\n<!-- END SUMMARY -->/.exec(md)?.[1] ?? "";
const num = (re: RegExp): number[] => { const m = re.exec(summary); assert.ok(m, `the one-page section says: ${re}`); return m!.slice(1).map(Number); };
const flagN = (f: string) => json.entries.filter((e) => e.bucket === "must" && e.flags.includes(f)).length;

test("the owner's one page is generated: its markers are present and every figure in its prose equals docs/launch-bar.json", () => {
  assert.ok(summary.length > 500, "the one-page section sits between BEGIN SUMMARY and END SUMMARY");
  const [rows, a, b, c] = num(/(\d+) register rows are not closed \((\d+) at priority A, (\d+) at B, (\d+) at C\)/);
  assert.equal(rows, json.counts.total, "rows not closed");
  assert.equal(a, json.entries.filter((e) => e.pri === "A").length, "priority A");
  assert.equal(b, json.entries.filter((e) => e.pri === "B").length, "priority B");
  assert.equal(c, json.entries.filter((e) => e.pri === "C").length, "priority C");
  const [must, hours] = num(/Must close before launch: (\d+) rows, (\d+) worker-hours/);
  assert.equal(must, json.counts.must, "must-close rows");
  assert.equal(hours, Math.round(json.mustWorkerHours), "must-close worker-hours");
  const [d, l, x, o] = num(/(\d+) need your decision, (\d+) a live run, (\d+) an outside party and (\d+) an action only you can take/);
  assert.deepEqual([d, l, x, o], [flagN("D"), flagN("L"), flagN("X"), flagN("O")], "the flags D, L, X, O");
  assert.equal(num(/Withdraw the claim until done: (\d+) rows/)[0], json.counts.withdraw, "withdraw");
  assert.equal(num(/After launch: (\d+) rows/)[0], json.counts.after, "after launch");
  assert.equal(num(/\*\*Full\*\*: all (\d+) must-close rows/)[0], json.counts.must, "the Full bar names all the must-close rows");
  assert.equal(num(/\*\*Full\*\*[^|]*\|\s*(\d+)\s*\|/)[0], Math.round(json.mustWorkerHours), "the Full bar's hours");
});

test("the counts table below the page agrees with the prose, and the closed-today list is as long as it says", () => {
  const table = /\| Must close before launch \| (\d+) \(([\d.]+) worker-hours/.exec(md);
  assert.ok(table, "the counts table is there");
  assert.equal(Number(table![1]), json.counts.must);
  assert.equal(Number(table![2]), json.mustWorkerHours);
  const closed = /\*\*Closed on (\d{4}-\d\d-\d\d): (\d+) rows\*\*[^:]*: ([^\n]+?)\.\n/.exec(summary);
  assert.ok(closed, "the closed-today list is there");
  const ids = closed![3]!.split(", ");
  assert.equal(ids.length, Number(closed![2]), "the list has as many ids as it says");
  assert.equal(new Set(ids).size, ids.length, "no id twice");
  const register = readFileSync(new URL("docs/gaps-register.md", root), "utf8");
  for (const id of ids.slice(0, 400)) assert.match(register, new RegExp(`^\\| ${id} \\|`, "m"), `${id} is a register row`);
});
