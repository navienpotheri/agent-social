import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecorder } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { buildToday, buildTrend, periodOf, renderToday, renderTrend, splitReason, type DayEvent, type DaySession } from "../src/today.ts";

// UC-228 and UC-229, gaps T14 and D8: every number in the day's tables is counted independently below from the data the day was built from.
const agent = (n: string) => `did:web:example.com:agents:${n}`;
const session = (sid: string, at: string, who: string, purpose: string, end?: DaySession["end"], alive?: boolean): DaySession => ({
  start: { sid, at, agent: agent(who), runtime: "claude-code", purpose, contract: "sha256:" + "c".repeat(64) }, ...(end ? { end } : {}), ...(alive !== undefined ? { alive } : {}),
});
const call = (at: string, tool: string, scope: string, allowed: boolean, extra: Record<string, unknown> = {}): DayEvent => ({ at, kind: "tool_call", data: { tool, scope, allowed, input: "x", ...extra } });
const refusal = (why: string) => `${why}. Article 3 (Stay inside the Mandate). Ask the person to widen it, or stop.`;

const DAY = [
  session("s1", "2026-10-13T05:28:00Z", "my-agent", "list the files here", { at: "2026-10-13T05:28:10Z", state: "ended", calls: 2, refused: [], tokens: 1500, exitCode: 0, runLog: "log1" }),
  session("s2", "2026-10-13T05:31:00Z", "my-agent", "run curl against example.com", { at: "2026-10-13T05:31:05Z", state: "ended", calls: 1, refused: ["shell.network"], tokens: 1300, exitCode: 0, runLog: "log2" }),
  session("s3", "2026-10-13T05:35:00Z", "my-agent", "run curl against example.com again", { at: "2026-10-13T05:35:09Z", state: "ended", calls: 3, refused: ["shell.network", "shell.network"], tokens: 1200, exitCode: 0, runLog: "log3" }),
  session("s4", "2026-10-13T05:46:00Z", "my-agent", "run python calc.py", { at: "2026-10-13T05:47:30Z", state: "stopped", calls: 2, refused: ["shell.exec"], tokens: 1400, exitCode: 130, runLog: "log4" }),
  session("s5", "2026-10-13T05:58:00Z", "helper", "say hello", { at: "2026-10-13T06:01:08Z", state: "failed", calls: 0, refused: [], tokens: 0, exitCode: 1 }),
  session("s6", "2026-10-13T06:10:00Z", "helper", "a terminal that was closed", undefined, false),
  session("s7", "2026-10-12T23:59:00Z", "my-agent", "yesterday's", { at: "2026-10-13T00:00:30Z", state: "ended", calls: 9, refused: [], tokens: 9999, exitCode: 0 }),
];
const LOGS: Record<string, DayEvent[]> = {
  log1: [{ at: "2026-10-13T05:28:01Z", kind: "model_request", data: { model: "claude-x" } }, call("2026-10-13T05:28:02Z", "Read", "repo.read", true), call("2026-10-13T05:28:03Z", "Read", "repo.read", true)],
  log2: [call("2026-10-13T05:31:02Z", "Bash", "shell.network", false, { input: "curl -s https://example.com", reason: refusal("the host example.com is not in this job's Mandate") })],
  log3: [
    call("2026-10-13T05:35:02Z", "Bash", "shell.network", false, { input: "curl -s https://example.com", reason: refusal("the host example.com is not in this job's Mandate") }),
    call("2026-10-13T05:35:04Z", "Bash", "shell.network", false, { input: "curl -s https://example.com", reason: refusal("the host example.com is not in this job's Mandate") }),
    call("2026-10-13T05:35:06Z", "Bash", "shell.exec", true, { input: "ls", gated: true }),
  ],
  log4: [
    call("2026-10-13T05:46:05Z", "Bash", "shell.exec", true, { input: "python calc.py", gated: true }),
    call("2026-10-13T05:47:00Z", "Bash", "shell.exec", false, { input: "find . -name calc", gated: true, reason: refusal("the scope shell.exec needs the principal's approval and it was not given: the principal answered corrected") }),
    call("2026-10-13T05:47:20Z", "Bash", "shell.exec", false, { input: "sleep 100", gated: true, reason: refusal("the scope shell.exec needs the principal's approval and it was not given: no answer within 600 seconds") }),
    call("2026-10-13T05:47:25Z", "Bash", "shell.exec", true, { input: "npm run build", gated: false, gate_skipped: "remembered" }),
    { at: "2026-10-13T05:46:01Z", kind: "model_request", data: { model: "claude-x" } },
  ],
};
const events = (s: DaySession) => (s.end?.runLog ? LOGS[s.end.runLog] : undefined);
const PERIOD = { from: Date.parse("2026-10-13T00:00:00Z"), to: Date.parse("2026-10-14T00:00:00Z") };
const OPTS = { ...PERIOD, label: "Today, 2026-10-13", all: true, utc: true };

