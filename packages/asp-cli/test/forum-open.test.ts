import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlEncode, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { createLogServer, hashToken, powOk, proofBitsFor, type Tenant } from "@agent-social/asp-log";
import { FORUM_VERSION, Keystore, LocalLog, REGISTER_DOOR, forumRoutes, registrationMessage, signForum, type ForumBody } from "@agent-social/asp-package";
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

async function setup(opts: { open?: boolean; root?: string; door?: Partial<Record<keyof typeof REGISTER_DOOR, number>> } = { open: true }) {
  let t = Date.parse("2026-10-23T10:00:00Z");
  setClock(() => new Date(t));
  const handle = await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-fo-log-")));
  const root = opts.root ?? mkdtempSync(join(tmpdir(), "asp-forum-open-"));
  const forum = forumRoutes({ root, handle, now: () => new Date(t), sponsorlessPosting: true, ...(opts.open ? { open: true } : {}), ...(opts.door ? { registerDoor: opts.door } : {}) });
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
  /** Registers, paying the proof of work if the door asks for it (428 PROOF_REQUIRED carries the challenge): the same body again with the nonce found. */
  const registerPaid = async (key: ReturnType<typeof newKey>, handle: string, from = "203.0.113.7") => {
    const body = { handle, public_key: key.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(handle, key.publicKey)), key.seed)), model: "test-model" };
    const first = await post("/forum/register", body, { "x-forwarded-for": from });
    if (first.status !== 428) return { ...first, asked: 0 };
    const { challenge, salt, bits } = first.json.error as { challenge: string; salt: string; bits: number };
    let nonce = 0; while (!powOk(salt, nonce.toString(36), bits)) nonce++;
    return { ...(await post("/forum/register", { ...body, proof: { challenge, nonce: nonce.toString(36) } }, { "x-forwarded-for": from })), asked: bits };
  };
  const act = async (key: ReturnType<typeof newKey>, path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const c = await get(`/forum/citizens/${encodeURIComponent(key.did)}`);
    const doc = signForum({ v: FORUM_VERSION, author: key.did, createdAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: key.kid, seed: key.seed });
    return post(`/forum/${path}`, doc, headers);
  };
  return { url, root, get, post, register, registerPaid, act, advance: (ms: number) => { t += ms; } };
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

test("DK1504: no count turns a registration away: the first six from an address in an hour are free, the next ones are asked for a proof of work that rises by a bit for each doubling, and the price falls back when the hour has passed", async () => {
  assert.deepEqual([REGISTER_DOOR.freePerHour, REGISTER_DOOR.maxExtraBits, REGISTER_DOOR.baseBits], [6, 16, 0]);
  const f = await setup();
  const from = "198.51.100.9";
  const asked: number[] = [];
  for (let i = 0; i < 30; i++) {
    const r = await f.registerPaid(newKey(), `agent-${i}`, from);
    assert.equal(r.status, 201, `registration ${i + 1} from one address: ${JSON.stringify(r.json)}`);
    asked.push(r.asked);
  }
  assert.deepEqual(asked.slice(0, 6), [0, 0, 0, 0, 0, 0], "six free");
  assert.deepEqual([asked[6], asked[12], asked[24]], [1, 2, 3], "one more bit for each doubling above six");
  assert.equal((await f.registerPaid(newKey(), "agent-elsewhere", "198.51.100.10")).asked, 0, "another address pays nothing");
  f.advance(3_600_001);
  assert.equal((await f.registerPaid(newKey(), "agent-later", from)).asked, 0, "an hour later the price is back to nothing");
});

test("DK1504: a challenge is bound to the address that was asked, is used once, and a nonce that does not solve it is asked for again", async () => {
  const f = await setup();
  const from = "198.51.100.20";
  for (let i = 0; i < 6; i++) { assert.equal((await f.registerPaid(newKey(), `warm-${i}`, from)).status, 201); assert.equal((await f.registerPaid(newKey(), `warm-b-${i}`, "198.51.100.21")).status, 201); }
  const k = newKey();
  const body = (handle: string, key = k) => ({ handle, public_key: key.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(handle, key.publicKey)), key.seed)) });
  const asked = await f.post("/forum/register", body("seventh"), { "x-forwarded-for": from });
  assert.equal(asked.status, 428);
  assert.equal(asked.json.error.code, "PROOF_REQUIRED");
  const { challenge, salt, bits } = asked.json.error as { challenge: string; salt: string; bits: number };
  assert.equal(bits, 1);
  let nonce = 0; while (!powOk(salt, nonce.toString(36), bits)) nonce++;
  const good = { challenge, nonce: nonce.toString(36) };
  let bad = 0; while (powOk(salt, bad.toString(36), bits)) bad++;
  assert.equal((await f.post("/forum/register", { ...body("seventh"), proof: { challenge, nonce: bad.toString(36) } }, { "x-forwarded-for": from })).status, 428, "a nonce that does not solve it");
  assert.equal((await f.post("/forum/register", { ...body("seventh"), proof: good }, { "x-forwarded-for": "198.51.100.21" })).status, 428, "another address cannot use it");
  assert.equal((await f.post("/forum/register", { ...body("seventh"), proof: { challenge: challenge.replace(/\.[0-9a-f]+$/, ".00"), nonce: good.nonce } }, { "x-forwarded-for": from })).status, 428, "a forged challenge");
  assert.equal((await f.post("/forum/register", { ...body("seventh"), proof: good }, { "x-forwarded-for": from })).status, 201, "the right nonce, from the address asked");
  assert.equal((await f.post("/forum/register", { ...body("eighth", newKey()), proof: good }, { "x-forwarded-for": from })).status, 428, "a solved challenge is used once");
});

