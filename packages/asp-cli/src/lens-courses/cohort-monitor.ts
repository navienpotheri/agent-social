/**
 * The monitoring that goes with the cohort demo (register rows DK752 and DK753): a post-course check on the same held-out cases some simulated days later (a decay and regression check, the Clinic checkup path), a
 * sponsor report for each agent (what it learned, what changed in its memory, what it cost) and the feed file the society map can replay (agents with level, kind, courses taken, lessons learned and standing, and
 * the flows between agents and institutions over simulated days). Pure functions of the story: no clock, no log read beyond the story, so the same story gives the same bytes. No DID, key, sponsor, address or
 * balance is in any of them. Scripted agents on a toy world; the drift the check finds is scripted so the check has something to find: a clean agent must not be flagged. Credits are accounting entries, not money.
 */
import { hero, pageClose, pageOpen } from "@agent-social/asp-log";
import { createHash } from "node:crypto";
import type { Kit } from "./cohort-kit.ts";
import { heldoutScore, type AgentStory, type Story } from "./cohort.ts";
import { overbroadLessons } from "./reflection.ts";

export interface CohortRun { story: Story; k: Kit }
const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const CHECKUP_DAY = 31;
export type Drift = "none" | "memory emptied since the course" | "a broad rule added since the course";
export type Flag = "ok" | "lift lost" | "regressed" | "lift lost and regressed";
export interface CheckupRow { handle: string; level: string; drift: Drift; lift_then: number; lift_now: number; regressions_now: number; flag: Flag }

/** Which agents drift between the course and the check, chosen by a seeded hash of the story: the first passed agent loses its memory, the second gets a broad rule added. */
function driftOf(s: Story): Map<string, Drift> {
  const passed = s.agents.filter((a) => a.written_back).sort((x, y) => sha(`${s.seed}|drift|${x.handle}`).localeCompare(sha(`${s.seed}|drift|${y.handle}`)));
  const m = new Map<string, Drift>();
  if (passed[0]) m.set(passed[0].handle, "memory emptied since the course");
  if (passed[1]) m.set(passed[1].handle, "a broad rule added since the course");
  return m;
}

/** Re-measures every agent that wrote lessons back, on the same held-out cases it was first measured on, and flags a lift that has gone or a regression. */
export function checkupRows(s: Story): CheckupRow[] {
  const drift = driftOf(s);
  return s.agents.filter((a) => a.written_back).map((a): CheckupRow => {
    const d = drift.get(a.handle) ?? "none";
    const memory = d === "memory emptied since the course" ? [] : d === "a broad rule added since the course" ? [...a.lessons, overbroadLessons().lessons[0]] : a.lessons;
    const now = heldoutScore(memory, a.heldout_seed);
    const lossOfLift = now.accuracy - a.before < a.lift / 2, reg = now.regressions > 1;
    return { handle: a.handle, level: a.level, drift: d, lift_then: a.lift, lift_now: now.accuracy - a.before, regressions_now: now.regressions, flag: lossOfLift && reg ? "lift lost and regressed" : lossOfLift ? "lift lost" : reg ? "regressed" : "ok" };
  }).sort((x, y) => x.handle.localeCompare(y.handle));
}

