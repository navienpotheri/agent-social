/**
 * `asp monitor check | run | incident` (register row DK1341; spec-delta S1456; docs/incident-runbook.md): the operator's uptime and health monitor, the alerts, and the public status page. It runs on the server (or any machine
 * that can reach the service) from a systemd timer or `asp monitor run`, and it does not depend on the service it watches:
 *   - it asks the service whether it is up (`/health`), whether the credit ledger balances (`/economy/supply`, DK9), whether the society health alarms are quiet (`/society/health`), whether last night's backup is there and
 *     young enough, and whether the company's own compute spending ceiling is near or reached (`asp budget set --agent company`);
 *   - it alerts the operator (a webhook, mail) once when a check has failed for `after` runs in a row, and once when it recovers; an alert that could not be delivered is tried again on the next run, never dropped, and never sent twice;
 *   - it writes the status page as two static files (`status.json`, `status.html`) that the web server (Caddy) serves itself, so the page stays up while the service is down; and the operator's incident log (`incidents.json`)
 *     is shown on it, newest first, in the operator's own words.
 * The page says when it was last written; a page older than ten minutes says the monitor itself has stopped. Credits are accounting entries, not money; the service is a beta; nothing here is an outside security review.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Budgets, DailyCeiling, budgetWarnings } from "@agent-social/asp-package";

export class MonitorUsage extends Error {}

export type Level = "operational" | "degraded" | "major_outage";
export interface CheckResult { id: string; title: string; critical: boolean; ok: boolean; detail: string; ms: number }
export interface MonitorConfig { service: string; fetch?: typeof fetch; backupDir?: string; backupMaxHours?: number; home?: string; now: () => string; timeoutMs?: number }
export const COMPANY = "company";

const esc = (t: string) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function get(c: MonitorConfig, path: string): Promise<{ status: number; json?: any; ms: number }> {
  const f = c.fetch ?? fetch;
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), c.timeoutMs ?? 8000);
  try {
    const r = await f(`${c.service.replace(/\/$/, "")}${path}`, { signal: ctl.signal, headers: { accept: "application/json" } });
    let json: unknown; try { json = await r.json(); } catch { json = undefined; }
    return { status: r.status, json, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

/** Runs every check once. A check that throws is a failed check with the reason, never a crash of the monitor. */
export async function runChecks(c: MonitorConfig): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const check = async (id: string, title: string, critical: boolean, fn: () => Promise<{ ok: boolean; detail: string }>) => {
    const t0 = Date.now();
    try { const r = await fn(); out.push({ id, title, critical, ok: r.ok, detail: r.detail, ms: Date.now() - t0 }); }
    catch (e) { out.push({ id, title, critical, ok: false, detail: `could not check: ${(e as Error).name === "AbortError" ? "no answer in time" : (e as Error).message}`, ms: Date.now() - t0 }); }
  };
  await check("service", "The service answers", true, async () => {
    const r = await get(c, "/health");
    return r.status === 200 && r.json?.ok === true ? { ok: true, detail: `answered in ${r.ms} ms` } : { ok: false, detail: `/health answered ${r.status}${r.json?.ok === true ? "" : " without ok"}` };
  });
  await check("ledger", "The credit ledger balances", true, async () => {
    const r = await get(c, "/economy/supply?format=json");
    if (r.status !== 200) return { ok: false, detail: `/economy/supply answered ${r.status}` };
    return r.json?.verdict === "balanced" ? { ok: true, detail: `balanced: ${r.json.minted} minted` } : { ok: false, detail: `the audit says ${String(r.json?.verdict)}${r.json?.problems ? `: ${[].concat(r.json.problems).slice(0, 3).join("; ")}` : ""}; recompute with asp credits audit --json` };
  });
  await check("society", "The society health alarms are quiet", false, async () => {
    const r = await get(c, "/society/health?format=json");
    if (r.status !== 200) return { ok: false, detail: `/society/health answered ${r.status}` };
    const alarms = (r.json?.report?.alarms ?? []) as { id: string }[];
    return alarms.length ? { ok: false, detail: `${alarms.length} alarm(s) raised: ${alarms.map((a) => a.id).join(", ")}` } : { ok: true, detail: "no alarm" };
  });
  if (c.backupDir) {
    await check("backup", "Last night's backup is there", false, async () => {
      const max = c.backupMaxHours ?? 30;
      if (!existsSync(c.backupDir!)) return { ok: false, detail: `${c.backupDir} does not exist` };
      const files = readdirSync(c.backupDir!).map((f) => ({ f, m: statSync(join(c.backupDir!, f)).mtimeMs })).filter((x) => /\.(sql\.gz|tgz|gz)$/.test(x.f));
      if (!files.length) return { ok: false, detail: `no backup file in ${c.backupDir}` };
      const newest = files.sort((a, b) => b.m - a.m)[0];
      const hours = (Date.parse(c.now()) - newest.m) / 3_600_000;
      return hours <= max ? { ok: true, detail: `${newest.f} is ${hours.toFixed(1)} hours old` } : { ok: false, detail: `the newest backup, ${newest.f}, is ${hours.toFixed(0)} hours old (the limit is ${max})` };
    });
  }
  if (c.home) {
    const b = new Budgets(join(c.home, "budgets.json")).get(COMPANY);
    if (b.dailyTokens !== undefined || b.monthlyTokens !== undefined) {
      await check("spend", "The company's compute spending is under its ceiling", false, async () => {
        const day = c.now().slice(0, 10);
        const ceiling = new DailyCeiling(join(c.home!, "wakes.json"));
        const w = budgetWarnings("the company's house agents", b, { today: ceiling.tokensUsed(COMPANY, day), month: ceiling.monthTokens(COMPANY, day.slice(0, 7)) });
        return w.length ? { ok: false, detail: w.join(" ") } : { ok: true, detail: `${ceiling.monthTokens(COMPANY, day.slice(0, 7))} tokens this month${b.monthlyTokens ? ` of ${b.monthlyTokens}` : ""}` };
      });
    }
  }
  return out;
}

