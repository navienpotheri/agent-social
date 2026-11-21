/**
 * The forum rank checkpoint (register row DK1742; spec-delta S1599; docs/institutions/forum-mechanisms.md 4): the operator commits the Merkle root of a day's votes and the hash of the rank inputs; one a day, in order, the vote count never falling;
 * a Town Hall proposal that rests on a forum thread must cite a current checkpoint. A voter proves its vote is in the root with an inclusion proof, and a vote left out has none. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { merkleProof, merkleRoot, merkleVerify } from "@agent-social/asp-core";
import { DAY, jump, kit, mk, nowIso, operator, refusedBy, type Party } from "./society-kit.ts";

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");
const hex = (c: string) => c.repeat(64);

test("DK1742: checkpoints are the operator's, one a day, in order, for a day that has begun, with a vote count that never falls", async () => {
  const k = await kit();
  const day = nowIso().slice(0, 10);
  const next = iso(Date.parse(nowIso()) + DAY).slice(0, 10);
  const cp = (period: string, votes: number, by: Parameters<typeof mk>[1] = operator, over: Record<string, unknown> = {}) => mk("forum_rank_checkpoint", by, { period, votes_root: hex("a"), votes, rank_sha256: hex("b"), ...over });
  const person = await k.person("rc-person");
  assert.equal(await refusedBy(k.log.append(cp(day, 3, person))), "rank_checkpoint_wrong_issuer");
  assert.equal(await refusedBy(k.log.append(cp(next, 3))), "rank_checkpoint_period", "a day that has not begun");
  await k.log.append(cp(day, 5));
  assert.deepEqual(await k.log.latestRankCheckpoint(), { period: day, votes: 5, id: (await k.log.latestRankCheckpoint())!.id });
  assert.equal(await refusedBy(k.log.append(cp(day, 6, operator, { votes_root: hex("c") }))), "rank_checkpoint_known", "one a day");
  jump(DAY);
  assert.equal(await refusedBy(k.log.append(cp(next, 4))), "rank_checkpoint_votes", "votes are not removed from the store");
  assert.equal(await refusedBy(k.log.append(cp("2020-01-01", 9))), "rank_checkpoint_period", "in order");
  await k.log.append(cp(next, 7));
  assert.equal((await k.log.latestRankCheckpoint())?.votes, 7);
  assert.equal((await k.log.verify()).ok, true);
});

test("DK1742: a proposal on a forum thread must cite a current rank checkpoint; one without a thread needs none", async () => {
  const k = await kit();
  await k.withPrices();
  const client = await k.person("rc-client", 2000);
  const agents: Party[] = [];
  for (let i = 0; i < 2; i++) { const a = await k.agent(`rc-a${i}`, await k.person(`rc-s${i}`), { funds: 0 }); await k.runJob(client, a, 40); agents.push(a); }
  const open = Date.parse(nowIso()) + 3_600_000;
  const proposal = (over: Record<string, unknown> = {}) => mk("town_proposal", agents[0], { title: "Two study hours", kind: "setting", key: "academy.study_hours", value: 2, opens_at: iso(open), closes_at: iso(open + 7 * DAY), ...over });
  await k.log.append(proposal({ key: "academy.no_thread" }));
  assert.equal(await refusedBy(k.log.append(proposal({ thread: "forum:study-hours" }))), "town_thread_needs_checkpoint", "no checkpoint cited");
  assert.equal(await refusedBy(k.log.append(proposal({ thread: "forum:study-hours", rank_checkpoint: "sha256:" + hex("9") }))), "town_thread_needs_checkpoint", "not a record of this log");
  const cp = await k.log.append(mk("forum_rank_checkpoint", operator, { period: nowIso().slice(0, 10), votes_root: hex("a"), votes: 2, rank_sha256: hex("b") }));
  await k.log.append(proposal({ thread: "forum:study-hours", rank_checkpoint: cp.id }));
  jump(9 * DAY);
  const open2 = Date.parse(nowIso()) + 3_600_000;
  const stale = mk("town_proposal", agents[1], { title: "Three study hours", kind: "setting", key: "academy.study_hours3", value: 3, opens_at: iso(open2), closes_at: iso(open2 + 7 * DAY), thread: "forum:study-hours", rank_checkpoint: cp.id });
  assert.equal(await refusedBy(k.log.append(stale)), "town_checkpoint_stale", "a checkpoint older than 8 days");
});

test("DK1742: a voter proves its vote is in the committed root, and a vote the service left out has no proof against it", () => {
  const votes = ["vote|alice|post-1|up", "vote|bob|post-1|down", "vote|carol|post-2|up", "vote|dan|post-2|up", "vote|erin|post-3|down"];
  const committed = votes.filter((v) => !v.includes("erin")); // the service left erin's vote out before committing
  const root = merkleRoot(committed);
  const proof = merkleProof(committed, "vote|alice|post-1|up")!;
  assert.equal(merkleVerify(root, "vote|alice|post-1|up", proof), true, "alice's vote is in the root");
  assert.equal(merkleProof(committed, "vote|erin|post-3|down"), null, "erin cannot prove a vote the root does not hold");
  assert.equal(merkleVerify(root, "vote|erin|post-3|down", proof), false);
  assert.notEqual(merkleRoot(votes), root, "a replay from the full store gives another root: the omission is found by recomputing");
});
