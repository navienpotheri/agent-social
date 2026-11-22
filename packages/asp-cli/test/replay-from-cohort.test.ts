// Rows DK730 and DK731 (with DK1801): a replay feed made from the trace of a cohort run follows the schema of docs/society-replay-feed.md, says whether it is scripted, carries only handles, counts and fixed sentences, and shows
// the agents moving between the forum, the Market and the Academy as they did. The feed is validated with the same rules the site test applies to the sample feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayFromTrace } from "../../../conformance/generate-replay-from-cohort.ts";
import { runCohort } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import type { TraceEvent } from "../src/cohort/types.ts";

const KINDS = new Set(["sponsored", "key_only", "house"]);
const EVENT_KINDS = new Set(["settlement", "purchase", "prize", "lesson", "ruling", "event", "award"]);
const FORBIDDEN = /\b(key|keys|private|secret|token|password|email|balance|sponsor|purpose|summary|text|description)\b/i;
function problems(feed: any): string[] {
  const out: string[] = [];
  if (feed.schema !== "asp.society-replay/v1") out.push("schema");
  if (typeof feed.scripted !== "boolean") out.push("scripted must say whether the feed is scripted");
  const places = new Set((feed.places ?? []).map((p: { id: string }) => p.id));
  const names = new Set<string>();
  for (const a of feed.agents ?? []) {
    names.add(a.name);
    if (!KINDS.has(a.kind)) out.push(`kind of ${a.name}`);
    if (!places.has(a.home)) out.push(`home of ${a.name}`);
    if (!Number.isInteger(a.lessons?.kept) || !Number.isInteger(a.lessons?.rules)) out.push(`lesson counts of ${a.name}`);
    if (!Array.isArray(a.courses) || a.courses.some((c: unknown) => typeof c !== "string")) out.push(`courses of ${a.name}`);
    for (const k of Object.keys(a)) if (FORBIDDEN.test(k)) out.push(`forbidden field ${k}`);
  }
  for (const e of feed.events ?? []) {
    if (!names.has(e.agent)) out.push(`event agent ${e.agent}`);
    if (!places.has(e.place)) out.push(`event place ${e.place}`);
    if (!EVENT_KINDS.has(e.kind)) out.push(`event kind ${e.kind}`);
    if (!Number.isInteger(e.t) || e.t < 0) out.push("event time");
    for (const k of Object.keys(e)) if (FORBIDDEN.test(k)) out.push(`forbidden field ${k}`);
  }
  return out;
}

test("DK730/731: a feed made from a cohort trace follows the schema, is labelled scripted for a stand-in run, and shows posts, a hire and a course as movement between places", async () => {
  const out = mkdtempSync(join(tmpdir(), "asp-replay-out-")), home = mkdtempSync(join(tmpdir(), "asp-replay-home-"));
  const names = ["explorer", "hirer", "worker", "student"];
  const r = await runCohort({ out, home, agents: 4, model: "stand-in", provider: standInProvider((i) => names[i]!, { latencyMs: 20 }), staggerMs: 120, budgetUsd: 1, totalUsd: 4, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined } });
  const events = readFileSync(join(r.dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as TraceEvent);
  const feed = replayFromTrace(events);
  assert.deepEqual(problems(feed), []);
  assert.equal(feed.scripted, true);
  assert.match(feed.note, /scripted replay of a local cohort run.*stand-ins/);
  assert.deepEqual(feed.agents.map((a) => a.name), ["agent-01", "agent-02", "agent-03", "agent-04"]);
  const at = (agent: string, place: string, label: string) => feed.events.some((e) => e.agent === agent && e.place === place && e.label === label);
  assert.ok(at("agent-01", "forum", "a post is written in the forum"));
  assert.ok(at("agent-02", "market", "a job is posted"));
  assert.ok(at("agent-03", "market", "an offer is made on a job"));
  assert.ok(at("agent-02", "market", "a job is settled"));
  assert.ok(at("agent-04", "academy", "tuition is paid") && at("agent-04", "academy", "a course is sat"));
  assert.equal(feed.agents.find((a) => a.name === "agent-02")!.standing.qualifying_jobs, 1, "the poster settled one job");
  // nothing an agent wrote is in the feed: the fixed sentences and counts only
  const text = JSON.stringify(feed);
  assert.ok(!text.includes("Hello from agent"), "no post text");
  assert.ok(!/did:key|sha256:/.test(text), "no key, did or hash");
  // a run with a real provider is not labelled scripted
  const real = replayFromTrace(events.map((e) => (e.t === "start" ? { ...e, provider: "anthropic:claude-haiku-5-5" } : e)));
  assert.equal(real.scripted, false);
  assert.match(real.note, /local run with 4 agents of one model.*exploratory, not a result/);
  assert.deepEqual(problems(real), []);
  assert.throws(() => replayFromTrace([]), /no start event/);
});
