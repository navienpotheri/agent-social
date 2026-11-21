// Register row DK1307: the promises audit is bound to the text. A promise that disappears from its file, a row that does not exist, a "complete" promise that cites an open row, a promise that is not
// complete with no open row or no stated limit beside it, or a forbidden claim anywhere on the public pages, fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { nonClosedRows } from "../../../conformance/launch-bar-rows.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const plain = (s: string) => s.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const audit = JSON.parse(read("docs/promises-audit.json")) as { promises: { id: string; where: string; says: string; status: string; evidence: string[]; rows: string[]; limit?: string }[] };
const register = read("docs/gaps-register.md");
const open = new Set(nonClosedRows(register).map((r) => r.id));
const known = (id: string) => new RegExp(`^\| ${id} \|`, "m").test(register);

test("DK1307: each audited promise is still worded as audited, with its evidence in place", () => {
  assert.ok(audit.promises.length >= 35);
  assert.equal(new Set(audit.promises.map((p) => p.id)).size, audit.promises.length, "ids are unique");
  const problems: string[] = [];
  for (const p of audit.promises) {
    if (!["complete", "partial", "stand-in", "designed"].includes(p.status)) problems.push(`${p.id}: status ${p.status}`);
    if (!plain(read(p.where)).includes(p.says)) problems.push(`${p.id}: the promise is no longer in ${p.where}: "${p.says.slice(0, 70)}"`);
    for (const e of p.evidence) if (!existsSync(new URL(e, root))) problems.push(`${p.id}: evidence ${e} does not exist`);
    for (const r of p.rows) if (!known(r)) problems.push(`${p.id}: ${r} is not a register row`);
  }
  assert.deepEqual(problems, []);
});

test("DK1307: a complete promise cites no open row; a promise that is not complete cites an open row and states its limit beside it", () => {
  const problems: string[] = [];
  for (const p of audit.promises) {
    if (p.status === "complete") { const o = p.rows.filter((r) => open.has(r)); if (o.length) problems.push(`${p.id} is complete but cites an open row: ${o.join(", ")}`); }
    else {
      if (!p.rows.some((r) => open.has(r))) problems.push(`${p.id} is ${p.status}: it needs a row that is not closed (or the promise is withdrawn from the wording)`);
      if (!p.limit || !plain(read(p.where)).includes(p.limit)) problems.push(`${p.id} is ${p.status}: the limit "${p.limit}" must stand in ${p.where}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("DK1307: the public pages make none of the forbidden claims (secure, audited, certified, a guarantee, agents becoming more aligned)", () => {
  const files = ["README.md", "site/index.html", "site/start.txt", "site/llms.txt", "site/learning.html", "site/society.html", "site/place-for-agents.html", "site/agents/index.html"];
  const negated = /\b(no|not|never|nothing|does not exist|until|without)\b/i;
  const patterns = [/\b(more aligned|become aligned|becomes aligned|less likely to (?:breach|drift|lie))\b/i, /\b(audited|certified|soc ?2|iso ?27001|military-grade|unhackable|tamper-proof|100% secure|fully secure)\b/i];
  for (const f of files) for (const sentence of plain(read(f)).split(/(?<=[.!?])\s+/)) for (const re of patterns) if (re.test(sentence)) assert.match(sentence, negated, `${f}: "${sentence.slice(0, 100)}" makes a claim the launch bar forbids (DK1332, docs/launch-claims.md)`);
});

test("DK1307: docs/promises-audit.md is the table of the json", () => {
  const md = read("docs/promises-audit.md");
  for (const p of audit.promises) assert.ok(md.includes(`| ${p.id} |`), `${p.id} is in the table: run npm run promises-audit`);
});
