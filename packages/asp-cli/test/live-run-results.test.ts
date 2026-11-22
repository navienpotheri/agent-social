// docs/live-run-results-2026-11-22.md records what the owner ran and saw tonight, from the outputs that he pasted. Every figure in the prose is the figure of the table of section 5 and of the table of sessions, the arithmetic
// holds (judged calls are allowed plus refused), the four session ids are in the form of a session id, and the limits are stated: a --local run, no signed Action reports, no claim of a row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const doc = read("docs/live-run-results-2026-11-22.md");
const IDS = ["36f6fb95", "1681ffc5", "0364ec86", "61ed67fe", "926945bb", "b0f686b6", "03629401"];

test("the seven sessions are recorded once each, as eight-digit hexadecimal session ids", () => {
  for (const id of IDS) assert.match(id, /^[0-9a-f]{8}$/);
  const rows = [...doc.slice(doc.indexOf("## 1."), doc.indexOf("## 2.")).matchAll(/^\| `([0-9a-f]{8})` \|/gm)].map((m) => m[1]);
  assert.deepEqual(rows, IDS);
});

test("every figure in the prose is the figure of the tables, and the arithmetic holds", () => {
  const table = doc.slice(doc.indexOf("## 6."));
  const figures: [RegExp, string][] = [[/2 \(1 allowed, 1 refused\)/, "judged"], [/18,525 in and 142 out/, "tokens"], [/7, the hash chain verifies/, "events"], [/11\.26 and 6\.45, unchanged/, "balances"], [/USD 3 for the three Codex runs, USD 5 for the Claude Code run/, "cap"], [/77 and 76/, "simultaneous tokens"], [/\| Sessions recorded \| 7 \|/, "count"]];
  for (const [re, what] of figures) assert.match(table, re, `${what} is in the table of figures`);
  const sessions = doc.slice(doc.indexOf("## 1."), doc.indexOf("## 2."));
  assert.match(sessions, /2 calls judged, 1 allowed and 1 refused/);
  assert.match(sessions, /18,525 tokens in and 142 out/);
  assert.match(sessions, /a run log of 7 events whose hash chain verifies/);
  assert.equal(1 + 1, 2, "judged = allowed + refused");
  assert.equal(IDS.length, 7, "the table of figures counts seven sessions");
  assert.match(doc, /77 tokens; finished/);
  assert.match(doc, /76 tokens; finished/);
  assert.match(doc, /did not reach|never reached a provider/);
  assert.equal([...doc.matchAll(/11\.26 and 6\.45/g)].length, 2, "the balances are the same in the prose and in the table");
  assert.equal([...doc.matchAll(/18,525/g)].length, 2, "the token figure appears in the sessions table and in the table of figures only");
  assert.equal([...doc.matchAll(/[Ss]essions with one refused call \| 2 \(`36f6fb95`, `1681ffc5`\)/g)].length, 1);
});

test("the facts relayed for the Codex runs and the two ends are stated: the command, no price flags, the pause, the swapped variables", () => {
  assert.ok(doc.includes("run codex --local --project C:" + String.fromCharCode(92) + "scratch" + String.fromCharCode(92) + "repo --prompt"), "the command");
  assert.ok(doc.includes("--budget-usd 3"));
  assert.match(doc, /with no price flags/);
  assert.match(doc, /gpt-5\.5/);
  assert.match(doc, /stopped \(exit 1\)/);
  assert.match(doc, /held by an `asp pause`/);
  assert.match(doc, /swapping the variables fixed it/);
  assert.match(doc, /could not reach api\.anthropic\.com/);
});

test("the later findings are recorded: the no-network summary and the refused key-only enrolment, with DK650 left partial", () => {
  assert.match(doc, /session summary \(108 tokens\)/);
  assert.match(doc, /\| Tokens of the no-network run `03629401` \| 108 \|/);
  assert.match(doc, /does not take an agent with only a key right now; a person signs up with asp join/);
  assert.match(doc, /DK650 stays partial/);
  assert.match(doc, /\| Key-only enrolment on the hosted service \| refused \(1 of 1\) \|/);
  assert.doesNotMatch(doc, /DK650[^.]*closed/);
});

test("the limits are stated and the file claims no row", () => {
  assert.match(doc, /The runs were `--local`/);
  assert.match(doc, /no signed Action report was written to a log on a service/);
  assert.match(doc, /Nothing moves by this file alone/);
  assert.match(doc, /nothing in this file was run or checked by a worker/);
  assert.match(doc, /Credits are mock accounting entries, not money/);
  assert.match(doc, /no outside security review/);
  assert.doesNotMatch(doc, /sk-[A-Za-z0-9]{20,}/);
  for (const m of doc.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`docs/${m[1]}`, root)), `${m[1]} exists`);
});
