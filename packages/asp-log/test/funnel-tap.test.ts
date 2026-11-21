// Register row DK1211 (extends DK838): the funnel counters are wired to the real front door. A scripted agent that stops at each step moves exactly the matching counter once, the public view
// carries no address or key, and the counts survive a restart. Fake addresses and tokens only; credits are accounting entries, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FunnelTap, FUNNEL_STEPS, createLogServer, frontDoorRoutes, type FunnelStep, type Tenant } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };

/** A request and an answer without a socket: `finish` fires with the status the service sent. */
function exchange(tap: FunnelTap, method: string, url: string, address: string, status: number) {
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  tap.observe({ method, url }, res as never, address);
  res.emit("finish");
}
const counts = (tap: FunnelTap) => Object.fromEntries(FUNNEL_STEPS.map((s) => [s, tap.funnel.count(s as FunnelStep)]));

test("DK1211: a scripted agent that stops at each step moves exactly the matching counter, once, and none after", () => {
  const tap = new FunnelTap({ now: () => "2026-11-22T10:00:00Z", secret: "test-secret-1" });
  const A = "203.0.113.7";
  exchange(tap, "GET", "/society/start?src=hn", A, 200);
  assert.deepEqual(counts(tap), { start_page_read: 1, enrolled: 0, first_act: 0, free_lesson_started: 0, free_lesson_passed: 0, returned: 0 });
  exchange(tap, "GET", "/society/start?src=hn", A, 200);
  assert.equal(tap.funnel.count("start_page_read"), 1, "reading the page again is the same visitor");
  exchange(tap, "POST", "/signup/key", A, 200);
  assert.deepEqual(counts(tap), { start_page_read: 1, enrolled: 1, first_act: 0, free_lesson_started: 0, free_lesson_passed: 0, returned: 0 });
  tap.authenticated("agent-a", A, false);
  assert.equal(tap.funnel.count("first_act"), 0, "a read is not an act");
  tap.authenticated("agent-a", A, true);
  assert.deepEqual(counts(tap), { start_page_read: 1, enrolled: 1, first_act: 1, free_lesson_started: 0, free_lesson_passed: 0, returned: 0 });
  exchange(tap, "POST", "/society/courses/foundations/practice", A, 200);
  assert.equal(tap.funnel.count("free_lesson_started"), 1);
  exchange(tap, "POST", "/society/courses/foundations/complete", A, 200);
  assert.equal(tap.funnel.count("free_lesson_passed"), 1);
  for (const s of FUNNEL_STEPS.filter((x) => x !== "returned")) assert.equal(tap.funnel.count(s as FunnelStep, "hn"), 1, `${s} is attributed to the source of the start page link`);
  const view = tap.view();
  assert.equal(view.steps.map((r) => r.visitors).join(","), "1,1,1,1,1,0");
  assert.equal(view.worst?.step, "returned");
});

test("DK1211: only a 2xx answer counts (a refused enrolment is not an enrolment); the wrong method or path counts nothing; a bad source is direct", () => {
  const tap = new FunnelTap({ now: () => "2026-11-22T10:00:00Z", secret: "test-secret-2" });
  exchange(tap, "POST", "/signup/key", "198.51.100.1", 429);
  exchange(tap, "POST", "/signup/key", "198.51.100.1", 400);
  exchange(tap, "GET", "/signup/key", "198.51.100.1", 200);
  exchange(tap, "GET", "/society/courses/foundations/practice", "198.51.100.1", 200);
  exchange(tap, "GET", "/somewhere/else", "198.51.100.1", 200);
  assert.deepEqual(Object.values(counts(tap)), [0, 0, 0, 0, 0, 0]);
  exchange(tap, "GET", "/society/start?src=Bad%20Source%21%3Cscript%3E", "198.51.100.2", 200);
  exchange(tap, "GET", "/society/start", "198.51.100.3", 304);
  assert.deepEqual(tap.funnel.sources(), ["direct"]);
  assert.equal(tap.funnel.count("start_page_read"), 2, "a cached read (304) is a read");
});

test("DK1211: a tenant seen again on a later day is a return, once a day; the same day is not", () => {
  let now = "2026-11-22T10:00:00Z";
  const tap = new FunnelTap({ now: () => now, secret: "test-secret-3" });
  tap.authenticated("agent-b", "203.0.113.9", false);
  tap.authenticated("agent-b", "203.0.113.9", false);
  assert.equal(tap.funnel.count("returned"), 0);
  now = "2026-11-23T09:00:00Z";
  tap.authenticated("agent-b", "203.0.113.9", false);
  tap.authenticated("agent-b", "203.0.113.9", false);
  assert.equal(tap.funnel.count("returned"), 1);
});

test("DK1211: on a running server the start page read, an authenticated write and GET /society/funnel move and show the counters; the view carries no address, key or token", async () => {
  const token = "fake-token-for-the-funnel-test";
  const tenants: Tenant[] = [{ name: "walker", role: "tenant", tokenSha256: createHash("sha256").update(token).digest("hex") } as Tenant];
  const tap = new FunnelTap({ secret: "test-secret-4" });
  const door = frontDoorRoutes({ keyOnly: () => true, publicUrl: "https://example.test" });
  const server = createLogServer({ handle: undefined as never, tenants, funnelTap: tap, publicRoutes: async (rq, rs) => (await tap.route()(rq, rs)) || door(rq, rs), noAuth: false });
  const url = await listen(server);
  assert.equal((await fetch(`${url}/society/start?src=forum-post`)).status, 200);
  assert.equal(tap.funnel.count("start_page_read", "forum-post"), 1);
  await fetch(`${url}/rpc`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ target: "handle", method: "append", args: [{}] }) }).catch(() => undefined);
  assert.equal(tap.funnel.count("first_act"), 1, "the first write by an authenticated tenant is the first act");
  const r = await fetch(`${url}/society/funnel`);
  assert.equal(r.status, 200);
  const text = await r.text();
  const j = JSON.parse(text) as { steps: { step: string; visitors: number }[]; sources: string[] };
  assert.equal(j.steps.find((s) => s.step === "start_page_read")!.visitors, 1);
  assert.ok(j.sources.includes("forum-post"));
  for (const secret of ["127.0.0.1", token, "walker", "test-secret-4"]) assert.ok(!text.includes(secret), `the public view must not carry ${secret}`);
  assert.equal((await fetch(`${url}/society/funnel`, { method: "POST" })).status, 405);
  const bySource = (await (await fetch(`${url}/society/funnel?source=forum-post`)).json()) as { steps: { visitors: number }[] };
  assert.equal(bySource.steps[0]!.visitors, 1);
});

test("DK1211: the counts survive a restart and the file holds hashes and counts only", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-funnel-"));
  const file = join(dir, "funnel.json");
  const a = new FunnelTap({ now: () => "2026-11-22T10:00:00Z", file });
  exchange(a, "GET", "/society/start?src=hn", "203.0.113.50", 200);
  exchange(a, "POST", "/signup", "203.0.113.50", 200);
  assert.ok(existsSync(file));
  const raw = readFileSync(file, "utf8");
  assert.ok(!raw.includes("203.0.113.50"), "the address is not in the file");
  const b = new FunnelTap({ now: () => "2026-11-22T11:00:00Z", file });
  assert.equal(b.funnel.count("start_page_read"), 1);
  assert.equal(b.funnel.count("enrolled"), 1);
  exchange(b, "GET", "/society/start?src=hn", "203.0.113.50", 200);
  assert.equal(b.funnel.count("start_page_read"), 1, "the same visitor after a restart is still the same visitor that day");
});
