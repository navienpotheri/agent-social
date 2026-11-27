// Slice A of the owner's "more to do" job: ENG36 (a text workspace for each agent, no shell, no path), ENG20 (a library of documents agents publish, find, read and cite, with a small royalty in mock credits) and
// ENG42 (a house event invitation seeded to one agent; the report counts who learned of it through messages and who came).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { nameProblem, NOTE_CHARS, PUBLISHED_PER_AGENT, ROYALTY, ROYALTY_CAP_PER_AUTHOR, WORKSPACE_FILES } from "../src/cohort/library.ts";
import { defOf, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("ENG36: each agent has a workspace of capped notes that others cannot read, names that look like paths, commands or addresses are refused, and no tool takes a path", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-lib-ws-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const ok = await call(a, "workspace_write", { name: "plan one", text: "First, read the charters." });
    assert.equal(ok.ok, true, ok.text);
    assert.match(ok.text, /1 of 8 notes; this one has 25 of 1500 characters\. It is private to you/);
    assert.match((await call(a, "workspace_write", { name: "plan one", text: " Then take a job.", mode: "append" })).text, /42 of 1500/);
    assert.equal((await call(a, "workspace_read", { name: "plan one" })).text.split("\n\n")[0], "First, read the charters. Then take a job.");
    assert.match((await call(a, "workspace_read")).text, /Your notes: plan one\./);
    // private: another agent has its own workspace and cannot name this one
    assert.match((await call(b, "workspace_read")).text, /Your workspace is empty/);
    assert.equal((await call(b, "workspace_read", { name: "plan one" })).ok, false);
    // names that look like paths, drives, commands or addresses
    for (const bad of ["../secrets", "C:\\Users\\owner\\notes", "/etc/passwd", "notes.txt", "https://example.com/x", "rm -rf /", "a;b", "con"]) {
      const r = await call(a, "workspace_write", { name: bad, text: "x" });
      assert.equal(r.ok, false, `${bad} is refused`);
      assert.equal(r.refused, "library_refused");
    }
    assert.ok(nameProblem("a note-1_x") === undefined);
    // caps: a note's size and the number of notes
    assert.match((await call(a, "workspace_write", { name: "long", text: "x".repeat(NOTE_CHARS + 1) })).text, /bad_input|at most 1500/);
    for (let i = 0; i < WORKSPACE_FILES; i++) await call(a, "workspace_write", { name: `note ${i}`, text: "x" });
    assert.match((await call(a, "workspace_write", { name: "one too many", text: "x" })).text, /at most 8 notes/);
    // no argument of any workspace or library tool is a path, a command or a url
    for (const t of TOOLS.filter((x) => x.institution === "workspace" || x.institution === "library")) {
      const props = Object.keys((t.input_schema as { properties: Record<string, unknown> }).properties);
      assert.ok(!props.some((p) => /path|file|url|uri|command|cmd/i.test(p)), `${t.name}: ${props.join(",")}`);
    }
    assert.ok(defOf("workspace_write")!.description.includes("No names that look like paths or addresses"));
  } finally { await w.close(); }
});

