import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { randomSeed } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { FORUM_VERSION, Keystore, LocalLog, forumRoutes, signForum, type ForumBody } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";

const HUMAN = "did:web:example.com:users:navien";
const OPERATOR = "did:web:example.com:agents:operator";
const A = "did:web:example.com:agents:alice";
const B = "did:web:example.com:agents:bob";
const C = "did:web:example.com:agents:carol";
const TOKEN = "forum-tenant-token";
const ADMIN = "forum-admin-token";
const tenants: Tenant[] = [
  { name: "agents", role: "tenant", tokenSha256: hashToken(TOKEN) },
  { name: "ops", role: "admin", tokenSha256: hashToken(ADMIN) },
];

const servers: Server[] = [];
after(() => { setClock(undefined); for (const s of servers) s.close(); });

const DAY = 86_400_000;

async function setup(opts: { unlimited?: boolean } = {}) {
  let t = Date.parse("2026-10-21T10:00:00Z");
  setClock(() => new Date(t));
  const handle = await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-fm-log-")));
  const root = mkdtempSync(join(tmpdir(), "asp-forum-"));
  const forum = forumRoutes({ root, handle, now: () => new Date(t), ...(opts.unlimited ? { unlimited: true } : {}) });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const home = mkdtempSync(join(tmpdir(), "asp-fm-home-"));
  const asp = async (args: string[], token = TOKEN) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: url, ASP_LOG_TOKEN: token, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, cwd: home };
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  assert.equal((await asp(["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  for (const did of [OPERATOR, A, B, C]) assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", did, "--sponsor", HUMAN])).code, 0);
  const file = (name: string, text: string) => { const p = join(home, name); writeFileSync(p, text); return p; };
  const get = async (path: string) => (await fetch(`${url}${path}`)).json() as Promise<any>;
  /** Signs and posts one act directly (faster than the CLI for the volume tests). */
  const act = async (did: string, path: string, body: Record<string, unknown>, token = TOKEN) => {
    const c = await get(`/forum/citizens/${encodeURIComponent(did)}`);
    const signer = new Keystore(home).forDid(did)!;
    const doc = signForum({ v: FORUM_VERSION, author: did, createdAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, signer);
    const res = await fetch(`${url}/forum/${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(doc) });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { asp, url, home, root, file, get, act, advance: (ms: number) => { t += ms; } };
}

const idOf = (out: string) => /(?:posted|commented|voted \w+|hidden): (sha256:[0-9a-f]{64})/.exec(out)![1];

test("the daily caps name the limit and reset at the next UTC day; duplicates, self-votes and wrong prev are refused", async () => {
  const f = await setup();
  const p1 = await f.asp(["forum", "post", f.file("a.md", "Agents should cite the page they fetched."), "--by", A, "--title", "Cite your sources", "--tag", "method,web"]);
  assert.equal(p1.code, 0, p1.err);
  const post = idOf(p1.out);

  const second = await f.asp(["forum", "post", f.file("b.md", "A different thought entirely."), "--by", A, "--title", "Another"]);
  assert.notEqual(second.code, 0);
  assert.match(second.err, /1 post allowed per UTC day; resets at 2026-10-22T00:00:00Z/);

  const dup = await f.asp(["forum", "post", f.file("c.md", "agents should CITE the page they fetched!!"), "--by", B, "--title", "cite your sources"]);
  assert.notEqual(dup.code, 0);
  assert.match(dup.err, /near-duplicate/);

  const self = await f.asp(["forum", "vote", post, "--by", A, "--up"]);
  assert.notEqual(self.code, 0);
  assert.match(self.err, /your own/);

  assert.equal((await f.asp(["forum", "vote", post, "--by", B, "--up"])).code, 0);
  assert.match((await f.asp(["forum", "vote", post, "--by", B, "--up"])).err, /already stands/);
  assert.equal((await f.asp(["forum", "vote", post, "--by", C, "--down"])).code, 0);
  assert.match((await f.asp(["forum", "record", A])).out, /karma 0, 1 act/);
  assert.equal((await f.asp(["forum", "vote", post, "--by", C, "--up"])).code, 0); // a changed vote replaces the standing one
  assert.match((await f.asp(["forum", "record", A])).out, /karma 2/);

  // The next UTC day the post allowance is back.
  f.advance(DAY);
  assert.equal((await f.asp(["forum", "post", f.file("b2.md", "A different thought entirely."), "--by", A, "--title", "Another"])).code, 0);

  // A stale prev (a fork) is refused with the id that was expected.
  const stale = await f.act(B, "comments", { kind: "comment", post, text: "hi", prev: null });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "BAD_PREV");
});

test("20 comments and 50 votes per day, then the next refusal names the limit", async () => {
  const f = await setup();
  const post = idOf((await f.asp(["forum", "post", f.file("a.md", "root"), "--by", A, "--title", "Root"])).out);
  const comments: string[] = [];
  for (let day = 0; day < 3; day++) {
    for (let i = 0; i < 20 && comments.length < 51; i++) {
      const r = await f.act(A, "comments", { kind: "comment", post, text: `comment ${comments.length}` });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      comments.push(r.json.id);
    }
    if (day === 0) { const over = await f.act(A, "comments", { kind: "comment", post, text: "one too many" }); assert.equal(over.status, 429); assert.match(over.json.error.message, /20 comments/); }
    f.advance(DAY);
  }
  for (const id of comments.slice(0, 50)) assert.equal((await f.act(B, "votes", { kind: "vote", target: id, value: 1 })).status, 201);
  const over = await f.act(B, "votes", { kind: "vote", target: comments[50], value: 1 });
  assert.equal(over.status, 429);
  assert.equal(over.json.error.code, "DAILY_LIMIT");
  assert.match(over.json.error.message, /50 votes/);
  assert.equal((await f.get(`/forum/citizens/${encodeURIComponent(A)}`)).karma, 50);
});

test("the service rejects unknown keys, the wrong DID's key, tampering, and a hide from a non-operator", async () => {
  const f = await setup();
  const body = (author: string) => ({ v: FORUM_VERSION as typeof FORUM_VERSION, kind: "post" as const, author, title: "T", text: "text", tags: [] as string[], createdAt: "2026-10-21T10:00:00Z", prev: null });
  const post = (doc: unknown, token = TOKEN) => fetch(`${f.url}/forum/posts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(doc) });
  const code = async (r: Response) => ((await r.json()) as any).error.code;

  const ghost = "did:web:example.com:agents:ghost";
  assert.equal(await code(await post(signForum(body(ghost), { kid: `${ghost}#key-1`, seed: randomSeed() }))), "UNKNOWN_KEY");
  assert.equal(await code(await post(signForum(body(A), { kid: `${B}#key-1`, seed: randomSeed() }))), "WRONG_KEY");
  assert.equal(await code(await post(signForum(body(A), { kid: `${A}#key-1`, seed: randomSeed() }))), "BAD_SIGNATURE");
  assert.equal((await fetch(`${f.url}/forum/posts`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);

  const real = idOf((await f.asp(["forum", "post", f.file("a.md", "something to hide"), "--by", A, "--title", "Hide me"])).out);
  const notOp = await f.asp(["forum", "hide", real, "--by", OPERATOR, "--reason", "spam"]);
  assert.notEqual(notOp.code, 0);
  assert.match(notOp.err, /only the operator/);
  const hid = await f.asp(["forum", "hide", real, "--by", OPERATOR, "--reason", "posted a live key"], ADMIN);
  assert.equal(hid.code, 0, hid.err);
  const shown = await f.asp(["forum", "show", real]);
  assert.match(shown.out, /\[hidden by the operator: posted a live key\]/);
  assert.doesNotMatch(shown.out, /something to hide/);
  assert.match((await f.asp(["forum", "feed"])).out, /\[hidden\]/);
});

test("the record verifies, and an edited document or a cut chain is caught; citizens show tier and slashes from the log", async () => {
  const f = await setup();
  const post = idOf((await f.asp(["forum", "post", f.file("a.md", "original words"), "--by", A, "--title", "Orig"])).out);
  await f.asp(["forum", "comment", post, f.file("c.md", "a reply"), "--by", B]);
  const reply = (await f.get(`/forum/posts/${encodeURIComponent(post)}`)).comments[0].id;
  await f.asp(["forum", "comment", post, f.file("c2.md", "a reply to the reply"), "--by", C, "--parent", reply]);
  const ok = await f.asp(["forum", "verify"]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /verified: 3 act/);
  assert.equal((await f.get("/forum/head")).seq, 3);

  const rec = await f.asp(["forum", "record", A]);
  assert.match(rec.out, /from the log: tier \d, 0 slash\(es\)/);
  const html = await (await fetch(`${f.url}/forum/human/citizen/${encodeURIComponent(A)}`)).text();
  assert.match(html, /tier/);
  const page = await (await fetch(`${f.url}/forum/human/post/${encodeURIComponent(post)}`)).text();
  assert.match(page, /a reply to the reply/);
  assert.match(await (await fetch(`${f.url}/forum/constitution`)).text(), /1 post, 20 comments, 50 votes/);
  assert.match(await (await fetch(`${f.url}/forum/llms.txt`)).text(), /POST \/forum\/posts/);

  const file = join(f.root, "docs", readdirSync(join(f.root, "docs")).find((n) => n.startsWith(post.replace(":", "-")))!);
  writeFileSync(file, readFileSync(file, "utf8").replace("original words", "changed words"));
  const bad = await f.asp(["forum", "verify"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /was changed after it was recorded/);
});

test("html pages escape what agents wrote", async () => {
  const f = await setup();
  const post = idOf((await f.asp(["forum", "post", f.file("a.md", "<script>alert(1)</script>"), "--by", A, "--title", "<b>x</b>"])).out);
  const html = await (await fetch(`${f.url}/forum/human/post/${encodeURIComponent(post)}`)).text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("with the daily caps lifted a citizen can post and comment past the usual limits, and every other rule still holds", async () => {
  const f = await setup({ unlimited: true });
  const first = await f.act(A, "posts", { kind: "post", tags: [], title: "One", text: "first words" });
  assert.equal(first.status, 201);
  assert.equal((await f.act(A, "posts", { kind: "post", tags: [], title: "Two", text: "second, different words" })).status, 201, "a second post on the same day");
  for (let i = 0; i < 25; i++) assert.equal((await f.act(B, "comments", { kind: "comment", post: first.json.id, text: `comment ${i}` })).status, 201);
  assert.equal((await f.act(A, "posts", { kind: "post", tags: [], title: "One", text: "first words" })).json.error.code, "DUPLICATE");
  assert.equal((await f.act(A, "votes", { kind: "vote", target: first.json.id, value: 1 })).json.error.code, "OWN_TARGET");
  const c = await f.get(`/forum/citizens/${encodeURIComponent(B)}`);
  assert.equal(c.limits.comment, null);
  assert.match(await (await fetch(`${f.url}/forum/constitution`)).text(), /test run with the daily caps lifted/);
  assert.match((await f.asp(["forum", "record", B])).out, /25 of no limit comments|25.no limit comments/);
});

test("a post written in the meme convention is drawn as a meme card, escaped, and other posts are not", async () => {
  const f = await setup();
  const classic = idOf((await f.asp(["forum", "post", f.file("m1.md", "[meme:classic] 🤖 me: writes the tests // the tests: <b>pass</b>"), "--by", A, "--title", "meme one", "--tag", "meme"])).out);
  await f.asp(["forum", "post", f.file("m2.md", "[meme:ladder] 🥱 read the docs // 🙂 skim the docs // 😮 ask the docs // 🤯 become the docs"), "--by", B, "--title", "meme two", "--tag", "meme"]);
  await f.asp(["forum", "post", f.file("m3.md", "[meme:choice] 😎 meetings // async"), "--by", C, "--title", "meme three", "--tag", "meme"]);
  await f.asp(["forum", "post", f.file("p.md", "just words, no meme"), "--by", OPERATOR, "--title", "plain", "--tag", "feed"]);
  const html = await (await fetch(`${f.url}/forum/human`)).text();
  assert.equal((html.match(/class="meme /g) ?? []).length, 3);
  assert.match(html, /meme classic/);
  assert.match(html, /meme ladder/);
  assert.match(html, /meme choice/);
  assert.doesNotMatch(html, /<b>pass<\/b>/, "agent text is escaped inside a meme");
  assert.match(html, /just words, no meme/);
  const page = await (await fetch(`${f.url}/forum/human/post/${encodeURIComponent(classic)}`)).text();
  assert.match(page, /class="meme classic"/);
  assert.match(page, /&lt;b&gt;pass&lt;\/b&gt;/);
});
