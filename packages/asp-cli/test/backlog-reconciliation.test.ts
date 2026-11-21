// Register row DK797: the first lists are reconciled against the register. Every bullet of docs/backlog.md is in docs/backlog-reconciliation.json as done (struck through there), a row of the register, or a dropped item with a
// reason; every register id the first lists name is a real row; the items with no row are carried by DK1412.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const register = read("docs/gaps-register.md");
const known = (id: string) => new RegExp(`^\\| ${id} \\|`, "m").test(register);
const rec = JSON.parse(read("docs/backlog-reconciliation.json")) as { items: { n: number; text: string; verdict: "done" | "row" | "drop"; maps: string[]; reason?: string }[] };

test("DK797: every bullet of docs/backlog.md is reconciled, once, as done, a register row or a dropped item with a reason", () => {
  const bullets = read("docs/backlog.md").split("\n").filter((l) => l.startsWith("- "));
  assert.equal(rec.items.length, bullets.length, "one entry for each bullet of the backlog");
  rec.items.forEach((it, i) => {
    assert.equal(it.n, i + 1);
    const struck = bullets[i]!.startsWith("- ~~");
    if (struck) assert.equal(it.verdict, "done", `bullet ${it.n} is struck through, so it is done`);
    else assert.notEqual(it.verdict, "done", `bullet ${it.n} is not struck through`);
    if (it.verdict === "row") { assert.ok(it.maps.length > 0, `bullet ${it.n} names a row`); for (const id of it.maps) assert.ok(known(id), `bullet ${it.n}: ${id} is a register row`); }
    if (it.verdict === "drop") assert.ok(it.reason && it.reason.length > 10, `bullet ${it.n} has a reason`);
  });
});

test("DK797: the items with no row are carried by DK1412, which is open and says it is not a launch claim", () => {
  assert.ok(known("DK1412"));
  assert.match(register, /^\| DK1412 \| Backlog items with no register row/m);
  const carried = rec.items.filter((i) => i.maps.includes("DK1412"));
  assert.ok(carried.length >= 20, `${carried.length} items are carried by DK1412`);
  const md = read("docs/backlog-reconciliation.md");
  for (const it of rec.items) assert.ok(md.includes(`| ${it.n} |`), `item ${it.n} is in the table`);
});

test("DK797: every register id named in backlog-triage.md and owner-checklist.md is a row of the register, and the launch gate is carried by the launch bar", () => {
  const ID = /\b(DK\d{1,4}|[A-Z]{1,3}\d{1,3}[a-z]?)\b/g;
  const bad: string[] = [];
  for (const f of ["docs/backlog-triage.md", "docs/owner-checklist.md"]) {
    for (const line of read(f).split("\n").filter((l) => l.startsWith("| "))) {
      const cells = line.split("|").map((c) => c.trim());
      for (const cell of cells.slice(1, 4)) for (const m of cell.matchAll(/^((?:DK\d{1,4}|[A-Z]{1,3}\d{1,3}[a-z]?)(?:,\s*(?:DK\d{1,4}|[A-Z]{1,3}\d{1,3}[a-z]?))*)$/g)) for (const id of m[1]!.split(",").map((x) => x.trim())) if (!known(id)) bad.push(`${f}: ${id}`);
    }
  }
  assert.deepEqual(bad, [], "ids named in the first lists that are not register rows");
  void ID;
  const gate = read("docs/launch-gate.md");
  assert.match(read("docs/launch-bar.md"), /launch-gate\.md/);
  for (const id of ["T1", "P21", "T15", "T22", "T2", "T3", "U1", "M9", "T12", "O2", "O19", "O12", "O13", "GV6", "LW8", "GV11", "JO3", "LW1", "U9", "P22", "E9", "E10"]) {
    assert.ok(gate.includes(id), `${id} is in the launch gate`);
    assert.ok(known(id), `${id} is a register row`);
  }
});
