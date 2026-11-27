// Rows ENG34 and ENG31 (the kickstarter pack, slice 3): identity-derived voices (deterministic from the DID, optional, off by default, and a run with them on writes more varied text than the same run with them off),
// and the founding-residents snapshot: a stand-in founding run of fifteen residents makes at least 60 posts in at least 10 threads with replies, the snapshot is labelled model-written content with its diversity and
// cost, and a later society starts from it under founder accounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { loadSnapshot, parseSnapshot, snapshotProblems, SNAPSHOT_LABEL, SNAPSHOT_MIN_DIVERSITY, SNAPSHOT_MIN_POSTS, SNAPSHOT_MIN_THREADS, type Snapshot } from "../src/cohort/snapshot.ts";
import { diversityOf, HUMOURS, INTERESTS, LENGTHS, ORIENTATIONS, REGISTERS, voiceOf, voiceText } from "../src/cohort/voice.ts";
import { bootWorld } from "../src/cohort/world.ts";

const opts = (agents: number, behaviour: string, extra: Partial<CohortOptions> = {}): CohortOptions => ({
  out: mkdtempSync(join(tmpdir(), "asp-found-out-")), home: mkdtempSync(join(tmpdir(), "asp-found-home-")), agents, model: "stand-in",
  provider: standInProvider(() => behaviour, { latencyMs: 2 }), staggerMs: 20, budgetUsd: 2, totalUsd: 2 * agents, minutes: 5, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined }, ...extra,
} as CohortOptions);

test("ENG34: a voice is derived from the DID alone, is the same each time, varies across identities in every trait, and is offered as one optional paragraph", () => {
  const dids = Array.from({ length: 200 }, (_, i) => `did:key:z6Mk${i.toString(36)}abc${i * 7919}`);
  const voices = dids.map(voiceOf);
  assert.deepEqual(voiceOf(dids[0]!), voiceOf(dids[0]!), "deterministic");
  assert.notDeepEqual(voiceOf(dids[0]!), voiceOf(dids[1]!), "identities differ");
  assert.ok(voices.every((v) => v.interests[0] !== v.interests[1] && INTERESTS.includes(v.interests[0] as never)));
  for (const [trait, values] of [["register", REGISTERS], ["length", LENGTHS], ["humour", HUMOURS], ["orientation", ORIENTATIONS]] as const) {
    const seen = new Set(voices.map((v) => v[trait]));
    assert.equal(seen.size, values.length, `${trait}: every value occurs over 200 identities`);
  }
  assert.ok(new Set(voices.map((v) => v.interests.join("|"))).size > 40, "many different interest pairs");
  const text = voiceText(voices[0]!);
  assert.match(text, /entirely optional \(ignore it if you like\)/);
  assert.match(text, /derived from your identity/);
  assert.ok(!/\bmust\b|\bshould\b|you are a\b/i.test(text), "a seed, not an instruction or a persona");
  assert.equal(diversityOf(["the same words here", "the same words here"]), 0);
  assert.equal(diversityOf(["alpha bravo charlie", "delta echo foxtrot"]), 1);
  assert.equal(diversityOf(["one text only"]), null);
});

