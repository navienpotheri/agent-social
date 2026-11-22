// Row ENG73: a Finds thread and a place to post about finds. A labelled house thread is opened when the run has things to find; looking closely at the Town Hall shows the latest few finds, read only; a find carries one
// neutral line that others may like to hear of it; nothing is paid for posting; the report quotes what was written and counts how many finders wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER_PLACES, markerAt } from "../src/cohort/markers.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const GOOD = "I would check it with a test on an unseen case, merge or keep one rule, drop what contradicts, give the reason, verify one claim, write the check first, and say what I left out.";

test("the Finds thread exists, labelled and by the house, only in a run that has things to find; a find carries one neutral line; the Town Hall shows the latest finds read only; nothing is paid for posting", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-finds-")), markers: "seed-f", expedition: true });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    const hall = w.api.market!;
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const thread = w.api.findsThread!;
    assert.ok(thread.startsWith("sha256:"), "the thread exists");
    const feed = JSON.parse((await w.api.get("/forum/feed?sort=new&limit=30&tag=finds")).text) as { posts: { id: string; handle: string; title: string }[] };
    assert.deepEqual(feed.posts.map((p) => [p.handle, p.title]), [["town-crier", "Finds: what have you come across?"]], "a labelled house account opened it");
    const line = `Others may like to hear what you found: the Finds thread in the forum (post ${thread}); not required.`;
    // a plaque is a find: one neutral line, once, and the other texts keep to the facts
    const plaque = await call(a, "inspect", { place: "registry" });
    assert.ok(plaque.text.includes(line), "the line follows a find");
    assert.equal(plaque.text.split("Others may like to hear").length - 1, 1, "one line, not two");
    assert.doesNotMatch(plaque.text, /you should|must|please|reward/i);
    const bare = MARKER_PLACES.find((p) => !markerAt("seed-f", a.did, p, 0) && p !== "registry" && p !== "academy")!;
    assert.ok(!(await call(a, "inspect", { place: bare })).text.includes("Others may like to hear"), "not after a look that found nothing");
    // a card and its answer
    const place = MARKER_PLACES.find((p) => markerAt("seed-f", a.did, p, 0) && p !== "registry" && p !== "academy")!;
    assert.ok(place, "agent-01 has a card away from the registry");
    assert.ok((await call(a, "inspect", { place })).text.includes(line));
    const right = await call(a, "field_answer", { place, answer: GOOD });
    assert.ok(right.text.includes(line), "a right answer carries it too");
    assert.ok((await call(a, "unlock", { what: "reading-room" })).text.includes(line), "an opened place carries it");
    // posting is not paid for: a comment in the thread changes the balance by nothing
    const before = await hall.balance(a);
    const posted = await call(a, "forum_comment", { post: thread, text: "I found a plaque at the registry and a card elsewhere." });
    assert.equal(posted.ok, true, posted.text);
    assert.equal(await hall.balance(a), before, "no reward for posting");
    await call(b, "forum_comment", { post: thread, text: "Nothing yet, but I am still looking around." });
    // the Town Hall shows the latest finds, a few lines, read only
    const hallLook = await call(b, "inspect", { place: "town-hall" });
    assert.match(hallLook.text, /^The Town Hall is where agents can take a role/);
    assert.match(hallLook.text, /Latest in the Finds thread \(read only\): agent-02: "Nothing yet, but I am still looking around\."; agent-01: "I found a plaque at the registry and a card elsewhere\."\./);
    if (!markerAt("seed-f", b.did, "town-hall", 0)) assert.ok(!hallLook.text.includes("Others may like to hear"), "a look at the Town Hall is not a find unless a card is pinned there");
  } finally { await w.close(); }
  const none = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-finds-none-")) });
  try {
    assert.equal(none.api.findsThread, undefined, "no thread when there is nothing to find");
    const feed = JSON.parse((await none.api.get("/forum/feed?sort=new&limit=30&tag=finds")).text) as { posts: unknown[] };
    assert.equal(feed.posts.length, 0);
  } finally { await none.close(); }
});

test("two scripted explorers find things, say so in the Finds thread and read the Town Hall; the report quotes what they wrote, counts the finders that wrote, and says nothing is paid for writing", async () => {
  const r = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-finds-out-")), home: mkdtempSync(join(tmpdir(), "asp-finds-home-")), agents: 2, model: "stand-in", provider: standInProvider(() => "finder", { latencyMs: 5 }), staggerMs: 60, budgetUsd: 2, totalUsd: 4, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 80, io: { out: () => undefined }, markers: "seed-g", expedition: true } as CohortOptions);
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## What agents wrote about finds\n\n2 agents found something \(a field lesson, a discovery or a place that opened\); 2 of them wrote in the Finds thread, and 2 agents in all wrote there\. Nothing is paid for writing there\./);
  assert.match(md, /- agent-01 \(found something\): "agent-01 found a card or two while looking around: at the /);
  assert.match(md, /- agent-02 \(found something\): "agent-02 found a card or two/);
  for (const s of r.report.perAgent) assert.equal(s.endReason, "stopped_exploring");
  // the Town Hall was read by both
  const trace = readFileSync(join(r.dir, "trace.jsonl"), "utf8");
  assert.equal((trace.match(/"input":\{"place":"town-hall"\}/g) ?? []).length, 2);
  // without anything to find there is no section
  const plain = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-finds-out2-")), home: mkdtempSync(join(tmpdir(), "asp-finds-home2-")), agents: 1, model: "stand-in", provider: standInProvider(() => "sleeper", { latencyMs: 5 }), budgetUsd: 2, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 20, io: { out: () => undefined } } as CohortOptions);
  assert.doesNotMatch(readFileSync(plain.markdownPath, "utf8"), /What agents wrote about finds/);
});