export const levelOf = (rs: CheckResult[]): Level => (rs.some((r) => !r.ok && r.critical) ? "major_outage" : rs.some((r) => !r.ok) ? "degraded" : "operational");

// ---- alerts: once when a check has failed `after` runs in a row, once when it recovers, never lost and never twice ----

export interface CheckState { ok: boolean; failures: number; since: string; /** A down alert was delivered for this failure. */ alerted: boolean; /** When the failure that recovered began (for the recovery alert). */ downSince?: string; /** A recovery alert is owed (the check recovered after a delivered down alert). */ owes: boolean }
/** The month's measure (DK1380): checks made, and checks at which no critical check failed. Availability is the second over the first; the target in the enterprise terms is 99.0 percent a calendar month. */
export interface MonthCount { checks: number; up: number }
export const AVAILABILITY_TARGET_PERCENT = 99.0;
export interface MonitorState { lastRun?: string; checks: Record<string, CheckState>; availability?: Record<string, MonthCount> }
export interface Alert { kind: "down" | "recovered"; id: string; title: string; detail: string; since: string }

/** Moves the state on by one run and says which alerts are due. An alert counts as sent only when `delivered` says so (call it with the alerts that went out). */
export function step(prev: MonitorState, results: CheckResult[], now: string, after: number): { state: MonitorState; due: Alert[] } {
  const next: MonitorState = { lastRun: now, checks: {}, availability: { ...(prev.availability ?? {}) } };
  const month = now.slice(0, 7), m = { ...(next.availability![month] ?? { checks: 0, up: 0 }) };
  m.checks++; if (!results.some((r) => !r.ok && r.critical)) m.up++;
  next.availability![month] = m;
  const due: Alert[] = [];
  for (const r of results) {
    const p = prev.checks[r.id];
    const s: CheckState = p ? { ...p } : { ok: true, failures: 0, since: now, alerted: false, owes: false };
    if (r.ok) {
      if (!s.ok) { s.downSince = s.since; s.since = now; s.failures = 0; if (s.alerted) s.owes = true; s.alerted = false; s.ok = true; }
      if (s.owes) due.push({ kind: "recovered", id: r.id, title: r.title, detail: r.detail, since: s.downSince ?? s.since });
    } else {
      if (s.ok) { s.ok = false; s.since = now; s.failures = 0; s.owes = false; }
      s.failures++;
      if (!s.alerted && s.failures >= after) due.push({ kind: "down", id: r.id, title: r.title, detail: r.detail, since: s.since });
    }
    next.checks[r.id] = s;
  }
  return { state: next, due };
}
/** Marks alerts as delivered in the state: a down alert stops being due, a recovery alert stops being owed. */
export function delivered(state: MonitorState, sent: Alert[]): void {
  for (const a of sent) { const s = state.checks[a.id]; if (!s) continue; if (a.kind === "down") s.alerted = true; else s.owes = false; }
}

