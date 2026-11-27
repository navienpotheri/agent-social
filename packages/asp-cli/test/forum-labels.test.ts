// Rows DK858 and DK859: forum labels (own key or service-held key; sponsored or sponsor-less) on every post, comment, citizen JSON and page; any key may write once the launch gate is opened; the gate is OFF by default; a banned key cannot write.
// Fake keys only; credits are mock accounting entries, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlEncode, cosign, createRecord, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes, signerFromSeed } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { FORUM_VERSION, HostedSigner, LocalLog, forumRoutes, registrationMessage, signForum, type ForumBody } from "@agent-social/asp-package";

const TOKEN = "labels-token";
const tenants: Tenant[] = [{ name: "agents", role: "tenant", tokenSha256: hashToken(TOKEN) }];
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

const HUMAN = "did:web:example.com:users:sponsor";
const SPONSORED = "did:web:example.com:agents:sponsored";
const SELF = "did:web:example.com:agents:selfkey";
const HOSTED = "did:web:example.com:agents:hosted";
const AT = "2026-11-19T10:00:00Z";
let ipCounter = 10;

async function setup(forumOpts: { sponsorlessPosting?: boolean; banned?: (k: string) => boolean } = {}) {
  const handle = await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-fl-log-")));
  const seeds = new Map<string, Uint8Array>();
  const passport = async (did: string, kind: "human" | "agent", sponsor: string | undefined, seed: Uint8Array) => {
    const signer = signerFromSeed(`${did}#key-1`, seed);
    const rec = createRecord({ type: "passport", issuer: did, subject: did, prev: null, issued_at: AT, body: { did, kind, ...(sponsor ? { sponsor } : {}), tier: 1, shape: {}, purpose: "a label test", keys: [{ id: `${did}#key-1`, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(seed)) }] } } as never, signer);
    await handle.append(sponsor && sponsor !== did ? cosign(rec, signerFromSeed(`${sponsor}#key-1`, seeds.get(sponsor)!)) : rec);
    seeds.set(did, seed);
  };
  await passport(HUMAN, "human", undefined, randomSeed());
  await passport(SPONSORED, "agent", HUMAN, randomSeed());
  await passport(SELF, "agent", SELF, randomSeed());
  // The service-held agent: the hosted signer holds its seed.
  const hosted = new HostedSigner(join(mkdtempSync(join(tmpdir(), "asp-fl-keys-")), "hosted.keys"), "a long enough test passphrase");
  const k = hosted.create(HOSTED);
  await handle.append(hosted.sign(HOSTED, { type: "passport", subject: HOSTED, prev: null, issued_at: AT, body: { did: HOSTED, kind: "agent", sponsor: HOSTED, custody: "service", tier: 1, shape: {}, purpose: "a label test", keys: [{ id: k.kid, type: "Ed25519", public_key: b64urlEncode(k.publicKey) }] } }));
  const forum = forumRoutes({ root: mkdtempSync(join(tmpdir(), "asp-fl-")), handle, now: () => new Date(AT), open: true, ...forumOpts });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = async (path: string) => (await fetch(url + path)).json() as Promise<any>;
  const text = async (path: string) => (await fetch(url + path)).text();
  const signerOf = (did: string) => did === HOSTED ? hosted.signerFor(did) : signerFromSeed(`${did}#key-1`, seeds.get(did)!);
  const act = async (did: string, path: string, body: Record<string, unknown>, signer = signerOf(did), headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) => {
    const c = await get(`/forum/citizens/${encodeURIComponent(did)}`);
    const doc = signForum({ v: FORUM_VERSION, author: did, createdAt: AT, prev: c.last, ...body } as ForumBody, signer);
    const r = await fetch(`${url}/forum/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(doc) });
    return { status: r.status, json: (await r.json()) as any };
  };
  const keyOnly = async (handleName: string) => {
    const seed = randomSeed(), pk = publicKeyFromSeed(seed), did = didKeyFromPublicKey(pk), pub = b64urlEncode(pk);
    const r = await fetch(`${url}/forum/register`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ipCounter++}` }, body: JSON.stringify({ handle: handleName, public_key: pub, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(handleName, pub)), seed)) }) });
    assert.equal(r.status, 201);
    return { did, signer: signerFromSeed(`${did}#key-1`, seed), pub };
  };
  return { url, get, text, act, keyOnly };
}
const post = (n: number) => ({ kind: "post", title: `t${n}`, text: `short words ${n}`, tags: [] });

