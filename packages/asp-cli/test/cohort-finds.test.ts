// Row ENG73 (as the owner changed it): a Finds thread and a place to post about finds. A labelled house thread is opened when the run has things to find; looking closely at the Town Hall shows the latest few finds,
// read only; a find carries one neutral line; posting pays nothing, but a tip earns its author one small mock credit when ANOTHER agent takes the card and cites the post (once for each citing agent and post, capped for
// each author); an empty post earns nothing; the report quotes what finders wrote and counts how many of them wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TIP_CAP_PER_AUTHOR, Tips } from "../src/cohort/finds.ts";
import { MARKER_PLACES, WINDOW_MS, markerAt } from "../src/cohort/markers.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const GOOD = "I would check it with a test on an unseen case, merge or keep one rule, drop what contradicts, give the reason, verify one claim, write the check first, and say what I left out, in the general rule.";
const lineOf = (thread: string): string => `Others may like to hear what you found: the Finds thread in the forum (post ${thread}); not required. A tip there that another agent uses and cites earns its author a small credit; an empty post earns nothing.`;

test("the Finds thread exists, labelled and by the house, only in a run that has things to find; a find carries one neutral line; the Town Hall shows the latest finds read only; posting alone pays nothing", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-finds-")), markers: "seed-f", expedition: true });
  try {
    w.api.markers!.clock = () => 7 * WINDOW_MS;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    const hall = w.api.market!;
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const thread = w.api.findsThread!;
    assert.ok(thread.startsWith("sha256:"));
    const feed = JSON.parse((await w.api.get("/forum/feed?sort=new&limit=30&tag=finds")).text) as { posts: { handle: string; title: string }[] };
    assert.deepEqual(feed.posts.map((p) => [p.handle, p.title]), [["town-crier", "Finds: what have you come across?"]]);
    const line = lineOf(thread);
    const plaque = await call(a, "inspect", { place: "registry" });
    assert.ok(plaque.text.includes(line), "the line follows a find");
    assert.equal(plaque.text.split("Others may like to hear").length - 1, 1, "one line");
    assert.doesNotMatch(plaque.text, /you should|must|please/i);
    const bare = MARKER_PLACES.find((p) => !markerAt("seed-f", p, 7) && p !== "registry" && p !== "academy")!;
    assert.ok(!(await call(a, "inspect", { place: bare })).text.includes("Others may like to hear"), "not after a look that found nothing");
    const place = MARKER_PLACES.find((p) => markerAt("seed-f", p, 7) && p !== "registry" && p !== "academy")!;
    assert.ok((await call(a, "inspect", { place })).text.includes(line));
    assert.ok((await call(a, "field_answer", { place, answer: GOOD })).text.includes(line), "a right answer carries it too");
    assert.ok((await call(a, "unlock", { what: "reading-room" })).text.includes(line), "an opened place carries it");
    const before = await hall.balance(a);
    const posted = await call(a, "forum_comment", { post: thread, text: "I found a plaque at the registry and a card elsewhere." });
    assert.equal(posted.ok, true, posted.text);
    assert.equal(await hall.balance(a), before, "no reward for posting");
    await call(b, "forum_comment", { post: thread, text: "Nothing yet, but I am still looking around." });
    const hallLook = await call(b, "inspect", { place: "town-hall" });
    assert.match(hallLook.text, /Latest in the Finds thread \(read only\): agent-02: "Nothing yet, but I am still looking around\."; agent-01: "I found a plaque at the registry and a card elsewhere\."; the house: "House example/);
  } finally { await w.close(); }
  const none = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-finds-none-")) });
  try {
    assert.equal(none.api.findsThread, undefined);
    assert.equal(none.api.tips, undefined);
  } finally { await none.close(); }
});

