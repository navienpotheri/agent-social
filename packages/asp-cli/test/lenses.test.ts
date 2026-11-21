/**
 * The lens framework (docs/institutions/lenses.md; register row DK78): at least six lenses with every field, a generated matrix that is up to date, and a coverage check that fails an institution spec serving no lens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageProblems, loadLenses, matrixOf, readSpecFile, type LensData } from "../../../conformance/generate-lens-matrix.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("at least six lenses are written with every field, and every institution spec says which lenses it serves", () => {
  const d = loadLenses();
  assert.ok(d.lenses.length >= 6);
  assert.deepEqual(coverageProblems(d, readSpecFile), []);
});

test("the matrix is generated and up to date: rerun `npm run lenses` after a change to lenses.json", () => {
  assert.equal(readFileSync(join(ROOT, "docs/lenses/matrix.md"), "utf8"), matrixOf(loadLenses()));
});

test("the check fails an institution that serves no lens, a spec that does not say which lenses it serves, and a lens with an empty field", () => {
  const d = structuredClone(loadLenses()) as LensData;
  const spec = (path: string) => readSpecFile(path);
  // An institution that no lens lights up.
  const orphan = { ...d, institutions: [...d.institutions, { id: "orphan", spec: "docs/institutions/housing.md" }] };
  assert.ok(coverageProblems(orphan, spec).some((p) => p.startsWith("orphan: no lens is served")));
  // A spec with no "Lenses served" line.
  assert.ok(coverageProblems(d, (p) => (p.endsWith("shops.md") ? "# Shops\nno statement" : spec(p))).some((p) => p.startsWith("shops: ") && p.includes("does not say which lenses")));
  // A spec that lists a lens the matrix does not give it, and one that omits a lens it is given.
  assert.ok(coverageProblems(d, (p) => (p.endsWith("shops.md") ? "**Lenses served:** L6-sybil\n" : spec(p))).some((p) => p.includes("does not list L3-world-models")));
  assert.ok(coverageProblems(d, (p) => (p.endsWith("housing.md") ? (spec(p) ?? "").replace(/\*\*Lenses served:\*\*.*/, "**Lenses served:** L1-generative-agents, L5-inferring-values, L2-reflection-experience") : spec(p))).some((p) => p.includes("lists L2-reflection-experience, but the lens has no cell here")));
  // A lens with an empty field, an unknown function and fewer than six lenses.
  const bad = structuredClone(d) as LensData;
  bad.lenses[0].kill_switch = "";
  bad.lenses[1].cells[0].function = "daydream";
  assert.ok(coverageProblems(bad, spec).some((p) => p.includes("kill_switch is empty")));
  assert.ok(coverageProblems(bad, spec).some((p) => p.includes("unknown function daydream")));
  assert.ok(coverageProblems({ ...d, lenses: d.lenses.slice(0, 5) }, spec).some((p) => p.startsWith("only 5 lenses")));
});

test("every lens carries a citation, a claim, a kill-switch and an honest licence statement for each asset", () => {
  for (const l of loadLenses().lenses) {
    assert.ok(l.sources.every((s) => s.cite.length > 10 && s.claim.length > 10), l.id);
    assert.ok(l.assets.every((a) => ["unchecked", "the project's"].includes(a.licence) || a.licence.length > 0), l.id);
  }
});
