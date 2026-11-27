// Row DK1380: the incident drill document names only commands that exist, links files that exist, and says that it touches no real tenant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const doc = read("docs/incident-drill.md");

test("every asp command in the drill is documented, and every link goes to a file", () => {
  const commands = read("docs/commands.md");
  for (const m of new Set([...doc.matchAll(/`asp ([a-z]+ [a-z]+)/g)].map((x) => x[1]!))) assert.ok(commands.includes(`asp ${m}`) || commands.includes(`asp ${m.split(" ")[0]} `) , `asp ${m} is documented`);
  for (const m of doc.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`docs/${m[1]}`, root)), `${m[1]} exists`);
});

test("the drill touches no real tenant, rehearses the notice and the write-up, and says what it does not test", () => {
  assert.match(doc, /touches no real tenant/);
  assert.match(doc, /drill-2026-11-23/);
  assert.match(doc, /post-incident note/);
  assert.match(doc, /What the drill does not test/);
  assert.match(doc, /Credits are mock accounting entries/);
});