test("ENG34: with voices on, the same four stand-in agents on the same seed world write more varied text than with voices off; voices are off unless asked for and the report says which", async () => {
  const off = await runCohort(opts(4, "voiced"));
  const on = await runCohort(opts(4, "voiced", { voices: true }));
  assert.equal(off.report.diversity.voices, false);
  assert.equal(on.report.diversity.voices, true);
  assert.equal(off.report.diversity.texts, 4);
  assert.equal(on.report.diversity.texts, 4);
  assert.equal(off.report.diversity.value, 0, "the same hello with only a number changed");
  assert.ok(on.report.diversity.value! > 0.3, `with voices on: ${on.report.diversity.value}`);
  assert.ok(on.report.diversity.value! > off.report.diversity.value!);
  const md = readFileSync(on.markdownPath, "utf8");
  assert.match(md, /## What the agents wrote, and how alike it is/);
  assert.match(md, /Voices derived from each agent's identity were on/);
  assert.match(md, /- agent-01: .*; humour /);
  assert.match(readFileSync(off.markdownPath, "utf8"), /Voices derived from each agent's identity were off/);
  const trace = readFileSync(join(on.dir, "trace.jsonl"), "utf8");
  assert.match(trace.split("\n")[0]!, /"voices":true/);
});

test("ENG31: a founding run of fifteen stand-in residents leaves a snapshot of 60 posts in 15 threads with replies, labelled model-written, with its diversity and cost; later societies start from it under founder accounts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-found-snap-"));
  const file = join(dir, "snapshot.json");
  const lines: string[] = [];
  const r = await runCohort(opts(15, "resident", { snapshotOut: file, io: { out: (l) => lines.push(l) } }));
  assert.ok(existsSync(file), "the snapshot is written");
  const snap = parseSnapshot(readFileSync(file, "utf8"));
  assert.deepEqual(snapshotProblems(snap), [], JSON.stringify(snapshotProblems(snap)));
  assert.ok(snap.posts.length >= SNAPSHOT_MIN_POSTS, `${snap.posts.length} posts`);
  assert.ok(snap.posts.filter((p) => p.replies.length > 0).length >= SNAPSHOT_MIN_THREADS);
  assert.ok(snap.diversity! >= SNAPSHOT_MIN_DIVERSITY, `diversity ${snap.diversity}`);
  assert.equal(snap.label, SNAPSHOT_LABEL);
  assert.match(snap.label, /Model-written content/);
  assert.equal(snap.agents, 15);
  assert.equal(snap.costUsd, Math.round(r.report.totalUsd * 1e4) / 1e4, "the cost of the founding run is recorded");
  assert.ok(snap.posts.every((p) => !["town-crier", "house-host", "house-greeter"].includes(p.by)), "the house's own posts are not in it");
  assert.ok(lines.some((l) => /^founding snapshot: \d+ posts in \d+ threads with replies, diversity [0-9.]+, cost \$/.test(l) && !/does not yet meet/.test(l)));
  // a later society starts from it: the posts and replies are there under founder accounts, the welcome says so, the agents' handles are not reused
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-found-world-")), snapshot: snap });
  try {
    const feed = JSON.parse((await w.api.get("/forum/feed?sort=new&limit=500")).text) as { posts: { handle: string; title: string; comments: number }[] };
    const founders = feed.posts.filter((p) => p.handle.startsWith("founder-"));
    assert.equal(founders.length, snap.posts.length, "every post was written again");
    assert.equal(feed.posts.filter((p) => /^agent-/.test(p.handle)).length, 0, "no founding agent's handle is reused");
    assert.equal(founders.reduce((n, p) => n + p.comments, 0), snap.posts.reduce((n, p) => n + p.replies.length, 0), "every reply too");
    assert.ok(feed.posts.some((p) => p.title === "Founding residents"));
    assert.equal(new Set(founders.map((p) => p.handle)).size > 10, true, "several founder accounts (an account makes at most five acts)");
  } finally { await w.close(); }
  // and a cohort started from it runs, and its agents can read the founders' posts
  const later = await runCohort(opts(2, "explorer", { fromSnapshot: file }));
  assert.equal(later.report.agents, 2);
  assert.ok(later.report.perAgent.every((s) => s.calls > 0));
});

test("ENG31: a snapshot that is too small, too alike or unlabelled is said not to meet the founding bar, and a file that is not a snapshot is refused", async () => {
  const small: Snapshot = { version: 1, label: "notes", costUsd: 0, agents: 1, voices: false, diversity: 0.2, posts: [{ id: "x", by: "agent-01", title: "t", text: "some text here", tags: [], replies: [] }] };
  const lacks = snapshotProblems(small);
  assert.equal(lacks.length, 4);
  assert.match(lacks.join(";"), /1 posts, at least 60/);
  assert.match(lacks.join(";"), /0 threads with replies, at least 10/);
  assert.match(lacks.join(";"), /diversity 0\.2, at least 0\.6/);
  assert.match(lacks.join(";"), /not labelled as model-written/);
  assert.throws(() => parseSnapshot("not json"), /not JSON/);
  assert.throws(() => parseSnapshot(JSON.stringify({ version: 9, posts: [] })), /not a founding snapshot/);
  assert.throws(() => parseSnapshot(JSON.stringify({ version: 1, label: "x", posts: [{ title: 1 }] })), /malformed/);
  // the loader writes the replies under other accounts than the post's
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-found-load-")) });
  try {
    const r = await loadSnapshot(w, { ...small, label: SNAPSHOT_LABEL, posts: [{ id: "x", by: "a", title: "Post", text: "A post that gets two replies from the snapshot.", tags: ["t"], replies: [{ by: "b", text: "First reply here." }, { by: "c", text: "Second reply here." }] }] });
    assert.deepEqual(r, { posts: 1, replies: 2, founders: 1 });
  } finally { await w.close(); }
});
