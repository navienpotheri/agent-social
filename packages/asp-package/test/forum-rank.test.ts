// Row DK1742: forum ranking that a farm cannot buy, and the eligibility of a thread for the Town Hall agenda. A fleet of clones is one vote, fresh keys weigh nothing, a trade of votes is worth a quarter; a one-way farm of
// controllers that look independent is NOT stopped and the test says so with the numbers. Fake ids only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENDA, agendaEligibility, rank, tally, type Citizen, type PostIn, type VoteIn } from "../src/forum-rank.ts";

const DAY = 86_400_000, NOW = 1_800_000_000_000;
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** An honest forum: 150 citizens of their own controllers, 30 posts of a hidden quality, votes up with the probability of the quality. */
function honest() {
  const r = rng(7);
  const citizens: Citizen[] = Array.from({ length: 150 }, (_, i) => ({ did: `h${i}`, controller: `hc${i}`, ageDays: 100, countedJobs: 2 }));
  const posts: PostIn[] = Array.from({ length: 30 }, (_, i) => ({ id: `hp${i}`, author: `h${i}`, createdAt: NOW - 5 * DAY }));
  const votes: VoteIn[] = [];
  for (const p of posts) { const q = r(); for (const c of citizens) if (c.did !== p.author && r() < 0.25) votes.push({ voter: c.did, post: p.id, author: p.author, value: r() < q ? 1 : -1, at: NOW - 4 * DAY + Math.floor(r() * DAY) }); }
  return { citizens, posts, votes, r };
}
const position = (order: PostIn[], id: string) => order.findIndex((p) => p.id === id) + 1;

test("DK1742: the rules of the count: fresh keys and keys with no counted job weigh nothing, one controller counts once for a post, a vote for one's own controller's post does not count, a daily cap", () => {
  const cs: Citizen[] = [
    { did: "a", controller: "ca", ageDays: 90, countedJobs: 1 }, { did: "a2", controller: "ca", ageDays: 90, countedJobs: 1 },
    { did: "b", controller: "cb", ageDays: 90, countedJobs: 1 }, { did: "fresh", controller: "cf", ageDays: 2, countedJobs: 3 }, { did: "nojob", controller: "cn", ageDays: 90, countedJobs: 0 },
    { did: "auth", controller: "cx", ageDays: 90, countedJobs: 1 }, { did: "auth2", controller: "cx", ageDays: 90, countedJobs: 1 },
  ];
  const posts: PostIn[] = [{ id: "p", author: "auth", createdAt: NOW - 3 * DAY }];
  const v = (voter: string, at = NOW): VoteIn => ({ voter, post: "p", author: "auth", value: 1, at });
  const t = tally(cs, posts, [v("a"), v("a2"), v("b"), v("fresh"), v("nojob"), v("auth2")]).get("p")!;
  assert.deepEqual([t.score, t.naive, t.controllers, t.upControllers], [2, 6, 2, 2], "ca once, cb once; fresh, no-job and the author's own controller add nothing");
  assert.ok(t.reasons.some((x) => /own controller/.test(x)));
  // a daily cap of 20 on one controller: 25 votes for 25 posts in one day, 20 count
  const many: PostIn[] = Array.from({ length: 25 }, (_, i) => ({ id: `q${i}`, author: "auth", createdAt: NOW - 3 * DAY }));
  const tt = tally(cs, many, many.map((p, i) => ({ voter: "b", post: p.id, author: "auth", value: 1 as const, at: NOW + i })));
  assert.equal([...tt.values()].reduce((s, x) => s + x.score, 0), 20);
});

test("DK1742: a fleet of 1,000 clones of one controller moves a post by one vote, 500 fresh keys by none, and a trade of votes between two controllers is worth a quarter", () => {
  const h = honest();
  const target: PostIn = { id: "atk-post", author: "atk0", createdAt: NOW - 5 * DAY };
  const citizens: Citizen[] = [...h.citizens, { did: "atk0", controller: "atk", ageDays: 100, countedJobs: 2 },
    ...Array.from({ length: 1000 }, (_, i) => ({ did: `clone${i}`, controller: "atk", ageDays: 100, countedJobs: 2 })),
    ...Array.from({ length: 500 }, (_, i) => ({ did: `fresh${i}`, controller: `fc${i}`, ageDays: 1, countedJobs: 0 }))];
  const posts = [...h.posts, target];
  const votes: VoteIn[] = [...h.votes,
    ...Array.from({ length: 1000 }, (_, i) => ({ voter: `clone${i}`, post: target.id, author: "atk0", value: 1 as const, at: NOW - 4 * DAY })),
    ...Array.from({ length: 500 }, (_, i) => ({ voter: `fresh${i}`, post: target.id, author: "atk0", value: 1 as const, at: NOW - 4 * DAY }))];
  const t = tally(citizens, posts, votes).get(target.id)!;
  assert.equal(t.naive, 1500, "the plain sum is 1,500");
  assert.equal(t.score, 0, "the clones are the author's own controller and the fresh keys weigh nothing: zero");
  const naiveOrder = [...posts].sort((a, b) => (tally(citizens, posts, votes).get(b.id)!.naive - tally(citizens, posts, votes).get(a.id)!.naive));
  assert.equal(position(naiveOrder, target.id), 1, "by the plain sum the attacker's post is first");
  const w = tally(citizens, posts, votes);
  assert.ok(position(rank(citizens, posts, votes), target.id) > posts.filter((p) => w.get(p.id)!.score > 0).length, "by the weighted count it is below every post with positive support");
  // a trade of votes: five controllers each up-vote the other four's posts; five independent controllers also up-vote the first one's post
  const ring = ["r1", "r2", "r3", "r4", "r5"], zs = ["z1", "z2", "z3", "z4", "z5"];
  const cs: Citizen[] = [...ring, ...zs].map((d) => ({ did: d, controller: `c${d}`, ageDays: 90, countedJobs: 1 }));
  const ps: PostIn[] = ring.map((d) => ({ id: `p-${d}`, author: d, createdAt: NOW - 3 * DAY }));
  const vs: VoteIn[] = [];
  for (const d of ring) for (const p of ps) if (p.author !== d) vs.push({ voter: d, post: p.id, author: p.author, value: 1, at: NOW - DAY });
  for (const z of zs) vs.push({ voter: z, post: "p-r1", author: "r1", value: 1, at: NOW - DAY });
  const tt = tally(cs, ps, vs);
  assert.equal(tt.get("p-r1")!.score, 6, "five independent controllers at 1 each and four traded votes at a quarter");
  assert.equal(tt.get("p-r2")!.score, 1, "four traded votes at a quarter: a ring alone gets a quarter of its size");
});

