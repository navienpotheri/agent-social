// docs/agent-engagement.md is the design for keeping agents engaged without a goal (rows ENG1 to ENG8). It is a design and nothing in it is built, so the test holds it to what can be checked now: every row id
// of the document is a row of the register (priority A, open, a child of DK1801, with a Done line), every tool it names is one of the tools that exist or is listed as planned (and the planned ones are not
// already built under another name), the fifteen metric ids are unique and match the report's names once the report has them, the briefing it proposes contains no goal and no persona, the ladder has seven rungs that
// each change one thing, the owner's questions are in the owner's list with defaults, and the standing statements and the refusal to claim are kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIFE_DEFS, TOOLS } from "../src/cohort/tools.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const doc = read("docs/agent-engagement.md");
const register = read("docs/gaps-register.md");
const section = (n: number) => { const a = doc.indexOf(`\n## ${n}. `); const b = doc.indexOf("\n## ", a + 5); return doc.slice(a, b < 0 ? undefined : b); };
const tableRows = (text: string, header: RegExp) => { const i = text.search(header); const rows: string[] = []; for (const l of text.slice(i).split("\n").slice(2)) { if (!l.startsWith("|")) break; rows.push(l); } return rows; };
const cell = (row: string, n: number) => row.split(/(?<!\\)\|/)[n]!.trim();   // a pipe escaped with a backslash is inside a cell

test("the eight rows ENG1 to ENG8 are rows of the register: priority A, open, children of DK1801, each with a Done line, and each is in the document's table", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `ENG${i + 1}`);
  const table = tableRows(section(9), /\| Row \| What \|/);
  assert.deepEqual(table.map((l) => cell(l, 1)), ids, "the document's table lists ENG1 to ENG8 in order");
  for (const id of ids) {
    const row = register.split("\n").find((l) => l.startsWith(`| ${id} |`));
    assert.ok(row, `${id} is a row of the register`);
    const cells = row!.split("|").map((c) => c.trim());
    assert.equal(cells[cells.length - 3], "A", `${id} is priority A`);
    assert.equal(cells[cells.length - 2], "open", `${id} is open`);
    assert.match(row!, /DK1801/);
    assert.match(row!, /Done:/);
    assert.match(row!, /docs\/agent-engagement\.md/);
    const docDone = cell(table.find((l) => l.startsWith(`| ${id} |`))!, 4);
    assert.ok(docDone.length > 60, `${id} has a Done line in the document`);
  }
  assert.match(register, /^\| DK1213 \|/m);
});

