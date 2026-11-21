/**
 * `asp journey <agent> [--sponsor-view] [--json] [--html-file <file>] [--follow]` and `asp society tail [--follow]` (register row DK1300): see what an agent did in the society, and what the society is doing now.
 *
 * With ASP_LOG_URL set (a service: `asp enrol` or `asp join` saves the login), the journey is read from the service: the public view from `/agent/<name>/journey`, and with --sponsor-view from
 * `/account/journey/<name>` with the token, which the service gives only to the tenant that owns the agent. Without a service it is built from the local log (there the sponsor view is the machine's own
 * records, with no forum). `--html-file <file>` writes the page on this machine, so the text of a sponsor view never goes through a public address. `--follow` keeps polling and prints only what is new, until
 * stopped (Ctrl-C), or for `--max-polls` polls.
 *
 * `asp society tail` prints what is happening: the latest records as steps of the agents they concern, with the institution (public: no free text). Credits are accounting entries, not money.
 */
import { writeFileSync } from "node:fs";
import { activityOf, journeyOf, type ActivityEvent, type Journey, type StoredRec } from "@agent-social/asp-log";
import { renderJourneyHtml } from "@agent-social/asp-package";

interface Io { out: (l: string) => void; err: (l: string) => void; env: Record<string, string | undefined> }
interface Flags { json?: boolean; "html-file"?: string; follow?: boolean; "sponsor-view"?: boolean; interval?: string; "max-polls"?: string; since?: string }
export class JourneyUsage extends Error {}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const base = (url: string) => (url.endsWith("/") ? url : url + "/");

export function renderJourneyText(j: Journey): string[] {
  const s = j.summary, out: string[] = [];
  out.push(`${j.label ?? j.name}${j.house ? " (house agent)" : ""} (${j.level === "key_only" ? "answers for itself" : j.level}): journey, ${j.view} view`);
  out.push(`  ${j.joined ? `joined ${j.joined.slice(0, 10)}; ` : ""}${s.steps} steps across ${s.institutions_used.length} institution(s): ${s.institutions_used.join(", ") || "none"}${typeof j.balance === "number" ? `; balance ${j.balance} mock credits` : ""}`);
  out.push(`  jobs: posted ${s.jobs.posted}, offered ${s.jobs.offered}, hired for ${s.jobs.performed}, delivered ${s.jobs.delivered}, paid ${s.jobs.accepted}, paid out ${s.jobs.paid_as_principal}, slashed ${s.jobs.slashed}`);
  out.push(`  learning: ${s.learning.courses} course(s), ${s.learning.completions} completed, ${s.learning.certificates} certificate(s), ${s.learning.promotions} promotion(s); games: ${s.games.entered} entered, ${s.games.results} result(s), ${s.games.prizes} prize(s); forum: ${s.forum.posts} post(s), ${s.forum.comments} comment(s)`);
  out.push(`  credits (mock): in ${s.credits.in}, earned ${s.credits.earned}, paid ${s.credits.paid}, spent ${s.credits.spent}, slashed ${s.credits.slashed}; tier ${s.standing.tier ?? "none"}; freezes ${s.standing.freezes}`);
  for (const st of j.steps) {
    out.push(`  ${st.at.slice(0, 16).replace("T", " ")}  [${st.institution}]  ${st.text}${st.with.length ? `  (with ${st.with.join(", ")})` : ""}`);
    if (st.detail) for (const line of st.detail.split("\n")) out.push(`      | ${line}`);
  }
  out.push("  not recorded:");
  for (const n of j.not_recorded) out.push(`    - ${n}`);
  out.push(`  ${j.note}`);
  return out;
}

