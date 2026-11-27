// The shared job-data vectors (conformance/vectors/data-handling.json; register row JO3, spec-delta S1569): the default reading of an absent `data_handling` and the validation both SDKs apply. The Python SDK runs the same file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOB_DATA_TERM, MAX_RETAIN_DAYS, dataHandlingProblem, readDataHandling } from "../src/index.ts";

const vec = JSON.parse(readFileSync(new URL("../../../conformance/vectors/data-handling.json", import.meta.url), "utf8"));

test("the term and the limit are the vectors'", () => { assert.equal(vec.term, JOB_DATA_TERM); assert.equal(vec.maxRetainDays, MAX_RETAIN_DAYS); });
for (const c of vec.cases) {
  test(`data_handling: ${c.name}`, () => {
    assert.equal(dataHandlingProblem(c.input)?.rule ?? null, c.problem);
    assert.deepEqual(readDataHandling(c.input), c.reading);
  });
}
test("an absent field reads as every default, so the term applies to every contract including older ones", () => {
  assert.deepEqual(readDataHandling(undefined), { term: "asp.job-data/v1", commons_sharing: false, retention: "delete_at_settlement", retain_days: null, personal_data: "none" });
});
