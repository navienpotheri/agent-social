// Row DK1801, after the owner's first real runs: the report says what the agents were offered and saw, quotes their own reasons for stopping, says "was" for one agent, prints per-hour figures only for a run of a minute or more,
// says which write tools an agent that only read was offered, and computes "what this run cannot tell you" from the tool set of the run instead of a fixed sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, renderReport } from "../src/cohort/observe.ts";
import { seenOf, TOOLS } from "../src/cohort/tools.ts";
import type { TraceEvent } from "../src/cohort/types.ts";

const T0 = Date.parse("2026-11-22T10:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const base = { institution: "forum", scope: "read.forum", writes: false, chars: 10, ms: 1 };

function events(opts: { tools: string[]; seconds: number; agents?: number; stopWhy?: string }): TraceEvent[] {
  const n = opts.agents ?? 1;
  const ev: TraceEvent[] = [{ t: "start", at: at(0), run: "r", model: "claude-haiku-5-5", provider: "anthropic", agents: n, capUsdPerAgent: 0.4, capUsdTotal: 0.4 * n, minutes: 5, tools: opts.tools, briefingSha256: "ab".repeat(32) }];
  for (let i = 1; i <= n; i++) {
    const id = `a${i}`;
    ev.push({ t: "agent", at: at(0), agent: id, did: `did:key:z${i}`, handle: `agent-0${i}` });
    ev.push({ t: "model", at: at(1), agent: id, turn: 1, input: 6000, output: 150, usd: 0.011 });
    ev.push({ t: "tool", at: at(1), agent: id, turn: 1, tool: "look_jobs", input: {}, ok: true, ...base, institution: "market", seen: "3 jobs on the board" });
    ev.push({ t: "tool", at: at(2), agent: id, turn: 1, tool: "forum_read", input: {}, ok: true, ...base, seen: "2 forum posts" });
    ev.push({ t: "tool", at: at(opts.seconds), agent: id, turn: 2, tool: "stop_exploring", input: { why: opts.stopWhy ?? "The society is quiet: nothing here I can do honestly." }, ok: true, ...base, institution: "none", scope: "rest" });
    ev.push({ t: "end", at: at(opts.seconds), agent: id, reason: "finished: the agent chose to stop", turns: 2, usd: 0.022 });
  }
  return ev;
}
const NAMES = TOOLS.map((t) => t.name);

test("the report says 'was' for one agent, quotes the agent's own reason for stopping, and lists what the agent saw and was offered", () => {
  const md = renderReport(analyse(events({ tools: NAMES, seconds: 4 }))).markdown;
  assert.match(md, /1 agent of one model \(`claude-haiku-5-5`, through `anthropic`\) was put in/);
  const two = renderReport(analyse(events({ tools: NAMES, seconds: 4, agents: 2 }))).markdown;
  assert.match(two, /2 agents of one model .* were put in/);
  assert.match(md, /## Why they stopped, in their own words/);
  assert.match(md, /- agent-01 \(finished: the agent chose to stop\): "The society is quiet: nothing here I can do honestly\."/);
  assert.match(md, /## What the agents saw/);
  assert.match(md, new RegExp(`SHA-256 ${"ab".repeat(32)}\\) and was offered ${NAMES.length} tools: ${NAMES[0]}`));
  assert.match(md, /- agent-01 read: look_jobs \(3 jobs on the board\); forum_read \(2 forum posts\)\./);
});

test("per-hour figures are printed only for a run of at least a minute; a run of seconds says it is too short for a rate", () => {
  const short = analyse(events({ tools: NAMES, seconds: 5 }));
  assert.equal(short.tokensPerAgentHour, null);
  assert.equal(short.usdPerAgentHour, null);
  assert.match(renderReport(short).markdown, /run too short for a rate \| run too short for a rate/);
  const long = analyse(events({ tools: NAMES, seconds: 120 }));
  assert.equal(long.tokensPerAgentHour, Math.round(6150 / (120 / 3600)));
  assert.ok(long.usdPerAgentHour! > 0);
  assert.doesNotMatch(renderReport(long).markdown, /too short for a rate/);
});

test("an agent that only read is said to have been offered the tools that write and act, and to have used none", () => {
  const md = renderReport(analyse(events({ tools: NAMES, seconds: 4 }))).markdown;
  assert.match(md, /It only read and never wrote\. It was offered \d+ tools? that write or act \(forum_post, forum_comment, forum_vote, post_job/);
  assert.match(md, /used none of them, so this is an agent that read and then stopped/);
});

test("what this run cannot tell you is computed from the tool set: a set with no Market, Academy or messages says so by name, and a full set does not", () => {
  const small = renderReport(analyse(events({ tools: ["look_map", "forum_read", "stop_exploring"], seconds: 4 }))).markdown;
  assert.match(small, /Anything about the Market, the Academy, direct messages: the tool set of this run had no tool for them\./);
  const full = renderReport(analyse(events({ tools: NAMES, seconds: 4 }))).markdown;
  assert.doesNotMatch(full, /Anything about the Market/);
  assert.match(full, /The tool set had tools for the forum, the Market, the Academy and direct messages/);
  const none = renderReport(analyse(events({ tools: [], seconds: 4 }))).markdown;
  assert.match(none, /the trace does not record the tool set/);
});

test("what a read returned is summarised as counts for the report, and anything else is left unsaid", () => {
  assert.equal(seenOf("look_jobs", JSON.stringify({ ok: true, result: [{}, {}, {}] })), "3 jobs on the board");
  assert.equal(seenOf("look_jobs", JSON.stringify({ ok: true, result: [{}] })), "1 job on the board");
  assert.equal(seenOf("forum_read", JSON.stringify({ posts: [{}, {}] })), "2 forum posts");
  assert.equal(seenOf("look_map", JSON.stringify({ ok: true, feed: { agents: [{}, {}], places: [{}] } })), "2 agents and 1 places on the map");
  assert.equal(seenOf("forum_replies", JSON.stringify({ replies: [] })), "0 replies to its own acts");
  assert.equal(seenOf("look_charters", "{}"), undefined);
  assert.equal(seenOf("look_jobs", "not json"), undefined);
});
