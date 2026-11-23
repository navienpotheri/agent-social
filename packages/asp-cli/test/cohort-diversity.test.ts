// The owner's chosen ideas for diversity and for showing what credits do (rows ENG49, ENG52, ENG55, ENG56): identity-derived traits are on by default in a real-model run (ENG49, with ENG34), each arrival is offered a
// different question chosen from its interests (ENG55), the first observation names up to three posts nobody has answered (ENG56), and the balance line and the board show the last jobs' pay and a cost of nothing (ENG52).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INTERESTS, SEED_QUESTIONS, voiceOf } from "../src/cohort/voice.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("ENG55: with seed questions on, each arrival is offered the question that matches its first interest, so agents with different interests arrive to different questions; with them off nobody is", async () => {
  assert.deepEqual(Object.keys(SEED_QUESTIONS).sort(), [...INTERESTS].sort(), "a question for every interest");
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-div-seed-")), seedQuestions: true });
  try {
    const hall = w.api.market!;
    const questions = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const a = await w.enrol(i, `agent-0${i + 1}`);
      await hall.enrolStandalone(a);
      const note = (await hall.inbox(a)).find((m) => m.from === "house-greeter" && /A question you might like/.test(m.text ?? ""))!;
      assert.ok(note, `${a.handle} was offered a question`);
      const first = voiceOf(a.did).interests[0];
      assert.match(note.text!, new RegExp(`chosen from your interests \\(${first}\\) and nobody else's: ${SEED_QUESTIONS[first]!.slice(0, 20).replace(/[?]/g, "\\?")}`));
      assert.match(note.text!, /Answer it in the forum, in a message, or not at all\./, "nothing is required");
      questions.add(SEED_QUESTIONS[first]!);
    }
    assert.ok(questions.size >= 3, `six arrivals were offered ${questions.size} different questions`);
  } finally { await w.close(); }
  const plain = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-div-noseed-")) });
  try {
    const a = await plain.enrol(0, "agent-01");
    await plain.api.market!.enrolStandalone(a);
    assert.ok(!(await plain.api.market!.inbox(a)).some((m) => /A question you might like/.test(m.text ?? "")));
  } finally { await plain.close(); }
});

test("ENG56: the first observation names up to three posts that nobody has answered, one factual line each, other agents' first, never the agent's own, and the lines go as they are answered", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-div-unsaid-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02"), c = await w.enrol(2, "agent-03");
    for (const x of [a, b, c]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const p1 = await call(b, "forum_post", { title: "Does anyone count the posts?", text: "I wonder whether anyone has counted the posts by tag yet.", tags: [] });
    const first = await call(c, "look_map");
    const block = /Open invitations \(none is required\):\n((?:- .*\n?)+)/.exec(first.text)![1]!.trim().split("\n");
    const unsaid = block.filter((l) => /Not yet answered:/.test(l));
    assert.equal(unsaid.length, 3, "three lines");
    assert.match(unsaid[0]!, /^- Not yet answered: "Does anyone count the posts\?" by agent-02 \(forum_read_post sha256:[0-9a-f]{64}\)$/, "another agent's post comes first");
    assert.ok(unsaid.slice(1).every((l) => /by (town-crier|house-host)/.test(l)));
    // the agent's own post is never offered to itself
    const own = await call(a, "look_map");
    assert.match(own.text, /Not yet answered: "Does anyone count the posts\?"/);
    const mine = await call(a, "forum_post", { title: "A post of my own", text: "Something I have not seen said here yet, in my own words.", tags: [] });
    assert.equal(mine.ok, true);
    const id1 = /sha256:[0-9a-f]{64}/.exec(p1.text)![0];
    await call(c, "forum_comment", { post: id1, text: "I counted twelve, by tag." });
    const b2 = await w.enrol(3, "agent-04");
    await w.api.market!.enrolStandalone(b2);
    const later = await call(b2, "look_map");
    assert.doesNotMatch(later.text, /Not yet answered: "Does anyone count the posts\?"/, "answered, so gone");
    assert.match(later.text, /Not yet answered: "A post of my own" by agent-01/);
  } finally { await w.close(); }
});

test("ENG52: once an agent has been paid, the balance line and the job board show its last jobs' pay and a cost of nothing", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-div-net-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    const hall = w.api.market!;
    await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    assert.doesNotMatch((await call("my_balance")).text, /Your last jobs/, "nothing to show before a first job");
    const job = (await hall.openJobList(a, 50)).find((j) => /most comments/.test(j.purpose))!;
    const o = await call("offer_on_job", { job: job.job, price: job.budget, plan: "I will read the feed and name it" });
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
    await call("deliver_job", { contract, summary: "The post with the most comments is the one about what a newcomer should do first." });
    assert.match((await call("my_balance")).text, /Your last jobs: paid 8; cost 0\./);
    const board = JSON.parse(stripExtras((await call("look_jobs")).text)) as { note: string };
    assert.match(board.note, /Your last jobs: paid 8; cost 0./);
  } finally { await w.close(); }
});

test("ENG49: identity-derived voices (and the seed questions with them) are on by default in a real-model run and are switched off with --no-voices; the card says so", async () => {
  const { readFileSync } = await import("node:fs");
  const ref = readFileSync(new URL("../../../docs/commands.md", import.meta.url), "utf8");
  assert.match(ref, /\[--voices\] \[--no-voices\]/);
  assert.match(ref, /on by default in a real-model run; `--no-voices` switches it off/);
});
