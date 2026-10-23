import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlEncode, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { FORUM_VERSION, Keystore, LocalLog, REGISTER_LIMITS, forumRoutes, registrationMessage, signForum, type ForumBody } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";

const TOKEN = "forum-open-tenant-token";
const tenants: Tenant[] = [{ name: "agents", role: "tenant", tokenSha256: hashToken(TOKEN) }];
const servers: Server[] = [];
after(() => { setClock(undefined); for (const s of servers) s.close(); });

/** A key-only citizen: a fresh Ed25519 key and the did:key it derives, with nothing in the log. */
function newKey() {
  const seed = randomSeed();
  const publicKey = publicKeyFromSeed(seed);
  const did = didKeyFromPublicKey(publicKey);
  return { seed, publicKey: b64urlEncode(publicKey), did, kid: `${did}#key-1` };
}

async function setup(opts: { open?: boolean } = { open: true }) {
  let t = Date.parse("2026-10-23T10:00:00Z");
  setClock(() => new Date(t));
  const handle = await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-fo-log-")));
  const root = mkdtempSync(join(tmpdir(), "asp-forum-open-"));
  const forum = forumRoutes({ root, handle, now: () => new Date(t), ...(opts.open ? { open: true } : {}) });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };
  const get = async (path: string) => (await fetch(`${url}${path}`)).json() as Promise<any>;
  /** Registers a key under a handle; `from` is the address the service sees (x-forwarded-for). */
  const register = (key: ReturnType<typeof newKey>, handle: string, from = "203.0.113.7", sign = key.seed) =>
    post("/forum/register", { handle, public_key: key.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(handle, key.publicKey)), sign)), model: "test-model" }, { "x-forwarded-for": from });
  const act = async (key: ReturnType<typeof newKey>, path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const c = await get(`/forum/citizens/${encodeURIComponent(key.did)}`);
    const doc = signForum({ v: FORUM_VERSION, author: key.did, createdAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: key.kid, seed: key.seed });
    return post(`/forum/${path}`, doc, headers);
  };
  return { url, root, get, post, register, act, advance: (ms: number) => { t += ms; } };
}

test("a key alone joins: the did is the key's did:key, the record says there is no sponsor, and nothing secret is issued", async () => {
  const f = await setup();
  const k = newKey();
  const r = await f.register(k, "first-agent");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.did, k.did);
  assert.equal(r.json.handle, "first-agent");
  assert.equal(r.json.sponsor, null);
  assert.equal("token" in r.json || "secret" in r.json, false);
  const c = await f.get(`/forum/citizens/${encodeURIComponent(k.did)}`);
  assert.equal(c.handle, "first-agent");
  assert.equal(c.sponsor, null);
  assert.equal(c.joined, "key only");
  assert.equal(c.reputation, null, "no tier, slash or accepted job: those come from the log");
});

test("registration refuses a bad signature, a bad or reserved handle, a taken handle and a key that is already registered", async () => {
  const f = await setup();
  const k = newKey();
  const other = newKey();
  const wrongKey = await f.register(k, "someone", "203.0.113.1", other.seed);
  assert.equal(wrongKey.status, 403);
  assert.equal(wrongKey.json.error.code, "BAD_SIGNATURE");
  assert.equal((await f.register(k, "Bad Handle!", "203.0.113.2")).json.error.code, "BAD_HANDLE");
  assert.equal((await f.register(k, "ab", "203.0.113.2")).json.error.code, "BAD_HANDLE");
  assert.equal((await f.register(k, "operator", "203.0.113.2")).json.error.code, "RESERVED_HANDLE");
  assert.equal((await f.register(k, "first", "203.0.113.3")).status, 201);
  assert.equal((await f.register(newKey(), "first", "203.0.113.4")).json.error.code, "HANDLE_TAKEN");
  const again = await f.register(k, "second", "203.0.113.5");
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ALREADY_REGISTERED");
  assert.equal(again.json.error.handle, "first");
});

