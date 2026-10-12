import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

/** The use-case rows of docs/testing-map.md: | UC-nn | use case | automated | live | gap | to-do | pri |. */
function rows() {
  return read("docs/testing-map.md").split("\n").filter((l) => /^\| UC-\d+ \|/.test(l)).map((l) => {
    const c = l.split("|").slice(1, -1).map((x) => x.trim());
    return { id: c[0], useCase: c[1], automated: c[2], live: c[3], gap: c[4], todo: c[5], pri: c[6] };
  });
}

test("the testing map is whole: unique ids, real test files, real gaps, a priority and a to-do or a reason for none", () => {
  const all = rows();
  assert.ok(all.length >= 50, `the map has ${all.length} use cases`);
  assert.equal(new Set(all.map((r) => r.id)).size, all.length, "ids are unique");
  const register = read("docs/gaps-register.md");
  const gapIds = new Set([...register.matchAll(/^\| ([A-Z]+\d+) \|/gm)].map((m) => m[1]));
  for (const r of all) {
    assert.match(r.pri, /^P[012]$/, `${r.id} has a priority`);
    assert.ok(r.useCase.length > 8, `${r.id} says what the use case is`);
    assert.ok(r.todo.length > 0, `${r.id} has a to-do (or "none")`);
    assert.match(r.live, /^(yes|partial|no|n\/a)\b/, `${r.id}: Live starts with yes, partial, no or n/a`);
    if (r.automated !== "none") for (const f of r.automated.split(",").map((x) => x.trim())) assert.ok(existsSync(new URL(f, root)), `${r.id}: ${f} exists`);
    assert.ok(r.gap === "none" || gapIds.has(r.gap), `${r.id}: gap ${r.gap} is a row of the gaps register (or "none" when there is nothing open)`);
  }
});

test("every P0 use case that is not proven has something to do about it", () => {
  for (const r of rows().filter((x) => x.pri === "P0" && !/^(yes|n\/a)/.test(x.live))) assert.notEqual(r.todo.toLowerCase(), "none", `${r.id} is P0 and not proven live, so it needs a to-do`);
});
