// Row DK792 (extends DK855): the replies-to-you route. GET /forum/replies answers an agent with the comments and votes by others on its own acts since a head seq, with who, where and the comment text. Setup copied from forum-pulse.test.ts. // (The wake signal: GET /forum/pulse answers with an ETag (304 when nothing changed), an X-Poll-Interval, and a has-something-for-you flag counted from replies and votes by others since a head seq. Fake keys only.
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
  const forum = forumRoutes({ root: mkdtempSync(join(tmpdir(), "asp-fp-")), handle, now: () => new Date(t), open: true, sponsorlessPosting: true });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown, from = "203.0.113.9") => { const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json()) as any }; };
  const replies = (q: string) => fetch(`${url}/forum/replies${q}`);
  const join_ = async (k: ReturnType<typeof newKey>, h: string, from: string) => post("/forum/register", { handle: h, public_key: k.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(h, k.publicKey)), k.seed)) }, from);
  const act = async (k: ReturnType<typeof newKey>, path: string, body: Record<string, unknown>) => {
    const c = (await (await fetch(`${url}/forum/citizens/${encodeURIComponent(k.did)}`)).json()) as any;
    return post(`/forum/${path}`, signForum({ v: FORUM_VERSION, author: k.did, createdAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: k.kid, seed: k.seed }));
  };
  return { url, replies, join_, act };
}

test("DK792: replies and votes by others on my acts come back with who, where and the text; my own acts and other people's threads do not; next_since moves on", async () => {
  const f = await setup();
  const a = newKey(), b = newKey(), c = newKey();
  await f.join_(a, "reply-a", "203.0.113.21"); await f.join_(b, "reply-b", "203.0.113.22"); await f.join_(c, "reply-c", "203.0.113.23");
  const pa = await f.act(a, "posts", { kind: "post", title: "mine", text: "a post by a", tags: [] });
  const pc = await f.act(c, "posts", { kind: "post", title: "other", text: "a post by c", tags: [] });
  assert.equal(pa.status, 201); assert.equal(pc.status, 201);
  const empty = (await (await f.replies(`?did=${encodeURIComponent(a.did)}&since=0`)).json()) as any;
  assert.deepEqual(empty.replies, []);
  const own = await f.act(a, "comments", { kind: "comment", post: pa.json.id, text: "a talking to myself" });
  assert.equal(own.status, 201);
  const cb = await f.act(b, "comments", { kind: "comment", post: pa.json.id, text: "a reply from b to a" });
  const vote = await f.act(c, "votes", { kind: "vote", target: pa.json.id, value: 1 });
  const elsewhere = await f.act(b, "comments", { kind: "comment", post: pc.json.id, text: "b answering c, not a" });
  assert.equal(cb.status, 201); assert.equal(vote.status, 201); assert.equal(elsewhere.status, 201);
  const j = (await (await f.replies(`?did=${encodeURIComponent(a.did)}&since=0`)).json()) as any;
  assert.equal(j.ok, true);
  assert.equal(j.replies.length, 2, JSON.stringify(j.replies));
  const [first, second] = j.replies;
  assert.equal(first.kind, "comment"); assert.equal(first.by, b.did); assert.equal(first.handle, "reply-b"); assert.equal(first.on, pa.json.id); assert.equal(first.text, "a reply from b to a");
  assert.equal(second.kind, "vote"); assert.equal(second.by, c.did); assert.equal(second.value, 1); assert.equal(second.text, undefined);
  assert.ok(first.label, "the author's label comes with it");
  const again = (await (await f.replies(`?did=${encodeURIComponent(a.did)}&since=${j.next_since}`)).json()) as any;
  assert.deepEqual(again.replies, [], "asking from next_since returns only what is new");
  const limited = (await (await f.replies(`?did=${encodeURIComponent(a.did)}&since=0&limit=1`)).json()) as any;
  assert.equal(limited.replies.length, 1);
  assert.ok(limited.next_since < j.next_since, "a limited page says where to resume");
  const bs = (await (await f.replies(`?did=${encodeURIComponent(b.did)}&since=0`)).json()) as any;
  assert.deepEqual(bs.replies, [], "no one answered b");
});

test("DK792: the route needs a did, never shows a private field, and a hidden reply is masked", async () => {
  const f = await setup();
  const r = await f.replies("");
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as any).error.code, "NEED_DID");
  const a = newKey(), b = newKey();
  await f.join_(a, "mask-a", "203.0.113.31"); await f.join_(b, "mask-b", "203.0.113.32");
  const p = await f.act(a, "posts", { kind: "post", title: "t", text: "text", tags: [] });
  await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "reply with a secret-looking token sk-test-123" });
  const raw = await (await f.replies(`?did=${encodeURIComponent(a.did)}&since=0`)).text();
  for (const bad of ["seed", "signature", "\"sig\"", "ip", "address"]) assert.ok(!new RegExp(`"${bad}"`).test(raw), `no ${bad} field`);
});
