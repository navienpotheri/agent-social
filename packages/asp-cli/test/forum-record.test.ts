// Row DK856: the per-agent forum record page and badge: keys, signed acts and chain entries, verifiable from the JSON alone with no account, deterministic, with the does-not-prove paragraph and no private field. Fake keys only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlEncode, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { RECORD_DOES_NOT_PROVE, verifyForumRecord, FORUM_VERSION, LocalLog, forumRoutes, registrationMessage, signForum, type ForumBody, type ForumRecord } from "@agent-social/asp-package";

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
  const join_ = async (k: ReturnType<typeof newKey>, h: string, from: string) => post("/forum/register", { handle: h, public_key: k.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(h, k.publicKey)), k.seed)) }, from);
  const act = async (k: ReturnType<typeof newKey>, path: string, body: Record<string, unknown>) => {
    const c = (await (await fetch(`${url}/forum/citizens/${encodeURIComponent(k.did)}`)).json()) as any;
    return post(`/forum/${path}`, signForum({ v: FORUM_VERSION, author: k.did, createdAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: k.kid, seed: k.seed }));
  };
  return { url, join_, act };
}

test("DK856: the record verifies from its own JSON, is deterministic, carries the does-not-prove paragraph, and shows nothing private", async () => {
  const f = await setup();
  const a = newKey(), b = newKey();
  await f.join_(a, "rec-a", "203.0.113.4"); await f.join_(b, "rec-b", "203.0.113.5");
  const p = await f.act(a, "posts", { kind: "post", title: "record me", text: "a signed post", tags: [] });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  assert.equal((await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "from b" })).status, 201);
  assert.equal((await f.act(a, "votes", { kind: "vote", target: (await (await fetch(`${f.url}/forum/citizens/${encodeURIComponent(b.did)}`)).json() as any).recent[0].id, value: 1 })).status, 201);
  const get = async (path: string) => (await fetch(f.url + path)).text();
  const t1 = await get(`/forum/record/${encodeURIComponent(a.did)}`), t2 = await get(`/forum/record/${encodeURIComponent(a.did)}`);
  assert.equal(t1, t2, "deterministic");
  const r = JSON.parse(t1) as ForumRecord;
  assert.equal(r.acts.length, 2);
  assert.equal(r.does_not_prove, RECORD_DOES_NOT_PROVE);
  assert.deepEqual(verifyForumRecord(r), { ok: true, problems: [] }, "verifies with no call to the service");
  assert.ok(!t1.includes("from b") && !/"model"|tenant|token/.test(t1), "no other author's text, no model, no tenant");
  // A changed document or a wrong key fails.
  const bad = JSON.parse(t1) as ForumRecord; (bad.acts[0]!.doc as any).title = "changed";
  assert.equal(verifyForumRecord(bad).ok, false);
  const wrong = JSON.parse(t1) as ForumRecord; wrong.keys = [{ kid: wrong.keys[0]!.kid, public_key: b.publicKey }];
  assert.equal(verifyForumRecord(wrong).ok, false);
  const page = await get(`/forum/human/record/${encodeURIComponent(a.did)}`);
  assert.match(page, /What this does not prove/); assert.ok(page.includes(RECORD_DOES_NOT_PROVE));
  assert.equal(await get(`/forum/human/record/${encodeURIComponent(a.did)}`), page, "the page is deterministic too");
  const badge = await get(`/forum/badge/${encodeURIComponent(a.did)}`);
  assert.match(badge, /forum record: 2 signed acts/);
  assert.equal((await fetch(`${f.url}/forum/record/did:key:nobody`)).status, 404);
});
