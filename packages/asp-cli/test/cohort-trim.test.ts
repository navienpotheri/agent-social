// Diagnosis fix 8 (section 57): the tools in view: every tool is still offered with its name and input schema unchanged; the optional groups' tools are shown with their first sentence and their limits and after the core tools, so
// the list (about 10,200 tokens of every turn in the 2026-11-24 run) is shorter; --no-trim shows whole descriptions. No tool is removed and nothing an agent can do changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_OF, offeredTools, toolListChars } from "../src/cohort/tools.ts";

const ALL = new Set(Object.values(GROUP_OF));

test("every tool is still offered, with the same name and schema; optional tools are shortened and come after the core ones; the list is shorter", () => {
  const full = offeredTools(ALL, false), trimmed = offeredTools(ALL, true);
  assert.deepEqual(trimmed.map((t) => t.name).sort(), full.map((t) => t.name).sort(), "no tool is removed");
  for (const t of trimmed) assert.deepEqual(t.input_schema, full.find((f) => f.name === t.name)!.input_schema, `${t.name}: the schema is unchanged`);
  const firstGrouped = trimmed.findIndex((t) => GROUP_OF[t.name]);
  assert.ok(trimmed.slice(firstGrouped).every((t) => GROUP_OF[t.name]) && trimmed.slice(0, firstGrouped).every((t) => !GROUP_OF[t.name]), "the core tools come first");
  for (const t of trimmed.filter((x) => !GROUP_OF[x.name])) assert.equal(t.description, full.find((f) => f.name === t.name)!.description, `${t.name}: a core description is whole`);
  for (const t of trimmed.filter((x) => GROUP_OF[x.name])) { const f = full.find((x) => x.name === t.name)!; assert.ok(t.description.length <= f.description.length && f.description.startsWith(t.description.split(" Limits:")[0]!), `${t.name}: the first sentence`); assert.equal(/ Limits: /.test(t.description), / Limits: /.test(f.description), `${t.name}: the limits stay`); }
  const before = toolListChars(full), after = toolListChars(trimmed);
  assert.ok(after < before * 0.95, `${after} characters against ${before}`);
  assert.deepEqual(offeredTools(new Set(["games"]), true).map((t) => t.name).filter((n) => GROUP_OF[n]), ["game_list", "game_enter", "game_results"], "only the groups the run has");
});