test("registration is throttled per address and per service, and the address limit resets after an hour", async () => {
  const f = await setup();
  for (let i = 0; i < REGISTER_LIMITS.perAddressPerHour; i++) assert.equal((await f.register(newKey(), `agent-${i}`, "198.51.100.9")).status, 201);
  const blocked = await f.register(newKey(), "agent-extra", "198.51.100.9");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, "REGISTRATION_LIMIT");
  assert.equal(blocked.json.error.limit, "address");
  assert.equal((await f.register(newKey(), "agent-elsewhere", "198.51.100.10")).status, 201, "another address is unaffected");
  f.advance(3_600_001);
  assert.equal((await f.register(newKey(), "agent-later", "198.51.100.9")).status, 201, "an hour later the address may join again");

  const g = await setup();
  for (let i = 0; i < REGISTER_LIMITS.perServicePerHour; i++) assert.equal((await g.register(newKey(), `citizen-${i}`, `10.0.${Math.floor(i / 250)}.${i % 250}`)).status, 201);
  const full = await g.register(newKey(), "one-too-many", "10.9.9.9");
  assert.equal(full.status, 429);
  assert.equal(full.json.error.limit, "service");
});

test("a key-only citizen posts, comments and votes with no token, under the same daily caps; an unregistered author is refused", async () => {
  const f = await setup();
  const a = newKey();
  const b = newKey();
  assert.equal((await f.register(a, "alpha-agent", "192.0.2.1")).status, 201);
  assert.equal((await f.register(b, "beta-agent", "192.0.2.2")).status, 201);
  const p = await f.act(a, "posts", { kind: "post", title: "A first record", text: "Every act is signed and chained.", tags: ["record"] });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  const again = await f.act(a, "posts", { kind: "post", title: "A second one", text: "A different thought entirely.", tags: [] });
  assert.equal(again.status, 429);
  assert.equal(again.json.error.code, "DAILY_LIMIT");
  const c = await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "Agreed." });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const v = await f.act(b, "votes", { kind: "vote", target: p.json.id, value: 1 });
  assert.equal(v.status, 201, JSON.stringify(v.json));
  const feed = await f.get("/forum/feed");
  assert.equal(feed.posts[0].handle, "alpha-agent");
  assert.equal(feed.posts[0].score, 1);

  const stranger = newKey();
  const refused = await f.act(stranger, "posts", { kind: "post", title: "Not joined", text: "No registration.", tags: [] });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error.code, "NOT_REGISTERED");

  const doc = signForum({ v: FORUM_VERSION, kind: "comment", author: b.did, post: p.json.id, text: "Forged.", createdAt: "2026-10-23T10:00:00Z", prev: null } as ForumBody, { kid: a.kid, seed: a.seed });
  const forged = await f.post("/forum/comments", doc);
  assert.notEqual(forged.status, 201, "a key may sign only for its own did");
});

test("the record verifies with key-only citizens", async () => {
  const f = await setup();
  const a = newKey();
  assert.equal((await f.register(a, "recorder", "192.0.2.50")).status, 201);
  assert.equal((await f.act(a, "posts", { kind: "post", title: "Verifiable", text: "Check this offline.", tags: [] })).status, 201);
  const v = await f.get("/forum/verify");
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.equal(v.entries, 1);
});

test("a forum that is not open refuses registration and a token-less write", async () => {
  const f = await setup({});
  const k = newKey();
  const r = await f.register(k, "closed-door");
  assert.equal(r.status, 401);
  const w = await f.act(k, "posts", { kind: "post", title: "No", text: "Not open.", tags: [] });
  assert.equal(w.status, 401);
});

test("asp forum register joins with a key already in the keystore", async () => {
  const f = await setup();
  const home = mkdtempSync(join(tmpdir(), "asp-fo-home-"));
  const k = newKey();
  new Keystore(home).createFromSeed(k.kid, k.seed);
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: f.url, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, cwd: home };
  const code = await main(["forum", "register", "cli-agent", "--did", k.did, "--model", "test-model"], io);
  assert.equal(code, 0, err.join("\n"));
  assert.ok(out.join("\n").includes(`joined as cli-agent: ${k.did}`));
  const c = await f.get(`/forum/citizens/${encodeURIComponent(k.did)}`);
  assert.equal(c.handle, "cli-agent");
  assert.equal(c.model, "test-model");
});
