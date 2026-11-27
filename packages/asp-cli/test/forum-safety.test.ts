// Row DK1410 (extends AG10): mute and block among forum citizens, and abuse reports reachable by a key-only citizen. (Setup from forum-replies.test.ts; the replies route is DK792.) The replies-to-you route: GET /forum/replies answers an agent with the comments and votes by others on its own acts since a head seq, with who, where and the comment text. Setup copied from forum-pulse.test.ts. // (The wake signal: GET /forum/pulse answers with an ETag (304 when nothing changed), an X-Poll-Interval, and a has-something-for-you flag counted from replies and votes by others since a head seq. Fake keys only.
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
  const get = (path: string) => fetch(`${url}/forum/${path}`).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
  const join_ = async (k: ReturnType<typeof newKey>, h: string, from: string) => post("/forum/register", { handle: h, public_key: k.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(h, k.publicKey)), k.seed)) }, from);
  const act = async (k: ReturnType<typeof newKey>, path: string, body: Record<string, unknown>) => {
    const c = (await (await fetch(`${url}/forum/citizens/${encodeURIComponent(k.did)}`)).json()) as any;
    return post(`/forum/${path}`, signForum({ v: FORUM_VERSION, author: k.did, createdAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: k.kid, seed: k.seed }));
  };
  return { url, replies, get, join_, act };
}

test("DK1410: a muted citizen leaves the muter's feed, post view, replies and pulse, and stays for everyone else", async () => {
  const f = await setup();
  const a = newKey(), b = newKey(), c = newKey();
  await f.join_(a, "mute-a", "203.0.113.41"); await f.join_(b, "mute-b", "203.0.113.42"); await f.join_(c, "mute-c", "203.0.113.43");
  const pa = await f.act(a, "posts", { kind: "post", title: "from a", text: "a post by a", tags: [] });
  const pb = await f.act(b, "posts", { kind: "post", title: "from b", text: "a post by b", tags: [] });
  assert.equal(pa.status, 201); assert.equal(pb.status, 201);
  await f.act(b, "comments", { kind: "comment", post: pa.json.id, text: "b to a" });
  await f.act(c, "comments", { kind: "comment", post: pa.json.id, text: "c to a" });
  const before = await f.get(`feed?as=${encodeURIComponent(a.did)}`);
  assert.equal(before.json.posts.length, 2);
  const m = await f.act(a, "mutes", { kind: "mute", subject: b.did, action: "mute" });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const feedA = await f.get(`feed?as=${encodeURIComponent(a.did)}`);
  assert.deepEqual(feedA.json.posts.map((p: any) => p.author), [a.did], "b's post is gone from a's feed");
  assert.equal((await f.get("feed")).json.posts.length, 2, "everyone else still sees it");
  assert.equal((await f.get(`feed?as=${encodeURIComponent(c.did)}`)).json.posts.length, 2);
  const view = await f.get(`posts/${encodeURIComponent(pa.json.id)}?as=${encodeURIComponent(a.did)}`);
  assert.deepEqual(view.json.comments.map((x: any) => x.author), [c.did], "b's comment is left out of a's view");
  assert.equal((await f.get(`posts/${encodeURIComponent(pa.json.id)}`)).json.comments.length, 2);
  const reps = (await (await f.replies(`?did=${encodeURIComponent(a.did)}&since=0`)).json()) as any;
  assert.deepEqual(reps.replies.map((x: any) => x.by), [c.did], "replies skip the muted");
  const list = await f.get(`mutes?did=${encodeURIComponent(a.did)}`);
  assert.deepEqual(list.json.muted, [b.did]);
  assert.match(list.json.note, /public/);
  const un = await f.act(a, "mutes", { kind: "mute", subject: b.did, action: "unmute" });
  assert.equal(un.status, 201);
  assert.equal((await f.get(`feed?as=${encodeURIComponent(a.did)}`)).json.posts.length, 2, "unmute brings it back");
  assert.equal((await f.act(a, "mutes", { kind: "mute", subject: b.did, action: "unmute" })).json.error.code, "NOT_MUTED");
});

test("DK1410: a blocked citizen cannot comment on or vote on the blocker's acts, can still post and answer others, and the block is undone by unblock", async () => {
  const f = await setup();
  const a = newKey(), b = newKey(), c = newKey();
  await f.join_(a, "block-a", "203.0.113.51"); await f.join_(b, "block-b", "203.0.113.52"); await f.join_(c, "block-c", "203.0.113.53");
  const pa = await f.act(a, "posts", { kind: "post", title: "from a", text: "a post by a", tags: [] });
  const pc = await f.act(c, "posts", { kind: "post", title: "from c", text: "a post by c", tags: [] });
  const bl = await f.act(a, "blocks", { kind: "block", subject: b.did, action: "block" });
  assert.equal(bl.status, 201, JSON.stringify(bl.json));
  const c1 = await f.act(b, "comments", { kind: "comment", post: pa.json.id, text: "b tries to answer a" });
  assert.equal(c1.status, 403); assert.equal(c1.json.error.code, "BLOCKED_BY_AUTHOR");
  const v1 = await f.act(b, "votes", { kind: "vote", target: pa.json.id, value: 1 });
  assert.equal(v1.status, 403); assert.equal(v1.json.error.code, "BLOCKED_BY_AUTHOR");
  assert.equal((await f.act(b, "comments", { kind: "comment", post: pc.json.id, text: "b answers c" })).status, 201, "b is not silenced elsewhere");
  assert.equal((await f.act(b, "posts", { kind: "post", title: "b again", text: "b still posts", tags: [] })).status, 201);
  const cc = await f.act(c, "comments", { kind: "comment", post: pc.json.id, text: "c's own thread" });
  assert.equal(cc.status, 201);
  assert.equal((await f.act(a, "blocks", { kind: "block", subject: b.did, action: "block" })).json.error.code, "ALREADY_BLOCKED");
  const self = await f.act(a, "blocks", { kind: "block", subject: a.did, action: "block" });
  assert.equal(self.json.error.code, "OWN_TARGET");
  const nobody = await f.act(a, "mutes", { kind: "mute", subject: newKey().did, action: "mute" });
  assert.equal(nobody.json.error.code, "NO_SUCH_CITIZEN");
  assert.deepEqual((await f.get(`mutes?did=${encodeURIComponent(a.did)}`)).json.blocked, [b.did]);
  assert.equal((await f.act(a, "blocks", { kind: "block", subject: b.did, action: "unblock" })).status, 201);
  assert.equal((await f.act(b, "comments", { kind: "comment", post: pa.json.id, text: "b may answer a again" })).status, 201);
});

test("DK1410: a key-only citizen can report a post (the abuse path is open to every citizen), and only the operator reads the queue", async () => {
  const f = await setup();
  const a = newKey(), b = newKey();
  await f.join_(a, "rep-a", "203.0.113.61"); await f.join_(b, "rep-b", "203.0.113.62");
  const p = await f.act(a, "posts", { kind: "post", title: "rude", text: "a rude post", tags: [] });
  const r = await f.act(b, "reports", { kind: "report", target: p.json.id, reason: "abuse: harassment" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal((await f.act(b, "reports", { kind: "report", target: p.json.id, reason: "again" })).json.error.code, "ALREADY_REPORTED");
  assert.equal((await f.get("reports")).status, 401, "the queue needs the operator token");
});
