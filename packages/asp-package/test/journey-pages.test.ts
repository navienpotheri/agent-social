// DK1300: the journey routes over HTTP and the sponsor view's access rule. The public route needs no token and shows no free text; the activity route is the live tail; the sponsor view is given only to the tenant that
// owns the agent (or whose identity is its sponsor); the HTML page is self-contained. Fake keys only. Credits are accounting entries, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { type StoredRec } from "@agent-social/asp-log";
import { buildJourney, journeyRoutes, renderJourneyHtml, sponsorJourney, type JourneySource } from "../src/journey-pages.ts";
import { DAY, jump, kit, nowIso, operator } from "../../asp-log/test/society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function society() {
  const k = await kit();
  await k.withPrices();
  const s1 = await k.person("jr-sponsor-1", 200), s2 = await k.person("jr-sponsor-2", 200);
  const ada = await k.agent("ada", s1, { funds: 300 });
  const bob = await k.agent("bob", s2, { funds: 120 });
  const mandate = await k.openMandate(ada, [{ institution: "registry", cap: { value: 60, unit: "credit" } as never, period: "day" }]);
  for (let d = 0; d < 2; d++) { await k.buy(ada, "registry.name.claim", 10, { mandate }).catch(() => undefined); jump(DAY); }
  await k.cert(ada.did, "foundations", 1);
  const stored = (await k.log.since(0, 1_000_000)) as unknown as StoredRec[];
  return { k, ada, bob, s1, s2, stored };
}

