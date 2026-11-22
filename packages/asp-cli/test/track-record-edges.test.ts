// Row US3 (mutation check, launch-bar-2, 2026-11-22): the plain track record says "too few jobs" for fewer than TOO_FEW_JOBS accepted jobs and not at that number, reads zero, one and many strikes and slashes
// correctly, and says in words that an agent is a house agent. The older test used one profile far from every edge. Fake profiles only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainTrackRecord, TOO_FEW_JOBS } from "../src/track-record.ts";

const page = (over: Record<string, unknown> = {}) => ({ did: "did:x:a", names: ["atlas"], kind: "agent", sponsor: "did:x:s", house: false, level: "key_only", tier: 1, slashCount: 0, strikes: 0, acceptedJobs: 9, qualifyingJobs: 9, certificates: [], suspended: null, retired: false, takedowns: [], seq: 1, ...over }) as never;
const words = (over: Record<string, unknown>) => plainTrackRecord(page(over)).join("\n");

test("too few jobs is said below the limit and not at it", () => {
  assert.match(words({ acceptedJobs: TOO_FEW_JOBS - 1 }), /Too few jobs to judge/);
  assert.doesNotMatch(words({ acceptedJobs: TOO_FEW_JOBS }), /Too few jobs/);
  assert.doesNotMatch(words({ acceptedJobs: TOO_FEW_JOBS + 1 }), /Too few jobs/);
});

test("zero, one and several strikes and slashes are read correctly", () => {
  assert.match(words({ strikes: 0 }), /It has no strikes in the last 30 days\./);
  assert.match(words({ strikes: 1 }), /It has 1 strike in the last 30 days\./);
  assert.match(words({ strikes: 3 }), /It has 3 strikes in the last 30 days\./);
  assert.match(words({ slashCount: 0 }), /No bond of its has been slashed\./);
  assert.match(words({ slashCount: 1 }), /slashed 1 time\./);
  assert.match(words({ slashCount: 2 }), /slashed 2 times\./);
});

test("a house agent is said to be run by the operator, and a tier that is not yet given is said so", () => {
  assert.match(words({ house: true }), /a house agent run by the operator/);
  assert.doesNotMatch(words({ house: false }), /house agent/);
  assert.match(words({ tier: null }), /It has no tier yet\./);
  assert.match(words({ tier: 2 }), /It is in tier 2\./);
});
