/**
 * The public cohort pages (register row DK751): `GET /society/cohorts` and `GET /society/cohorts/<id>` (and, from DK752 and DK753, `/checkup`, `/agents/<handle>` and `/feed.json` under it), open to anyone, no token,
 * deterministic: the same bytes on every request, computed from the demo story of `cohort.ts` (a fixed seed) and nothing else. They carry no private field and no free text: agents are shown by their handle (s01 to
 * s24), their level and their group; the reason a sitting failed is one of a fixed list; no DID, key, sponsor, balance, address or lesson text appears on the dashboard. HTML by default, JSON with `?format=json` or
 * `Accept: application/json`. Scripted agents on a toy world, no real model, credits are accounting entries, not money, nothing changes model weights.
 */
import { emptyState, hero, shell, shortNameHtml } from "@agent-social/asp-log";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runCohortWithLog, type AgentStory, type Story } from "./cohort.ts";
import { buildCheckup, buildFeed, sponsorReport, type CohortRun } from "./cohort-monitor.ts";

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const DEMO_SEED = "demo";

let demo: Promise<CohortRun> | undefined;
/** The one demo cohort, run once per process: the run is deterministic, so every request sees the same story. */
export function demoRun(): Promise<CohortRun> { return (demo ??= runCohortWithLog({ seed: DEMO_SEED }).then(({ story, k }) => ({ story, k }))); }

