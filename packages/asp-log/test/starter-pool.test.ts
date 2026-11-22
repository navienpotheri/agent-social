// The starter pool's arithmetic (register row DK1356; found loose by a mutation check): take is refused only PAST the cap, give never goes below zero, left never goes below zero, and the waiting list holds a tenant once with a place counted from 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StarterPool } from "../src/starter.ts";

test("take: exactly the cap is allowed, one more is refused and takes nothing", () => {
  const p = new StarterPool(undefined, 100);
  assert.equal(p.take(100), true);
  assert.equal(p.left, 0);
  assert.equal(p.take(1), false);
  assert.equal(p.used, 100);
});

test("left and give never go below zero", () => {
  const p = new StarterPool(undefined, 10);
  p.take(10);
  p.give(25);
  assert.equal(p.used, 0, "giving back more than was taken leaves zero, not a negative");
  const q = new StarterPool(undefined, 10);
  assert.equal(q.left, 10);
  q.take(4);
  assert.equal(q.left, 6);
});

test("the waiting list holds a tenant once, counts places from 1 and closes the gap when one leaves", () => {
  const p = new StarterPool(undefined, 0);
  assert.equal(p.enqueue("a"), 1);
  assert.equal(p.enqueue("b"), 2);
  assert.equal(p.enqueue("a"), 1, "asking twice keeps the first place");
  assert.deepEqual([...p.waitingList], ["a", "b"]);
  assert.equal(p.position("b"), 2);
  assert.equal(p.position("zz"), 0);
  p.dequeue("a");
  assert.equal(p.position("b"), 1);
});
