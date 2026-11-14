/**
 * `asp forecast` (register row US2): from the sessions that finished in the last days, per agent the median and 90th-percentile tokens of a session, the median time, a day and a week at that rate, and today so
 * far; sessions without an end, older than the window or from another agent do not count. No money figure is given. Fake sessions only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildForecast, type DaySession } from "../src/today.ts";
import { main, type Io } from "../src/cli.ts";

const NOW = new Date(2026, 10, 14, 15, 0, 0);
const at = (daysAgo: number, hour = 10) => new Date(2026, 10, 14 - daysAgo, hour, 0, 0);
const iso = (d: Date) => d.toISOString();
const sess = (agent: string, start: Date, tokens: number, minutes = 5, ended = true): DaySession => ({
  start: { sid: Math.random().toString(16).slice(2, 10), at: iso(start), agent: `did:web:example.com:agents:${agent}`, runtime: "claude-code", purpose: "p", contract: "c" },
  ...(ended ? { end: { at: iso(new Date(start.getTime() + minutes * 60_000)), state: "done", calls: 3, refused: [], tokens, exitCode: 0 } } : {}),
});

test("the median, the bad case, the daily rate and the week, from finished sessions in the window only", () => {
  const all = [
    ...[1000, 2000, 3000, 4000, 20000].map((t, i) => sess("coder", at(i + 1), t, 4 + i)),
    sess("coder", at(40), 999999),            // outside the window
    sess("coder", at(0, 9), 500),             // today
    sess("coder", at(2), 777, 5, false),      // no end: not counted
    sess("writer", at(3), 100),
  ];
  const f = buildForecast(all, 14, NOW);
  const c = f.agents.find((a) => a.agent === "coder")!;
  assert.equal(c.sessions, 6);
  assert.equal(c.tokensMedian, 2000, "of 500, 1000, 2000, 3000, 4000, 20000");
  assert.equal(c.tokensP90, 20000);
  assert.equal(c.tokensTotal, 30500);
  assert.equal(c.perDayTokens, Math.round(30500 / 14));
  assert.equal(c.nextWeekTokens, Math.round(30500 / 14) * 7);
  assert.equal(c.todayTokens, 500);
  assert.equal(f.agents[0].agent, "coder", "the biggest spender first");
  assert.equal(f.agents.find((a) => a.agent === "writer")!.sessions, 1);
});

test("a window that is not a whole number of days is refused, and no sessions is a plain sentence", () => {
  assert.throws(() => buildForecast([], 0, NOW), /whole number/);
  assert.throws(() => buildForecast([], 1.5, NOW), /whole number/);
  assert.deepEqual(buildForecast([sess("a", at(1), 5, 5, false)], 7, NOW).agents, []);
});

test("asp forecast prints the table from the machine's own session list, as JSON with --json, and gives no money figure", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-forecast-"));
  const start = (s: DaySession) => JSON.stringify({ t: "start", ...s.start, me: "m", bank: "b", scopes: ["repo.read"], hosts: [] });
  const end = (s: DaySession) => JSON.stringify({ t: "end", sid: s.start.sid, contract: "c", ...s.end, refused: [] });
  const now = new Date();
  const ss = [1, 2, 3].map((n) => sess("coder", new Date(now.getTime() - n * 3_600_000), n * 1000));
  writeFileSync(join(home, "runs.ndjson"), ss.flatMap((s) => [start(s), end(s)]).join("\n") + "\n");
  const run = async (args: string[]) => { const out: string[] = []; const io: Io = { out: (l) => out.push(l), err: (l) => out.push(l), env: { ASP_HOME: home }, cwd: home } as Io; const code = await main(args, io); return { code, out: out.join("\n") }; };
  const r = await run(["forecast"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Forecast from the last 14 days/);
  assert.match(r.out, /coder\s+3\s+2,000/);
  assert.doesNotMatch(r.out, /\$|credits? will|USD/);
  const j = JSON.parse((await run(["forecast", "--days", "7", "--json"])).out);
  assert.equal(j.days, 7);
  assert.equal(j.agents[0].tokensMedian, 2000);
  assert.notEqual((await run(["forecast", "--days", "0"])).code, 0);
});
