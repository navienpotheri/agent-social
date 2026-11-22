// The adaptive door's arithmetic (register row DK1365; found untestable in time by a mutation check: the end-to-end door test takes over a minute): the proof-of-work bits rise by one for each doubling above the free
// allowance up to a ceiling and fall as enrolments age out; a rush is queued in order (an address with fewer enrolments first), never refused by count; the breaker closes the queue only at capacity; a ticket is redeemed once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AdaptiveDoor } from "../src/adaptive-door.ts";

const MIN = 60_000, HOUR = 3_600_000;
const door = (o: Partial<ConstructorParameters<typeof AdaptiveDoor>[0]> = {}) => { let t = 1_000_000; const d = new AdaptiveDoor<string>({ baseBits: 10, freePerHour: 6, maxExtraBits: 4, drainPerMinute: 3, maxQueue: 5, now: () => t, ...o }); return { d, at: (x: number) => { t = x; }, advance: (x: number) => { t += x; }, now: () => t }; };

test("bits: the base cost up to the free allowance, then one more for each doubling, to the ceiling, and back as enrolments age out", () => {
  const w = door({ drainPerMinute: 100000 });
  const admit = () => w.d.admit("a", "x");
  for (let i = 0; i < 5; i++) { admit(); w.advance(1000); }
  assert.equal(w.d.bitsFor("a"), 10, "5 enrolments: still free");
  admit(); w.advance(1000);
  assert.equal(w.d.bitsFor("a"), 11, "the sixth reaches the allowance: one more bit");
  for (let i = 0; i < 6; i++) { admit(); w.advance(1000); }
  assert.equal(w.d.bitsFor("a"), 12, "twelve is a doubling of six");
  for (let i = 0; i < 100; i++) { admit(); w.advance(1000); }
  assert.equal(w.d.bitsFor("a"), 14, "a ceiling of four extra bits");
  assert.equal(w.d.bitsFor("another"), 10, "another address is not touched");
  w.advance(2 * HOUR);
  assert.equal(w.d.bitsFor("a"), 10, "the cost falls back when the enrolments are older than an hour");
});

test("a rush is queued in order of fewest enrolments then arrival, never refused; the breaker closes only at capacity; a ticket is redeemed once", () => {
  const w = door();
  const first = ["heavy", "b", "c"].map((x) => w.d.admit(x, x));
  assert.deepEqual(first.map((x) => x.state), ["go", "go", "go"], "three a minute go straight through");
  const busy = w.d.admit("heavy", "h1");
  assert.equal(busy.state, "queued", "the fourth is queued, not refused");
  w.advance(1000);
  const q3 = w.d.admit("fresh", "f1");
  assert.equal(q3.state === "queued" && q3.position, 1, "an address with fewer enrolments goes ahead of an earlier one that has more");
  const waitingPoll = w.d.poll(busy.state === "queued" ? busy.ticket : "");
  assert.equal(waitingPoll.state, "waiting");
  assert.ok(waitingPoll.state === "waiting" && waitingPoll.etaSec >= 1 && waitingPoll.position === 2, "a place behind the fresh address and an eta of at least a second");
  const stats0 = w.d.stats();
  assert.deepEqual([stats0.waiting, stats0.admittedLastMinute], [2, 3]);
  // fill the queue to its cap of 5, then the breaker answers and drops nothing
  w.d.admit("x1", "x1"); w.d.admit("x2", "x2"); w.d.admit("x2b", "x2b"); w.d.admit("x2c", "x2c");
  const over = w.d.admit("x3", "x3");
  assert.deepEqual(over, { state: "breaker", retryAfterSec: 60 });
  assert.equal(w.d.stats().waiting, 5, "nothing queued was dropped");
  // a minute later slots free up and tickets become ready
  w.advance(MIN + 1000);
  const t = q3.state === "queued" ? q3.ticket : "";
  assert.equal(w.d.poll(t).state, "ready");
  assert.equal(w.d.redeem(t), "f1");
  assert.equal(w.d.redeem(t), undefined, "a ticket is redeemed once");
  assert.equal(w.d.poll(t).state, "unknown");
  assert.equal(w.d.poll("no-such-ticket").state, "unknown");
});

test("a queue is served before a newcomer who arrives while it waits; a ticket older than an hour is dropped", () => {
  const w = door({ drainPerMinute: 1, maxQueue: 50 });
  w.d.admit("a", "a");
  const waiting = w.d.admit("b", "b");
  assert.equal(waiting.state, "queued");
  w.advance(MIN + 1);
  const newcomer = w.d.admit("c", "c");
  assert.notEqual(newcomer.state, "go", "the newcomer does not jump a queue that has someone ready or waiting");
  w.advance(2 * HOUR);
  assert.equal(w.d.poll(waiting.state === "queued" ? waiting.ticket : "").state, "unknown", "an old ticket is pruned");
});