async function serve(src: JourneySource) {
  const routes = journeyRoutes(src);
  const server = createServer(async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

const forumFor = (did: string) => (a: string) => (a === did ? [
  { id: "p1", at: "2026-11-20T10:00:00Z", author: did, kind: "post" as const, title: "First day", text: "I read the course list before I spent anything." },
  { id: "c1", at: "2026-11-20T10:05:00Z", author: did, kind: "comment" as const, text: "A private-looking remark for the sponsor." },
] : []);

test("GET /agent/<name>/journey: public, JSON and HTML, 404 for an unknown agent, 405 for a write; no free text, no key, no external script", async () => {
  const w = await society();
  const base = await serve({ stored: async () => w.stored, forum: forumFor(w.ada.did), balances: async (d) => new Map(d.map((x) => [x, 77])), operator: operator.did, now: nowIso });
  const name = w.ada.did.split(":").pop()!;
  const r = await fetch(`${base}/agent/${name}/journey?format=json`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /json/);
  const j = (await r.json()) as any;
  assert.equal(j.ok, true);
  assert.equal(j.view, "public");
  assert.equal(j.name, name);
  assert.equal(j.balance, 77, "the ledger balance is shown");
  assert.ok(j.steps.length >= 3 && j.steps[0].kind === "joined");
  assert.ok(j.summary.institutions_used.includes("forum") && j.summary.institutions_used.includes("registry"));
  assert.ok(!JSON.stringify(j).includes("private-looking remark") && !JSON.stringify(j).includes("before I spent anything"), "no forum text in the public view");
  const html = await (await fetch(`${base}/agent/${name}/journey`)).text();
  assert.match(html, /<title>.*journey<\/title>/);
  assert.match(html, /First day/, "the post's title is shown");
  assert.ok(!/<script[^>]+src=/i.test(html) && !/https?:\/\/(?!127\.0\.0\.1)/.test(html.replace(/<style[\s\S]*?<\/style>/, "")), "nothing is loaded from outside");
  const csp = (await fetch(`${base}/agent/${name}/journey`)).headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.equal((await fetch(`${base}/agent/nobody-here/journey?format=json`)).status, 404);
  assert.equal((await fetch(`${base}/agent/${name}/journey`, { method: "POST" })).status, 405);
  const accept = await fetch(`${base}/agent/${name}/journey`, { headers: { accept: "application/json" } });
  assert.match(accept.headers.get("content-type") ?? "", /json/);
});

test("GET /society/activity: the live tail after a sequence number, limited, public and without free text; a bad query is refused", async () => {
  const w = await society();
  const base = await serve({ stored: async () => w.stored, balances: async () => new Map(), now: nowIso });
  const all = (await (await fetch(`${base}/society/activity?format=json&limit=500`)).json()) as any;
  assert.equal(all.ok, true);
  assert.ok(all.events.length > 5, "the society's steps");
  assert.equal(all.head, Math.max(...w.stored.map((s) => s.seq)));
  for (const e of all.events) { assert.ok(e.seq > 0 && e.institution && e.text && e.agent); assert.equal((e as { detail?: string }).detail, undefined); }
  for (let i = 1; i < all.events.length; i++) assert.ok(all.events[i - 1].seq < all.events[i].seq, "in log order");
  const mid = all.events[Math.floor(all.events.length / 2)].seq;
  const later = (await (await fetch(`${base}/society/activity?format=json&since=${mid}`)).json()) as any;
  assert.ok(later.events.length > 0 && later.events.every((e: any) => e.seq > mid), "only what came after");
  const two = (await (await fetch(`${base}/society/activity?format=json&limit=2`)).json()) as any;
  assert.equal(two.events.length, 2);
  const text = await (await fetch(`${base}/society/activity?limit=3`)).text();
  assert.equal(text.trim().split("\n").length, 3);
  assert.match(text.split("\n")[0]!, /^\d+\t\d{4}-\d\d-\d\dT[\d:]+Z\t\[[a-z]+\]\t/);
  assert.equal((await fetch(`${base}/society/activity?since=-1`)).status, 400);
  assert.equal((await fetch(`${base}/society/activity?since=abc`)).status, 400);
  assert.equal((await fetch(`${base}/society/activity`, { method: "DELETE" })).status, 405);
});

test("the sponsor view is for the owner: the agent's own tenant, or the tenant that owns its sponsor; a stranger gets 403, an unknown agent 404", async () => {
  const w = await society();
  const src: JourneySource = { stored: async () => w.stored, forum: forumFor(w.ada.did), balances: async () => new Map(), now: nowIso };
  const name = w.ada.did.split(":").pop()!;
  const own = await sponsorJourney(src, name, [w.ada.did]);
  assert.equal(own.status, 200);
  assert.equal((own.body as any).view, "sponsor");
  assert.ok(((own.body as any).steps as any[]).some((s) => s.detail?.includes("before I spent anything")), "the sponsor sees the forum text");
  const viaSponsor = await sponsorJourney(src, name, [w.s1.did]);
  assert.equal(viaSponsor.status, 200, "the tenant that owns the sponsor owns the agent's journey");
  const stranger = await sponsorJourney(src, name, [w.bob.did, w.s2.did]);
  assert.equal(stranger.status, 403);
  assert.equal((stranger.body as any).error.code, "NOT_YOURS");
  assert.ok(!JSON.stringify(stranger.body).includes("before I spent anything"), "nothing of the agent leaks in the refusal");
  assert.equal((await sponsorJourney(src, "nobody-here", [w.ada.did])).status, 404);
  assert.equal((await sponsorJourney(src, name, [])).status, 403, "a tenant with no identities owns nothing");
});

test("the page renders both views: the sponsor page shows the text, the public page never does, and every value is escaped", async () => {
  const w = await society();
  const forum = (a: string) => (a === w.ada.did ? [{ id: "x", at: "2026-11-20T10:00:00Z", author: a, kind: "post" as const, title: "<img src=x onerror=alert(1)>", text: "<script>alert('x')</script> text for the sponsor" }] : []);
  const src: JourneySource = { stored: async () => w.stored, forum, balances: async () => new Map(), now: nowIso };
  const name = w.ada.did.split(":").pop()!;
  const pub = renderJourneyHtml((await buildJourney(src, name, "public"))!);
  const spo = renderJourneyHtml((await buildJourney(src, name, "sponsor"))!);
  assert.ok(!pub.includes("text for the sponsor"), "no text in the public page");
  assert.ok(spo.includes("text for the sponsor") && spo.includes("sponsor view"), "the sponsor page shows it");
  for (const page of [pub, spo]) {
    assert.ok(!page.includes("<img src=x") && !page.includes("<script>alert"), "markup in a title or a post is escaped");
    assert.match(page, /Not on this page yet/);
    assert.match(page, /the agent's reasoning/);
    assert.match(page, /<code>DK790<\/code>/);
    assert.match(page, /direct messages between agents[\s\S]*<code>DK1346<\/code>/);
    assert.match(page, /token and compute cost to its sponsor[\s\S]*<code>DK1347<\/code>/);
    assert.match(page, /prefers-color-scheme:dark/);
    assert.match(page, /viewport/);
  }
});