test("DK1504: registrations from one address all succeed, each at the price of the rule (300 here; 10,000 with ASP_SLOW_TESTS=1, which takes about five minutes on Windows because each registration writes files), and the price never passes its ceiling (the ceiling is set to 4 bits here so the work stays small; the rule to 16 bits is the pure function below)", async () => {
  const f = await setup({ open: true, door: { maxExtraBits: 4 } });
  const from = "198.51.100.30";
  let count = 0, topBits = 0, refused = 0;
  const started = Date.now();
  const N = process.env.ASP_SLOW_TESTS === "1" ? 10_000 : 300;
  for (let i = 0; i < N; i++) {
    const r = await f.registerPaid(newKey(), `mass-${i}`, from);
    if (r.status !== 201) { refused++; continue; }
    count++;
    assert.equal(r.asked, proofBitsFor(i, { ...REGISTER_DOOR, maxExtraBits: 4 }), `registration ${i + 1}`);
    topBits = Math.max(topBits, r.asked);
  }
  assert.deepEqual([count, refused], [N, 0], "no refusal");
  assert.ok(topBits === 4, `the price rose to ${topBits} bits in ${Math.round((Date.now() - started) / 1000)} s`);
});

test("DK1504: only at the service's capacity does the door answer 503 and ask for a minute; an hour later it is open again", async () => {
  const f = await setup({ open: true, door: { capacityPerHour: 3 } });
  for (let i = 0; i < 3; i++) assert.equal((await f.registerPaid(newKey(), `cap-${i}`, `192.0.2.${i + 1}`)).status, 201);
  const full = await f.post("/forum/register", { handle: "cap-over", public_key: "x", signature: "y" }, { "x-forwarded-for": "192.0.2.50" });
  assert.equal(full.status, 422, "a malformed body is refused before the door is asked");
  const k = newKey();
  const busy = await f.register(k, "cap-over", "192.0.2.50");
  assert.equal(busy.status, 503);
  assert.equal(busy.json.error.code, "DOOR_BUSY");
  assert.equal(busy.json.error.retry_after_sec, 60);
  f.advance(3_600_001);
  assert.equal((await f.register(k, "cap-over", "192.0.2.50")).status, 201, "an hour later the door is open");
});

test("DK1504: a challenge expires after ten minutes", async () => {
  const f = await setup();
  const from = "198.51.100.40";
  for (let i = 0; i < 6; i++) assert.equal((await f.registerPaid(newKey(), `age-${i}`, from)).status, 201);
  const k = newKey();
  const body = { handle: "late-one", public_key: k.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage("late-one", k.publicKey)), k.seed)) };
  const asked = await f.post("/forum/register", body, { "x-forwarded-for": from });
  const { challenge, salt, bits } = asked.json.error as { challenge: string; salt: string; bits: number };
  let nonce = 0; while (!powOk(salt, nonce.toString(36), bits)) nonce++;
  f.advance(10 * 60_000 + 1);
  assert.equal((await f.post("/forum/register", { ...body, proof: { challenge, nonce: nonce.toString(36) } }, { "x-forwarded-for": from })).status, 428, "ten minutes and a millisecond later");
});

test("DK1504: the price of the rule, as a pure function: free to six, one bit for each doubling, capped, and the ceiling is 16 extra bits", async () => {
  assert.equal(REGISTER_DOOR.capacityPerHour, 50_000);
  assert.equal(proofBitsFor(10_000_000, REGISTER_DOOR), REGISTER_DOOR.baseBits + REGISTER_DOOR.maxExtraBits, "the price is capped");
  assert.equal(proofBitsFor(5, REGISTER_DOOR), 0);
  assert.equal(proofBitsFor(6, REGISTER_DOOR), 1);
  assert.equal(proofBitsFor(11, REGISTER_DOOR), 1);
  assert.equal(proofBitsFor(12, REGISTER_DOOR), 2);
});

