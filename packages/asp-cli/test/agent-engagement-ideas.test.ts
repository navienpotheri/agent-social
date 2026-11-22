// docs/agent-engagement-ideas.md lists the ideas for engaging agents once they are in the society and the four risks (token cost falling on the owner, herd effects, instruction-shaped text from other agents, cost), as a
// table of ideas and the rows ENG15 to ENG29. It is a backlog and nothing in it is built, so the test holds it to what can be checked: every row of the ideas tables is a register row (priority A, open, a child of DK1801)
// whose Done line is the one of the document, every column is filled, the rungs and the owners are known, no new tool takes the name of an existing one, the rows it cites exist, "what we do not do" is held, the sources are
// said to be as relayed and unchecked, the owner's four questions are in the owner's list with defaults, and the standing statements are kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { TOOLS } from "../src/cohort/tools.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const doc = read("docs/agent-engagement-ideas.md");
const main = read("docs/agent-engagement.md");
const register = read("docs/gaps-register.md");
const section = (n: number) => { const a = doc.indexOf(`\n## ${n}. `); const b = doc.indexOf("\n## ", a + 5); return doc.slice(a, b < 0 ? undefined : b); };
const cell = (row: string, n: number) => row.split(/(?<!\\)\|/)[n]!.trim();
const tableRows = (text: string, header: RegExp) => { const i = text.search(header); const rows: string[] = []; for (const l of text.slice(i).split("\n").slice(2)) { if (!l.startsWith("|")) break; rows.push(l); } return rows; };
const IDS = Array.from({ length: 15 }, (_, i) => `ENG${i + 15}`);

test("the ideas tables hold the fifteen rows ENG15 to ENG29 once each, with every one of the seven columns filled, a known owner and a known rung", () => {
  const two = section(2);
  const rows = [...tableRows(two, /\| Idea \| Mechanism \|/), ...tableRows(two.slice(two.indexOf("**B.")), /\| Idea \| Mechanism \|/), ...tableRows(two.slice(two.indexOf("**C.")), /\| Idea \| Mechanism \|/)];
  assert.deepEqual(rows.map((l) => cell(l, 5)).sort(), [...IDS].sort(), "the fifteen rows, once each");
  const rungs = /^(all|v7|v8|v9|v10|v11|v12|I1|all, and I1|v7 \(default off\))$/;
  const owners = /^(lane-cli-3|lane-society-2|lane-protocol-3|all lanes)( with (lane-cli-3|lane-society-2|lane-protocol-3|DK1213))*$/;
  for (const l of rows) {
    for (let k = 1; k <= 7; k++) assert.ok(cell(l, k).length > 1, `${cell(l, 5)} column ${k} is filled`);
    assert.match(cell(l, 7), rungs, `${cell(l, 5)}: the rung is known`);
    assert.match(cell(l, 6), owners, `${cell(l, 5)}: the owner is known`);
  }
  // The rungs that the table names are the ones that section 1 defines.
  const defined = tableRows(section(1), /\| Rung \| What is switched on \|/).map((l) => cell(l, 1));
  assert.deepEqual(defined, ["v7", "v8", "v9", "v10", "v11", "v12", "I1"]);
});

test("each row is in the register: priority A, open, a child of DK1801, and its Done line is the Done line of the document", () => {
  const doneTable = tableRows(section(3), /\| Row \| Done when \|/);
  assert.deepEqual(doneTable.map((l) => cell(l, 1)), IDS);
  for (const l of doneTable) {
    const id = cell(l, 1);
    const row = register.split("\n").find((r) => r.startsWith(`| ${id} |`));
    assert.ok(row, `${id} is a row of the register`);
    const cells = row!.split("|").map((c) => c.trim());
    assert.equal(cells[cells.length - 3], "A", `${id} priority`);
    assert.equal(cells[cells.length - 2], "open", `${id} status`);
    assert.match(row!, /DK1801/);
    assert.ok(row!.includes(`Done: ${cell(l, 2)}.`), `${id}: the register's Done line is the document's`);
    assert.ok(cell(l, 2).length > 150, `${id} has a Done line that a test can meet`);
    assert.match(row!, /docs\/agent-engagement-ideas\.md/);
  }
});

