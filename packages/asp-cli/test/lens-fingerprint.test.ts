// Row DK610: the capability fingerprint: the courses an agent completed (the log's completions) and what it scored on held-out tasks (the sittings ledger), the lenses and cells they serve, and a digest; two agents on
// different paths differ, the same path gives the same digest, and a sitting without a completion does not count as completed. Synthetic records; fake keys only. Credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { academyCmd } from "../src/academy.ts";
import { capabilityFingerprint } from "../src/lens-courses/fingerprint.ts";
import { loadCatalogue } from "../src/lens-courses/catalogue.ts";
import { engineIds } from "../src/lens-courses/index.ts";
import type { LedgerEntry } from "../src/lens-courses/sitting.ts";

const cards = loadCatalogue(engineIds()).courses;
const [A, B, C] = [cards[0]!, cards.find((c) => c.lens !== cards[0]!.lens)!, cards[2]!];
const X = "did:web:example.com:agents:fp-x", Y = "did:web:example.com:agents:fp-y";
let n = 0;
const id = () => "sha256:" + String(++n).padStart(64, "0");
const rec = (type: string, body: Record<string, unknown>) => ({ type: `asp.${type}/v0.2`, id: id(), issuer: "did:web:asp.local:registry", body, issued_at: "2026-11-20T00:00:00Z" });

function world(completions: [string, string][]) {
  const courseOf = new Map(cards.map((c) => [c.id, rec("course", { course: c.id })]));
  const enrols = completions.map(([holder, course]) => ({ holder, course, e: rec("enrolment", { course: courseOf.get(course)!.id, holder }) }));
  const dones = enrols.map((x) => rec("completion", { enrolment: x.e.id, holder: x.holder, exercises_passed: 1 }));
  const all = [...courseOf.values(), ...enrols.map((x) => x.e), ...dones];
  return { academyRecords: async (types: string[]) => all.filter((r) => types.includes(r.type.slice(4, -5))), get: async (rid: string) => all.find((r) => r.id === rid), head: async () => ({ seq: 0, logHash: "" }) };
}
const sit = (holder: string, c: { id: string }, passed: boolean, mean: number, at: string): LedgerEntry => ({ at, course: c.id, holder, enrolment: id(), attempt: 1, artifact: id(), passed, mean_permille: mean, anchor: id() });

test("DK610: two agents on different paths have different fingerprints, built from the log and the ledger", async () => {
  const r = world([[X, A.id], [X, C.id], [Y, B.id]]);
  const entries = [sit(X, A, true, 870, "2026-11-20T01:00:00Z"), sit(X, A, false, 400, "2026-11-19T01:00:00Z"), sit(X, C, true, 910, "2026-11-20T02:00:00Z"), sit(Y, B, true, 800, "2026-11-20T03:00:00Z"), sit(Y, A, true, 950, "2026-11-20T04:00:00Z")];
  const fx = await capabilityFingerprint(r as never, entries, X, cards), fy = await capabilityFingerprint(r as never, entries, Y, cards);
  assert.deepEqual(fx.courses.map((c) => [c.id, c.completed, c.sittings, c.passed_sittings, c.best_permille]), [[A.id, true, 2, 1, 870], [C.id, true, 1, 1, 910]].sort((a, b) => cards.findIndex((c) => c.id === a[0]) - cards.findIndex((c) => c.id === b[0])));
  assert.equal(fx.completed, 2);
  assert.equal(fy.completed, 1);
  assert.notEqual(fx.digest, fy.digest, "different paths differ");
  assert.equal((await capabilityFingerprint(r as never, entries, X, cards)).digest, fx.digest, "the same path gives the same digest");
  // a passed sitting with no completion is listed but is not completed, and serves no lens
  const ya = fy.courses.find((c) => c.id === A.id)!;
  assert.deepEqual([ya.completed, ya.best_permille], [false, 950]);
  assert.equal(fy.lenses[A.lens], undefined, "only completed courses count towards the lenses and cells");
  assert.deepEqual(Object.keys(fy.lenses), [B.lens]);
  assert.ok(fx.cells.length > 0 && fx.cells.every((c) => / x /.test(c)));
  assert.match(fx.note, /not a rank/);
  // an agent that never sat anything has an empty fingerprint
  assert.deepEqual((await capabilityFingerprint(r as never, entries, "did:web:example.com:agents:nobody", cards)).courses, []);
});

test("DK610: asp academy lens fingerprint --by <agent> prints it and --json gives the data", async () => {
  const r = world([[X, A.id]]);
  const out: string[] = [];
  const run = (flags: Record<string, string | boolean>) => academyCmd("lens", ["fingerprint"], { log: { log: r } as never, io: { out: (l) => out.push(l) }, now: () => "2026-11-22T00:00:00Z", signerFor: () => { throw new Error("no signing"); }, flags });
  assert.equal(await run({ by: X }), 0);
  assert.match(out.join("\n"), new RegExp(`${X}: 1 of ${cards.length} courses completed`));
  out.length = 0;
  assert.equal(await run({ by: X, json: true }), 0);
  assert.equal(JSON.parse(out.join("\n")).completed, 1);
  await assert.rejects(() => run({}), /fingerprint --by/);
});
