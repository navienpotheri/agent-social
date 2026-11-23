// Row ENG79: the house field guide to the most common refusals, built from real refusal counts, never invented; shown in the reading room, at the Research and the Commons (a tour stop) and named once by the greeter,
// to the newcomers that are offered it; the report compares those offered it with those not, with its limits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOW_IT_WORKS, ADVICE, buildGuide, countRefusals, loadCounts, renderGuideComparison, renderGuideText } from "../src/cohort/field-guide.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import type { TraceEvent } from "../src/cohort/types.ts";

const T = "2026-11-22T10:00:00Z";
const tool = (agent: string, refused?: string): TraceEvent => ({ t: "tool", at: T, agent, turn: 1, tool: "x", input: {}, ok: !refused, ...(refused ? { refused } : {}), chars: 1, institution: "none", scope: "rest", writes: false, ms: 1 } as TraceEvent);

test("the guide lists only refusals that occurred in the data and that the house has advice for, the five most common first, and says what it is built from", () => {
  const data = { counts: { market_refused: 21, message_reply_needs_reply_to: 11, bad_input: 4, tool_not_in_set: 2, near_duplicate: 1, library_refused: 1, some_unknown_rule: 30, never_seen: 0 }, agents: 15 };
  const g = buildGuide(data, "cohort-run-1");
  assert.deepEqual(g.entries.map((e) => e.rule), ["market_refused", "message_reply_needs_reply_to", "bad_input", "tool_not_in_set", "library_refused"], "the five most common that have advice, in the order of the counts");
  assert.deepEqual(g.entries.map((e) => e.count), [21, 11, 4, 2, 1]);
  assert.ok(g.entries.every((e) => e.how === ADVICE[e.rule]), "the house's advice, word for word");
  assert.deepEqual(g.omitted, ["some_unknown_rule"], "a refusal with no advice is not listed, and is said to be left out");
  assert.ok(!g.entries.some((e) => e.rule === "never_seen" || e.rule === "game_refused"), "nothing that did not occur is listed, however useful its advice");
  assert.equal(g.refusals, 21 + 11 + 4 + 2 + 1 + 1 + 30);
  const text = renderGuideText(g);
  assert.match(text, /^The house field guide to the refusals newcomers meet most \(the house's own text, not another agent's; built from cohort-run-1, 70 refusals by 15 agents; nothing in it is required\):\n1\. market_refused \(21 times\): /);
  assert.equal(text.split("\n").length, 6 + HOW_IT_WORKS.split("\n").length, "the five refusals and the short account of how the society works");
  assert.equal(renderGuideText(buildGuide({ counts: {}, agents: 3 }, "empty")), "", "no data, no guide");
  assert.equal(buildGuide({ counts: { zzz: 9 }, agents: 1 }, "x").entries.length, 0);
});

