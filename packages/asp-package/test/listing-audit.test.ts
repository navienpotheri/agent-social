/**
 * The listing audit (register row DK818; spec-delta S1207): claims are machine-checkable; a deterministic probe records which held; the board shows a verified-claims share; an unsupported claim costs a slice of the
 * bond and is posted with the probe's hash. A scripted over-claiming seller rises in first-listed share when unchecked and falls to zero when audited; an honest seller's share does not fall; buyers choosing by verified
 * share make fewer wrong picks. Scripted services, a toy market; credits are mock accounting entries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SLICE_PERMILLE, bondSlice, forumPost, probe, rank, simulateMarket, type Listing } from "../src/listing-audit.ts";

const truth = (i: number) => (i * 7) % 11;
const sample = Array.from({ length: 40 }, (_, i) => i + 1);
const service = (o: { latency: number; wrongEvery: number; formats: string[] }) => ({ formats: o.formats, run: (i: number) => ({ output: o.wrongEvery && i % o.wrongEvery === 0 ? truth(i) + 1 : truth(i), latencyMs: o.latency + (i % 5) }) });
const claims = (latency: number, accuracy: number, formats?: string[]): Listing["claims"] => [{ id: "latency", kind: "max_latency_ms", value: latency }, { id: "accuracy", kind: "min_accuracy_permille", value: accuracy }, ...(formats ? [{ id: "formats", kind: "formats" as const, value: formats }] : [])];
const honest = (id: string): Listing => ({ id, seller: `seller-${id}`, bond: 100, claims: claims(300, 900), service: service({ latency: 120, wrongEvery: 0, formats: ["json"] }) });
const overclaimer: Listing = { id: "over", seller: "seller-over", bond: 100, claims: claims(100, 990, ["json", "csv", "xml"]), service: service({ latency: 400, wrongEvery: 3, formats: ["json"] }) };
const buyers = Array.from({ length: 20 }, () => ({ maxLatencyMs: 300, minAccuracyPermille: 900 }));

test("the probe is deterministic and records which claims held with what was observed; the verified share and the hash follow", () => {
  const r = probe(overclaimer, sample, truth);
  assert.deepEqual(r.results.map((x) => [x.id, x.held]), [["latency", false], ["accuracy", false], ["formats", false]]);
  assert.equal(r.verifiedPermille, 0);
  assert.equal(r.results.find((x) => x.id === "formats")!.observed, "missing csv,xml");
  assert.deepEqual(probe(overclaimer, sample, truth), r, "the same listing and sample give the same record and hash");
  assert.match(r.probeHash, /^sha256:[0-9a-f]{64}$/);
  const h = probe(honest("h1"), sample, truth);
  assert.equal(h.verifiedPermille, 1000);
  assert.ok(h.results.every((x) => x.held));
  assert.notEqual(probe(honest("h1"), sample.slice(1), truth).probeHash, h.probeHash, "another sample is another probe");
  const half = probe({ ...honest("h2"), claims: claims(300, 900, ["json", "xml"]) }, sample, truth);
  assert.equal(half.verifiedPermille, 667, "two of three claims held");
});

test("an unsupported claim costs a slice of the bond and is posted in the Forum with the probe's hash and no text the seller wrote; an honest listing costs nothing and is not posted", () => {
  assert.equal(SLICE_PERMILLE, 50);
  const r = probe(overclaimer, sample, truth);
  assert.equal(bondSlice(overclaimer, r), 15, "three unsupported claims at 5% of a bond of 100");
  const post = forumPost(r)!;
  assert.match(post.text, /latency \(observed \d+\)/); assert.match(post.text, /formats \(observed missing csv,xml\)/); assert.ok(post.text.includes(r.probeHash));
  assert.equal(bondSlice({ ...overclaimer, bond: 10 }, r), 2);
  const h = honest("h1");
  assert.equal(bondSlice(h, probe(h, sample, truth)), 0);
  assert.equal(forumPost(probe(h, sample, truth)), null);
});

test("in a scripted market the over-claimer is first-listed for every buyer when unchecked and for none when audited; an honest seller's share does not fall and its listing costs it nothing; buyers choosing by verified share make no wrong picks where choosing by claims makes all", () => {
  const listings = [honest("h1"), overclaimer];
  const unchecked = simulateMarket(listings, buyers, sample, truth, "claimed", false);
  const audited = simulateMarket(listings, buyers, sample, truth, "verified", true);
  assert.deepEqual(unchecked.firstListed, { h1: 0, over: 20 }, "an unaudited board rewards the longest list of claims");
  assert.deepEqual(audited.firstListed, { h1: 20, over: 0 }, "audited, the over-claimer falls to zero and the honest seller rises");
  assert.equal(unchecked.wrongPicks, 20); assert.equal(audited.wrongPicks, 0);
  assert.deepEqual(audited.slices, { h1: 0, over: 15 }); assert.equal(audited.posts, 1);
  // Honest sellers only: the audit changes nothing about who is first-listed, and costs nobody anything.
  const two = [honest("h1"), honest("h2")];
  const a = simulateMarket(two, buyers, sample, truth, "claimed", false), b = simulateMarket(two, buyers, sample, truth, "verified", true);
  assert.deepEqual(a.firstListed, b.firstListed, "an honest seller's share is unchanged by the audit");
  assert.deepEqual(b.slices, { h1: 0, h2: 0 }); assert.equal(b.posts, 0); assert.equal(b.wrongPicks, 0);
  const records = new Map(listings.map((l) => [l.id, probe(l, sample, truth)]));
  assert.deepEqual(rank(listings, records, "verified").map((l) => l.id), ["h1", "over"]);
  assert.deepEqual(rank(listings, records, "claimed").map((l) => l.id), ["over", "h1"]);
});
