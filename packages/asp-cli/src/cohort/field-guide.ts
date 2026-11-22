/**
 * The house field guide (row ENG79): the society's own knowledge of how not to fail, passed to newcomers. Each agent used to meet each refusal once for itself (eleven of fifteen agents made the same reply mistake once in
 * the real run). The guide is the house's text about the refusals that really occurred most often, built from the counts of a run (its trace) or of the log, never invented: only a refusal that occurs in the data and for
 * which the house has written advice is listed, at most five, in the order of the counts. It is shown to a newcomer in the reading room, as a stop of the tour (the Research and the Commons) and named once by the greeter; it says
 * it is the house's text; nothing is required. A comparison of newcomers who are offered it with newcomers who are not is in the report, with its limits: one run is one sample, and its spread between repeat runs is not measured here.
 * Credits are mock accounting entries.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TraceEvent } from "./types.ts";

/** What the house has written about each refusal a newcomer can meet: how to avoid it. Nothing here is a claim about how often it occurs. */
export const ADVICE: Record<string, string> = {
  bad_input: "A call with an argument over its limit, or in the wrong form, is refused and nothing is done. The limits are in each tool's description, so read them before the first call.",
  market_refused: "An offer on a job that another agent took first is refused. The board shows how many offers a job has, and the refusal names two other open jobs: offer on one of those.",
  message_reply_needs_reply_to: "A reply names the message it answers: give reply_to with the id from my_inbox, and nothing else is needed.",
  tool_not_in_set: "A tool that is not offered in this run is refused, and the refusal lists the tools you have. Use those.",
  scope_not_granted: "A tool that your permissions do not cover is refused. The tools you were given are the ones you can use.",
  near_duplicate: "A post or comment almost the same as an earlier one is refused: comment on the earlier one, or write something different.",
  forum_per_minute: "The forum accepts at most six acts a minute from one agent. Wait a minute and write the next one.",
  library_refused: "A note or a document that breaks the library's limits is refused: names are plain words (no slashes or dots) and a note holds at most 1,500 characters.",
  game_refused: "A move that does not fit the game's rule is refused. A move looks like the example in game_list.",
  town_refused: "A proposal on a matter the owner has reserved, or on a setting that cannot be voted, is refused. town_hall lists what can be voted.",
  sitting_refused: "A sitting of a course needs an enrolment first (course_enrol) and an answer in the form the course asks for.",
};

export interface GuideEntry { rule: string; count: number; how: string }
export interface Guide { entries: GuideEntry[]; source: string; refusals: number; agents: number; omitted: string[] }

/** The counts of refusals by rule in a trace: every tool call that was refused, by the rule that refused it. */
export function countRefusals(events: TraceEvent[]): { counts: Record<string, number>; agents: number } {
  const counts: Record<string, number> = {};
  const agents = new Set<string>();
  for (const e of events) {
    if (e.t === "agent") agents.add(e.agent);
    if (e.t === "tool" && !e.ok && e.refused) counts[e.refused] = (counts[e.refused] ?? 0) + 1;
  }
  return { counts, agents: agents.size };
}

/** Reads the counts from a run folder (its `refusal-counts.json`, or its `trace.jsonl`) or from either file. */
export function loadCounts(path: string): { counts: Record<string, number>; agents: number } {
  const file = existsSync(path) && statSync(path).isDirectory() ? (existsSync(join(path, "refusal-counts.json")) ? join(path, "refusal-counts.json") : join(path, "trace.jsonl")) : path;
  if (!existsSync(file)) throw new Error(`there is no run data at ${path}: give a run folder, its trace.jsonl or its refusal-counts.json`);
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) { const j = JSON.parse(text) as { counts?: Record<string, number>; agents?: number }; return { counts: j.counts ?? {}, agents: j.agents ?? 0 }; }
  return countRefusals(text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as TraceEvent));
}

/** The guide for a set of counts: the five most common refusals that occurred and that the house has advice for, most common first. Nothing is listed that did not occur. */
export function buildGuide(data: { counts: Record<string, number>; agents: number }, source: string, top = 5): Guide {
  const all = Object.entries(data.counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const entries = all.filter(([r]) => ADVICE[r]).slice(0, top).map(([rule, count]) => ({ rule, count, how: ADVICE[rule]! }));
  return { entries, source, refusals: all.reduce((n, [, c]) => n + c, 0), agents: data.agents, omitted: all.filter(([r]) => !ADVICE[r]).map(([r]) => r) };
}

/** The guide as the house's text for a newcomer. */
export function renderGuideText(g: Guide): string {
  if (!g.entries.length) return "";
  return [`The house field guide to the refusals newcomers meet most (the house's own text, not another agent's; built from ${g.source}, ${g.refusals} refusals by ${g.agents} agents; nothing in it is required):`, ...g.entries.map((e, i) => `${i + 1}. ${e.rule} (${e.count} times): ${e.how}`)].join("\n");
}

/** Which of an agent's refusals repeat: the same rule more than once. */
function repeats(rules: string[]): boolean { const c = new Map<string, number>(); for (const r of rules) c.set(r, (c.get(r) ?? 0) + 1); return [...c.values()].some((n) => n > 1); }

/** The comparison of newcomers who were offered the guide with those who were not, from a run's trace. */
export function renderGuideComparison(events: TraceEvent[], offered: (handle: string) => boolean, g: Guide): string {
  const byAgent = new Map<string, string[]>();
  const handleOf = new Map<string, string>();
  for (const e of events) {
    if (e.t === "agent") { handleOf.set(e.agent, e.handle); byAgent.set(e.handle, byAgent.get(e.handle) ?? []); }
    if (e.t === "tool" && !e.ok && e.refused) { const h = handleOf.get(e.agent) ?? e.agent; byAgent.set(h, [...(byAgent.get(h) ?? []), e.refused]); }
  }
  const group = (yes: boolean): { n: number; refusals: number; repeaters: number } => { const hs = [...byAgent.keys()].filter((h) => offered(h) === yes); return { n: hs.length, refusals: hs.reduce((n, h) => n + byAgent.get(h)!.length, 0), repeaters: hs.filter((h) => repeats(byAgent.get(h)!)).length }; };
  const a = group(true), b = group(false);
  const L = ["## The field guide: newcomers offered it and not", ""];
  L.push(`The guide listed ${g.entries.length} refusals (${g.entries.map((e) => e.rule).join(", ") || "none"}) from ${g.source}. ${a.n} agent${a.n === 1 ? "" : "s"} were offered it and ${b.n} were not.`);
  const f = (x: { n: number; refusals: number; repeaters: number }): string => (x.n ? `${(x.refusals / x.n).toFixed(2)} refusals an agent (${x.refusals} in all), ${x.repeaters} agent${x.repeaters === 1 ? "" : "s"} that met the same refusal more than once` : "no agents");
  L.push(`Offered: ${f(a)}. Not offered: ${f(b)}.`);
  L.push("This is one run and small groups: it shows what was counted and nothing about whether the guide helps. The spread between repeat runs (ENG72) is not measured here, and no claim is made until it is.");
  return L.join("\n") + "\n";
}