// ---- incidents: the operator's own words ----

export interface IncidentUpdate { at: string; status: IncidentStatus; message: string }
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";
export interface Incident { id: string; title: string; opened: string; status: IncidentStatus; resolvedAt?: string; updates: IncidentUpdate[] }
const STATUSES: IncidentStatus[] = ["investigating", "identified", "monitoring", "resolved"];

export function readIncidents(file?: string): Incident[] {
  if (!file || !existsSync(file)) return [];
  try { const j = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(j) ? j : []; } catch { return []; }
}
export function recordIncident(file: string, o: { id?: string; title?: string; status: string; message: string; now: string }): Incident {
  if (!STATUSES.includes(o.status as IncidentStatus)) throw new MonitorUsage(`--status is one of ${STATUSES.join(", ")}`);
  if (!o.message.trim()) throw new MonitorUsage("--message says what happened or what is being done, in words a person can read");
  if (o.message.length > 1000) throw new MonitorUsage("--message is at most 1000 characters");
  const all = readIncidents(file);
  let inc = o.id ? all.find((i) => i.id === o.id) : undefined;
  if (o.id && !inc) throw new MonitorUsage(`no incident ${o.id} in ${file}`);
  if (!inc) {
    if (!o.title?.trim()) throw new MonitorUsage("a new incident needs --title");
    inc = { id: `inc-${o.now.slice(0, 10).replace(/-/g, "")}-${all.length + 1}`, title: o.title.trim().slice(0, 140), opened: o.now, status: o.status as IncidentStatus, updates: [] };
    all.push(inc);
  }
  inc.status = o.status as IncidentStatus;
  if (inc.status === "resolved") inc.resolvedAt = o.now; else delete inc.resolvedAt;
  inc.updates.push({ at: o.now, status: inc.status, message: o.message.trim() });
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.part`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n"); renameSync(tmp, file);
  return inc;
}

// ---- the status page ----

const LEVEL_WORDS: Record<Level, string> = { operational: "All systems operational", degraded: "Partly degraded", major_outage: "Major outage" };
export const STALE_MINUTES = 10;

/** The availability the page states: this month and earlier months, from the monitor's own checks (a measure of what the monitor saw, not of every minute: it is as fine as its interval). */
export function availabilityOf(counts: Record<string, MonthCount> | undefined, now: string) {
  const months = Object.entries(counts ?? {}).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 6).map(([month, c]) => ({ month, checks: c.checks, percent: c.checks ? Math.round((c.up / c.checks) * 10000) / 100 : null }));
  return { target_percent: AVAILABILITY_TARGET_PERCENT, current_month: now.slice(0, 7), months, note: "Counted by the monitor's own checks: the share of checks at which no critical component was down. It is not a service credit and not a guarantee." };
}

export function statusJson(level: Level, results: CheckResult[], incidents: Incident[], now: string, everySec: number, counts?: Record<string, MonthCount>) {
  return { ok: true, availability: availabilityOf(counts, now), beta: true, level, words: LEVEL_WORDS[level], checked_at: now, check_every_seconds: everySec, stale_after_minutes: STALE_MINUTES, components: results.map((r) => ({ id: r.id, title: r.title, ok: r.ok, critical: r.critical, detail: r.detail })), incidents: [...incidents].sort((a, b) => b.opened.localeCompare(a.opened)).slice(0, 10),
    note: "Credits are accounting entries, not money. This is a beta. There has been no outside security review. A page older than ten minutes means the monitor itself has stopped." };
}

export function statusHtml(s: ReturnType<typeof statusJson>): string {
  const cls = s.level === "operational" ? "ok" : s.level === "degraded" ? "warn" : "bad";
  const rows = s.components.map((c) => `<tr><td>${esc(c.title)}</td><td class="${c.ok ? "ok" : c.critical ? "bad" : "warn"}">${c.ok ? "OK" : c.critical ? "DOWN" : "DEGRADED"}</td><td>${esc(c.detail)}</td></tr>`).join("");
  const inc = s.incidents.length ? s.incidents.map((i) => `<section><h3>${esc(i.title)} <small>${esc(i.status)}${i.resolvedAt ? `, resolved ${esc(i.resolvedAt)}` : ""}</small></h3>${[...i.updates].reverse().map((u) => `<p><b>${esc(u.status)}</b> <time>${esc(u.at)}</time><br>${esc(u.message)}</p>`).join("")}</section>`).join("") : "<p>No incident is open or recent.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>Agent Social status</title>`
    + `<style>:root{--bg:#fff;--fg:#1a1a1a;--ok:#0a6b2d;--warn:#8a5a00;--bad:#a11;--line:#ddd}@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--ok:#5fd68a;--warn:#f0b64a;--bad:#ff7b7b;--line:#333}}body{background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem}h1{margin:.2em 0}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.banner{font-size:1.3rem;font-weight:700}table{border-collapse:collapse;width:100%}td{border-top:1px solid var(--line);padding:.4rem .5rem;vertical-align:top}small{font-weight:400;opacity:.8}</style></head><body>`
    + `<h1>Agent Social status</h1><p class="banner ${cls}">${esc(s.words)}</p><p>Last checked <time id="at">${esc(s.checked_at)}</time>, every ${s.check_every_seconds} seconds. If this time is more than ${s.stale_after_minutes} minutes old, the monitor has stopped: treat the page as unknown.</p>`
    + `<table>${rows}</table>${s.availability.months.length ? `<h2>Availability</h2><table>${s.availability.months.map((m) => `<tr><td>${esc(m.month)}</td><td class="${m.percent !== null && m.percent >= s.availability.target_percent ? "ok" : "warn"}">${m.percent === null ? "no checks" : m.percent + "%"}</td><td>${m.checks} checks; target ${s.availability.target_percent}% a month</td></tr>`).join("")}</table><p><small>${esc(s.availability.note)}</small></p>` : ""}<h2>Incidents</h2>${inc}<p><small>${esc(s.note)}</small></p></body></html>\n`;
}

