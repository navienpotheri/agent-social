import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const schemas = readdirSync(new URL("spec/schemas/", root)).filter((f) => f.endsWith(".schema.json") && f !== "common.schema.json" && f !== "envelope.schema.json").map((f) => f.replace(/\.schema\.json$/, ""));
const vectors = JSON.parse(readFileSync(new URL("conformance/vectors/schema.json", root), "utf8")) as { cases: { name: string; schema: string; valid: boolean }[] };

test("every record type in spec/schemas has schema vectors, at least one valid and one invalid, which both SDKs run", () => {
  assert.ok(schemas.length > 90, "the schema folder was read");
  const gaps: string[] = [];
  for (const t of schemas) {
    const cases = vectors.cases.filter((c) => c.schema === t);
    if (!cases.some((c) => c.valid)) gaps.push(`${t}: no valid vector`);
    if (!cases.some((c) => !c.valid)) gaps.push(`${t}: no invalid vector`);
  }
  assert.deepEqual(gaps, [], "add vectors in conformance/generate.ts and run `npm run vectors` (the Python SDK reads the same file)");
});

test("the Python SDK lists exactly the record types the schemas define", () => {
  const py = readFileSync(new URL("python/src/asp_core/schema.py", root), "utf8");
  const listed = new Set([...(/RECORD_TYPES = \(([\s\S]*?)\)\nTYPE_VERSION/.exec(py)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...listed].filter((t) => !schemas.includes(t)).sort(), [], "a Python record type with no schema");
  assert.deepEqual(schemas.filter((t) => !listed.has(t)).sort(), [], "a schema with no Python record type");
});
