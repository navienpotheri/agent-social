// Collusion and farming of the credit reward (register row DK6; spec-delta S468): a colluding pair, a ring and a sponsor's own agents cannot move a tier, and the detector over the log reports each. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closesLoop, findCollusion, type Hire } from "../src/collusion.ts";
import { Kit, refused } from "./academy-kit.ts";

const DAY = 86_400_000;

test("the loop rule is pure: a hire closes a loop when the performer already hired the principal, directly or through up to four others, in the last 90 days", () => {
  const e = (principal: string, performer: string, day: number): Hire => ({ principal, performer, at: day * DAY, contract: `${principal}>${performer}` });
  assert.equal(closesLoop([e("B", "A", 1)], "A", "B", 2 * DAY), true, "B hired A, so A hiring B closes the pair");
  assert.equal(closesLoop([e("B", "C", 1), e("C", "A", 2)], "A", "B", 3 * DAY), true, "A hires B who hired C who hired A: a ring of three");
  assert.equal(closesLoop([e("B", "C", 1), e("C", "D", 1), e("D", "E", 1), e("E", "A", 1)], "A", "B", 2 * DAY), true, "a ring of five");
  assert.equal(closesLoop([e("B", "C", 1), e("C", "D", 1), e("D", "E", 1), e("E", "F", 1), e("F", "A", 1)], "A", "B", 2 * DAY), true, "a ring of six");
  assert.equal(closesLoop([e("B", "C", 1), e("C", "D", 1), e("D", "E", 1), e("E", "F", 1), e("F", "G", 1), e("G", "A", 1)], "A", "B", 2 * DAY), false, "a ring of seven is beyond the rule");
  assert.equal(closesLoop([e("B", "A", 1)], "A", "B", 100 * DAY), false, "an edge older than 90 days is forgotten");
  assert.equal(closesLoop([e("B", "A", 5)], "A", "B", 2 * DAY), false, "a hire in the future of this one is not before it");
  assert.equal(closesLoop([e("A", "B", 1)], "A", "B", 2 * DAY), false, "hiring the same performer twice is not a loop");
  assert.equal(closesLoop([], "A", "B", 2 * DAY), false);
});

test("DK6 done: a colluding pair, a ring and a sponsor's own agents move no tier, and the detector reports each of them", async () => {
  const k = new Kit();
  const [s1, s2, s3] = [await k.person("cl-s1"), await k.person("cl-s2"), await k.person("cl-s3")];
  const [a, b, c] = [await k.agent("cl-a", s1, 1), await k.agent("cl-b", s2, 1), await k.agent("cl-c", s3, 1)];
  const q = async (d: string) => (await k.log.reputationOf(d))?.qualifyingJobs ?? 0;

  // A pair: A hires B (counts once for B: they are independent), B hires A back (a loop: no standing), A hires B again (a loop: no standing).
  await k.acceptedJob(a, b);
  assert.equal(await q(b.did), 1, "the first job between independent parties counts");
  await k.acceptedJob(b, a);
  await k.acceptedJob(a, b);
  assert.equal(await q(a.did), 0, "the job back does not count");
  assert.equal(await q(b.did), 1, "repeating it adds nothing");

  // A ring of three with fresh agents: D hires E, E hires F, F hires D. The first two count; the one that closes the ring does not.
  const [d, e, f] = [await k.agent("cl-d", s1, 1), await k.agent("cl-e", s2, 1), await k.agent("cl-f", s3, 1)];
  await k.acceptedJob(d, e); await k.acceptedJob(e, f);
  assert.deepEqual([await q(e.did), await q(f.did)], [1, 1]);
  await k.acceptedJob(f, d);
  assert.equal(await q(d.did), 0, "the job that closes the ring does not count");

  // An agent working for its own sponsor's other agent: independence, never standing.
  const g = await k.agent("cl-g", s1, 1);
  await k.acceptedJob(a, g); // a and g share sponsor s1
  assert.equal(await q(g.did), 0, "agents of one sponsor never count for each other");

  // None of it promotes anyone: three counted jobs and a certificate are what a promotion needs, and nobody here has them.
  for (const x of [a, b, d, e, f, g]) {
    const cert = await k.certify(x, "foundations", 1);
    assert.ok(await refused(k.log.append(k.promote(x, 1, 2, [cert]))), `${x.did} is not promoted by farming`);
    assert.equal((await k.log.reputationOf(x.did))?.tier, 1);
  }

  // The detector reports each pattern.
  const found = await k.log.collusionReport();
  const kinds = found.map((x) => x.kind);
  assert.ok(kinds.includes("reciprocal"), `a reciprocal pair: ${kinds}`);
  assert.ok(kinds.includes("ring"), `a ring: ${kinds}`);
  assert.ok(kinds.includes("sponsor_cluster"), `a sponsor cluster: ${kinds}`);
  const pair = found.find((x) => x.kind === "reciprocal")!;
  assert.deepEqual([...pair.agents].sort(), [a.did, b.did].sort());
  assert.ok(pair.jobs.length >= 2 && pair.why.includes("hired each other"));
  const ring = found.find((x) => x.kind === "ring")!;
  assert.deepEqual([...ring.agents].sort(), [d.did, e.did, f.did].sort());
  const cluster = found.find((x) => x.kind === "sponsor_cluster")!;
  assert.ok(cluster.agents.includes(g.did) && cluster.why.includes("never count"));
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true, "replay reproduces the log with the same loop verdicts");
});

test("DK6: one principal behind most of an agent's work is reported, and an honest log reports nothing", async () => {
  const k = new Kit();
  const honest = await k.agent("cl-honest", await k.person("cl-hs"), 1);
  for (const n of ["x1", "x2", "x3"]) await k.acceptedJob(await k.person(`cl-${n}`), honest);
  assert.deepEqual(await k.log.collusionReport(), [], "three different principals: nothing to report");
  const farmed = await k.agent("cl-farmed", await k.person("cl-fs"), 1);
  const boss = await k.person("cl-boss");
  for (let i = 0; i < 4; i++) await k.acceptedJob(boss, farmed);
  const found = await k.log.collusionReport();
  assert.deepEqual(found.map((x) => x.kind), ["concentration"]);
  assert.deepEqual(found[0].agents, [farmed.did, boss.did]);
  assert.match(found[0].why, /4 of .* 4 accepted jobs are for one principal/);
  assert.ok(((await k.log.reputationOf(farmed.did))?.qualifyingJobs ?? 0) < 4, "the counterparty cap limits what counted");
  assert.deepEqual(findCollusion([]), []);
});
