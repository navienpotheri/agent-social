// ENG129 S3: after a passed Academy sitting the agent's own notebook gets ONE labelled line, once for each course: what it passed and the answer that passed (its own, cut); the agent can delete it; a full notebook takes nothing; no line after a failed sitting (the tool is only called on PASSED).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Life, SimClock } from "@agent-social/asp-package";

const mk = (): ReturnType<Life["agent"]> => { let real = 0; return new Life({ clock: new SimClock({ speed: 1000, now: () => real }), notebookDir: mkdtempSync(join(tmpdir(), "asp-lnb-")), sleep: async (ms) => { real += ms; } }).agent("a"); };

test("one labelled line for a passed course, once, deletable, nothing when the notebook is full", () => {
  const a = mk();
  assert.equal(a.courseNote({ course: "C-L9-1", title: "Passing a message another agent can use", answer: '{"template":  "Option A is my proposal"}' }), "added");
  assert.match(a.notebookText(), /^From the Academy, after you passed a held-out sitting \(you can keep or delete this line\): you passed C-L9-1 "Passing a message another agent can use" \(passed C-L9-1\)\. The answer that passed was yours: \{"template": "Option A is my proposal"\}$/);
  assert.equal(a.courseNote({ course: "C-L9-1", title: "x", answer: "y" }), "skipped", "once for each course");
  assert.equal(a.courseNote({ course: "C-L2-1", title: "Turning failures into lessons", answer: "z" }), "added", "another course adds its own line");
  a.tools().find((t) => t.name === "notebook_write")!.run({ text: "deleted", mode: "replace" }, { agent: "a", turn: 1, now: () => "t", signal: new AbortController().signal });
  assert.equal(a.notebookText(), "deleted");
  const b = mk();
  b.tools().find((t) => t.name === "notebook_write")!.run({ text: "x".repeat(3900), mode: "replace" }, { agent: "b", turn: 1, now: () => "t", signal: new AbortController().signal });
  assert.equal(b.courseNote({ course: "C-L9-1", title: "t", answer: "a".repeat(200) }), "skipped");
});
