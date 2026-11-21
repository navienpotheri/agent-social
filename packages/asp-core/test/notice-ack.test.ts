// The shared notice-acknowledgement vectors (conformance/vectors/notice-ack.json; register row US8, spec-delta S1591): the validation both SDKs apply to a notice_ack body. The Python SDK runs the same file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KNOWN_NOTICES, noticeAckProblem } from "../src/index.ts";

const vec = JSON.parse(readFileSync(new URL("../../../conformance/vectors/notice-ack.json", import.meta.url), "utf8"));

test("the known notices are the vectors'", () => { assert.deepEqual([...KNOWN_NOTICES], vec.notices); });
for (const c of vec.cases) test(`notice_ack: ${c.name}`, () => { assert.equal(noticeAckProblem(c.input)?.rule ?? null, c.problem); });