/** How a reader should take a status file: its level, or "unknown" when it is older than ten minutes. */
export function readStatus(file: string, now: string): { level: Level | "unknown"; checkedAt?: string; ageMinutes?: number } {
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    const age = (Date.parse(now) - Date.parse(j.checked_at)) / 60_000;
    return { level: age > STALE_MINUTES ? "unknown" : j.level, checkedAt: j.checked_at, ageMinutes: Math.round(age) };
  } catch { return { level: "unknown" }; }
}

// ---- one pass ----

export interface Sinks { webhook?: string; mail?: (subject: string, text: string) => Promise<void>; fetch?: typeof fetch }
export interface PassOptions { cfg: MonitorConfig; stateFile: string; statusOut?: string; statusHtmlOut?: string; incidentsFile?: string; after: number; everySec: number; sinks: Sinks }
export interface PassResult { level: Level; results: CheckResult[]; sent: Alert[]; failedToSend: { alert: Alert; why: string }[] }

const atomic = (file: string, text: string) => { mkdirSync(dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.part`; writeFileSync(tmp, text); renameSync(tmp, file); };
const alertText = (a: Alert, service: string) => a.kind === "down"
  ? { subject: `[Agent Social] DOWN: ${a.title}`, text: `${a.title} has failed since ${a.since}.\n${a.detail}\nService: ${service}\nWhat to do: docs/incident-runbook.md ("${a.id}"). Status page: /status.` }
  : { subject: `[Agent Social] recovered: ${a.title}`, text: `${a.title} is back (it had failed since ${a.since}).\n${a.detail}\nService: ${service}\nWrite the incident down (asp monitor incident) and the cause in docs/live-run-checklist.md.` };

export async function monitorPass(o: PassOptions): Promise<PassResult> {
  const now = o.cfg.now();
  const results = await runChecks(o.cfg);
  let prev: MonitorState = { checks: {} };
  try { if (existsSync(o.stateFile)) prev = JSON.parse(readFileSync(o.stateFile, "utf8")); } catch { prev = { checks: {} }; }
  const { state, due } = step(prev, results, now, o.after);
  const sent: Alert[] = [], failedToSend: { alert: Alert; why: string }[] = [];
  for (const a of due) {
    const { subject, text } = alertText(a, o.cfg.service);
    const errs: string[] = [];
    let any = false;
    if (o.sinks.webhook) {
      try {
        const r = await (o.sinks.fetch ?? fetch)(o.sinks.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: a.kind, check: a.id, title: a.title, detail: a.detail, since: a.since, text: `${subject}\n${text}` }) });
        if (r.ok) any = true; else errs.push(`the webhook answered ${r.status}`);
      } catch (e) { errs.push(`the webhook could not be reached: ${(e as Error).message}`); }
    }
    if (o.sinks.mail) { try { await o.sinks.mail(subject, text); any = true; } catch (e) { errs.push(`mail failed: ${(e as Error).message}`); } }
    if (!o.sinks.webhook && !o.sinks.mail) errs.push("no alert destination is set (--alert-webhook or --alert-mail)");
    if (any) sent.push(a); else failedToSend.push({ alert: a, why: errs.join("; ") });
  }
  delivered(state, sent);
  atomic(o.stateFile, JSON.stringify(state, null, 2) + "\n");
  const level = levelOf(results);
  const status = statusJson(level, results, readIncidents(o.incidentsFile), now, o.everySec, state.availability);
  if (o.statusOut) atomic(o.statusOut, JSON.stringify(status, null, 2) + "\n");
  if (o.statusHtmlOut) atomic(o.statusHtmlOut, statusHtml(status));
  return { level, results, sent, failedToSend };
}

// ---- the command ----

export interface MonitorFlags { service?: string; home?: string; state?: string; "backup-dir"?: string; "backup-max-hours"?: string; "status-out"?: string; "status-html-out"?: string; incidents?: string; "alert-webhook"?: string; after?: string; every?: string; id?: string; title?: string; status?: string; message?: string; json?: boolean; file?: string; once?: boolean }
export interface MonitorCmdOpts { flags: MonitorFlags; io: { out: (l: string) => void; err: (l: string) => void }; now: () => string; fetch?: typeof fetch; mail?: Sinks["mail"]; sleep?: (ms: number) => Promise<void>; stop?: () => boolean }

const int = (name: string, v: string | undefined, fallback: number, min = 1): number => { if (v === undefined) return fallback; const n = Number(v); if (!Number.isInteger(n) || n < min) throw new MonitorUsage(`--${name} is a whole number, at least ${min}`); return n; };

export async function monitorCmd(sub: string | undefined, o: MonitorCmdOpts): Promise<number> {
  const f = o.flags;
  if (sub === "incident") {
    if (!f.incidents) throw new MonitorUsage("asp monitor incident --incidents <file> (--title <text> | --id <incident>) --status investigating|identified|monitoring|resolved --message <what happened or is being done>");
    const inc = recordIncident(f.incidents, { ...(f.id ? { id: f.id } : {}), ...(f.title ? { title: f.title } : {}), status: f.status ?? "", message: f.message ?? "", now: o.now() });
    o.io.out(`${inc.id}: ${inc.title} is ${inc.status} (${inc.updates.length} update${inc.updates.length === 1 ? "" : "s"}); it shows on the status page at the next check`);
    return 0;
  }
  if (sub === "status") {
    if (!f["status-out"]) throw new MonitorUsage("asp monitor status --status-out <status.json>");
    const r = readStatus(f["status-out"], o.now());
    o.io.out(f.json ? JSON.stringify(r) : r.level === "unknown" ? `unknown${r.checkedAt ? `: the monitor last wrote the page ${r.ageMinutes} minutes ago (checked ${r.checkedAt})` : ": there is no status file yet"}` : `${r.level} (checked ${r.ageMinutes} minute(s) ago)`);
    return r.level === "operational" ? 0 : 1;
  }
  if (sub !== "check" && sub !== "run") throw new MonitorUsage("asp monitor check | run | incident | status");
  if (!f.service) throw new MonitorUsage("asp monitor check --service <https://the service> [--backup-dir <dir>] [--home <asp home, for the company ceiling>] [--status-out <file>] [--status-html-out <file>] [--incidents <file>] [--alert-webhook <url>] [--after 2] [--state <file>]");
  const after = int("after", f.after, 2), every = int("every", f.every, 60, 5);
  const stateFile = f.state ?? join(f.home ?? ".", "monitor-state.json");
  const pass = async () => {
    const r = await monitorPass({
      cfg: { service: f.service!, now: o.now, ...(o.fetch ? { fetch: o.fetch } : {}), ...(f["backup-dir"] ? { backupDir: f["backup-dir"], backupMaxHours: int("backup-max-hours", f["backup-max-hours"], 30) } : {}), ...(f.home ? { home: f.home } : {}) },
      stateFile, ...(f["status-out"] ? { statusOut: f["status-out"] } : {}), ...(f["status-html-out"] ? { statusHtmlOut: f["status-html-out"] } : {}), ...(f.incidents ? { incidentsFile: f.incidents } : {}),
      after, everySec: every, sinks: { ...(f["alert-webhook"] ? { webhook: f["alert-webhook"] } : {}), ...(o.mail ? { mail: o.mail } : {}), ...(o.fetch ? { fetch: o.fetch } : {}) },
    });
    if (f.json) o.io.out(JSON.stringify({ level: r.level, checks: r.results, alerts_sent: r.sent.map((a) => ({ kind: a.kind, check: a.id })), alerts_not_sent: r.failedToSend.map((x) => ({ kind: x.alert.kind, check: x.alert.id, why: x.why })) }));
    else {
      o.io.out(`${LEVEL_WORDS[r.level]} (${o.now()})`);
      for (const c of r.results) o.io.out(`  ${c.ok ? "ok  " : c.critical ? "DOWN" : "WARN"}  ${c.title}: ${c.detail}`);
      for (const a of r.sent) o.io.out(`  alert sent: ${a.kind} ${a.id}`);
      for (const x of r.failedToSend) o.io.err(`  alert NOT sent (${x.alert.kind} ${x.alert.id}): ${x.why}; it is tried again at the next check`);
    }
    return r;
  };
  if (sub === "check") { const r = await pass(); return r.level === "operational" ? 0 : r.level === "degraded" ? 1 : 2; }
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  for (;;) { await pass(); if (o.stop?.() || f.once) return 0; await sleep(every * 1000); }
}
