// Row DK1341 (spec-delta S1456): the operator's monitor, its alerts and the public status page. A fake service whose answers the test controls stands in for the deployed one; a real local webhook receives the alerts;
// the status page is the static file the monitor writes, which is what keeps it up while the service is down. Fake keys; no real traffic.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { COMPANY, delivered, levelOf, monitorPass, readIncidents, readStatus, recordIncident, runChecks, statusHtml, statusJson, step, type MonitorState } from "../src/monitor.ts";
import { Budgets, DailyCeiling } from "@agent-social/asp-package";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const tmp = () => mkdtempSync(join(tmpdir(), "asp-monitor-"));
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };

/** A stand-in for the deployed service. */
async function fakeService() {
  const state = { health: 200 as number | "hang", ledger: "balanced", society: [] as string[], supplyStatus: 200 };
  const s = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    const json = (code: number, b: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (path === "/health") { if (state.health === "hang") return; return json(state.health, state.health === 200 ? { ok: true } : { ok: false }); }
    if (path === "/economy/supply") return state.supplyStatus === 200 ? json(200, { ok: true, verdict: state.ledger, minted: 5000, ...(state.ledger === "mismatch" ? { problems: ["supply 5000 but balances 4990"] } : {}) }) : json(state.supplyStatus, {});
    if (path === "/society/health") return json(200, { ok: true, report: { alarms: state.society.map((id) => ({ id })) } });
    json(404, {});
  });
  return { url: await listen(s), state, stop: () => new Promise<void>((r) => s.close(() => r())) };
}
async function webhook(ok = true) {
  const got: any[] = [];
  const s = createServer(async (req, res) => { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); got.push(JSON.parse(Buffer.concat(c).toString())); res.writeHead(ok ? 200 : 500); res.end(); });
  return { url: await listen(s), got };
}
const NOW = "2026-12-01T10:00:00Z";

test("every check on a healthy service is ok and the level is operational", async () => {
  const svc = await fakeService();
  const rs = await runChecks({ service: svc.url, now: () => NOW });
  assert.deepEqual(rs.map((r) => [r.id, r.ok]), [["service", true], ["ledger", true], ["society", true]]);
  assert.equal(levelOf(rs), "operational");
});

test("a service that is down, answers badly, hangs or cannot be reached is a failed critical check with the reason, never a crash", async () => {
  const svc = await fakeService();
  svc.state.health = 500;
  let rs = await runChecks({ service: svc.url, now: () => NOW });
  assert.equal(rs[0].ok, false); assert.match(rs[0].detail, /\/health answered 500/); assert.equal(levelOf(rs), "major_outage");
  svc.state.health = "hang";
  rs = await runChecks({ service: svc.url, now: () => NOW, timeoutMs: 250 });
  assert.match(rs[0].detail, /could not check: no answer in time/);
  await svc.stop();
  rs = await runChecks({ service: svc.url, now: () => NOW, timeoutMs: 500 });
  assert.ok(rs.every((r) => !r.ok), "nothing answers");
  assert.equal(levelOf(rs), "major_outage");
});

test("a ledger that does not balance is a critical failure that names the recompute command; society alarms and a missing supply page are told apart", async () => {
  const svc = await fakeService();
  svc.state.ledger = "mismatch";
  let rs = await runChecks({ service: svc.url, now: () => NOW });
  const ledger = rs.find((r) => r.id === "ledger")!;
  assert.equal(ledger.ok, false); assert.equal(ledger.critical, true);
  assert.match(ledger.detail, /the audit says mismatch: supply 5000 but balances 4990; recompute with asp credits audit --json/);
  assert.equal(levelOf(rs), "major_outage");
  svc.state.ledger = "balanced"; svc.state.society = ["QUIET", "TOO_FAST"];
  rs = await runChecks({ service: svc.url, now: () => NOW });
  const soc = rs.find((r) => r.id === "society")!;
  assert.equal(soc.ok, false); assert.equal(soc.critical, false);
  assert.match(soc.detail, /2 alarm\(s\) raised: QUIET, TOO_FAST/);
  assert.equal(levelOf(rs), "degraded", "an alarm is a degraded service, not an outage");
  svc.state.society = []; svc.state.supplyStatus = 404;
  assert.match((await runChecks({ service: svc.url, now: () => NOW })).find((r) => r.id === "ledger")!.detail, /\/economy\/supply answered 404/);
});