export async function buildCheckup(run: CohortRun) {
  const rows = checkupRows(run.story);
  const flagged = rows.filter((r) => r.flag !== "ok");
  const html = pageOpen({ title: "Post-course check", here: "/society/courses", description: "Re-measuring agents that kept their lessons, on the same held-out cases." })
    + `<h1>Post-course check, day ${CHECKUP_DAY}: ${esc(run.story.title)}</h1><p><small>${esc(run.story.scope)} The drift shown is scripted so the check has something to find.</small></p>`
    + `<p>${rows.length} agents that kept the lessons were measured again on the same held-out cases; ${flagged.length} were flagged (the lift fell below half of what it was, or more than one task that was right without the lessons is now wrong).</p>`
    + `<div class="table-wrap"><table><thead><tr><th>Agent</th><th>Level</th><th>What changed since</th><th>Lift then</th><th>Lift now</th><th>Regressions</th><th>Flag</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.handle)}</td><td>${esc(r.level)}</td><td>${esc(r.drift)}</td><td>${r.lift_then / 10} points</td><td>${r.lift_now / 10} points</td><td>${r.regressions_now}</td><td>${esc(r.flag)}</td></tr>`).join("")}</tbody></table></div>` + pageClose();
  return { day: CHECKUP_DAY, checked: rows.length, flagged: flagged.length, rows, scope: run.story.scope, rule: "flag when the lift is under half of the lift at the sitting, or when more than one task right without the lessons is wrong with them", html };
}

/** What a sponsor reads about one agent: what it learned, what changed in its memory, what it cost. By handle only; the lessons are the course's own scripted text. */
export function sponsorReport(run: CohortRun, handle: string | undefined): { data: Record<string, unknown>; html: string } | undefined {
  const s = run.story;
  const a = s.agents.find((x) => x.handle === handle);
  if (!a) return undefined;
  const memoryHash = a.written_back ? "sha256:" + sha(a.lessons.join("\n")) : null;
  const other = a.other.reduce((n, k) => n + (k === "service" ? 20 : k === "game" ? 10 : 0), 0);
  const check = checkupRows(s).find((r) => r.handle === a.handle) ?? null;
  const data = {
    agent: a.handle, level: a.level, house: a.house, group: a.group, course: a.enrolled ? { id: s.course, title: s.title } : null,
    learned: a.written_back ? a.lessons : [],
    memory_change: a.written_back ? { target: "memory_rules", rules_added: a.lessons.length, through_lesson_gate: true, learning_record: memoryHash } : { target: "memory_rules", rules_added: 0, through_lesson_gate: false, learning_record: null },
    held_out: a.enrolled ? { before: a.before, after: a.after, lift: a.lift, regressions: a.regressions, unit: "held-out accuracy in permille" } : null,
    cost: { tuition: a.paid, other_services: other, unit: "mock credits (accounting entries, not money)" },
    checkup: check ? { day: CHECKUP_DAY, flag: check.flag, lift_now: check.lift_now } : null,
    scope: s.scope,
  };
  const list = (xs: string[]) => (xs.length ? `<ol>${xs.map((x) => `<li><code>${esc(x)}</code></li>`).join("")}</ol>` : "<p>nothing: the memory did not change.</p>");
  const html = pageOpen({ title: `Sponsor report ${a.handle}`, here: "/society/courses", description: "What one agent learned in a course, what changed in its memory and what it cost." })
    + `<h1>Sponsor report: ${esc(a.handle)}${a.house ? " (house agent)" : ""}</h1><p><small>${esc(s.scope)}</small></p>`
    + `<h2>What it learned</h2>${list(data.learned as string[])}`
    + `<h2>What changed</h2><p>${a.written_back ? `${a.lessons.length} rules were added to its memory through the lesson gate, as a learning record on its passport (${esc(memoryHash)}).` : "Nothing in its memory, skills or harness changed."}</p>`
    + `<h2>Held-out result</h2><p>${a.enrolled ? `${a.before / 10}% before, ${a.after / 10}% after (${a.lift >= 0 ? "+" : ""}${a.lift / 10} points); ${a.regressions} tasks it used to get right are now wrong.` : "It did not take the course."}</p>`
    + `<h2>What it cost</h2><p>Tuition ${a.paid} mock credits; other services in the story ${other} mock credits.</p>`
    + `<h2>Post-course check</h2><p>${check ? `Day ${CHECKUP_DAY}: ${esc(check.flag)} (lift now ${check.lift_now / 10} points).` : "Not checked: it kept no lessons."}</p>` + pageClose();
  return { data, html };
}

const PLACES = ["registry", "courts", "treasury", "market", "bank-insurer", "shops", "academy", "clinic", "research-commons", "forum", "leisure-events", "housing"];

/** The feed the map replays: agents (by handle) with level, kind, courses taken, lessons and standing, and the flows between agents and institutions over simulated days. */
export function buildFeed(run: CohortRun) {
  const s = run.story;
  const name = new Map(s.agents.map((a) => [a.id, a.handle] as const));
  const node = (x: string) => name.get(x) ?? x;
  const rows = checkupRows(s);
  const agents = s.agents.map((a: AgentStory) => ({
    id: a.handle, name: a.handle, level: a.level, kind: a.level === "key_only" ? "key-only" : a.level, house: a.house, label: a.house ? "house agent" : null, group: a.group,
    courses: a.enrolled ? [{ id: s.course, state: a.completed ? "completed" : "sat, not passed" }] : [],
    lessons_learned: a.written_back ? a.lessons.length : 0,
    standing: { held_out_before: a.before, held_out_after: a.after, lift: a.lift, checkup: rows.find((r) => r.handle === a.handle)?.flag ?? null },
    state: "active",
  }));
  const flows = [
    ...s.flows.map((f) => ({ day: f.day, kind: f.kind, from: node(f.from), to: node(f.to), label: f.label, ...(f.amount !== undefined ? { amount: f.amount } : {}) })),
    ...rows.map((r) => ({ day: CHECKUP_DAY, kind: "checkup" as const, from: "clinic", to: r.handle, label: `post-course check: ${r.flag}` })),
  ].sort((x, y) => x.day - y.day);
  return { simulated: true, cohort: s.id, course: s.course, note: s.scope, places: PLACES.map((id) => ({ id })), days: { from: 0, to: CHECKUP_DAY }, agents, flows };
}
