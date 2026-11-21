/**
 * `asp today`: what a person sees after a day of agents running (docs/daily-view.md, gap T14). Pure functions: the sessions of the day (the session index) and each session's run log go in,
 * the lines come out, so every number can be checked against the data it was counted from (packages/asp-cli/test/today.test.ts does that, line by line).
 *
 * The decisions the design left open are taken as it recommended: the day is the person's local day (`--since 24h` gives the last 24 hours instead); a command is shown whole, with secrets
 * already masked by the run log, cut at 60 characters in a table (asp runs <id> has it in full); where the machine and the service could disagree the machine's own records are shown and
 * said to be the machine's.
 */

export interface DaySession {
  start: { sid: string; at: string; agent: string; runtime: string; purpose: string; contract: string };
  end?: { at: string; state: string; calls: number; refused: string[]; tokens: number; exitCode: number; runLog?: string };
  /** For a session with no end: is its process still there? false reads as interrupted. */
  alive?: boolean;
}
export interface DayEvent { at: string; kind: string; data: Record<string, unknown> }

export interface TodayOptions { from: number; to: number; label: string; all: boolean; utc?: boolean }

const short = (did: string) => did.split(":").slice(-1)[0] ?? did;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const num = (n: number) => n.toLocaleString("en-US");
const pad = (s: string | number, n: number) => String(s).padEnd(n);

/** The state a session is in, in the words of asp runs. */
export function stateOf(s: DaySession): string {
  return s.end?.state ?? (s.alive === false ? "interrupted" : "running");
}

/** The calls a session's run log holds, as the day's tables read them. */
interface Call { at: string; tool: string; scope: string; allowed: boolean; reason: string; gated: boolean; skipped: string; input: string }
const callsOf = (events: DayEvent[]): Call[] => events.filter((e) => e.kind === "tool_call").map((e) => ({
  at: e.at, tool: String(e.data.tool ?? ""), scope: String(e.data.scope ?? ""), allowed: e.data.allowed === true, reason: String(e.data.reason ?? ""),
  gated: e.data.gated === true, skipped: String(e.data.gate_skipped ?? ""), input: String(e.data.input ?? ""),
}));

/** A refusal's reason as the gateway wrote it is "<what was wrong>. Article N (Title). <what to do>."; the table shows the two parts apart. */
export function splitReason(reason: string): { why: string; fix: string } {
  const m = /^(.*?)\.?\s+(Article \d+ \([^)]*\)\.[\s\S]*)$/.exec(reason);
  return m ? { why: m[1].trim(), fix: m[2].trim() } : { why: reason.trim(), fix: "" };
}

export interface Today {
  sessions: { s: DaySession; state: string; calls: Call[]; secs?: number; hasLog: boolean }[];
  totals: { sessions: number; calls: number; refused: number; tokens: number; byState: Record<string, number> };
  refusals: { first: string; agent: string; input: string; scope: string; why: string; fix: string; count: number }[];
  approvals: { asked: number; yes: number; no: number; noAnswer: number; remembered: number };
  byScope: { scope: string; allowed: number; refused: number; sessions: number }[];
  tokensByAgent: { agent: string; tokens: number }[];
  models: string[];
  seconds: number;
  logsKept: number;
}