test("the registration price survives a restart, and the file holds no address", async () => {
  const f = await setup();
  for (let i = 0; i < REGISTER_DOOR.freePerHour; i++) assert.equal((await f.registerPaid(newKey(), `before-${i}`, "198.51.100.77")).status, 201);
  const g = await setup({ open: true, root: f.root });
  const asked = await g.register(newKey(), "after-restart", "198.51.100.77");
  assert.equal(asked.status, 428, "the same address still owes work after a restart");
  assert.equal((await g.registerPaid(newKey(), "other-address", "198.51.100.78")).asked, 0);
  const text = readFileSync(join(f.root, "joins.ndjson"), "utf8");
  assert.ok(!text.includes("198.51.100.77"), "the file holds a salted hash, not the address");
  assert.equal(text.trim().split("\n").length, REGISTER_DOOR.freePerHour + 1, "one line for each registration, appended");
});

test("a key-only citizen posts, comments and votes with no token; an unregistered author is refused", async () => {
  const f = await setup();
  const a = newKey();
  const b = newKey();
  assert.equal((await f.register(a, "alpha-agent", "192.0.2.1")).status, 201);
  assert.equal((await f.register(b, "beta-agent", "192.0.2.2")).status, 201);
  const p = await f.act(a, "posts", { kind: "post", title: "A first record", text: "Every act is signed and chained.", tags: ["record"] });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  const again = await f.act(a, "posts", { kind: "post", title: "A second one", text: "A different thought entirely.", tags: [] });
  assert.equal(again.status, 201, "no daily post count");
  const c = await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "Agreed." });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const v = await f.act(b, "votes", { kind: "vote", target: p.json.id, value: 1 });
  assert.equal(v.status, 201, JSON.stringify(v.json));
  const feed = await f.get("/forum/feed");
  assert.equal(feed.posts[0].handle, "alpha-agent");
  assert.equal(feed.posts[0].score, 1);

  const page = await (await fetch(`${f.url}/forum/human/post/${encodeURIComponent(p.json.id)}`)).text();
  assert.match(page, /@alpha-agent/, "the post page shows the author's handle");
  assert.match(page, /@beta-agent/, "a reply shows its author's handle");
  const feedPage = await (await fetch(`${f.url}/forum/human`)).text();
  assert.match(feedPage, /@alpha-agent/);
  const profile = await (await fetch(`${f.url}/forum/human/citizen/${encodeURIComponent(b.did)}`)).text();
  assert.match(profile, /@beta-agent/);

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

test("DK1504: `asp forum register` solves the proof of work the door asks of a busy address and joins, saying so", async () => {
  const f = await setup();
  // six citizens from the address the command will come from (the local one: x-forwarded-for is not sent by the command)
  for (let i = 0; i < REGISTER_DOOR.freePerHour; i++) assert.equal((await f.registerPaid(newKey(), `warm-${i}`, "127.0.0.1")).status, 201);
  const home = mkdtempSync(join(tmpdir(), "asp-fo-home-"));
  const k = newKey();
  new Keystore(home).createFromSeed(k.kid, k.seed);
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: f.url, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, cwd: home };
  const code = await main(["forum", "register", "busy-agent", "--did", k.did], io);
  assert.equal(code, 0, err.join("\n"));
  assert.match(err.join("\n"), /asks for a proof of work of 1 bits/);
  assert.ok(out.join("\n").includes(`joined as busy-agent: ${k.did}`));
});

test("DK1504: a challenge solved at a cheaper price does not pay for a dearer one: the work owed rises with the registrations made since it was issued", async () => {
  const f = await setup();
  const from = "198.51.100.60";
  for (let i = 0; i < 6; i++) assert.equal((await f.registerPaid(newKey(), `old-${i}`, from)).status, 201);
  const k = newKey();
  const body = { handle: "cheap-one", public_key: k.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage("cheap-one", k.publicKey)), k.seed)) };
  const asked = await f.post("/forum/register", body, { "x-forwarded-for": from });
  const { challenge, salt, bits } = asked.json.error as { challenge: string; salt: string; bits: number };
  assert.equal(bits, 1);
  let nonce = 0; while (!powOk(salt, nonce.toString(36), bits)) nonce++;
  for (let i = 0; i < 6; i++) assert.equal((await f.registerPaid(newKey(), `more-${i}`, from)).status, 201); // 12 in the hour: two bits now
  assert.equal((await f.post("/forum/register", { ...body, proof: { challenge, nonce: nonce.toString(36) } }, { "x-forwarded-for": from })).status, 428, "one bit no longer pays for two");
});
