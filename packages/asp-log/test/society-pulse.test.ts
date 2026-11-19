// Row DK850: GET /society/pulse, the society-wide wake signal: an ETag and a 304 when nothing changed, X-Poll-Interval, a has-something-for-you flag counted from records that name a did, and no private field.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { SOCIETY_POLL_INTERVAL_SEC, frontDoorRoutes, mentionsOf } from "../src/index.ts";

const ME = "did:key:z6MkMe";
const OTHER = "did:key:z6MkOther";
type Rec = { seq: number; record: { issuer: string; subject?: string | null; body: unknown } };
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function start() {
  const log: Rec[] = [];
  const pulse = {
    head: async () => ({ seq: log.length, logHash: `sha256:${"a".repeat(60)}${String(log.length).padStart(4, "0")}` }),
    since: async (after: number, limit: number) => log.filter((r) => r.seq > after).slice(0, limit),
  };
  const routes = frontDoorRoutes({ keyOnly: () => true, pulse });
  const server = createServer((req, res) => { void routes(req, res).then((h) => { if (!h) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const add = (record: Rec["record"]) => { log.push({ seq: log.length + 1, record }); };
  return { url, add };
}

test("DK850: an unchanged call is a 304, the interval is advertised, and the public answer carries the head and nothing else", async () => {
  const s = await start();
  const r1 = await fetch(`${s.url}/society/pulse`);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get("x-poll-interval"), String(SOCIETY_POLL_INTERVAL_SEC));
  const etag = r1.headers.get("etag")!;
  assert.ok(etag);
  assert.equal((await fetch(`${s.url}/society/pulse`, { headers: { "if-none-match": etag } })).status, 304);
  const body = (await r1.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["has_something", "head", "ok", "poll_interval_sec"], "no other field");
  s.add({ issuer: OTHER, body: {} });
  assert.equal((await fetch(`${s.url}/society/pulse`, { headers: { "if-none-match": etag } })).status, 200, "a new record changes the tag");
});

test("DK850: a returning-agent loop polls twice and acts only on change; the client honours the interval; a record naming the did raises the flag, the agent's own does not", async () => {
  const s = await start();
  let clock = 0, since = 0, etag = "", acted = 0, interval = 0, nextAt = 0, calls = 0;
  const poll = async () => {
    assert.ok(clock >= nextAt, "the client stand-in waited for the advertised interval");
    calls++;
    const r = await fetch(`${s.url}/society/pulse?did=${encodeURIComponent(ME)}&since=${since}`, { headers: etag ? { "if-none-match": etag } : {} });
    interval = Number(r.headers.get("x-poll-interval")); nextAt = clock + interval;
    if (r.status === 304) return;
    etag = r.headers.get("etag")!;
    const j = (await r.json()) as { head: { seq: number }; has_something: boolean; for_you: { records: number } };
    if (j.has_something) { acted++; since = j.head.seq; }
  };
  await poll(); clock += interval; await poll();
  assert.equal(acted, 0); assert.equal(calls, 2);
  clock += interval; await poll(); // a 304: the same call again
  s.add({ issuer: ME, subject: ME, body: { note: "my own record" } });
  clock += interval; await poll();
  assert.equal(acted, 0, "the agent's own record is not for the agent");
  s.add({ issuer: OTHER, subject: null, body: { counterparty: ME } });
  clock += interval; await poll();
  assert.equal(acted, 1);
  s.add({ issuer: OTHER, subject: ME, body: {} });
  clock += interval; await poll();
  assert.equal(acted, 2);
  await assert.rejects(() => poll(), /waited for the advertised interval/, "polling early is caught by the stand-in");
});

test("DK850: mentionsOf counts only records that name the did and were written by someone else; no record content leaves", async () => {
  const log: Rec[] = [
    { seq: 1, record: { issuer: OTHER, subject: ME, body: { secret: "private note" } } },
    { seq: 2, record: { issuer: OTHER, body: { parties: [ME, OTHER] } } },
    { seq: 3, record: { issuer: ME, body: { x: ME } } },
    { seq: 4, record: { issuer: OTHER, body: { y: "not me" } } },
  ];
  const p = { head: async () => ({ seq: 4, logHash: "h" }), since: async (a: number) => log.filter((r) => r.seq > a) };
  assert.equal(await mentionsOf(p, ME, 0), 2);
  assert.equal(await mentionsOf(p, ME, 1), 1);
  assert.equal(typeof (await mentionsOf(p, ME, 0)), "number");
});
