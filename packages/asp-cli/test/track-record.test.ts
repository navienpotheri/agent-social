// Row US3: `asp registry lookup <did> --plain` and `asp registry compare` give a track record in plain words and side by side, from the page the log computes, with no score and a warning when there are too
// few jobs to judge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { comparisonTable, plainTrackRecord, TOO_FEW_JOBS } from "../src/track-record.ts";
import { makeFixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const A = "did:web:example.com:agents:atlas";
const B = "did:web:example.com:agents:quill";

async function asp(f: ReturnType<typeof makeFixture>, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}

test("the plain record says what an agent has done and warns when there are too few jobs; the comparison puts agents side by side", async () => {
  const f = makeFixture();
  const ok = async (args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
  await ok(["identity", "new", "--kind", "human", "--did", ALICE]);
  for (const a of [A, B]) await ok(["identity", "new", "--kind", "agent", "--did", a, "--sponsor", ALICE, "--purpose", "Work"]);
  const one = await ok(["registry", "lookup", A, "--plain"]);
  assert.match(one.out, /is an agent at the sponsored identity level, sponsored by did:web:example\.com:users:alice\./);
  assert.match(one.out, /It has no tier yet\.|It is in tier \d\./);
  assert.match(one.out, /It has had 0 jobs accepted; 0 of them counted toward its standing/);
  assert.match(one.out, /No bond of its has been slashed\./);
  assert.match(one.out, new RegExp(`Too few jobs to judge: fewer than ${TOO_FEW_JOBS} accepted jobs\.`));
  assert.match(one.out, /It is a set of counts and says nothing about quality beyond them|says nothing about quality beyond them/);
  assert.doesNotMatch(one.out, /score|rating|stars/i, "no score is invented");
  const cmp = await ok(["registry", "compare", A, B]);
  assert.match(cmp.out, /accepted jobs\s+0\s+0/);
  assert.match(cmp.out, /bonds slashed/);
  assert.equal((await asp(f, ["registry", "compare", A])).code, 2, "one agent is a usage error");
  assert.equal((await asp(f, ["registry", "compare", A, "did:web:example.com:agents:nobody"])).code, 1);
});

test("a house agent, a retired agent and a suspended agent are said in words", () => {
  const base = { did: "did:x:a", names: ["atlas"], kind: "agent", sponsor: null, house: false, level: "key_only", tier: 2, slashCount: 1, strikes: 2, acceptedJobs: 5, qualifyingJobs: 4, certificates: [{ skill: "review", level: 1, expires: "2027-01-01" }], suspended: { until: "2026-12-01", reason: "abuse report", record: "r" }, retired: true, takedowns: [], seq: 12 } as never;
  const text = plainTrackRecord(base).join("\n");
  assert.match(text, /with no sponsor/);
  assert.match(text, /A bond of its has been slashed 1 time\./);
  assert.match(text, /2 strikes in the last 30 days/);
  assert.match(text, /holds 1 certificate: review at level 1/);
  assert.match(text, /suspended until 2026-12-01: abuse report/);
  assert.match(text, /retired by its holder/);
  assert.doesNotMatch(text, /Too few jobs/);
  assert.match(comparisonTable([base, base]).join("\n"), /tier\s+2\s+2/);
});
