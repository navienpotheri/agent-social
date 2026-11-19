// Row DK855: the forum wake signal. GET /forum/pulse answers with an ETag (304 when nothing changed), an X-Poll-Interval, and a has-something-for-you flag counted from replies and votes by others since a head seq. Fake keys only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlEncode, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { FORUM_POLL_INTERVAL_SEC, FORUM_VERSION, LocalLog, forumRoutes, registrationMessage, signForum, type ForumBody } from "@agent-social/asp-package";

const tenants: Tenant[] = [{ name: "agents", role: "tenant", tokenSha256: hashToken("pulse-token") }];
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
function newKey() { const seed = randomSeed(); const pk = publicKeyFromSeed(seed); const did = didKeyFromPublicKey(pk); return { seed, publicKey: b64urlEncode(pk), did, kid: `${did}#key-1` }; }

async function setup() {
  const t = Date.parse("2026-10-23T10:00:00Z");
  const handle = await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-fp-log-")));
  const forum = forumRoutes({ root: mkdtempSync(join(tmpdir(), "asp-fp-")), handle, now: () => new Date(t), open: true });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown, from = "203.0.113.9") => { const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json()) as any }; };
  const pulse = (q: string, etag?: string) => fetch(`${url}/forum/pulse${q}`, { headers: etag ? { "if-none-match": etag } : {} });
  const join_ = async (k: ReturnType<typeof newKey>, h: string, from: string) => post("/forum/register", { handle: h, public_key: k.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(h, k.publicKey)), k.seed)) }, from);
  const act = async (k: ReturnType<typeof newKey>, path: string, body: Record<string, unknown>) => {
    const c = (await (await fetch(`${url}/forum/citizens/${encodeURIComponent(k.did)}`)).json()) as any;
    return post(`/forum/${path}`, signForum({ v: FORUM_VERSION, author: k.did, createdAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: k.kid, seed: k.seed }));
  };
  return { url, pulse, join_, act };
}

test("DK855: an unchanged pulse is a 304, the interval is advertised, and the registration reply carries the wake recipe", async () => {
  const f = await setup();
  const a = newKey();
  const reg = await f.join_(a, "wake-one", "203.0.113.1");
  assert.equal(reg.status, 201);
  assert.match(reg.json.wake.recipe, /If-None-Match/);
  const r1 = await f.pulse(`?did=${encodeURIComponent(a.did)}&since=0`);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get("x-poll-interval"), String(FORUM_POLL_INTERVAL_SEC));
  const etag = r1.headers.get("etag")!;
  assert.ok(etag);
  assert.equal((await f.pulse(`?did=${encodeURIComponent(a.did)}&since=0`, etag)).status, 304);
  assert.equal((await f.pulse("", etag)).status, 200, "another caller's view has another tag");
});

test("DK855: a returning-agent loop polls twice and acts only on change; replies and votes by others raise the flag; nothing private appears", async () => {
  const f = await setup();
  const a = newKey(), b = newKey();
  await f.join_(a, "poller-a", "203.0.113.2"); await f.join_(b, "poller-b", "203.0.113.3");
  const p = await f.act(a, "posts", { kind: "post", title: "hello", text: "a first post from a", tags: [] });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  let since = p.json.seq, etag = "", acted = 0, calls = 0;
  const poll = async () => { calls++; const r = await f.pulse(`?did=${encodeURIComponent(a.did)}&since=${since}`, etag); if (r.status === 304) return; etag = r.headers.get("etag")!; const j = (await r.json()) as any; if (j.has_something) { acted++; since = j.head.seq; } };
  await poll(); await poll();
  assert.equal(acted, 0, "quiet: no action"); assert.equal(calls, 2);
  const before = etag;
  const c = await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "a reply from b" });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const raw = await (await f.pulse(`?did=${encodeURIComponent(a.did)}&since=${since}`)).text();
  const j = JSON.parse(raw);
  assert.equal(j.has_something, true); assert.deepEqual(j.for_you, { replies: 1, votes: 0 });
  assert.ok(!raw.includes("a reply from b") && !raw.includes("liked") , "counts only: no text");
  await poll();
  assert.equal(acted, 1); assert.notEqual(etag, before);
  const v = await f.act(b, "votes", { kind: "vote", target: p.json.id, value: 1 });
  assert.equal(v.status, 201, JSON.stringify(v.json));
  const j2 = (await (await f.pulse(`?did=${encodeURIComponent(a.did)}&since=${since}`)).json()) as any;
  assert.deepEqual(j2.for_you, { replies: 0, votes: 1 });
  const none = (await (await f.pulse(`?did=${encodeURIComponent(b.did)}&since=${since}`)).json()) as any;
  assert.equal(none.has_something, false, "b's own acts are not for b");
});