test("DK1742: agenda eligibility needs weighted support, five distinct controllers and 48 hours; a hidden or fresh thread never reaches it", () => {
  const t = (over: Partial<ReturnType<typeof tally> extends Map<string, infer T> ? T : never> = {}) => ({ post: "p", score: 6, naive: 6, controllers: 6, upControllers: 6, reasons: [], ...over });
  const p: PostIn = { id: "p", author: "a", createdAt: NOW - 3 * DAY };
  assert.equal(agendaEligibility(p, t(), NOW).eligible, true);
  assert.match(agendaEligibility({ ...p, hidden: true }, t(), NOW).why, /hidden/);
  assert.match(agendaEligibility({ ...p, createdAt: NOW - DAY }, t(), NOW).why, /under 48 hours/);
  assert.match(agendaEligibility(p, t({ upControllers: 4 }), NOW).why, new RegExp(`fewer than the ${AGENDA.minControllers}`));
  assert.match(agendaEligibility(p, t({ score: 4.5 }), NOW).why, /below 5/);
});

test("DK1742 measured, and its limit: a one-way farm of 40 controllers that look independent DOES reach the agenda, and the same farm trading votes among itself is cut to a quarter, which at a size of 40 still clears the minimum", () => {
  const h = honest();
  const farm: Citizen[] = Array.from({ length: 40 }, (_, i) => ({ did: `f${i}`, controller: `fc${i}`, ageDays: 40, countedJobs: 1 }));
  const target: PostIn = { id: "farm-post", author: "f0", createdAt: NOW - 5 * DAY };
  const citizens = [...h.citizens, ...farm];
  // one way: 39 farm members up-vote f0's post and nothing else
  const oneWay: VoteIn[] = farm.slice(1).map((c) => ({ voter: c.did, post: target.id, author: "f0", value: 1, at: NOW - 4 * DAY }));
  const a = tally(citizens, [...h.posts, target], [...h.votes, ...oneWay]);
  const e = agendaEligibility(target, a.get(target.id)!, NOW);
  assert.equal(e.eligible, true, "an undetected farm of independent-looking controllers gets its size: the cost of a one-way farm is the cost of 40 counted identities");
  assert.equal(a.get(target.id)!.score, 39);
  // a ring: each member also has a post, and every member up-votes every other member's post (three or more each way)
  const ringPosts: PostIn[] = farm.map((c, i) => ({ id: `ring${i}`, author: c.did, createdAt: NOW - 5 * DAY }));
  const ringVotes: VoteIn[] = [];
  for (const c of farm) for (const p of ringPosts) if (p.author !== c.did) ringVotes.push({ voter: c.did, post: p.id, author: p.author, value: 1, at: NOW - 4 * DAY });
  const b = tally(citizens, [...h.posts, ...ringPosts], [...h.votes, ...ringVotes]);
  const best = Math.max(...ringPosts.map((p) => b.get(p.id)!.score));
  assert.ok(best <= 39 * 0.25 + 1e-9, `a ring's best post scores ${best}, a quarter of its size`);
  assert.ok(best >= AGENDA.minScore, `${best}: at a size of 40 even a quartered ring clears the agenda minimum of ${AGENDA.minScore}; the quartering shrinks a farm by a factor of four and no more, so a ring under 20 is stopped and one of 40 is not`);
  const small = tally([...h.citizens, ...farm.slice(0, 16)], [...h.posts, ...ringPosts.slice(0, 16)], [...h.votes, ...ringVotes.filter((v) => Number(v.voter.slice(1)) < 16 && Number(v.post.slice(4)) < 16)]);
  assert.ok(Math.max(...ringPosts.slice(0, 16).map((p) => small.get(p.id)!.score)) < AGENDA.minScore, "a ring of 16 is stopped by the quartering");
  // honest posts reach the agenda only by honest support: how many of the 30 honest posts were eligible
  const honestTally = tally(h.citizens, h.posts, h.votes);
  const eligible = h.posts.filter((p) => agendaEligibility(p, honestTally.get(p.id)!, NOW).eligible).length;
  assert.ok(eligible > 0 && eligible < h.posts.length, `${eligible} of 30 honest threads were eligible`);
});