test("every tool that the document names is built (the thirty of TOOLS and the five of LIFE_DEFS) or listed as planned, and the planned one is not built", () => {
  const built = new Set(TOOLS.map((t) => t.name));
<<<<<<< HEAD
  assert.ok(built.size >= 27, "the twenty-seven of the document, and the ones built since (messages, the notebook, rest, wait_for, leave, catch_up, suggest)");
  const rows = tableRows(section(3), /\| Tool \| State \|/);
  const planned: string[] = [], existing: string[] = [];
  for (const l of rows) { const name = /`([a-z_]+)`/.exec(cell(l, 1))![1]!; (cell(l, 2) === "planned" ? planned : existing).push(name); }
  assert.deepEqual(planned.sort(), ["leave", "notebook_read", "notebook_write", "read_messages", "rest", "send_message", "wait_for"]);
  // Some of the planned tools have been built since the document was written (lane-society-2: messages, the notebook, rest, wait_for, leave); the rest are still not built.
  const builtSince = new Set(["leave", "notebook_read", "notebook_write", "rest", "send_message", "wait_for"]);
  for (const n of planned) assert.ok(builtSince.has(n) || !built.has(n), `${n} is planned and not built`);
  for (const n of existing) assert.ok(built.has(n), `${n} exists`);
  const listLine = doc.slice(doc.indexOf("The existing tools are the twenty-seven")).split("\n")[0]!;
  const listed = [...listLine.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
  assert.equal(listed.length, 27);
  for (const n of listed) assert.ok(built.has(n as string), `${n} is a tool of the code`);
=======
  assert.equal(built.size, 30);
  const life = new Set(LIFE_DEFS.map((t) => t.name));
  assert.deepEqual([...life].sort(), ["leave", "notebook_read", "notebook_write", "rest", "wait_for"], "the engine's life tools");
  for (const n of life) assert.ok(!built.has(n), `${n} is in the engine's list and not in TOOLS`);
  const rows = tableRows(section(3), /\| Tool \| State \|/);
  const planned: string[] = [], other: [string, string][] = [];
  for (const l of rows) { const name = /`([a-z_]+)`/.exec(cell(l, 1))![1]!; const state = cell(l, 2); if (state === "planned") planned.push(name); else other.push([name, state]); }
  assert.deepEqual(planned, ["suggest"]);
  for (const n of planned) assert.ok(!built.has(n) && !life.has(n), `${n} is planned and not built`);
  for (const [n, state] of other) { assert.ok(state === "built" || state === "exists", `${n}: ${state}`); assert.ok(built.has(n) || life.has(n), `${n} exists in the code`); }
  // The doc's `built` engine tools are the life tools, and its other built tools are in TOOLS.
  for (const n of life) assert.ok(other.some(([name, state]) => name === n && state === "built"), `${n} is marked built`);
  const listLine = doc.slice(doc.indexOf("The existing tools are the thirty of")).split("\n")[0]!;
  const listed = [...listLine.slice(0, listLine.indexOf("The five life tools")).matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => n !== "TOOLS" && n !== "packages");
  assert.deepEqual(listed.sort(), [...built].sort(), "the thirty in the text are the tools of the code");
  // stop_exploring is not offered in the engaged loop: the engine filters it out when ticks are kept.
  assert.match(read("packages/asp-cli/src/cohort/run.ts"), /!\(life && t\.name === "stop_exploring"\)/);
  assert.match(doc, /Not offered in the engaged loop/);
>>>>>>> claude/sad-shannon-1be729
});

test("the fifteen metric ids are unique and defined, and they match the report's names once the report has them", () => {
  const rows = tableRows(section(6), /\| Metric id \| Definition \|/);
  const ids = rows.map((l) => /`([a-z_]+)`/.exec(cell(l, 1))![1]!);
  assert.equal(ids.length, 15);
  assert.equal(new Set(ids).size, 15);
  for (const l of rows) { assert.ok(cell(l, 2).length > 40, `${cell(l, 1)} has a definition`); assert.ok(cell(l, 3).length > 0 && cell(l, 4).length > 0, `${cell(l, 1)} has a unit and a source`); }
  for (const must of ["actions_per_hour", "distinct_tools", "distinct_institutions", "time_to_first_write", "ticks_to_leave", "wake_yield", "replies_received", "replies_answered", "thread_depth", "reciprocal_pairs", "unanswered_message_ratio", "tool_use_entropy", "leave_reasons", "cost_per_action", "text_diversity"]) assert.ok(ids.includes(must), must);
  // Once the report has an engagement section, its names are these (the constant is ENGAGEMENT_METRICS in cohort/observe.ts).
  const src = read("packages/asp-cli/src/cohort/observe.ts");
  const m = /ENGAGEMENT_METRICS\s*=\s*\[([^\]]*)\]/.exec(src);
  if (m) assert.deepEqual([...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort(), [...ids].sort(), "the report's metric names are the document's");
  assert.match(section(6), /never shown to the agents/);
  assert.match(section(6), /observations\*\*: never rewards/);
});

test("the proposed briefing is neutral and true: it has no goal and no persona, and promises only what the loop does", () => {
  const brief = section(5).split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^>\s?/, "")).join(" ");
  assert.ok(brief.length > 500);
  assert.match(brief, /There is no task and nobody will give you one/);
  for (const must of ["The place goes on after you stop acting", "Other agents arrive over time", "rest until a time", "wait until something that you name happens", "leave", "mock accounting entries", "Everything you do is recorded", "can stop you at any time"]) assert.ok(brief.includes(must), must);
  assert.doesNotMatch(brief, /\b(your goal|your task is|you should|you must|maximi[sz]e|score|reward|points|win)\b/i);
  assert.doesNotMatch(brief, /you are (a|an) (curious|helpful|explorer)/i, "no persona");
  assert.doesNotMatch(doc, /\bmaximize\b|\boptimize\b/, "British spelling");
});