/** Why a sitting did not pass, as one of a fixed list: never the text of a lesson or of a failure message. */
export function reasonOf(a: AgentStory): string {
  if (!a.enrolled) return "not enrolled";
  if (a.passed && a.written_back) return "passed and written back";
  const f = a.failures.join(" ");
  if (/held-out tasks: it has seen them|a service of the held-out/.test(f)) return "used a held-out case";
  if (/a lesson is `when|no lesson was written|lesson \d+:/.test(f)) return "not written as rules";
  if (/too broad|broken that was right/.test(f)) return "rules too broad";
  if (/right on/.test(f)) return "below the held-out mark";
  return a.passed ? "refused by the lesson gate" : "not passed";
}

/** The public view of a story: only the fields named here are copied (a whitelist, never a filter). */
export function dashboardView(s: Story) {
  const row = (a: AgentStory) => ({ handle: a.handle, level: a.level, house: a.house, group: a.group, result: reasonOf(a), before: a.before, after: a.after, lift: a.lift, regressions: a.regressions });
  return {
    id: s.id, course: s.course, title: s.title, price: s.price, scope: s.scope,
    completion: { cohort: s.summary.cohort, completed: s.summary.completed, passed: s.summary.passed, pass_rate_permille: s.summary.pass_rate_permille },
    held_out: { cohort_before: s.summary.before_cohort, cohort_after: s.summary.after_cohort, control_before: s.summary.before_control, control_after: s.summary.after_control, unit: "held-out accuracy in permille (1000 is every held-out case right)" },
    lift: s.summary.lift, regressions: s.summary.regressions, tuition: s.summary.tuition, cost_per_point_of_lift: s.summary.cost_per_point,
    agents: s.agents.map(row),
  };
}

const page = (title: string, body: string) => shell({ title, body, here: "/society/courses", description: "A cohort of agents took a course; this is what changed, measured on held-out cases." });

export function dashboardHtml(s: Story): string {
  const v = dashboardView(s);
  const t = v.lift;
  const rows = v.agents.map((a) => `<tr><td>${shortNameHtml(a.handle)}${a.house ? " <small>(house agent)</small>" : ""}</td><td>${esc(a.level)}</td><td>${esc(a.group)}</td><td>${esc(a.result)}</td><td class="num">${a.before / 10}%</td><td class="num">${a.after / 10}%</td><td class="num">${a.lift >= 0 ? "+" : ""}${a.lift / 10} points</td></tr>`).join("");
  const lift = (n: number) => `${n >= 0 ? "+" : ""}${n / 10}`;
  return page(`Cohort ${v.id}`,
    hero({ kicker: "Cohort", title: v.title, badges: [v.id, `${v.price} mock credits a place`], sub: v.scope, tiles: [{ label: "enrolled", value: v.completion.cohort }, { label: "completed", value: v.completion.completed }, { label: "pass rate", value: `${v.completion.pass_rate_permille / 10}%` }, { label: "held-out after", value: `${v.held_out.cohort_after / 10}%` }, { label: "lift (points)", value: lift(t.mean_lift_cohort) }] })
    + `<h2>Completion</h2><p>${v.completion.completed} of ${v.completion.cohort} completed the course (pass rate ${v.completion.pass_rate_permille / 10}%); the control of ${t.n_control} agents did not take it. Tuition ${v.price} mock credits each.</p>`
    + `<h2>Held-out score, before and after</h2><p>Cohort: ${v.held_out.cohort_before / 10}% before, ${v.held_out.cohort_after / 10}% after. Control: ${v.held_out.control_before / 10}% before, ${v.held_out.control_after / 10}% after. Both are measured on held-out cases the agents were never shown.</p>`
    + `<h2>Lift</h2><p>Mean held-out change: cohort ${t.mean_lift_cohort / 10} points, control ${t.mean_lift_control / 10} points; difference ${t.difference / 10} points (standard error ${t.se / 10}, t = ${t.t}). Method: ${esc(t.method)}. Tasks that were right without the lessons and wrong with them: ${v.regressions}. Cost per point of lift: ${v.cost_per_point_of_lift === null ? "not defined (no lift)" : `${v.cost_per_point_of_lift} mock credits`}.</p>`
    + `<h2>Agents</h2>${v.agents.length ? `<div class="table-wrap"><table><thead><tr><th>Agent</th><th>Level</th><th>Group</th><th>Result</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No agents yet", "A cohort lists its agents once they enrol.")}`
    + `<p><a href="/society/cohorts/${esc(v.id)}/checkup">post-course check</a> &middot; <a href="/society/cohorts/${esc(v.id)}/feed.json">map feed</a></p>`);
}

const send = (req: IncomingMessage, res: ServerResponse, type: string, body: string) => { res.writeHead(200, { "content-type": type, "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" }); res.end(req.method === "HEAD" ? undefined : body); };

export function cohortRoutes() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^\/society\/cohorts(?:\/([^/]+)(?:\/(checkup|feed\.json|agents\/([a-z0-9]+)))?)?\/?$/.exec(url.pathname);
    if (!m) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const wantsJson = url.searchParams.get("format") === "json" || (req.headers.accept ?? "").includes("application/json");
    const run = await demoRun();
    const s = run.story;
    if (!m[1]) {
      const list = [{ id: s.id, alias: DEMO_SEED, course: s.course, title: s.title, cohort: s.summary.cohort, control: s.summary.control }];
      if (wantsJson) send(req, res, "application/json", JSON.stringify({ ok: true, cohorts: list, scope: s.scope }));
      else send(req, res, "text/html; charset=utf-8", page("Cohorts", `<h1>Cohorts</h1><p><small>${esc(s.scope)}</small></p><ul>${list.map((c) => `<li><a href="/society/cohorts/${esc(c.id)}">${esc(c.id)}</a> (also <a href="/society/cohorts/${DEMO_SEED}">${DEMO_SEED}</a>): ${esc(c.title)}, ${c.cohort} agents in the cohort and ${c.control} in the control</li>`).join("")}</ul>`));
      return true;
    }
    if (m[1] !== s.id && m[1] !== DEMO_SEED) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "no such cohort" } })); return true; }
    if (!m[2]) { if (wantsJson) send(req, res, "application/json", JSON.stringify({ ok: true, cohort: dashboardView(s) })); else send(req, res, "text/html; charset=utf-8", dashboardHtml(s)); return true; }
    if (m[2] === "checkup") { const c = await buildCheckup(run); if (wantsJson) send(req, res, "application/json", JSON.stringify({ ok: true, checkup: c })); else send(req, res, "text/html; charset=utf-8", c.html); return true; }
    if (m[2] === "feed.json") { send(req, res, "application/json", JSON.stringify(buildFeed(run))); return true; }
    const r = sponsorReport(run, m[3]);
    if (!r) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "no such agent in this cohort" } })); return true; }
    if (wantsJson) send(req, res, "application/json", JSON.stringify({ ok: true, report: r.data })); else send(req, res, "text/html; charset=utf-8", r.html);
    return true;
  };
}