test("a tip earns its author one credit when another agent takes the card and cites it: once for each citing agent and post, never for one's own, nothing for an empty post or one that says nothing of the card, and the credits balance", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-finds-tip-")), markers: "seed-t", expedition: true });
  try {
    w.api.markers!.clock = () => 3 * WINDOW_MS;
    const a = await w.enrol(0, "agent-01"), c = await w.enrol(1, "agent-03"), d = await w.enrol(2, "agent-04"), e = await w.enrol(3, "agent-05");
    const hall = w.api.market!;
    for (const x of [a, c, d, e]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const thread = w.api.findsThread!;
    const place = MARKER_PLACES.find((p) => markerAt("seed-t", p, 3) && p !== "registry" && p !== "academy")!;
    const card = markerAt("seed-t", place, 3)!;
    const idOf = (r: { text: string }): string => /sha256:[0-9a-f]{64}/.exec(r.text)![0];
    // agent-01 finds the card, takes it, and writes a tip that says where it is; agent-03 writes an empty post
    await call(a, "inspect", { place });
    assert.equal((await call(a, "field_answer", { place, answer: GOOD })).text.startsWith("Yes."), true);
    const tipId = idOf(await call(a, "forum_comment", { post: thread, text: `There is a card at the ${place} right now about ${card.topic}.` }));
    const emptyId = idOf(await call(c, "forum_comment", { post: thread, text: "Interesting stuff around here, honestly, all of it." }));
    const a0 = await hall.balance(a), c0 = await hall.balance(c);
    // agent-04 looks, answers and cites the empty post: nothing is cited
    await call(d, "inspect", { place });
    const r1 = await call(d, "field_answer", { place, answer: GOOD, cite: emptyId });
    assert.match(r1.text, /^Yes\./);
    assert.match(r1.text, /That post does not say where or what the card is, so nothing was cited\./, "an empty post earns nothing");
    assert.equal(await hall.balance(c), c0);
    // agent-05 uses the tip and cites it
    await call(e, "inspect", { place });
    const r2 = await call(e, "field_answer", { place, answer: GOOD, cite: tipId });
    assert.match(r2.text, /Cited: agent-01 received 1 mock credit for the tip\./);
    assert.equal(await hall.balance(a), a0 + 1, "the author of the tip earned one credit");
    assert.equal(w.api.tips!.total, 1);
    // a post cited by the same agent again, the author's own post, and a post that is not in the thread cite nothing
    assert.equal((await call(e, "field_answer", { place, answer: GOOD, cite: tipId })).text.includes("Cited:"), false);
    assert.match((await call(a, "field_answer", { place, answer: GOOD, cite: tipId })).text, /already; it is yours\./);
    assert.equal(await hall.balance(a), a0 + 1);
    const other = MARKER_PLACES.find((p) => p !== place && markerAt("seed-t", p, 3))!;
    await call(d, "inspect", { place: other });
    assert.match((await call(d, "field_answer", { place: other, answer: GOOD, cite: "sha256:" + "0".repeat(64) })).text, /That is not a post in the Finds thread, so nothing was cited\./);
    assert.equal((await w.log.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
  // the cap and the once-per-citer rule, as for a citation in the library
  const t = new Tips();
  assert.deepEqual(t.cite("x", "p1", "author"), { ok: true, credits: 1 });
  assert.equal(t.cite("x", "p1", "author").ok, false);
  assert.equal(t.cite("author", "p1", "author").ok, false);
  for (let i = 0; i < TIP_CAP_PER_AUTHOR + 3; i++) t.cite(`c${i}`, "p2", "author");
  assert.equal(t.total, TIP_CAP_PER_AUTHOR, "no author earns more than the cap");
});

test("two scripted explorers find things, say so in the Finds thread and read the Town Hall; the report quotes what they wrote, counts the finders that wrote, and says that writing is not paid but a cited tip is", async () => {
  const r = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-finds-out-")), home: mkdtempSync(join(tmpdir(), "asp-finds-home-")), agents: 2, model: "stand-in", provider: standInProvider(() => "finder", { latencyMs: 5 }), staggerMs: 60, budgetUsd: 2, totalUsd: 4, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 80, io: { out: () => undefined }, markers: "seed-g", expedition: true } as CohortOptions);
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## What agents wrote about finds\n\n2 agents found something \(a field lesson, a discovery or a place that opened\); 2 of them wrote in the Finds thread, and 2 agents in all wrote there\. Writing there is not paid; a tip that another agent uses and cites earns its author a small credit: 0 tips used and cited, 0 mock credits paid for them\./);
  assert.match(md, /- agent-01 \(found something\): "agent-01 found a card or two while looking around: at the /);
  assert.match(md, /- agent-02 \(found something\): "agent-02 found a card or two/);
  for (const s of r.report.perAgent) assert.equal(s.endReason, "stopped_exploring");
  assert.equal((readFileSync(join(r.dir, "trace.jsonl"), "utf8").match(/"input":\{"place":"town-hall"\}/g) ?? []).length, 2);
  const plain = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-finds-out2-")), home: mkdtempSync(join(tmpdir(), "asp-finds-home2-")), agents: 1, model: "stand-in", provider: standInProvider(() => "sleeper", { latencyMs: 5 }), budgetUsd: 2, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 20, io: { out: () => undefined } } as CohortOptions);
  assert.doesNotMatch(readFileSync(plain.markdownPath, "utf8"), /What agents wrote about finds/);
});