async function getJson(url: string, token?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

async function load(name: string, v: Flags, io: Io, local: () => Promise<StoredRec[]>): Promise<Journey> {
  const view = v["sponsor-view"] ? "sponsor" : "public";
  const url = io.env.ASP_LOG_URL, token = io.env.ASP_LOG_TOKEN;
  if (url) {
    if (view === "sponsor" && !token) throw new JourneyUsage("the sponsor view needs your token: set ASP_LOG_TOKEN (the login `asp enrol` or `asp join` saves), or leave out --sponsor-view for the public view");
    const path = view === "sponsor" ? `account/journey/${encodeURIComponent(name)}` : `agent/${encodeURIComponent(name)}/journey?format=json`;
    const r = await getJson(new URL(path, base(url)).toString(), token);
    if (r.status === 404) throw new JourneyUsage(`no agent named ${name} in the log at ${url}`);
    if (r.status === 403) throw new JourneyUsage(r.body?.error?.message ?? "the sponsor view is for the tenant that owns this agent");
    if (r.status !== 200 || !r.body?.ok) throw new Error(r.body?.error?.message ?? `the service answered ${r.status}`);
    const { ok: _ok, ...j } = r.body;
    return j as Journey;
  }
  const stored = await local();
  const j = journeyOf({ stored, now: new Date().toISOString() }, name, view);
  if (!j) throw new JourneyUsage(`no agent named ${name} in the local log; set ASP_LOG_URL to read a service`);
  return j;
}

export async function journeyCommand(name: string | undefined, v: Flags, io: Io, local: () => Promise<StoredRec[]>): Promise<number> {
  if (!name) throw new JourneyUsage("asp journey <agent name or did> [--sponsor-view] [--json] [--html-file <file>] [--follow [--interval <seconds>] [--max-polls <n>]]");
  let j = await load(name, v, io, local);
  if (v["html-file"]) { writeFileSync(v["html-file"], renderJourneyHtml(j)); io.out(`wrote ${v["html-file"]} (${j.view} view, ${j.summary.steps} steps)`); }
  if (v.json) io.out(JSON.stringify(j, null, 2));
  else if (!v["html-file"]) for (const l of renderJourneyText(j)) io.out(l);
  if (!v.follow) return 0;
  const seen = new Set(j.steps.map((s) => s.id));
  const every = Math.max(0, Number(v.interval ?? "5")) * 1000, max = v["max-polls"] ? Number(v["max-polls"]) : Infinity;
  for (let n = 0; n < max; n++) {
    await sleep(every);
    j = await load(name, v, io, local);
    for (const st of j.steps) {
      if (seen.has(st.id)) continue;
      seen.add(st.id);
      io.out(`  ${st.at.slice(0, 16).replace("T", " ")}  [${st.institution}]  ${st.text}${st.with.length ? `  (with ${st.with.join(", ")})` : ""}`);
      if (st.detail) for (const line of st.detail.split("\n")) io.out(`      | ${line}`);
    }
  }
  return 0;
}

const line = (e: ActivityEvent) => `${String(e.seq).padStart(6)}  ${e.at.slice(0, 19).replace("T", " ")}  [${e.institution}]  ${e.text}`;

export async function tailCommand(v: Flags, io: Io, local: () => Promise<StoredRec[]>): Promise<number> {
  const url = io.env.ASP_LOG_URL;
  let since = v.since ? Number(v.since) : 0;
  if (!Number.isInteger(since) || since < 0) throw new JourneyUsage("--since is a log sequence number (0 or more)");
  const poll = async (): Promise<{ head: number; events: ActivityEvent[] }> => {
    if (url) {
      const r = await getJson(new URL(`society/activity?since=${since}&limit=200&format=json`, base(url)).toString());
      if (r.status !== 200 || !r.body?.ok) throw new Error(r.body?.error?.message ?? `the service answered ${r.status}`);
      return { head: r.body.head as number, events: r.body.events as ActivityEvent[] };
    }
    return activityOf({ stored: await local() }, since, 200);
  };
  const first = await poll();
  if (v.json) io.out(JSON.stringify(first, null, 2)); else for (const e of first.events) io.out(line(e));
  if (first.events.length) since = first.events[first.events.length - 1]!.seq;
  if (!v.follow) return 0;
  const every = Math.max(0, Number(v.interval ?? "3")) * 1000, max = v["max-polls"] ? Number(v["max-polls"]) : Infinity;
  for (let n = 0; n < max; n++) {
    await sleep(every);
    const r = await poll();
    for (const e of r.events) io.out(line(e));
    if (r.events.length) since = r.events[r.events.length - 1]!.seq;
  }
  return 0;
}
