// The public society-health page and the alarm mail (register row DK141).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { societyHealth, type Activity } from "@agent-social/asp-log";
import { societyHealthRoutes, mailHealthAlarms } from "../src/health-routes.ts";

const T0 = Date.parse("2026-11-01T00:00:00Z"), DAY = 86_400_000;
const busy: Activity[] = Array.from({ length: 10 }, (_, i) => ({ at: T0 + i * DAY + 3600_000, agent: "a", kind: i < 5 ? "code" : "data", price: 100 + i }));
const quiet = societyHealth([], [], { from: T0, until: T0 + 5 * DAY - 1 });
const fine = societyHealth(busy, [], { from: T0, until: T0 + 10 * DAY - 1, quietFloor: 1 });

async function serve<T>(report: () => Promise<any>, fn: (url: string) => Promise<T>): Promise<T> {
  const route = societyHealthRoutes({ report });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { server.close(); }
}

test("/society/health is public, shows the figure and the alarms as HTML or JSON, and only answers GET and HEAD", async () => {
  await serve(async () => ({ report: quiet, days: 5 }), async (url) => {
    const html = await (await fetch(`${url}/society/health`)).text();
    assert.match(html, /1 alarm\(s\) raised/);
    assert.match(html, /ALARM QUIET/);
    assert.match(html, /not money/);
    const j = await (await fetch(`${url}/society/health?format=json`)).json() as any;
    assert.equal(j.report.alarms[0].id, "QUIET");
    assert.match(j.figure, /the last 5 days/);
    assert.equal((await fetch(`${url}/society/health`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${url}/other`)).status, 404);
  });
  await serve(async () => ({ report: fine, days: 10 }), async (url) => {
    assert.match(await (await fetch(`${url}/society/health`)).text(), /No alarm/);
  });
  await serve(async () => { throw new Error("log unreadable"); }, async (url) => {
    assert.equal((await fetch(`${url}/society/health`)).status, 500);
  });
});

test("the operator is told once per alarm and onset: a second check of the same alarm sends nothing, no alarm sends nothing", async () => {
  const seen = new Set<string>(), mails: { key: string; subject: string; text: string }[] = [];
  const tell = async (key: string, subject: string, text: string) => { if (seen.has(key)) return false; seen.add(key); mails.push({ key, subject, text }); return true; };
  assert.deepEqual(await mailHealthAlarms(fine, tell), []);
  assert.deepEqual(await mailHealthAlarms(quiet, tell), ["health:QUIET:2026-11-01"]);
  assert.deepEqual(await mailHealthAlarms(quiet, tell), []);
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /QUIET/);
  assert.match(mails[0].text, /nothing was changed/);
});