test("the backup check: a young backup is ok, an old one, an empty folder and a missing folder are not", async () => {
  const svc = await fakeService();
  const dir = tmp(), now = Date.now();
  const check = async (d: string, max?: number) => (await runChecks({ service: svc.url, backupDir: d, ...(max ? { backupMaxHours: max } : {}), now: () => new Date(now).toISOString() })).find((r) => r.id === "backup")!;
  assert.match((await check(join(dir, "missing"))).detail, /does not exist/);
  assert.match((await check(dir)).detail, /no backup file in/);
  const f = join(dir, "asp-20261201-0217.sql.gz"); writeFileSync(f, "x");
  utimesSync(f, new Date(now - 5 * 3_600_000), new Date(now - 5 * 3_600_000));
  const young = await check(dir); assert.equal(young.ok, true); assert.match(young.detail, /asp-20261201-0217\.sql\.gz is 5\.0 hours old/);
  utimesSync(f, new Date(now - 50 * 3_600_000), new Date(now - 50 * 3_600_000));
  const old = await check(dir); assert.equal(old.ok, false); assert.match(old.detail, /is 50 hours old \(the limit is 30\)/);
  assert.equal((await check(dir, 72)).ok, true, "the limit is the operator's");
  writeFileSync(join(dir, "notes.txt"), "not a backup");
  assert.equal((await check(dir)).ok, false, "a file that is not a backup does not count");
});

test("alerts: one failure is not an alert, the second in a row is, once; recovery is one alert; a flap is silent", () => {
  const bad = (id = "service") => [{ id, title: "The service answers", critical: true, ok: false, detail: "down", ms: 1 }];
  const good = (id = "service") => [{ id, title: "The service answers", critical: true, ok: true, detail: "up", ms: 1 }];
  let st: MonitorState = { checks: {} };
  const run = (rs: ReturnType<typeof bad>, at: string, send = true) => { const r = step(st, rs, at, 2); st = r.state; if (send) delivered(st, r.due); return r.due; };
  assert.deepEqual(run(bad(), "t1"), [], "one failure: no alert");
  assert.deepEqual(run(good(), "t2"), [], "it came back: a flap is silent");
  assert.deepEqual(run(bad(), "t3"), []);
  const down = run(bad(), "t4");
  assert.equal(down.length, 1); assert.equal(down[0].kind, "down"); assert.equal(down[0].since, "t3");
  assert.deepEqual(run(bad(), "t5"), [], "not again while it stays down");
  assert.deepEqual(run(bad(), "t6"), []);
  const back = run(good(), "t7");
  assert.equal(back.length, 1); assert.equal(back[0].kind, "recovered"); assert.equal(back[0].since, "t3", "it says since when it was down");
  assert.deepEqual(run(good(), "t8"), [], "recovery is told once");
});

test("an alert that could not be delivered is due again at the next run, a down alert and a recovery alike, and is never sent twice once delivered", () => {
  const bad = [{ id: "ledger", title: "L", critical: true, ok: false, detail: "x", ms: 1 }];
  const good = [{ id: "ledger", title: "L", critical: true, ok: true, detail: "y", ms: 1 }];
  let st: MonitorState = { checks: {} };
  const run = (rs: typeof bad, at: string, send: boolean) => { const r = step(st, rs, at, 1); st = r.state; if (send) delivered(st, r.due); return r.due; };
  assert.equal(run(bad, "t1", false).length, 1, "due, not delivered");
  assert.equal(run(bad, "t2", false).length, 1, "due again");
  assert.equal(run(bad, "t3", true).length, 1, "delivered now");
  assert.equal(run(bad, "t4", true).length, 0);
  assert.equal(run(good, "t5", false)[0].kind, "recovered");
  assert.equal(run(good, "t6", false)[0].kind, "recovered", "a recovery not delivered is owed");
  assert.equal(run(good, "t7", true).length, 1);
  assert.equal(run(good, "t8", true).length, 0);
  // a recovery that was never owed (the down alert never went out) is not sent
  st = { checks: {} };
  run(bad, "u1", false);
  assert.equal(run(good, "u2", true).length, 0, "no down alert was delivered, so there is nothing to recover from");
});