/** Everything the day's tables hold, counted from the sessions and their run logs. `events` returns a session's run-log events, or undefined when it has none on this machine. */
export function buildToday(all: DaySession[], events: (s: DaySession) => DayEvent[] | undefined, o: Pick<TodayOptions, "from" | "to">): Today {
  const inDay = all.filter((s) => { const t = Date.parse(s.start.at); return t >= o.from && t < o.to; }).sort((a, b) => a.start.at.localeCompare(b.start.at));
  const sessions = inDay.map((s) => {
    const ev = events(s);
    return { s, state: stateOf(s), calls: ev ? callsOf(ev) : [], secs: s.end ? Math.max(0, Math.round((Date.parse(s.end.at) - Date.parse(s.start.at)) / 1000)) : undefined, hasLog: !!ev, ev: ev ?? [] };
  });
  const byState: Record<string, number> = {};
  for (const x of sessions) byState[x.state] = (byState[x.state] ?? 0) + 1;
  const totals = {
    sessions: sessions.length,
    calls: sessions.reduce((n, x) => n + (x.s.end?.calls ?? 0), 0),
    refused: sessions.reduce((n, x) => n + (x.s.end?.refused.length ?? 0), 0),
    tokens: sessions.reduce((n, x) => n + (x.s.end?.tokens ?? 0), 0),
    byState,
  };

  const collapsed = new Map<string, Today["refusals"][number]>();
  for (const x of sessions) for (const c of x.calls) {
    if (c.allowed) continue;
    const { why, fix } = splitReason(c.reason);
    const key = `${short(x.s.start.agent)}|${c.scope}|${c.input}|${why}`;
    const hit = collapsed.get(key);
    if (hit) hit.count++;
    else collapsed.set(key, { first: c.at, agent: short(x.s.start.agent), input: c.input || c.tool, scope: c.scope, why, fix, count: 1 });
  }

  const approvals = { asked: 0, yes: 0, no: 0, noAnswer: 0, remembered: 0 };
  const scopes = new Map<string, { allowed: number; refused: number; sessions: Set<string> }>();
  for (const x of sessions) for (const c of x.calls) {
    if (c.gated) {
      approvals.asked++;
      if (c.allowed) approvals.yes++;
      else if (/no answer within|did not answer/.test(c.reason)) approvals.noAnswer++;
      else approvals.no++;
    }
    if (c.skipped === "remembered") approvals.remembered++;
    const sc = scopes.get(c.scope || "(none)") ?? { allowed: 0, refused: 0, sessions: new Set<string>() };
    if (c.allowed) sc.allowed++; else sc.refused++;
    sc.sessions.add(x.s.start.sid);
    scopes.set(c.scope || "(none)", sc);
  }

  const tokens = new Map<string, number>();
  for (const x of sessions) tokens.set(short(x.s.start.agent), (tokens.get(short(x.s.start.agent)) ?? 0) + (x.s.end?.tokens ?? 0));
  const models = [...new Set(sessions.flatMap((x) => x.ev.filter((e) => e.kind === "model_request").map((e) => String(e.data.model ?? "")).filter(Boolean)))].sort();

  return {
    sessions: sessions.map(({ ev: _ev, ...rest }) => rest), totals,
    refusals: [...collapsed.values()].sort((a, b) => a.first.localeCompare(b.first)),
    approvals,
    byScope: [...scopes].map(([scope, v]) => ({ scope, allowed: v.allowed, refused: v.refused, sessions: v.sessions.size })).sort((a, b) => a.scope.localeCompare(b.scope)),
    tokensByAgent: [...tokens].map(([agent, n]) => ({ agent, tokens: n })).sort((a, b) => b.tokens - a.tokens),
    models,
    seconds: sessions.reduce((n, x) => n + (x.secs ?? 0), 0),
    logsKept: sessions.filter((x) => x.hasLog).length,
  };
}

const clock = (iso: string, utc?: boolean) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return utc ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : `${p(d.getHours())}:${p(d.getMinutes())}`; };
const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

