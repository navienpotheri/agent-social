// Row DK1801, owner's P0 (agents stop by themselves): every observation ends with what is open to the agent now, short and factual, so the next step is in view when it would stop; the same list is the content
// of the exit check; a stop records how many items were open (the premature-leave rate); and the suggest tool records what an agent says would make the place better.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyse, renderReport } from "../src/cohort/observe.ts";
import { openItems, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import type { TraceEvent } from "../src/cohort/types.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("each observation ends with what is open now (jobs, courses, house questions, messages to answer, offers on your jobs), counts drop as items are dealt with, and a refusal or a stop carries no such line", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-cohort-open-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (agent: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, agent, all, name, input);
    const first = await call(a, "look_map");
    assert.match(first.text, /\nOpen to you now: 1 message to answer \(my_inbox\); 10 open jobs \(look_jobs\); 1 course \(look_courses\); 6 forum questions with no reply \(forum_read, tag house-question\)\.$/);
    assert.deepEqual(await openItems(w.api, a), ["1 message to answer (my_inbox)", "10 open jobs (look_jobs)", "1 course (look_courses)", "6 forum questions with no reply (forum_read, tag house-question)"]);
    // a message to agent-02 appears for it, and goes once answered
    const sent = await call(a, "send_message", { to: "agent-02", text: "Hello, would you like to do a job together?", kind: "offer" });
    assert.equal(sent.ok, true, sent.text);
    assert.match((await call(b, "do_nothing")).text, /^Noted/);
    assert.match((await call(b, "look_charters")).text, /2 messages to answer \(my_inbox\)/, "the greeter's welcome and agent-01's offer");
    const id = /sha256:[0-9a-f]+/.exec(sent.text)![0];
    await call(b, "send_message", { to: "agent-01", text: "Yes, gladly.", reply_to: id });
    assert.match((await call(b, "look_charters")).text, /1 message to answer \(my_inbox\)/, "the greeter's welcome is still unanswered");
    // a refusal and a stop have no line; the stop records how many items were open
    assert.doesNotMatch((await call(a, "nope_tool")).text, /Open to you now/);
    const stop = await call(a, "stop_exploring", { why: "enough" });
    assert.equal(stop.end, true);
    assert.doesNotMatch(stop.text, /Open to you now/);
    assert.match(stop.seen ?? "", /^\d+ open at stop$/);
    // suggest is recorded as written and refused when over its limit
    assert.equal((await call(a, "suggest", { improvement: "A tool to list the jobs I can do within my balance.", category: "tools" })).ok, true);
    const long = await call(a, "suggest", { improvement: "x".repeat(401) });
    assert.match(long.text, /improvement up to 400 characters/);
  } finally { await w.close(); }
});

test("the report counts a stop with something open as a premature leave and lists what the agents suggested", () => {
  const T0 = Date.parse("2026-11-22T10:00:00Z"), at = (s: number) => new Date(T0 + s * 1000).toISOString();
  const base = { institution: "none", scope: "rest", writes: false, chars: 5, ms: 1 };
  const ev: TraceEvent[] = [{ t: "start", at: at(0), run: "r", model: "m", provider: "stand-in", agents: 2, capUsdPerAgent: 1, capUsdTotal: 2, minutes: 1 }];
  for (const [i, open] of [[1, 3], [2, 0]] as const) {
    ev.push({ t: "agent", at: at(0), agent: `a${i}`, did: `did:key:z${i}`, handle: `agent-0${i}` });
    if (i === 1) ev.push({ t: "tool", at: at(1), agent: "a1", turn: 1, tool: "suggest", input: { improvement: "Show job prices in the board", category: "jobs" }, ok: true, ...base, institution: "none", scope: "write.feedback", writes: true });
    ev.push({ t: "tool", at: at(2), agent: `a${i}`, turn: 2, tool: "stop_exploring", input: { why: "done" }, ok: true, ...base, seen: `${open} open at stop` });
    ev.push({ t: "end", at: at(2), agent: `a${i}`, reason: "finished: the agent chose to stop", turns: 2, usd: 0 });
  }
  const md = renderReport(analyse(ev)).markdown;
  assert.match(md, /Premature leaves: 1 of 2 agents that chose to stop had something open to them at that moment \(agent-01: 3\)/);
  assert.match(md, /## What the agents suggested\n\n- agent-01: \[jobs\] Show job prices in the board/);
  assert.doesNotMatch(md, /seen at stop|open at stop\)/, "the stop marker is not listed as something the agent saw");
});