function cfg(over: { svc: string; dir: string; sinks: any; after?: number; incidents?: string }) {
  return { cfg: { service: over.svc, now: () => NOW }, stateFile: join(over.dir, "state.json"), statusOut: join(over.dir, "status.json"), statusHtmlOut: join(over.dir, "status.html"), ...(over.incidents ? { incidentsFile: over.incidents } : {}), after: over.after ?? 2, everySec: 60, sinks: over.sinks };
}

test("an outage alerts the webhook once and the mail once, the status page says major outage, and recovery alerts once; the state file survives between passes", async () => {
  const svc = await fakeService(), hook = await webhook(), dir = tmp();
  const mails: { subject: string; text: string }[] = [];
  const sinks = { webhook: hook.url, mail: async (subject: string, text: string) => { mails.push({ subject, text }); } };
  const pass = () => monitorPass(cfg({ svc: svc.url, dir, sinks }));
  assert.equal((await pass()).level, "operational");
  svc.state.health = 500;
  const first = await pass();
  assert.equal(first.level, "major_outage"); assert.equal(first.sent.length, 0, "the first failed run is not yet an alert");
  const second = await pass();
  assert.equal(second.sent.length, 1);
  assert.equal(hook.got.length, 1); assert.equal(mails.length, 1);
  assert.equal(hook.got[0].kind, "down"); assert.equal(hook.got[0].check, "service");
  assert.match(hook.got[0].text, /DOWN: The service answers/);
  assert.match(mails[0].subject, /\[Agent Social\] DOWN: The service answers/);
  assert.match(mails[0].text, /docs\/incident-runbook\.md/);
  await pass(); await pass();
  assert.equal(hook.got.length, 1, "still one alert while it stays down");
  const page = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
  assert.equal(page.level, "major_outage"); assert.equal(page.components.find((c: any) => c.id === "service").ok, false);
  svc.state.health = 200;
  const back = await pass();
  assert.equal(back.sent.length, 1); assert.equal(hook.got.at(-1).kind, "recovered"); assert.equal(hook.got.length, 2);
  assert.match(mails.at(-1)!.subject, /recovered: The service answers/);
  await pass();
  assert.equal(hook.got.length, 2, "recovery is told once");
  assert.equal(JSON.parse(readFileSync(join(dir, "status.json"), "utf8")).level, "operational");
});

test("an alert that cannot be delivered is not lost: it is reported, kept, and sent at the next pass when the webhook works", async () => {
  const svc = await fakeService(), dir = tmp();
  svc.state.health = 500;
  const dead = await webhook(false);
  const p1 = await monitorPass(cfg({ svc: svc.url, dir, sinks: { webhook: dead.url }, after: 1 }));
  assert.equal(p1.sent.length, 0); assert.equal(p1.failedToSend.length, 1);
  assert.match(p1.failedToSend[0].why, /the webhook answered 500/);
  const live = await webhook(true);
  const p2 = await monitorPass(cfg({ svc: svc.url, dir, sinks: { webhook: live.url }, after: 1 }));
  assert.equal(p2.sent.length, 1); assert.equal(live.got.length, 1);
  const none = await monitorPass(cfg({ svc: svc.url, dir, sinks: {}, after: 1 }));
  assert.equal(none.failedToSend.length, 0, "delivered once: nothing more is due");
  // with no destination at all, the monitor says so instead of pretending
  const dir2 = tmp();
  const p3 = await monitorPass(cfg({ svc: svc.url, dir: dir2, sinks: {}, after: 1 }));
  assert.match(p3.failedToSend[0].why, /no alert destination is set/);
});

