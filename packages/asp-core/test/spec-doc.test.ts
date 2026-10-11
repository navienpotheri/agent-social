import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { specDocument } from "../../../conformance/generate-spec-doc.ts";

const root = new URL("../../../", import.meta.url);

test("SPEC.md is the protocol as spec/ says it: regenerate it with npm run spec when a schema or the lifecycle changes", () => {
  assert.equal(readFileSync(new URL("SPEC.md", root), "utf8"), specDocument(), "SPEC.md is out of date: run npm run spec");
});

test("SPEC.md names every record type and every lifecycle state", () => {
  const spec = readFileSync(new URL("SPEC.md", root), "utf8");
  for (const f of readdirSync(new URL("spec/schemas/", root)).filter((x) => x.endsWith(".schema.json") && !["common.schema.json", "envelope.schema.json"].includes(x))) {
    assert.ok(spec.includes(`asp.${f.replace(".schema.json", "")}/v0.2`), `${f} is in SPEC.md`);
  }
  const lifecycle = JSON.parse(readFileSync(new URL("spec/lifecycle.json", root), "utf8"));
  for (const s of lifecycle.states) assert.ok(spec.includes(s), `state ${s} is in SPEC.md`);
});