/** The lines asp today prints: tables A, C, D and the health line F; B and E with --all. */
export function renderToday(t: Today, o: TodayOptions): string[] {
  const out: string[] = [];
  const { totals } = t;
  out.push(`${o.label}: ${totals.sessions} session${totals.sessions === 1 ? "" : "s"}, ${num(totals.calls)} call${totals.calls === 1 ? "" : "s"} judged, ${num(totals.refused)} refused, ${num(totals.tokens)} tokens`);
  if (!totals.sessions) { out.push("nothing ran in this period (asp runs lists every session)"); return out; }
  const order = ["ended", "stopped", "failed", "interrupted", "running"];
  out.push(order.map((k) => `${k[0].toUpperCase()}${k.slice(1)} ${totals.byState[k] ?? 0}`).join(" · ") + `   (the machine's own records)`);
  out.push("");
  out.push(`${pad("time", 6)} ${pad("agent", 11)} ${pad("task", 42)} ${pad("state", 12)} ${pad("calls", 6)} ${pad("refused", 8)} ${pad("tokens", 8)} secs`);
  for (const x of t.sessions) {
    const e = x.s.end;
    out.push(`${pad(clock(x.s.start.at, o.utc), 6)} ${pad(cut(short(x.s.start.agent), 10), 11)} ${pad(cut(x.s.start.purpose, 40), 42)} ${pad(x.state, 12)} ${pad(e ? e.calls : "-", 6)} ${pad(e ? e.refused.length : "-", 8)} ${pad(e ? num(e.tokens) : "-", 8)} ${x.secs ?? "-"}`);
  }

  out.push("");
  if (t.refusals.length) {
    out.push("What was refused, and why:");
    out.push(`${pad("time", 6)} ${pad("agent", 11)} ${pad("what was tried", 44)} ${pad("scope", 14)} why / what to do`);
    for (const r of t.refusals) {
      out.push(`${pad(clock(r.first, o.utc), 6)} ${pad(cut(r.agent, 10), 11)} ${pad(cut(r.input, 42), 44)} ${pad(r.scope, 14)} ${r.why}${r.count > 1 ? `  (x${r.count})` : ""}`);
      if (r.fix) out.push(`${" ".repeat(78)}${r.fix}`);
    }
  } else out.push("Nothing was refused that the run logs show.");

  out.push("");
  const a = t.approvals;
  out.push(a.asked || a.remembered ? `Approvals: asked ${a.asked} · you said yes ${a.yes} · you said no ${a.no} · no answer ${a.noAnswer} · remembered "always" ${a.remembered}` : "Approvals: none were asked.");

  const failed = totals.byState.failed ?? 0, interrupted = totals.byState.interrupted ?? 0;
  const noLog = t.sessions.length - t.logsKept;
  out.push(`Health: ${failed || interrupted ? `${failed} failed, ${interrupted} interrupted` : "no failed or interrupted sessions"}; run logs kept on this machine for ${t.logsKept} of ${t.sessions.length} session${t.sessions.length === 1 ? "" : "s"}${noLog ? ` (the other ${noLog} have none here, so their calls are not in the tables below the first)` : ""}`);

  if (o.all) {
    out.push("");
    out.push("What the agents did, by scope:");
    out.push(`${pad("scope", 16)} ${pad("allowed", 8)} ${pad("refused", 8)} sessions`);
    for (const s of t.byScope) out.push(`${pad(s.scope, 16)} ${pad(s.allowed, 8)} ${pad(s.refused, 8)} ${s.sessions}`);
    out.push("");
    out.push(`Cost and time: tokens ${t.tokensByAgent.map((x) => `${x.agent} ${num(x.tokens)}`).join(" · ")}; time with an agent working ${duration(t.seconds)}${t.models.length ? `; model ${t.models.join(", ")} (from the provider's request)` : ""}`);
  } else out.push("(asp today --all adds the scope table and the cost and time lines)");
  return out;
}

/** The period asked for: `--day YYYY-MM-DD` (that local day), `--since 24h` (or `90m`) back from now, or today's local day. */
export function periodOf(v: { day?: string; since?: string }, now: Date = new Date()): { from: number; to: number; label: string } {
  if (v.since) {
    const m = /^(\d+)\s*(h|m)$/i.exec(v.since.trim());
    if (!m) throw new Error("--since is a number of hours or minutes, like 24h or 90m");
    const ms = Number(m[1]) * (m[2].toLowerCase() === "h" ? 3_600_000 : 60_000);
    return { from: now.getTime() - ms, to: now.getTime() + 1, label: `The last ${v.since.trim()}` };
  }
  const d = v.day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.day) : undefined;
  if (v.day && !d) throw new Error("--day is a date like 2026-10-13");
  const start = d ? new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { from: start.getTime(), to: end.getTime(), label: v.day ? iso : `Today, ${iso}` };
}

/** One local day of the trend: what the machine's records hold for it. */
export interface TrendDay { day: string; sessions: number; calls: number; refused: number; troubled: number; tokens: number; seconds: number }
export interface Trend { days: TrendDay[]; agents: { agent: string; sessions: number; calls: number; refused: number; troubled: number; tokens: number }[] }

/** Day by day, and agent by agent, over the last `count` local days ending with the day of `now` (gap D8: cost, time and how often things were refused or went wrong). Counted by buildToday, so the numbers are the day's own. */
export function buildTrend(all: DaySession[], events: (s: DaySession) => DayEvent[] | undefined, count: number, now: Date = new Date()): Trend {
  if (!Number.isInteger(count) || count < 1 || count > 366) throw new Error("--days is a whole number from 1 to 366");
  const days: TrendDay[] = [];
  const agents = new Map<string, { sessions: number; calls: number; refused: number; troubled: number; tokens: number }>();
  for (let i = count - 1; i >= 0; i--) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
    const t = buildToday(all, events, { from: from.getTime(), to: to.getTime() });
    days.push({ day: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`, sessions: t.totals.sessions, calls: t.totals.calls, refused: t.totals.refused, troubled: (t.totals.byState.failed ?? 0) + (t.totals.byState.interrupted ?? 0), tokens: t.totals.tokens, seconds: t.seconds });
    for (const x of t.sessions) {
      const a = agents.get(short(x.s.start.agent)) ?? { sessions: 0, calls: 0, refused: 0, troubled: 0, tokens: 0 };
      a.sessions++; a.calls += x.s.end?.calls ?? 0; a.refused += x.s.end?.refused.length ?? 0; a.troubled += x.state === "failed" || x.state === "interrupted" ? 1 : 0; a.tokens += x.s.end?.tokens ?? 0;
      agents.set(short(x.s.start.agent), a);
    }
  }
  return { days, agents: [...agents].map(([agent, v]) => ({ agent, ...v })).sort((a, b) => b.sessions - a.sessions || a.agent.localeCompare(b.agent)) };
}

/** The lines asp trend prints. */
export function renderTrend(t: Trend): string[] {
  const out: string[] = [];
  const sum = (k: keyof Omit<TrendDay, "day">) => t.days.reduce((n, d) => n + d[k], 0);
  out.push(`The last ${t.days.length} day${t.days.length === 1 ? "" : "s"}: ${sum("sessions")} sessions, ${num(sum("calls"))} calls judged, ${num(sum("refused"))} refused, ${num(sum("tokens"))} tokens, ${duration(sum("seconds"))} of an agent working   (the machine's own records)`);
  if (!sum("sessions")) { out.push("nothing ran in this period (asp runs lists every session)"); return out; }
  out.push("");
  out.push(`${pad("day", 11)} ${pad("sessions", 9)} ${pad("calls", 7)} ${pad("refused", 8)} ${pad("failed/cut", 11)} ${pad("tokens", 9)} time`);
  for (const d of t.days) out.push(`${pad(d.day, 11)} ${pad(d.sessions, 9)} ${pad(d.calls, 7)} ${pad(d.refused, 8)} ${pad(d.troubled, 11)} ${pad(num(d.tokens), 9)} ${d.sessions ? duration(d.seconds) : "-"}`);
  out.push("");
  out.push(`${pad("agent", 12)} ${pad("sessions", 9)} ${pad("calls", 7)} ${pad("refused", 8)} ${pad("refused per 100 calls", 22)} ${pad("failed/cut", 11)} tokens`);
  for (const a of t.agents) out.push(`${pad(cut(a.agent, 11), 12)} ${pad(a.sessions, 9)} ${pad(a.calls, 7)} ${pad(a.refused, 8)} ${pad(a.calls ? (a.refused * 100 / a.calls).toFixed(1) : "-", 22)} ${pad(a.troubled, 11)} ${num(a.tokens)}`);
  out.push("");
  out.push("Failed/cut is a session that failed or was left without an end. Refused and failed rates say how often an agent hit a wall or broke, not whether its work was good: that is what asp canary and a settled job show.");
  return out;
}

/** What a run of one agent has cost on this machine, and what the next ones are likely to (gap US2): from the sessions that ended in the window. Tokens and time, never a price: a model's price is the provider's. */
export interface AgentForecast { agent: string; sessions: number; tokensMedian: number; tokensP90: number; tokensTotal: number; secondsMedian: number; perDayTokens: number; nextWeekTokens: number; todayTokens: number }
export interface Forecast { days: number; agents: AgentForecast[] }

const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };

/** The forecast over the last `days` days (default 14): per agent the median and 90th-percentile tokens of a session, the median time, the daily average and a week's worth at that rate, and today's tokens so far. */
export function buildForecast(all: DaySession[], days: number, now: Date = new Date()): Forecast {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("--days is a whole number from 1 to 366");
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const by = new Map<string, { tokens: number[]; seconds: number[]; today: number }>();
  for (const s of all) {
    if (!s.end) continue;
    const at = Date.parse(s.start.at);
    if (!(at >= from) || at > now.getTime()) continue;
    const a = by.get(short(s.start.agent)) ?? { tokens: [], seconds: [], today: 0 };
    a.tokens.push(s.end.tokens); a.seconds.push(Math.max(0, Math.round((Date.parse(s.end.at) - at) / 1000)));
    if (at >= today) a.today += s.end.tokens;
    by.set(short(s.start.agent), a);
  }
  const agents = [...by].map(([agent, a]) => {
    const total = a.tokens.reduce((n, x) => n + x, 0);
    return { agent, sessions: a.tokens.length, tokensMedian: quantile(a.tokens, 0.5), tokensP90: quantile(a.tokens, 0.9), tokensTotal: total, secondsMedian: quantile(a.seconds, 0.5), perDayTokens: Math.round(total / days), nextWeekTokens: Math.round(total / days) * 7, todayTokens: a.today };
  }).sort((a, b) => b.tokensTotal - a.tokensTotal || a.agent.localeCompare(b.agent));
  return { days, agents };
}

export function renderForecast(f: Forecast): string[] {
  if (!f.agents.length) return [`no finished session in the last ${f.days} day${f.days === 1 ? "" : "s"} to forecast from (asp runs lists every session)`];
  const out = [`Forecast from the last ${f.days} day${f.days === 1 ? "" : "s"} of finished sessions on this machine (tokens and time; the model's price is the provider's, so no money figure is given):`, ""];
  out.push(`${pad("agent", 12)} ${pad("sessions", 9)} ${pad("a session (median)", 19)} ${pad("a bad one (p90)", 16)} ${pad("time (median)", 14)} ${pad("a day", 10)} ${pad("next 7 days", 12)} today so far`);
  for (const a of f.agents) out.push(`${pad(cut(a.agent, 11), 12)} ${pad(a.sessions, 9)} ${pad(num(a.tokensMedian), 19)} ${pad(num(a.tokensP90), 16)} ${pad(duration(a.secondsMedian), 14)} ${pad(num(a.perDayTokens), 10)} ${pad(num(a.nextWeekTokens), 12)} ${num(a.todayTokens)}`);
  out.push("", "A cap on one run is --token-cap, a cap on an agent's day is --daily-tokens; the next run's likely size is the median, a bad one the 90th percentile. Past sessions are a guide, not a promise.");
  return out;
}
