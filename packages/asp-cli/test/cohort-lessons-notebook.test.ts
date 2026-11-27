// Row ENG102/ENG78 follow-up: an admitted lesson that an agent cited becomes ONE labelled line in that agent's notebook, never the raw card and never the evidence text; the agent can delete it; the same lesson is not added
// twice; a notebook too full takes nothing; the write is recorded (shelf, trace, report).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Life, SimClock } from "@agent-social/asp-package";
import { LessonShelf } from "../src/cohort/lessons.ts";
import { renderLessonEvidence } from "../src/cohort/lessons-report.ts";

const card = { id: "lesson-001", handle: "agent-01", title: "A job pays on the spot", lesson: "A short house job I took was paid as soon as the house check accepted my delivery." };
const mk = (): ReturnType<Life["agent"]> => { let real = 0; return new Life({ clock: new SimClock({ speed: 1000, now: () => real }), notebookDir: mkdtempSync(join(tmpdir(), "asp-lnb-")), sleep: async (ms) => { real += ms; } }).agent("a"); };

test("one labelled line, once, deletable, and nothing when the notebook is full", () => {
  const a = mk();
  assert.equal(a.lessonNote(card), "added");
  assert.equal(a.notebookText(), `From the society, a lesson that another agent wrote and the gate admitted (you cited it; you can keep or delete this line): "A job pays on the spot" (lesson-001 by agent-01): ${card.lesson}`);
  assert.equal(a.lessonNote(card), "skipped", "the same lesson is not added twice");
  a.tools().find((t) => t.name === "notebook_write")!.run({ text: "I deleted it", mode: "replace" }, { agent: "a", turn: 1, now: () => "t", signal: new AbortController().signal });
  assert.equal(a.lessonNote(card), "added", "an agent that deleted the line can be given it again only by citing again");
  const b = mk();
  b.tools().find((t) => t.name === "notebook_write")!.run({ text: "x".repeat(3900), mode: "replace" }, { agent: "b", turn: 1, now: () => "t", signal: new AbortController().signal });
  assert.equal(b.lessonNote({ ...card, id: "lesson-002" }), "skipped", "a full notebook takes nothing");
});

test("the report counts the notebook writes with the card hash and says a notebook exists only for an agent that keeps ticks", () => {
  const s = new LessonShelf();
  s.notebookWrites.push({ id: "lesson-001", handle: "agent-02", at: "2026-11-24T10:00:00Z", action: "added", hash: "sha256:" + "a".repeat(64) });
  const md = renderLessonEvidence(s, [], [], [], 3);
  assert.match(md, /Notebooks: 1 admitted lesson was placed in the notebook of an agent that cited it, as one labelled line each and never raw \(lesson-001 to agent-02 added, sha256:aaaaaaaaaaaa\.\.\.\)\. Each is a trace event \(lesson_notebook\) and the agent can delete the line; a notebook exists only for an agent that keeps ticks\./);
  assert.match(md, /a stand-in run keeps no notebooks, so this link is shown only in a run with ticks\./);
});