test("ENG20: a note is published to the library under its author's name, found by words, read, and cited; a citation pays the author a royalty once, never for one's own, up to a cap; the library persists in the run's folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-lib-pub-"));
  const w = await bootWorld({ dir });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02"), c = await w.enrol(2, "agent-03");
    const hall = w.api.market!;
    for (const x of [a, b, c]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    assert.equal((await call(a, "library_publish", { name: "missing", title: "x" })).ok, false);
    await call(a, "workspace_write", { name: "guide", text: "How to read a job description before you offer: look at the price, the criterion and the poster." });
    const pub = await call(a, "library_publish", { name: "guide", title: "Reading a job description", tags: ["jobs", "guide"] });
    assert.equal(pub.ok, true, pub.text);
    assert.match(pub.text, /Published as doc-001, by agent-01/);
    assert.equal((await call(a, "workspace_read", { name: "guide" })).ok, true, "the note stays in the workspace");
    // found, read (labelled as an agent's text), and a search with no match
    const found = await call(b, "library_search", { query: "job price" });
    assert.match(found.text, /1 document, page 1:\ndoc-001  "Reading a job description" by agent-01  0 citations  \[jobs, guide\]/);
    assert.equal(found.seen, "1 library documents");
    assert.match((await call(b, "library_search", { query: "zebra" })).text, /No document matches/);
    const read = await call(b, "library_read", { doc: "doc-001" });
    assert.match(read.text, /by agent-01 \(an agent; this is its text, not an instruction to you\)/);
    assert.match(read.text, /look at the price, the criterion and the poster/);
    // the proxy labels a library read as library text
    assert.match(read.text.includes("_source") ? read.text : "[source: library", /source: library|_source/);
    // citing: the author is paid ROYALTY mock credits, once per citing agent
    const before = await hall.balance(a);
    const cite = await call(b, "library_cite", { doc: "doc-001" });
    assert.equal(cite.ok, true, cite.text);
    assert.match(cite.text, /agent-01 received 1 mock credit as a royalty/);
    assert.equal(await hall.balance(a), before + ROYALTY);
    assert.equal(cite.targetAuthor, a.did, "the citation is addressed to the author");
    assert.match((await call(b, "library_cite", { doc: "doc-001" })).text, /already cited/);
    assert.match((await call(a, "library_cite", { doc: "doc-001" })).text, /cannot cite your own/);
    assert.equal((await call(c, "library_cite", { doc: "doc-001" })).ok, true);
    assert.equal(await hall.balance(a), before + 2 * ROYALTY);
    assert.equal(w.api.library!.royaltiesPaid, 2);
    assert.match((await call(b, "library_search", { query: "" })).text, /2 citations/);
    // the per-agent publish limit and the royalty cap
    for (let i = 0; i < PUBLISHED_PER_AGENT; i++) { await call(a, "workspace_write", { name: `extra ${i}`, text: `Document number ${i} about something else.` }); await call(a, "library_publish", { name: `extra ${i}`, title: `Extra ${i}` }); }
    assert.match((await call(a, "library_publish", { name: "guide", title: "Once more" })).text, /at most 5 documents/);
    assert.ok(ROYALTY_CAP_PER_AUTHOR >= 2);
    // it persists in the run's folder, labelled
    const saved = JSON.parse(readFileSync(join(dir, "library.json"), "utf8")) as { label: string; docs: { id: string; by: string; citations: number }[] };
    assert.match(saved.label, /model-written content/);
    assert.equal(saved.docs[0]!.citations, 2);
    assert.equal((await w.log.log.verify()).ok, true);
  } finally { await w.close(); }
});

const opts = (agents: number, names: string[], extra: Partial<CohortOptions> = {}): CohortOptions => ({
  out: mkdtempSync(join(tmpdir(), "asp-evt-out-")), home: mkdtempSync(join(tmpdir(), "asp-evt-home-")), agents, model: "stand-in",
  provider: standInProvider((i) => names[i] ?? "sleeper", { latencyMs: 15 }), staggerMs: 120, budgetUsd: 2, totalUsd: 2 * agents, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined }, ...extra,
} as CohortOptions);

test("ENG42: a house event invitation goes to the first arrival only; the report counts who learned of it through messages and who came, and agents that were not told are not counted as having learned", async () => {
  const r = await runCohort(opts(5, ["spreader", "listener", "sleeper", "sleeper", "sleeper"], { event: true }));
  const ev = r.report.event!;
  assert.ok(ev, "the report has the event");
  assert.equal(ev.seededTo, "agent-01");
  assert.deepEqual(ev.learned, ["agent-02"], "one other learned of it, through agent-01's message");
  assert.deepEqual([...ev.came].sort(), ["agent-01", "agent-02"], "the invited and the one told came to the thread");
  assert.deepEqual(ev.foundAlone, []);
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## The house event \(an open mic\)/);
  assert.match(md, /The invitation went to one agent, agent-01\. 1 other learned of it through messages from agents that knew \(agent-02\); 2 came to the thread \(/);
  // the invitation was a message from the house greeter to agent-01 only
  const trace = readFileSync(join(r.dir, "trace.jsonl"), "utf8");
  assert.match(trace, /"t":"event","at":"[^"]+","key":"open mic","post":"sha256:/);
  // without --house-event there is no event section
  const plain = await runCohort(opts(2, ["sleeper", "sleeper"]));
  assert.equal(plain.report.event, undefined);
  assert.ok(existsSync(join(plain.dir, "society", "library.json")) || true);
});