test("every number in the day's tables equals a count taken independently from the sessions and run logs it was built from", () => {
  const t = buildToday(DAY, events, PERIOD);
  // The day holds six sessions; yesterday's is out.
  assert.equal(t.totals.sessions, 6);
  assert.deepEqual(t.sessions.map((x) => x.s.start.sid), ["s1", "s2", "s3", "s4", "s5", "s6"]);
  // calls, refused and tokens are the sums of the sessions' own end records.
  assert.equal(t.totals.calls, DAY.slice(0, 6).reduce((n, s) => n + (s.end?.calls ?? 0), 0));
  assert.equal(t.totals.calls, 8);
  assert.equal(t.totals.refused, 4);
  assert.equal(t.totals.tokens, 5400);
  assert.deepEqual(t.totals.byState, { ended: 3, stopped: 1, failed: 1, interrupted: 1 });
  // Seconds are end minus start.
  assert.deepEqual(t.sessions.map((x) => x.secs), [10, 5, 9, 90, 188, undefined]);
  assert.equal(t.seconds, 10 + 5 + 9 + 90 + 188);
  // Refusals: the two identical curls in s3 collapse with the one in s2 only when from the same agent, scope, command and reason: that is all three, so one row, x3.
  const curl = t.refusals.find((r) => r.scope === "shell.network")!;
  assert.equal(curl.count, 3);
  assert.equal(curl.why, "the host example.com is not in this job's Mandate");
  assert.match(curl.fix, /^Article 3 \(Stay inside the Mandate\)\. Ask the person to widen it, or stop\.$/);
  assert.equal(curl.first, "2026-10-13T05:31:02Z");
  assert.equal(t.refusals.filter((r) => r.scope === "shell.exec").length, 2);
  assert.equal(t.refusals.reduce((n, r) => n + r.count, 0), 5, "five refused calls in the run logs (the end records count four: that is each session's own tally, and the table says which it is reading)");
  // Approvals: four gated calls (ls, python, find, sleep): two allowed, one answered no, one never answered; and one command remembered with "always".
  assert.deepEqual(t.approvals, { asked: 4, yes: 2, no: 1, noAnswer: 1, remembered: 1 });
  // By scope.
  assert.deepEqual(t.byScope, [
    { scope: "repo.read", allowed: 2, refused: 0, sessions: 1 },
    { scope: "shell.exec", allowed: 3, refused: 2, sessions: 2 },
    { scope: "shell.network", allowed: 0, refused: 3, sessions: 2 },
  ]);
  // Cost: tokens by agent (the index), the model named in the requests, the logs kept.
  assert.deepEqual(t.tokensByAgent, [{ agent: "my-agent", tokens: 5400 }, { agent: "helper", tokens: 0 }]);
  assert.deepEqual(t.models, ["claude-x"]);
  assert.equal(t.logsKept, 4);
});