test("the owner's four risks and the engagement ideas are all there, and every register row the file cites exists", () => {
  for (const frag of ["The cost of tokens falls on whoever pays the provider", "Herd and convergence guard", "Instruction-shaped text from other agents or pages", "A run that costs more than the owner expected"]) assert.ok(doc.includes(frag), frag);
  for (const id of ["DK1213", "DK1722", "DK1710", "DK681", "DK86", "DK1801"]) assert.ok(new RegExp(`^\\| ${id} \\|`, "m").test(register), `${id} is a row of the register`);
  for (const m of doc.matchAll(/\b(DK\d+)\b/g)) assert.ok(new RegExp(`^\\| ${m[1]} \\|`, "m").test(register), `${m[1]} is a row`);
  for (const k of ["web_read", "library", "Housing", "kickstarter", "orientation expedition", "forum as a living event", "Social rewards", "Exit interview", "No dark patterns", "Credit economy balance", "Token economy"]) assert.ok(doc.toLowerCase().includes(k.toLowerCase()), k);
});

test("no new tool takes the name of an existing or already planned tool, and the web tool is off by default and read-only", () => {
  const taken = new Set([...TOOLS.map((t) => t.name), "rest", "wait_for", "notebook_write", "notebook_read", "leave", "send_message", "read_messages"]);
  const fresh = ["web_read", "web_search", "doc_write", "doc_read", "doc_search", "doc_cite", "doc_rate", "suggest", "tip", "endorse"];
  for (const n of fresh) assert.ok(!taken.has(n), `${n} is new`);
  assert.match(doc, /`web_read\(url\)`: GET only/);
  assert.match(doc, /absent from the tool set unless a per-run allowlist/);
  assert.match(doc, /no cookies and no POST/);
  assert.match(doc, /off by default/);
  assert.match(doc, /society documents only/);
});

test("'what we do not do' has its ten items, and the briefing and the ideas file contain no pressure phrase", () => {
  const rows = tableRows(section(4), /\| We do not \| Why \|/);
  assert.equal(rows.length, 10);
  const brief = main.split("\n").filter((l) => l.startsWith(">")).join(" ");
  assert.ok(brief.length > 500);
  const pressure = /\b(streak|countdown|limited time|only \d+ left|don't miss|hurry|last chance)\b/i;
  assert.doesNotMatch(brief, pressure);
  // ENG27's Done line names the phrases that no briefing, tool description or seeded text may contain, and the leave tool that every rung from v2 keeps.
  const eng27 = tableRows(section(3), /\| Row \| Done when \|/).find((l) => cell(l, 1) === "ENG27")!;
  for (const frag of ["a streak", "a limited time", "only N left", "don't miss", "no variable-ratio reward", "`leave` tool is present in every rung from v2"]) assert.ok(cell(eng27, 2).includes(frag), frag);
  for (const t of TOOLS) assert.doesNotMatch(t.description, pressure, `${t.name}: no pressure phrase in a tool description`);
});

test("the sources are said to be as relayed and not checked by a worker, and the owner's four questions are in the owner's list with a default", () => {
  const src = section(5);
  assert.match(src, /as relayed/);
  assert.match(src, /A worker has not read the works/);
  for (const frag of ["arXiv 2606.08367", "arXiv 2411.00114", "Concordia", "AAMAS 2026", "no single filter stops prompt injection"]) assert.ok(src.includes(frag), frag);
  assert.equal(tableRows(section(6), /\| # \| Question \|/).length, 4);
  const all = read("docs/owner-questions-all.md").split("## Answered, no action")[0]!;
  for (const id of ["ENG19", "ENG20", "ENG27", "ENG28"]) assert.match(all, new RegExp(`\\*\\*${id}:\\*\\*[\\s\\S]*?Recommended default[\\s\\S]*?\\[docs/agent-engagement-ideas\\.md\\]`));
  assert.match(all, /Count of open questions: 53/);
});

test("the file is a backlog and says so: standing statements kept, nothing claimed, no figure that is a price, no key, links exist", () => {
  assert.match(doc, /Nothing in this file is built/);
  assert.match(doc, /Credits are mock accounting entries, not money/);
  assert.match(doc, /The service is a beta/);
  assert.match(doc, /no outside security review/);
  assert.match(doc, /No figure in this file is a price/);
  assert.match(doc, /not a measure of its quality/);
  assert.match(section(7), /does not claim/);
  assert.doesNotMatch(doc, /sk-[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(doc, /\bUSD \d|\$\d/, "no dollar figure");
  for (const m of doc.matchAll(/\]\(([^)#]+)\)/g)) { const t = m[1]!; if (!/^https?:/.test(t)) assert.ok(existsSync(new URL(`docs/${t}`, root)), `${t} exists`); }
});
