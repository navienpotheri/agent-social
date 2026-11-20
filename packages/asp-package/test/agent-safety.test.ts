/**
 * Reversible actions with a cool-off, two lanes of memory and a run on the pool with a circuit breaker (register rows DK844, DK846 and DK845; spec-deltas S1228 to S1230). Scripted agents, a toy world and a toy pool;
 * credits are mock accounting entries; no real model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomSeed } from "@agent-social/asp-core";
import { ActionLog, OneLane, TwoLanes, crowdRun, type Episode } from "../src/agent-safety.ts";

const HOUR = 3_600_000;
const classes = { reversible: ["post_listing", "send_draft"], irreversible: ["delete_account", "wire_credits"] };
const comp = { post_listing: "withdraw_listing", send_draft: "recall_draft" };
const T0 = "2026-12-01T10:00:00Z";
const at = (h: number) => new Date(Date.parse(T0) + h * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");

test("DK844: a scripted agent posts then undoes within the window and the log shows both, with the compensating action; after the window, twice and for an irreversible action the undo is refused", () => {
  const log = new ActionLog(classes, "all", 24 * HOUR, comp);
  const posted = log.do("post_listing", at(0)) as { ok: true; id: string; undoUntil: string };
  assert.deepEqual([posted.ok, posted.undoUntil], [true, at(24)]);
  assert.deepEqual(log.undo(posted.id, at(5)), { ok: true, compensating: "withdraw_listing" });
  assert.deepEqual(log.entries.map((e) => [e.kind, e.action, e.of ?? null]), [["do", "post_listing", null], ["undo", "withdraw_listing", "a0"]], "both are in the log");
  assert.deepEqual(log.undo(posted.id, at(6)), { ok: false, code: "ALREADY_UNDONE" });
  const late = log.do("send_draft", at(10)) as { ok: true; id: string };
  assert.deepEqual(log.undo(late.id, at(10 + 25)), { ok: false, code: "COOL_OFF_ENDED" }, "the window is 24 hours");
  const wire = log.do("wire_credits", at(11)) as { ok: true; id: string; undoUntil: string | null };
  assert.equal(wire.undoUntil, null, "an irreversible action has no window");
  assert.deepEqual(log.undo(wire.id, at(12)), { ok: false, code: "NOT_REVERSIBLE" });
  assert.deepEqual(log.undo("nope", at(12)), { ok: false, code: "UNKNOWN" });
});

test("DK844: an irreversible action is refused where only reversible scope is granted, an action outside the Mandate is refused, and a sponsor may widen to irreversible later", () => {
  const narrow = new ActionLog(classes, "reversible", 24 * HOUR, comp);
  assert.deepEqual(narrow.do("wire_credits", at(0)), { ok: false, code: "IRREVERSIBLE_NOT_GRANTED" });
  assert.deepEqual(narrow.do("delete_account", at(0)), { ok: false, code: "IRREVERSIBLE_NOT_GRANTED" });
  assert.deepEqual(narrow.do("reformat_disk", at(0)), { ok: false, code: "NOT_IN_MANDATE" });
  assert.equal(narrow.do("post_listing", at(0)).ok, true, "reversible scope first");
  assert.equal(narrow.entries.length, 1, "a refused action leaves no entry");
  assert.equal(new ActionLog(classes, "all", 24 * HOUR, comp).do("wire_credits", at(0)).ok, true, "after the sponsor widens the scope");
});

// ---- DK846 ----
/** A world with a hidden rule (value -> action) and noise: in one episode in three the shown action is a random wrong one. */
function world(seed: number) {
  let s = seed; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const values = ["a", "b", "c", "d", "e", "f"], actions = ["x", "y", "z"];
  const truth = new Map(values.map((v, i) => [v, actions[i % 3]]));
  const episode = (): Episode => { const v = values[Math.floor(r() * values.length)]; const noisy = r() < 0.34; return { value: v, action: noisy ? actions[(actions.indexOf(truth.get(v)!) + 1 + Math.floor(r() * 2)) % 3] : truth.get(v)! }; };
  const heldOut = (decide: (v: string) => string | undefined) => values.filter((v) => decide(v) === truth.get(v)).length / values.length;
  return { episode, heldOut, truth };
}

