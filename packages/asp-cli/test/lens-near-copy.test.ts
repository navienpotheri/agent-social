// Row DK1402: a near copy of another agent's lesson list is refused, an honest independent answer is not. The check compares hashed word triples (never the words) and refuses at an overlap of 700 permille or more.
// This test measures it: copies with one, two and three words changed are caught; a reordered, re-cased copy is caught; a paraphrase that rewrites every line is NOT (stated limit); and eleven answers written independently,
// several with the same four correct rules and each with its own reasons, overlap far below the threshold (a false refusal rate of 0 of 55 pairs here, from a small hand-written set: not a measured rate on real agents).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAR_COPY_MIN_SHINGLES, NEAR_COPY_PERMILLE, isNearCopy, overlapPermille, shingleHashes } from "../src/lens-courses/sitting.ts";
import { honestLessons } from "../src/lens-courses/reflection.ts";

const triples = (lessons: string[]) => shingleHashes({ lessons })!;
const base = honestLessons().lessons;

test("DK1402: word triples are hashed, set-like, normalised and only for a list of lesson strings", () => {
  assert.equal(NEAR_COPY_PERMILLE, 700);
  assert.equal(shingleHashes({ rules: [] }), undefined, "another kind of artifact has none");
  assert.equal(shingleHashes({ lessons: [1, 2] }), undefined);
  assert.equal(shingleHashes(null), undefined);
  const a = triples(base);
  assert.ok(a.length >= NEAR_COPY_MIN_SHINGLES && a.every((h) => /^[0-9a-f]{12}$/.test(h)), "hashes only");
  assert.deepEqual(triples([...base].reverse().map((l) => l.toUpperCase().replace(/ /g, "  "))), a, "order, case and spacing make no new answer");
  assert.equal(overlapPermille(a, a), 1000);
  assert.equal(overlapPermille(a, []), 0);
  assert.deepEqual(triples(["ab cd"]).length, 1, "a line of fewer than three words is one unit");
  assert.equal(triples(["a b c d e"]).length, 3, "five words make three triples");
  const ten = Array.from({ length: 10 }, (_, i) => `h${i}`);
  assert.equal(overlapPermille(ten, ten.slice(0, 7)), 700);
  assert.equal(isNearCopy(ten, ten.slice(0, 7)), true, "exactly 700 permille is a near copy");
  assert.equal(isNearCopy(ten, ten.slice(0, 6)), false, "600 is not");
});

test("DK1402: a copy with one, two or three words changed is caught; a paraphrase of every line is not (the stated limit)", () => {
  const a = triples(base);
  const change = (n: number) => base.map((l, i) => (i < n ? l.replace(/\bunder\b|\bcannot\b|\bdrops\b|\bhas\b/, "xx") : l));
  const o1 = overlapPermille(a, triples(change(1)));
  const o2 = overlapPermille(a, triples(change(2)));
  const o3 = overlapPermille(a, triples(change(3)));
  assert.ok(o1 >= NEAR_COPY_PERMILLE && o2 >= NEAR_COPY_PERMILLE && o3 >= NEAR_COPY_PERMILLE, `one word in 1, 2, 3 lines: ${o1}, ${o2}, ${o3} permille`);
  assert.ok(o1 > o2 && o2 > o3, "more changes, less overlap");
  const paraphrase = base.map((l) => l.replace(/\bbecause\b/, "since").replace(/\bwait\b/, "hold").replace(/\bdrain_first\b/, "drain").replace(/\bcannot be rolled back\b/, "is irreversible").replace(/\bloses\b/, "drops").replace(/\bdrops\b/, "loses"));
  const op = overlapPermille(a, triples(paraphrase));
  assert.ok(op < NEAR_COPY_PERMILLE, `a rewrite of every line shares ${op} permille: below the threshold, so it is not caught`);
});

const HONEST: string[][] = [
  base,
  ["when change=migrate and queue=draining then wait since moving data while jobs drain loses work", "when change=deploy and day=fri and env=prod then backup_first as friday releases linger till monday", "when change=restart and load=high then drain_first to avoid dropped calls", "when change=config and env=prod then review given no staging buffer exists"],
  ["when change=migrate and queue=draining then wait: queue items vanish mid-move", "when change=deploy and day=fri and env=prod then backup_first: nobody is around to roll it back", "when change=restart and load=high then drain_first: connections die under load", "when change=config and env=prod then review: prod config errors are costly"],
  ["when change=deploy and day=fri and env=prod then backup_first (weekend, no rollback)", "when change=migrate and queue=draining then wait (jobs are lost)", "when change=config and env=prod then review (typos hit users at once)", "when change=restart and load=high then drain_first (peak traffic)"],
  ["Migrations while the queue drains lose jobs, so when change=migrate and queue=draining then wait.", "A friday production deploy has no weekend rollback: when change=deploy and day=fri and env=prod then backup_first.", "Restarting at high load drops requests: when change=restart and load=high then drain_first."],
  ["if change=config and env=prod then review, the safety net is missing", "if change=restart and load=high then drain_first, otherwise requests fail", "if change=migrate and queue=draining then wait, since half-moved jobs are lost", "if change=deploy and day=fri and env=prod then backup_first, the team is off at the weekend"],
  ["when env=prod and change=config then review because production has no cushion", "when load=high and change=restart then drain_first because busy servers shed traffic on restart", "when queue=draining and change=migrate then wait because the move races the drain", "when day=fri and change=deploy and env=prod then backup_first because a bad Friday deploy lasts days"],
  ["wait on migrations while draining; review prod configs; drain before restarting under load; backup before a friday prod deploy", "never restart without draining when load is high", "never migrate while the queue drains"],
  ["when change=deploy and day=fri and env=prod then backup_first because rollback over a weekend is slow", "when change=config and env=prod then review because prod has no staging", "when change=migrate and queue=draining then wait because jobs are lost", "when change=restart and load=high then drain_first because requests are dropped", "when env=staging then proceed because staging is safe to break"],
  ["when change=migrate and queue=draining then wait for the queue to empty first, because a migration under a draining queue loses jobs in flight", "when change=restart and load=high then drain_first so that in-flight requests complete before the process stops", "when change=config and env=prod then review since a faulty production configuration reaches every user instantly", "when change=deploy and day=fri and env=prod then backup_first because on a weekend nobody can roll back"],
  ["Rule one: do not migrate while draining. Rule two: do not restart at high load without draining. Rule three: review every prod config change. Rule four: back up before any Friday prod deploy.", "Rule five: staging may break freely."],
];

test("DK1402: eleven answers written independently, several with the same four correct rules, are none of them a near copy of another (0 of 55 pairs)", () => {
  let max = 0, over = 0, pairs = 0;
  for (let i = 0; i < HONEST.length; i++) for (let j = i + 1; j < HONEST.length; j++) {
    const o = overlapPermille(triples(HONEST[i]), triples(HONEST[j]));
    pairs++; max = Math.max(max, o); if (o >= NEAR_COPY_PERMILLE) over++;
  }
  assert.equal(pairs, 55);
  assert.equal(over, 0, `refused ${over} of ${pairs} honest pairs; the highest overlap is ${max} permille`);
  assert.ok(max < 500, `the highest overlap between honest answers is ${max} permille, well under ${NEAR_COPY_PERMILLE}`);
});
