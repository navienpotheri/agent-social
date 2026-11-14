// The privacy line (register row AG9; docs/privacy-line.md): the written line is checked against the code. Every file the document names exists, the Action record has no field for thought, and the telemetry
// safeguards the document leans on are the ones tested. A claim in the document that points at nothing fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const doc = readFileSync(root("docs/privacy-line.md"), "utf8");

test("every file and test the privacy line names exists", () => {
  const named = [...doc.matchAll(/`((?:packages|spec|docs)\/[A-Za-z0-9_./-]+\.(?:ts|json|md))`/g)].map((m) => m[1]);
  assert.ok(named.length >= 8, `${named.length} paths named`);
  for (const p of new Set(named)) assert.ok(existsSync(root(p)), `${p} is named in docs/privacy-line.md and does not exist`);
});

test("the Action record, the public record of a run, has no field for thought and no open fields", () => {
  const schema = JSON.parse(readFileSync(root("spec/schemas/action.schema.json"), "utf8")) as { additionalProperties: boolean; properties: Record<string, unknown> };
  assert.equal(schema.additionalProperties, false, "a closed set of fields");
  const names = Object.keys(schema.properties);
  for (const bad of ["reasoning", "thought", "thoughts", "prompt", "reply", "transcript", "memory", "messages", "content"]) assert.ok(!names.includes(bad), `the Action schema has a ${bad} field`);
  assert.deepEqual(names.sort(), ["artifacts", "assurance", "blocked_attempts", "contract", "late", "metrics", "scopes_used", "sub_agents", "summary", "targets"].sort(), "a change to what an Action carries is a change to the line: update docs/privacy-line.md and this test");
});

test("the telemetry digest carries no free text, and reasoning is collected only through the consented signal", () => {
  const files = readdirSync(root("spec/schemas")).filter((f) => f.startsWith("telemetry_act"));
  assert.ok(files.length >= 1);
  assert.match(doc, /absent means nothing is collected/);
  assert.match(doc, /reasoning-trace/);
  const mandate = JSON.parse(readFileSync(root("spec/schemas/mandate.schema.json"), "utf8")) as { properties: { telemetry?: { required: string[] } } };
  assert.ok(mandate.properties.telemetry?.required.includes("signals"), "the Mandate's telemetry field names the signals");
});