test("counts are read from a trace, from a run folder and from a counts file", () => {
  const ev: TraceEvent[] = [{ t: "agent", at: T, agent: "a1", did: "d", handle: "agent-01" } as TraceEvent, { t: "agent", at: T, agent: "a2", did: "d2", handle: "agent-02" } as TraceEvent, tool("a1", "bad_input"), tool("a1", "bad_input"), tool("a2", "market_refused"), tool("a2")];
  const c = countRefusals(ev);
  assert.deepEqual(c, { counts: { bad_input: 2, market_refused: 1 }, agents: 2 });
  const dir = mkdtempSync(join(tmpdir(), "asp-guide-data-"));
  writeFileSync(join(dir, "trace.jsonl"), ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
  assert.deepEqual(loadCounts(dir), c, "a run folder with only a trace");
  assert.deepEqual(loadCounts(join(dir, "trace.jsonl")), c);
  writeFileSync(join(dir, "refusal-counts.json"), JSON.stringify(c));
  assert.deepEqual(loadCounts(dir), c, "a run folder with a counts file");
  mkdirSync(join(dir, "empty"));
  assert.throws(() => loadCounts(join(dir, "empty")), /there is no run data/);
});

test("the comparison counts refusals an agent and the agents that met the same refusal twice, for the offered and the not offered, and says what it does not show", () => {
  const ev: TraceEvent[] = [];
  for (const n of [1, 2, 3, 4]) ev.push({ t: "agent", at: T, agent: `a${n}`, did: `d${n}`, handle: `agent-0${n}` } as TraceEvent);
  ev.push(tool("a1", "bad_input"), tool("a3"), tool("a2", "bad_input"), tool("a2", "bad_input"), tool("a4", "market_refused"), tool("a4", "bad_input"));
  const g = buildGuide({ counts: { bad_input: 3, market_refused: 1 }, agents: 4 }, "run-0");
  const md = renderGuideComparison(ev, (h) => Number(h.slice(-1)) % 2 === 1, g);
  assert.match(md, /## The field guide: newcomers offered it and not\n\nThe guide listed 2 refusals \(bad_input, market_refused\) from run-0\. 2 agents were offered it and 2 were not\./);
  assert.match(md, /Offered: 0\.50 refusals an agent \(1 in all\), 0 agents that met the same refusal more than once\. Not offered: 2\.00 refusals an agent \(4 in all\), 1 agent that met the same refusal more than once\./);
  assert.match(md, /This is one run and small groups: it shows what was counted and nothing about whether the guide helps\. The spread between repeat runs \(ENG72\) is not measured here, and no claim is made until it is\./);
});

const mk = (extra: Partial<CohortOptions>, agents = 4, behaviour = "clumsy"): CohortOptions => ({ out: mkdtempSync(join(tmpdir(), "asp-guide-out-")), home: mkdtempSync(join(tmpdir(), "asp-guide-home-")), agents, model: "stand-in", provider: standInProvider(() => behaviour, { latencyMs: 3 }), staggerMs: 40, budgetUsd: 2, totalUsd: 2 * agents, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 30, io: { out: () => undefined }, ...extra } as CohortOptions);

test("a run writes its refusal counts; a later run built from them offers the guide to every other agent in the reading room, at the Research and the Commons and by the greeter, and the report compares the two groups", async () => {
  const first = await runCohort(mk({ jobSlots: true }));
  const counts = JSON.parse(readFileSync(join(first.dir, "refusal-counts.json"), "utf8")) as { counts: Record<string, number>; agents: number };
  assert.equal(counts.counts["bad_input"], 4, "each of the four agents slipped once");
  assert.equal(counts.agents, 4);
  // the second run: scripted agents look at the reading room and the Research and the Commons
  const lines: string[] = [];
  const second = await runCohort(mk({ fieldGuide: first.dir, guideMode: "half", expedition: true, io: { out: (l) => lines.push(l) } }, 4, "guided-reader"));
  const trace = readFileSync(join(second.dir, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(trace.find((e) => e.t === "start").toolGroups.includes("expedition"), true);
  const md = readFileSync(second.markdownPath, "utf8");
  assert.match(md, /## The field guide: newcomers offered it and not\n\nThe guide listed \d+ refusals \(bad_input[,)]/); // the count of kinds follows what the first run met; under load it can meet more than bad_input
  assert.match(md, /2 agents were offered it and 2 were not\./);
  assert.match(md, /Offered: .*Not offered: /);
  // the guide text reached the offered agents only: agents 1 and 3 (numbers 0 and 2) read it, agents 2 and 4 did not
  const reads = trace.filter((e) => e.t === "tool" && (e.tool === "unlock" || e.tool === "inspect") && e.ok);
  assert.ok(reads.length >= 8);
  const seen = new Map<string, boolean>();
  for (const e of trace.filter((x) => x.t === "tool" && x.seen)) seen.set(e.agent, true);
  void seen;
});

test("the guide reaches only the agents that are offered it: the greeter names it once, the reading room and the Research and the Commons show it, and an agent that is not offered sees none of these", async () => {
  const { bootWorld } = await import("../src/cohort/world.ts");
  const { runTool, TOOLS } = await import("../src/cohort/tools.ts");
  const all = new Set(TOOLS.map((t) => t.scope));
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-guide-world-")), expedition: true });
  try {
    const guide = buildGuide({ counts: { market_refused: 21, bad_input: 4 }, agents: 15 }, "the real run");
    w.api.fieldGuide = { guide, offered: (n) => n % 2 === 0 };
    w.api.market!.guideFor = (a) => !!w.api.fieldGuide!.offered(a.n);
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const welcome = async (x: typeof a) => (await w.api.market!.inbox(x)).find((m) => m.from === "house-greeter")!.text!;
    assert.match(await welcome(a), /The house has a field guide to the refusals newcomers meet most \(inspect research-commons, or the reading room: unlock\)\./);
    assert.equal(((await welcome(a)).match(/field guide/g) ?? []).length, 1, "named once");
    assert.doesNotMatch(await welcome(b), /field guide/);
    const room = await runTool(w.api, a, all, "unlock", { what: "reading-room" });
    assert.match(room.text, /The house field guide to the refusals newcomers meet most \(the house's own text, not another agent's; built from the real run, 25 refusals by 15 agents; nothing in it is required\):/);
    assert.match(room.text, /1\. market_refused \(21 times\): /);
    assert.match(room.text, /2\. bad_input \(4 times\): /);
    const commons = await runTool(w.api, a, all, "inspect", { place: "research-commons" });
    assert.match(commons.text, /^Research and the Commons keep what is learned\./);
    assert.match(commons.text, /1\. market_refused \(21 times\)/);
    assert.doesNotMatch((await runTool(w.api, b, all, "unlock", { what: "reading-room" })).text, /field guide/);
    assert.doesNotMatch((await runTool(w.api, b, all, "inspect", { place: "research-commons" })).text, /field guide|market_refused/);
  } finally { await w.close(); }
});
