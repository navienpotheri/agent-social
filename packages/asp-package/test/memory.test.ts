import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { enforceMemoryBudget, mergeMemoryInto, withSuffix } from "../src/memory.ts";

function tree(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "asp-mem-"));
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
  return dir;
}
const read = (dir: string, rel: string) => readFileSync(join(dir, rel), "utf8");
const who = (n: number) => ({ name: `run ${n}`, label: `run${n}`, other: "an earlier run's" });

test("three-way merge: two runs that learned different things both keep their lessons", () => {
  const base = tree({ "auto/MEMORY.md": "- [A](a.md) - first\n", "auto/a.md": "A\n" });
  const one = tree({ "auto/MEMORY.md": "- [A](a.md) - first\n- [B](b.md) - second\n", "auto/a.md": "A\n", "auto/b.md": "B\n" });
  const two = tree({ "auto/MEMORY.md": "- [A](a.md) - first\n- [C](c.md) - third\n", "auto/a.md": "A\n", "auto/c.md": "C\n" });
  const merged = tree({ "auto/MEMORY.md": "- [A](a.md) - first\n", "auto/a.md": "A\n" });
  assert.deepEqual(mergeMemoryInto(merged, base, one, who(1)), []);
  assert.deepEqual(mergeMemoryInto(merged, base, two, who(2)), []);
  assert.equal(read(merged, "auto/b.md"), "B\n");
  assert.equal(read(merged, "auto/c.md"), "C\n");
  const index = read(merged, "auto/MEMORY.md");
  assert.ok(index.includes("(b.md)") && index.includes("(c.md)") && index.includes("(a.md)"));
  assert.equal(index.split("(a.md)").length, 2, "the shared line is not duplicated");
});

test("a topic file both runs changed differently is kept side by side, never overwritten", () => {
  const base = tree({ "auto/note.md": "base\n" });
  const merged = tree({ "auto/note.md": "from run one\n" }); // run one already wrote back
  const two = tree({ "auto/note.md": "from run two\n" });
  const notes = mergeMemoryInto(merged, base, two, who(2));
  assert.equal(read(merged, "auto/note.md"), "from run one\n");
  assert.equal(read(merged, "auto/note.run2.md"), "from run two\n");
  assert.match(notes[0], /run 2's auto[\\/]note\.md differs from an earlier run's; kept separately as auto[\\/]note\.run2\.md/);
  assert.equal(withSuffix("a/b.md", "run2"), "a/b.run2.md");
});

test("a removal deletes an untouched file but never one another run has changed since", () => {
  const base = tree({ "auto/x.md": "x\n", "auto/y.md": "y\n" });
  const ours = tree({}); // this run removed both
  const merged = tree({ "auto/x.md": "x\n", "auto/y.md": "y changed by another run\n" });
  const notes = mergeMemoryInto(merged, base, ours, who(3));
  assert.equal(existsSync(join(merged, "auto/x.md")), false);
  assert.equal(existsSync(join(merged, "auto/y.md")), true);
  assert.match(notes.join(" "), /run 3 removed auto[\\/]y\.md, but it has changed since; kept/);
});

test("the budget prunes the least recently changed topic files first, and the index lines that point at them", () => {
  const files: Record<string, string> = { "auto/MEMORY.md": [1, 2, 3, 4, 5].map((i) => `- [L${i}](l${i}.md) - lesson ${i}`).join("\n") + "\n" };
  for (let i = 1; i <= 5; i++) files[`auto/l${i}.md`] = `lesson ${i}\n`;
  const dir = tree(files);
  for (let i = 1; i <= 5; i++) utimesSync(join(dir, `auto/l${i}.md`), new Date(2026, 0, i), new Date(2026, 0, i)); // l1 is the oldest
  const r = enforceMemoryBudget(dir, { maxFiles: 3, maxBytes: 1_000_000, maxIndexLines: 100 });
  assert.deepEqual(r.pruned, ["auto/l1.md", "auto/l2.md"]);
  assert.equal(r.files, 3);
  assert.equal(existsSync(join(dir, "auto/l1.md")), false);
  assert.equal(existsSync(join(dir, "auto/l5.md")), true);
  const index = read(dir, "auto/MEMORY.md");
  assert.ok(!index.includes("(l1.md)") && !index.includes("(l2.md)") && index.includes("(l3.md)"), "no index line is left pointing at a pruned file");
  assert.equal(r.indexLinesRemoved, 2);
});

test("the byte budget prunes too, and an index is capped to its newest lines", () => {
  const dir = tree({ "auto/MEMORY.md": [1, 2, 3, 4].map((i) => `- [N${i}](n${i}.md) - note ${i}`).join("\n") + "\n", "auto/n1.md": "x".repeat(600), "auto/n2.md": "y".repeat(600), "auto/n3.md": "z", "auto/n4.md": "w" });
  utimesSync(join(dir, "auto/n1.md"), new Date(2026, 0, 1), new Date(2026, 0, 1));
  utimesSync(join(dir, "auto/n2.md"), new Date(2026, 0, 2), new Date(2026, 0, 2));
  const r = enforceMemoryBudget(dir, { maxFiles: 10, maxBytes: 700, maxIndexLines: 100 });
  assert.equal(r.pruned.length, 1, "removing the oldest large file is enough");
  assert.equal(existsSync(join(dir, "auto/n1.md")), false);

  const idx = tree({ "auto/MEMORY.md": [1, 2, 3, 4, 5, 6].map((i) => `- line ${i}`).join("\n") + "\n" });
  const capped = enforceMemoryBudget(idx, { maxFiles: 10, maxBytes: 1_000_000, maxIndexLines: 3 });
  assert.equal(capped.indexLinesRemoved, 3);
  assert.deepEqual(read(idx, "auto/MEMORY.md").split("\n").filter(Boolean), ["- line 4", "- line 5", "- line 6"], "the oldest lines go first");
});
