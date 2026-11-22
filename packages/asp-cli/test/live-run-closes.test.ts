// The note on what a real-model run can close (docs/live-run-closes.md): every row it names is a row of the register, every Done line it quotes is word for word part of that row, the rows the lead asked for are all
// there, the plan's own "Counts when" lines that the page relies on still exist, every command it names is in the commands reference and every test file it names exists. It checks the page against the register
// and the plan; it runs nothing live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), "utf8").replace(/\r\n/g, "\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const page = read("docs/live-run-closes.md");
const register = new Map<string, string>();
for (const l of read("docs/gaps-register.md").split("\n")) { const m = /^\| (\w+) \|/.exec(l); if (m) register.set(m[1], squash(l)); }

const blocks = page.split(/^### /m).slice(1).map((b) => ({ id: /^(\w+) — /.exec(b)?.[1] ?? "", text: b }));

test("every row the page names in a heading is a row of the register", () => {
  assert.ok(blocks.length >= 18, `${blocks.length} blocks`);
  for (const b of blocks) { assert.ok(b.id, `a heading with a row id: ${b.text.slice(0, 40)}`); assert.ok(register.has(b.id), `${b.id} is a row of the gaps register`); }
});

test("every Done line quoted is word for word part of its register row, and each block has all seven parts", () => {
  for (const b of blocks) {
    const quote = /\*\*Done line:\*\* "(.+?)" \(priority/.exec(b.text)?.[1];
    assert.ok(quote, `${b.id}: a quoted Done line`);
    assert.ok(register.get(b.id)!.includes(squash(quote!)), `${b.id}: the quoted Done line is part of the register row`);
    for (const part of ["**Settled by:**", "**The run must produce:**", "**Extract with:**", "**Check before closing:**", "**Stays:**", "**Too early if:**"]) assert.ok(b.text.includes(part), `${b.id}: has ${part}`);
    const stated = /\(priority (\w+), status `(\w+)` in the register today\)/.exec(b.text);
    assert.ok(stated, `${b.id}: states its priority and status`);
    const cells = register.get(b.id)!.split("|").map((c) => c.trim());
    assert.equal(stated![1], cells[cells.length - 3].split(" ")[0], `${b.id}: the priority is the register's (its first word: a row may carry a note after it)`);
    assert.equal(stated![2], cells[cells.length - 2], `${b.id}: the status is the register's today (regenerate the page when a row moves)`);
  }
});

test("the rows the lead named, and the live rows that the plan's Counts-when lines name, are all on the page", () => {
  const ids = new Set(blocks.map((b) => b.id));
  for (const id of ["P7", "T3", "T4", "T15", "T22", "DK650", "P21", "DK1364", "DK1712", "DK1604", "DK79", "DK241", "DK1716", "E5", "DK1602", "DK1600", "T2"]) assert.ok(ids.has(id), `${id} is on the page`);
  const plan = read("docs/live-run-plan.md");
  const named = /\*\*A row moves only when your block matches its "counts when" line:\*\* ([^.]+)\./.exec(plan)?.[1] ?? "";
  for (const id of named.match(/\b(?:T|P|E|DK)\d+\b/g) ?? []) assert.ok(ids.has(id), `${id}, named by the plan, is on the page`);
});

test("the plan the page relies on still has its Counts-when lines for items 1 to 6, and the cohort document exists", () => {
  const plan = read("docs/live-run-plan.md");
  assert.ok((plan.match(/\*Counts when:\*/g) ?? []).length >= 5);
  for (const item of ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6", "Item 8"]) assert.ok(plan.includes(`**${item}.`), `${item} is in the plan`);
  assert.ok(existsSync(new URL("docs/society-models-run.md", root)), "the cohort document (DK1801) exists");
  assert.match(read("docs/society-models-run.md"), /claude-haiku-5-5/);
});

test("every command the page names is in the commands reference, every test file it names exists, and it keeps the beta statements", () => {
  const cmds = read("docs/commands.md");
  for (const m of page.matchAll(/npm run asp -- ((?:[a-z][a-z-]*)(?: (?:[a-z][a-z-]*))?)/g)) {
    const words = m[1].split(" ");
    // the command, or its first word with a subcommand: both forms appear in the reference
    const ok = cmds.includes(`\`asp ${words.join(" ")}`) || cmds.includes(`\`asp ${words[0]} `) || cmds.includes(`\`asp ${words[0]}\``);
    assert.ok(ok, `asp ${words.join(" ")} is in commands.md`);
  }
  for (const m of page.matchAll(/packages\/[a-z-]+\/test\/[a-z0-9.-]+\.ts/g)) assert.ok(existsSync(new URL(m[0], root)), `${m[0]} exists`);
  assert.match(page, /Credits are mock accounting entries, not money/);
  assert.match(page, /no outside security review/);
  assert.match(page, /Nothing here claims that agents become more aligned/);
});