test("DK846: a scripted agent writing every note straight into rules is beaten on held-out cases by one using the two lanes, the two-lane agent reports its promotion rate, and expired tentative notes disappear from memory", () => {
  let beaten = 0, one = 0, two = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const w = world(seed);
    const single = new OneLane();
    const lanes = new TwoLanes(30, 4, () => true);
    for (let i = 0; i < 200; i++) { const e = w.episode(); single.observe(e); lanes.observe(e); }
    const a = w.heldOut((v) => single.decide(v)), b = w.heldOut((v) => lanes.decide(v));
    one += a; two += b; if (b > a) beaten++;
  }
  assert.ok(two / 20 > one / 20 + 0.15, `two lanes ${two / 20} against one lane ${one / 20}`);
  assert.ok(beaten >= 12, `the two-lane agent wins on ${beaten} of 20 seeds`);
  const w = world(3);
  const lanes = new TwoLanes(30, 4, () => true);
  for (let i = 0; i < 200; i++) lanes.observe(w.episode());
  const st = lanes.stats();
  assert.ok(st.notes > st.promoted && st.promoted > 0, JSON.stringify(st));
  assert.equal(st.promotionRate, Math.round((st.promoted / st.notes) * 1000));
  assert.ok(st.expired > 0, "tentative notes expire");
  assert.ok([...lanes.notes.values()].every((n) => n.seen < 4), "a note that reached the bar is a rule, not a note");
});

test("DK846: a tentative note expires unless it is seen again, a promoted rule needs repeated sightings and a passing held-out replay, and a failing replay keeps it out", () => {
  const lanes = new TwoLanes(3, 2, (_v, a) => a !== "bad");
  lanes.observe({ value: "p", action: "x" });
  for (let i = 0; i < 5; i++) lanes.observe({ value: `filler-${i}`, action: "y" });
  assert.equal(lanes.notes.has("p|x"), false, "not seen again within its life: gone");
  assert.equal(lanes.decide("p"), undefined);
  lanes.observe({ value: "q", action: "x" }); lanes.observe({ value: "q", action: "x" });
  assert.equal(lanes.decide("q"), "x", "two sightings and the replay passes: promoted");
  lanes.observe({ value: "r", action: "bad" }); lanes.observe({ value: "r", action: "bad" }); lanes.observe({ value: "r", action: "bad" });
  assert.equal(lanes.decide("r"), undefined, "the held-out replay refused it");
});

// ---- DK845 ----
const depositors = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`d${String(i).padStart(2, "0")}`, 100]));

test("DK845: a scripted crowd that withdraws at once exhausts the pool with the breaker off and the last depositors recover nothing; with it on the halt is signed, nobody recovers nothing and conservation holds", () => {
  const seed = randomSeed();
  const off = crowdRun(depositors, 300, { breaker: false, thresholdPermille: 400, rounds: 5, seed });
  assert.equal(off.exhausted, true, "the pool is exhausted");
  assert.equal(off.worstRecoveryPermille, 0, "the last depositors get nothing");
  assert.equal(off.halted, false);
  assert.equal(off.conserved, true);
  const on = crowdRun(depositors, 300, { breaker: true, thresholdPermille: 400, rounds: 5, seed });
  assert.equal(on.halted, true);
  assert.equal(on.halts.length, 1);
  assert.equal(on.haltVerified, true, "the halt is signed and verifies");
  assert.equal(on.exhausted, false, "the pool was not drained when it halted");
  assert.ok(on.worstRecoveryPermille >= 200, `nobody is left with nothing: ${on.worstRecoveryPermille}`);
  assert.equal(on.conserved, true, "the pool plus everything paid is what the pool held");
  const owedAtHalt = Object.entries(on.recoveryPermille).filter(([k]) => k !== "d00").map(([, v]) => v);
  assert.ok(Math.max(...owedAtHalt) - Math.min(...owedAtHalt) <= 10, "everyone still owed when it halts recovers the same share: the shortfall is shared, not dumped on the last in line");
  assert.deepEqual(crowdRun(depositors, 300, { breaker: true, thresholdPermille: 400, rounds: 5, seed }).recoveryPermille, on.recoveryPermille, "deterministic");
});

test("DK845: with a fully backed pool nobody loses with or without the breaker, and the breaker does not trip on an ordinary round", () => {
  const seed = randomSeed();
  for (const breaker of [false, true]) {
    const r = crowdRun(depositors, 1000, { breaker, thresholdPermille: 1000, rounds: 3, seed });
    assert.equal(r.worstRecoveryPermille, 1000, `breaker ${breaker}`);
    assert.equal(r.conserved, true);
    assert.equal(r.halted, false);
  }
});