test("the status page is two static files that exist while the service is down, say when they were written, escape what the operator wrote, and are unknown once ten minutes old", async () => {
  const svc = await fakeService(), dir = tmp();
  const inc = join(dir, "incidents.json");
  recordIncident(inc, { title: "Slow answers <script>alert(1)</script>", status: "investigating", message: "We are looking at it & will say more.", now: "2026-12-01T09:00:00Z" });
  await svc.stop();
  const r = await monitorPass(cfg({ svc: svc.url, dir, sinks: {}, incidents: inc }));
  assert.equal(r.level, "major_outage");
  const html = readFileSync(join(dir, "status.html"), "utf8");
  assert.match(html, /<p class="banner bad">Major outage<\/p>/);
  assert.match(html, /Last checked <time id="at">2026-12-01T10:00:00Z<\/time>, every 60 seconds/);
  assert.match(html, /more than 10 minutes old, the monitor has stopped/);
  assert.ok(!html.includes("<script>alert(1)</script>"), "the operator's text is escaped");
  assert.match(html, /Slow answers &lt;script&gt;/);
  assert.match(html, /We are looking at it &amp; will say more\./);
  assert.match(html, /no outside security review/);
  assert.ok(!/<script/i.test(html.replace(/&lt;script/g, "")), "the page has no script");
  assert.equal(readStatus(join(dir, "status.json"), "2026-12-01T10:05:00Z").level, "major_outage");
  const stale = readStatus(join(dir, "status.json"), "2026-12-01T10:30:00Z");
  assert.equal(stale.level, "unknown"); assert.equal(stale.ageMinutes, 30);
  assert.equal(readStatus(join(dir, "none.json"), NOW).level, "unknown");
  assert.ok(statusHtml(statusJson("operational", [], [], NOW, 60)).includes("All systems operational"));
});

test("incidents: opened with a title, updated by id, resolved with a time; bad status, empty message, unknown id and a missing title are refused", () => {
  const f = join(tmp(), "incidents.json");
  const a = recordIncident(f, { title: "Sign-up is slow", status: "investigating", message: "Looking.", now: "2026-12-01T09:00:00Z" });
  assert.match(a.id, /^inc-20261201-1$/);
  const b = recordIncident(f, { id: a.id, status: "identified", message: "The database is busy.", now: "2026-12-01T09:20:00Z" });
  assert.equal(b.updates.length, 2); assert.equal(b.resolvedAt, undefined);
  const c = recordIncident(f, { id: a.id, status: "resolved", message: "Fixed.", now: "2026-12-01T10:00:00Z" });
  assert.equal(c.resolvedAt, "2026-12-01T10:00:00Z");
  assert.equal(readIncidents(f).length, 1);
  assert.throws(() => recordIncident(f, { id: a.id, status: "fine", message: "x", now: NOW }), /--status is one of/);
  assert.throws(() => recordIncident(f, { id: a.id, status: "resolved", message: "  ", now: NOW }), /--message says what happened/);
  assert.throws(() => recordIncident(f, { id: "inc-nope", status: "resolved", message: "x", now: NOW }), /no incident inc-nope/);
  assert.throws(() => recordIncident(f, { status: "investigating", message: "x", now: NOW }), /needs --title/);
  assert.throws(() => recordIncident(f, { id: a.id, status: "monitoring", message: "x".repeat(1001), now: NOW }), /at most 1000/);
  writeFileSync(f, "{not json");
  assert.deepEqual(readIncidents(f), [], "a damaged file reads as empty");
});

test("the company's compute spending ceiling: near it is a warning on the page, reached is a failed check, and with no ceiling there is no check", async () => {
  const svc = await fakeService(), home = tmp();
  const month = NOW.slice(0, 7), day = NOW.slice(0, 10);
  const spend = async () => (await runChecks({ service: svc.url, home, now: () => NOW })).find((r) => r.id === "spend");
  assert.equal(await spend(), undefined, "no ceiling set, no check");
  new Budgets(join(home, "budgets.json")).set(COMPANY, { monthlyTokens: 1000 });
  const ok = await spend(); assert.equal(ok!.ok, true); assert.match(ok!.detail, /0 tokens this month of 1000/);
  new DailyCeiling(join(home, "wakes.json")).addTokens(COMPANY, day, 850);
  const near = await spend(); assert.equal(near!.ok, false); assert.equal(near!.critical, false);
  assert.match(near!.detail, /has used 85% of its monthly cap: 850 of 1000 tokens/);
  new DailyCeiling(join(home, "wakes.json")).addTokens(COMPANY, day, 200);
  assert.match((await spend())!.detail, /has reached its monthly cap: 1050 of 1000/);
  assert.equal(new DailyCeiling(join(home, "wakes.json")).monthTokens(COMPANY, month), 1050);
});

