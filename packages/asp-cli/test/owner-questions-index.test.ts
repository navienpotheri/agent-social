import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const text = readFileSync(new URL("docs/owner-questions-all.md", root), "utf8").replace(/\r\n/g, "\n");

test("the owner's one-pass question list: the stated count equals the numbered lines, they run 1..N once, and each names a source", () => {
  const stated = Number(/\*\*Count of open questions: (\d+)\*\*/.exec(text)?.[1]);
  assert.ok(stated > 0, "the count is stated");
  const open = text.split("## Answered, no action")[0];
  const numbered = [...open.matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)];
  assert.equal(numbered.length, stated, "the stated count is the number of numbered questions");
  assert.deepEqual(numbered.map((m) => Number(m[1])), Array.from({ length: stated }, (_, i) => i + 1), "the numbers run 1 to N with none missing or repeated");
  for (const line of open.split("\n").filter((l) => /^\d+\. /.test(l))) assert.match(line, /\[[^\]]+\]\s*$/, `a source in brackets ends: ${line.slice(0, 40)}`);
});

test("the owner's list does not claim an alignment result and keeps the beta statements", () => {
  assert.match(text, /Credits are accounting entries, not money/);
  assert.match(text, /no outside security review/);
  assert.match(text, /Nothing here claims that agents become more aligned/);
});

test("every row id the list names is a row of the gaps register", () => {
  const register = readFileSync(new URL("docs/gaps-register.md", root), "utf8");
  const ids = new Set([...register.matchAll(/^\| ([A-Z]+\d+) \|/gm)].map((m) => m[1]));
  const open = text.split("## Answered, no action")[0];
  const named = new Set([...open.matchAll(/\*\*((?:[A-Z]+\d+)(?:(?: \/ | and |, )[A-Z]+\d+)*)[ (:]/g)].flatMap((m) => m[1].split(/ \/ | and |, /)));
  for (const id of named) if (/^(DK|AG|LW|O|T|E|X|US|U)\d+$/.test(id)) assert.ok(ids.has(id), `${id} is a row of the register`);
});