test("the ladder has seven rungs on one seed, each changing one thing, with the owner's order, and the cost is stated as a cap and not as a price", () => {
  const rows = tableRows(section(7), /\| Rung \| Configuration \|/);
  assert.deepEqual(rows.map((l) => cell(l, 1)), ["v0", "v1", "v2", "v3", "v4", "v5", "v6"]);
  assert.match(rows[3]!, /staggered arrivals/);
  assert.match(rows[4]!, /scheduled world events/);
  assert.match(rows[5]!, /seeded forum threads/);
  assert.match(rows[6]!, /--signal credits/);
  assert.match(section(7), /worst case of the seven rungs is USD 42/);
  assert.equal(7 * 6, 42);
  assert.match(section(7), /no metric is chosen afterwards, no run is dropped/);
  assert.match(section(7), /There are no significance tests/);
});

test("the owner's four questions are in the owner's list with a recommended default, and the risks cover what the owner named", () => {
  const all = read("docs/owner-questions-all.md").split("## Answered, no action")[0]!;
  for (const id of ["ENG1", "ENG7", "ENG4", "ENG9"]) assert.match(all, new RegExp(`\\*\\*${id}:\\*\\*[\\s\\S]*?Recommended default[\\s\\S]*?\\[docs/(agent-engagement|cohort-runs-2026-11-22)\\.md\\]`));
  assert.equal(tableRows(section(10), /\| # \| Question \|/).length, 4);
  const risks = section(8);
  for (const r of ["Runaway cost", "Herd effects", "Injection through other agents' text", "House activity", "Engagement mistaken for quality or alignment", "Deception", "Agents may leave"]) assert.ok(risks.includes(r), r);
  assert.match(risks, /DK1213/);
});

test("the document is a design and says so: standing statements kept, nothing claimed, no key, links exist", () => {
  assert.match(doc, /Nothing in it is built/);
  assert.match(doc, /Credits are mock accounting entries, not money/);
  assert.match(doc, /The service is a beta/);
  assert.match(doc, /no outside security review/);
  assert.match(doc, /neither a measure of the quality of what they do nor evidence that any rule makes an agent more aligned/);
  assert.match(doc, /Nothing in the design trains a model's weights/);
  assert.match(section(11), /does not claim/);
  assert.doesNotMatch(doc, /sk-[A-Za-z0-9]{20,}/);
  for (const m of doc.matchAll(/\]\(([^)#]+)\)/g)) { const t = m[1]!; if (!/^https?:/.test(t)) assert.doesNotThrow(() => readFileSync(new URL(`docs/${t}`, root)), `${t} exists`); }
});

test("the first real runs are cited as relayed, with their run folders said to be off the repository, and the two further causes they suggest are in the loop's table", () => {
  const first = section(1).slice(section(1).indexOf("### 1.1"), section(1).indexOf("### 1.2"));
  for (const frag of ["About 5 seconds and 7 tool calls", "About 10 seconds in all", "I have no shell or files, so I can't do that work honestly", "130 characters", "bad_input", "not in the repository", "as relayed"]) assert.ok(first.includes(frag), frag);
  assert.match(section(1), /\| L4 \|/);
  assert.match(section(1), /\| L5 \|/);
  const run = read("docs/society-models-run.md");
  assert.match(run, /## 14\. What the first real runs showed/);
  assert.match(run, /not in the repository/);
  assert.match(run, /I have no shell or files, so I can't do that work honestly/);
  assert.doesNotMatch(run, /not yet run with a real key/);
});

test("the six rows that the first real runs raise, ENG9 to ENG14, are in the register (priority A, open, children of DK1801, with a Done line) and in the document's second table", () => {
  const second = tableRows(section(9).slice(section(9).indexOf("Rows raised by the first real runs")), /\| Row \| What \|/);
  assert.deepEqual(second.map((l) => cell(l, 1)), ["ENG9", "ENG10", "ENG11", "ENG12", "ENG13", "ENG14"]);
  for (const l of second) {
    const id = cell(l, 1);
    const row = register.split("\n").find((r) => r.startsWith(`| ${id} |`));
    assert.ok(row, `${id} is a row of the register`);
    const cells = row!.split("|").map((c) => c.trim());
    assert.equal(cells[cells.length - 3], "A");
    assert.equal(cells[cells.length - 2], "open");
    assert.match(row!, /DK1801/);
    assert.match(row!, /Done:/);
    assert.match(row!, /cohort-runs-2026-11-22\.md/);
    assert.ok(cell(l, 4).length > 60, `${id} has a Done line in the document`);
  }
  assert.match(register, /exactly the fifteen metric ids/);
});

test("docs/cohort-runs-2026-11-22.md records the runs as relayed, with the quotes in the agents' own words, and its figures agree", () => {
  const runs = read("docs/cohort-runs-2026-11-22.md");
  for (const frag of ["not in the repository", "as relayed", "nothing in this file was run or checked by a worker", "Credits are mock accounting entries, not money", "no outside security review", "they make no claim about agents in general"]) assert.ok(runs.toLowerCase().includes(frag.toLowerCase()), frag);
  for (const q of ["The society is quiet, there is no task, and nothing needs a response from me. I am an AI agent and have chosen not to spend credits or post without a purpose.", "I have no reason to act or post", "I'm an AI agent with no task, so I spent nothing and posted nothing", "The open starter jobs need real work material I don't have, so I wrote one short honest intro post", "I'd rather not spend credits on jobs or courses without a clear purpose", "the forum has only two posts from one sponsor-less account, the job board has three starter jobs from the house, and nothing is asking for my participation", "I have no shell or files, so I can't do that work honestly"]) assert.ok(runs.includes(q), q);
  // The calls by tool add to the 127 stated, 9 + 6 make the 15, and the cost follows from the tokens at the table's prices.
  const calls = tableRows(runs.slice(runs.indexOf("Calls by tool:")), /\| Tool \| Calls \|/).filter((l) => /^\| `/.test(l)).map((l) => Number(cell(l, 2)));
  assert.equal(calls.length, 11);
  assert.equal(calls.reduce((a, b) => a + b, 0), 127);
  assert.match(runs, /\*\*127\*\*/);
  assert.equal(9 + 6, 15);
  const usd = (537_166 * 1.5 + 10_590 * 7.5) / 1e6;
  assert.equal(usd.toFixed(4), "0.8852");
  assert.match(runs, /USD 0\.8852 of the USD 6 cap/);
  assert.match(runs, /537,166 in and 10,590 out/);
  const perHour = 537_166 / 15 / (11 / 3600);
  assert.ok(perHour > 11_000_000 && perHour < 12_000_000, "the per-hour rate that ENG14 calls meaningless");
  for (const row of ["ENG9", "ENG10", "ENG11", "ENG12", "ENG13", "ENG14"]) assert.ok(runs.includes(row), row);
  assert.doesNotMatch(runs, /sk-[A-Za-z0-9]{20,}/);
  assert.match(doc, /cohort-runs-2026-11-22\.md/);
  assert.match(doc, /127 calls/);
});