async function asp(args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: tmp(), ...env }, cwd: tmp() };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), io };
}

test("asp monitor check on the command line: exit 0 when all is well, 1 degraded, 2 outage; it writes the page, alerts the webhook and mails into a folder when no mail key is set", async () => {
  const svc = await fakeService(), hook = await webhook(), dir = tmp();
  const args = ["monitor", "check", "--service", svc.url, "--status-out", join(dir, "status.json"), "--status-html-out", join(dir, "status.html"), "--state", join(dir, "state.json"), "--incidents", join(dir, "incidents.json"), "--alert-webhook", hook.url, "--alert-mail", "ops@example.org", "--after", "1", "--home", dir];
  const ok = await asp(args);
  assert.equal(ok.code, 0, ok.err); assert.match(ok.out, /^All systems operational/);
  svc.state.society = ["QUIET"];
  const warn = await asp(args);
  assert.equal(warn.code, 1); assert.match(warn.out, /WARN\s+The society health alarms are quiet: 1 alarm\(s\) raised: QUIET/);
  svc.state.health = 500;
  const down = await asp(args);
  assert.equal(down.code, 2); assert.match(down.out, /DOWN\s+The service answers/);
  assert.match(down.out, /alert sent: down service/);
  assert.ok(hook.got.some((g) => g.check === "service" && g.kind === "down"));
  const outbox = join(dir, "monitor-outbox");
  assert.ok(existsSync(outbox), "with no mail key the alert mail is written to a folder, never lost");
  const json = await asp([...args, "--json"]);
  assert.equal(JSON.parse(json.out).level, "major_outage");
  const status = await asp(["monitor", "status", "--status-out", join(dir, "status.json")]);
  assert.equal(status.code, 1); assert.match(status.out, /^major_outage \(checked \d+ minute\(s\) ago\)|^unknown: the monitor last wrote the page/);
  const inc = await asp(["monitor", "incident", "--incidents", join(dir, "incidents.json"), "--title", "Outage", "--status", "investigating", "--message", "We see it."]);
  assert.equal(inc.code, 0); assert.match(inc.out, /inc-\d{8}-1: Outage is investigating \(1 update\)/);
  assert.equal(readIncidents(join(dir, "incidents.json")).length, 1);
});

test("asp monitor says what to type and refuses nonsense", async () => {
  for (const [args, re] of [
    [["monitor"], /asp monitor check \| run \| incident \| status/],
    [["monitor", "check"], /asp monitor check --service/],
    [["monitor", "check", "--service", "http://127.0.0.1:1", "--after", "0"], /--after is a whole number, at least 1/],
    [["monitor", "incident"], /asp monitor incident --incidents/],
    [["monitor", "status"], /asp monitor status --status-out/],
  ] as [string[], RegExp][]) { const r = await asp(args); assert.notEqual(r.code, 0, args.join(" ")); assert.match(r.err, re, args.join(" ")); }
});

test("asp monitor run checks again and again until stopped", async () => {
  const svc = await fakeService(), dir = tmp();
  let sleeps = 0;
  const { monitorCmd } = await import("../src/monitor.ts");
  const out: string[] = [];
  const code = await monitorCmd("run", { io: { out: (l) => out.push(l), err: () => {} }, now: () => NOW, sleep: async () => { sleeps++; }, stop: () => sleeps >= 2, flags: { service: svc.url, state: join(dir, "s.json"), "status-out": join(dir, "status.json"), every: "5" } });
  assert.equal(code, 0);
  assert.equal(out.filter((l) => l.startsWith("All systems operational")).length, 3, "a pass, a sleep, a pass, a sleep, a pass");
});