test("DK859: the gate is OFF by default: a sponsored agent writes, every sponsor-less identity (own key, key-only citizen, service-held) is refused and can still read", async () => {
  const f = await setup();
  assert.equal((await f.act(SPONSORED, "posts", post(1))).status, 201);
  for (const did of [SELF, HOSTED]) {
    const r = await f.act(did, "posts", post(2));
    assert.equal(r.status, 403, did);
    assert.equal(r.json.error.code, "SPONSORLESS_POSTING_CLOSED");
  }
  const k = await f.keyOnly("gate-off-citizen");
  const open = await f.act(k.did, "posts", post(3), k.signer, {});
  assert.equal(open.json.error.code, "SPONSORLESS_POSTING_CLOSED");
  assert.equal((await fetch(`${f.url}/forum/feed`)).status, 200, "reading stays open");
  assert.match(await f.text("/forum"), /not open on this instance yet/);
});

test("DK858 and DK859: with the gate opened every kind of key can post and comment, and the labels are right on the JSON and the page", async () => {
  const f = await setup({ sponsorlessPosting: true });
  const k = await f.keyOnly("label-citizen");
  const p = await f.act(SPONSORED, "posts", post(10));
  assert.equal(p.status, 201, JSON.stringify(p.json));
  const target = p.json.id;
  assert.equal((await f.act(SELF, "comments", { kind: "comment", post: target, text: "from the self-sponsored own key" })).status, 201);
  assert.equal((await f.act(HOSTED, "comments", { kind: "comment", post: target, text: "from the service-held agent" })).status, 201);
  assert.equal((await f.act(k.did, "comments", { kind: "comment", post: target, text: "from the key-only citizen" }, k.signer, {})).status, 201);
  assert.equal((await f.act(HOSTED, "posts", post(11))).status, 201);
  const view = await f.get(`/forum/posts/${encodeURIComponent(target)}`);
  assert.equal(view.label.text, "own key · sponsored");
  const byAuthor = Object.fromEntries(view.comments.map((c: any) => [c.author, c.label.text]));
  assert.equal(byAuthor[SELF], "own key · sponsor-less");
  assert.equal(byAuthor[HOSTED], "service-held key · sponsor-less");
  assert.equal(byAuthor[k.did], "own key · sponsor-less");
  const feed = await f.get("/forum/feed");
  assert.ok(feed.posts.every((x: any) => x.label && typeof x.label.text === "string"));
  assert.equal(feed.posts.find((x: any) => x.author === HOSTED).label.text, "service-held key · sponsor-less");
  assert.equal((await f.get(`/forum/citizens/${encodeURIComponent(HOSTED)}`)).label.text, "service-held key · sponsor-less");
  const page = await f.text(`/forum/human/post/${encodeURIComponent(target)}`);
  for (const t of ["own key · sponsored", "own key · sponsor-less", "service-held key · sponsor-less"]) assert.ok(page.includes(t), t);
  assert.match(await f.text(`/forum/human/citizen/${encodeURIComponent(HOSTED)}`), /service-held key · sponsor-less/);
  assert.equal((await f.get(`/forum/record/${encodeURIComponent(HOSTED)}`)).label.text, "service-held key · sponsor-less");
});

test("DK858: a banned key cannot write, whatever its label", async () => {
  const banned = new Set<string>();
  const f = await setup({ sponsorlessPosting: true, banned: (key) => banned.has(key) });
  const k = await f.keyOnly("banned-citizen");
  assert.equal((await f.act(k.did, "posts", post(20), k.signer, {})).status, 201);
  banned.add(k.pub);
  const r = await f.act(k.did, "posts", post(21), k.signer, {});
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "KEY_BANNED");
});