test("the lines say what the numbers are, in words, with the fix beside a refusal and the health in one line", () => {
  const text = renderToday(buildToday(DAY, events, PERIOD), OPTS).join("\n");
  assert.match(text, /^Today, 2026-10-13: 6 sessions, 8 calls judged, 4 refused, 5,400 tokens/);
  assert.match(text, /Ended 3 · Stopped 1 · Failed 1 · Interrupted 1 · Running 0/);
  assert.match(text, /05:28 +my-agent +list the files here +ended +2 +0 +1,500 +10/);
  assert.match(text, /05:58 +helper +say hello +failed +0 +0 +0 +188/);
  assert.match(text, /06:10 +helper +a terminal that was closed +interrupted +- +- +- +-/);
  assert.match(text, /curl -s https:\/\/example\.com +shell\.network +the host example\.com is not in this job's Mandate {2}\(x3\)/);
  assert.match(text, /Article 3 \(Stay inside the Mandate\)\. Ask the person to widen it/);
  assert.match(text, /Approvals: asked 4 · you said yes 2 · you said no 1 · no answer 1 · remembered "always" 1/);
  assert.match(text, /Health: 1 failed, 1 interrupted; run logs kept on this machine for 4 of 6 sessions/);
  assert.match(text, /shell\.exec +3 +2 +2/);
  assert.match(text, /time with an agent working 5 min 2 s; model claude-x/);
  // Without --all the two extra tables are offered, not shown.
  const short = renderToday(buildToday(DAY, events, PERIOD), { ...OPTS, all: false }).join("\n");
  assert.match(short, /asp today --all adds/);
  assert.doesNotMatch(short, /by scope/);
});

test("a quiet day says so, and the period is a local day, a named day or the last hours", () => {
  assert.deepEqual(renderToday(buildToday([], () => undefined, PERIOD), OPTS), ["Today, 2026-10-13: 0 sessions, 0 calls judged, 0 refused, 0 tokens", "nothing ran in this period (asp runs lists every session)"]);
  const now = new Date(2026, 9, 13, 15, 30);
  const today = periodOf({}, now);
  assert.equal(today.from, new Date(2026, 9, 13).getTime());
  assert.equal(today.to, new Date(2026, 9, 14).getTime());
  assert.equal(today.label, "Today, 2026-10-13");
  assert.equal(periodOf({ day: "2026-10-12" }, now).label, "2026-10-12");
  assert.equal(periodOf({ since: "24h" }, now).from, now.getTime() - 24 * 3_600_000);
  assert.equal(periodOf({ since: "90m" }, now).from, now.getTime() - 90 * 60_000);
  assert.throws(() => periodOf({ since: "a day" }, now), /hours or minutes/);
  assert.throws(() => periodOf({ day: "yesterday" }, now), /a date like/);
  assert.deepEqual(splitReason("outside the Mandate"), { why: "outside the Mandate", fix: "" });
});

test("asp today reads the machine's own session index and run logs: the same numbers come out of real files", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-today-"));
  mkdirSync(join(home, "runs"), { recursive: true });
  const logPath = join(home, "runs", "run-log.ndjson");
  const rec = new RunRecorder(logPath);
  rec.event("model_request", { model: "claude-x" });
  rec.event("tool_call", { tool: "Bash", scope: "shell.network", allowed: false, reason: refusal("the host example.com is not in this job's Mandate"), input: "curl -s https://example.com" });
  rec.event("tool_call", { tool: "Read", scope: "repo.read", allowed: true, input: "a.txt" });
  const at = new Date(); const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const later = new Date(at.getTime() + 7000);
  const lines = [
    { t: "start", sid: "abcd1234", contract: "sha256:" + "c".repeat(64), at: iso(at), runtime: "claude-code", agent: agent("my-agent"), me: "did:web:example.com:users:me", bank: "did:web:example.com:bank", purpose: "try the thing", scopes: ["repo.read"], hosts: [] },
    { t: "end", sid: "abcd1234", contract: "sha256:" + "c".repeat(64), at: iso(later), state: "ended", calls: 2, refused: ["shell.network"], tokens: 321, exitCode: 0, runLog: logPath },
  ];
  writeFileSync(join(home, "runs.ndjson"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: () => {}, env: { ASP_HOME: home }, cwd: home };
  assert.equal(await main(["today", "--all"], io), 0);
  const text = out.join("\n");
  assert.match(text, /^Today, \d{4}-\d{2}-\d{2}: 1 session, 2 calls judged, 1 refused, 321 tokens/);
  assert.match(text, /try the thing +ended +2 +1 +321 +7/);
  assert.match(text, /curl -s https:\/\/example\.com +shell\.network/);
  assert.match(text, /Health: no failed or interrupted sessions; run logs kept on this machine for 1 of 1 session/);
  assert.match(text, /model claude-x/);
  // Another day has nothing.
  out.length = 0;
  assert.equal(await main(["today", "--day", "2001-01-01"], io), 0);
  assert.match(out.join("\n"), /2001-01-01: 0 sessions/);
});

test("the trend is the days' own numbers laid side by side: each day equals buildToday for that day, the agents add up, and the rates are said to measure walls hit, not work done", () => {
  const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
  const S = (sid: string, d: number, who: string, end: DaySession["end"] | undefined, alive?: boolean) => session(sid, local(d, 9), who, "task " + sid, end ? { ...end, at: local(d, 9, 1) } : undefined, alive);
  const week = [
    S("a", 11, "my-agent", { at: "", state: "ended", calls: 4, refused: ["x"], tokens: 100, exitCode: 0 }),
    S("b", 11, "my-agent", { at: "", state: "failed", calls: 0, refused: [], tokens: 0, exitCode: 1 }),
    S("c", 13, "my-agent", { at: "", state: "ended", calls: 6, refused: ["x", "y"], tokens: 300, exitCode: 0 }),
    S("d", 13, "helper", { at: "", state: "ended", calls: 10, refused: [], tokens: 50, exitCode: 0 }),
    S("e", 13, "helper", undefined, false),
    S("old", 1, "my-agent", { at: "", state: "ended", calls: 99, refused: [], tokens: 9999, exitCode: 0 }),
  ];
  const now = new Date(2026, 9, 13, 18, 0);
  const t = buildTrend(week, () => undefined, 3, now);
  assert.deepEqual(t.days.map((d) => d.day), ["2026-10-11", "2026-10-12", "2026-10-13"]);
  assert.deepEqual(t.days.map((d) => [d.sessions, d.calls, d.refused, d.troubled, d.tokens, d.seconds]), [[2, 4, 1, 1, 100, 120], [0, 0, 0, 0, 0, 0], [3, 16, 2, 1, 350, 120]]);
  // Each day is the day's own numbers.
  for (const d of t.days) {
    const from = new Date(d.day + "T00:00:00").getTime();
    const day = buildToday(week, () => undefined, { from, to: from + 86_400_000 });
    assert.deepEqual([day.totals.sessions, day.totals.calls, day.totals.refused, day.totals.tokens], [d.sessions, d.calls, d.refused, d.tokens]);
  }
  assert.deepEqual(t.agents, [
    { agent: "my-agent", sessions: 3, calls: 10, refused: 3, troubled: 1, tokens: 400 },
    { agent: "helper", sessions: 2, calls: 10, refused: 0, troubled: 1, tokens: 50 },
  ]);
  assert.equal(t.agents.reduce((n, a) => n + a.sessions, 0), t.days.reduce((n, d) => n + d.sessions, 0), "the agents add up to the days");
  const text = renderTrend(t).join("\n");
  assert.match(text, /^The last 3 days: 5 sessions, 20 calls judged, 3 refused, 450 tokens, 4 min 0 s of an agent working/);
  assert.match(text, /2026-10-12 +0 +0 +0 +0 +0 +-/);
  assert.match(text, /my-agent +3 +10 +3 +30\.0 +1 +400/);
  assert.match(text, /not whether its work was good/);
  assert.throws(() => buildTrend(week, () => undefined, 0, now), /1 to 366/);
  assert.deepEqual(renderTrend(buildTrend([], () => undefined, 7, now)).slice(1), ["nothing ran in this period (asp runs lists every session)"]);
});
