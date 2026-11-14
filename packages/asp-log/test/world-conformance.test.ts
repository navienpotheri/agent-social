// The shared world vectors (conformance/vectors/world.json): the generator and the rules must give what the file says. The Python SDK runs the same file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { GENERATOR, checkWorldRecord, generateDay, seedCommitment } from "../src/world.ts";

const vec = JSON.parse(readFileSync(new URL("../../../conformance/vectors/world.json", import.meta.url), "utf8"));

test("world vectors: generator version, commitments and every seeded day", () => {
  assert.equal(vec.generator, GENERATOR);
  for (const c of vec.commitments) assert.equal(seedCommitment(c.seed), c.commitment);
  assert.ok(vec.generate.length >= 60);
  for (const c of vec.generate) assert.deepEqual(generateDay(c.seed, c.day), c.events, `${c.seed} ${c.day}`);
});

test("world vectors: the log's rules on world records", () => {
  for (const c of vec.rules) {
    const r = { type: "asp.world/v0.2", issuer: c.issuer, issued_at: c.issued_at, body: c.body } as AspRecord;
    if (c.expect === "ok") { checkWorldRecord(r); continue; }
    assert.throws(() => checkWorldRecord(r), (e: unknown) => e instanceof AspError && e.code === "GUARD_FAILED" && e.detail === c.expect, c.name);
  }
});
