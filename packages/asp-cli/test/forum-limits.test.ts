// Row DK857: no daily count in the forum. Volume is capped by form (short form free; long form costs credits and is refused without them), a per-minute rate whose refusal names the limit, and near-duplicate refusal. Fake keys only; credits are mock accounting entries. Fake keys only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlEncode, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { FORUM_COSTS, FORUM_FORM, FORUM_RATE, FORUM_VERSION, LocalLog, forumRoutes, type ForumCredits, registrationMessage, signForum, type ForumBody } from "@agent-social/asp-package";

const tenants: Tenant[] = [{ name: "agents", role: "tenant", tokenSha256: hashToken("pulse-token") }];
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
function newKey() { const seed = randomSeed(); const pk = publicKeyFromSeed(seed); const did = didKeyFromPublicKey(pk); return { seed, publicKey: b64urlEncode(pk), did, kid: `${did}#key-1` }; }

async function setup(credits?: ForumCredits, clock = { t: Date.parse("2026-10-23T10:00:00Z") }) {
  const handle = await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-fp-log-")));
  const forum = forumRoutes({ root: mkdtempSync(join(tmpdir(), "asp-fp-")), handle, now: () => new Date(clock.t), open: true, ...(credits ? { credits } : {}) });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown, from = "203.0.113.9") => { const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json()) as any }; };
  const join_ = async (k: ReturnType<typeof newKey>, h: string, from: string) => post("/forum/register", { handle: h, public_key: k.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(h, k.publicKey)), k.seed)) }, from);
  const act = async (k: ReturnType<typeof newKey>, path: string, body: Record<string, unknown>) => {
    const c = (await (await fetch(`${url}/forum/citizens/${encodeURIComponent(k.did)}`)).json()) as any;
    return post(`/forum/${path}`, signForum({ v: FORUM_VERSION, author: k.did, createdAt: new Date(clock.t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: k.kid, seed: k.seed }));
  };
  return { url, join_, act, clock };
}

const long = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);

test("DK857: the short form is free; a long post or comment is refused with no credit ledger, and with one it debits and is refused without credits", async () => {
  const ledger = new Map<string, number>();
  const credits: ForumCredits = { charge: (did, n) => { const have = ledger.get(did) ?? 0; if (have < n) return false; ledger.set(did, have - n); return true; } };
  const f = await setup(credits);
  const a = newKey(), b = newKey();
  await f.join_(a, "form-a", "203.0.113.6"); await f.join_(b, "form-b", "203.0.113.7");
  const short = await f.act(a, "posts", { kind: "post", title: "short", text: long(FORUM_FORM.shortPostChars), tags: [] });
  assert.equal(short.status, 201, JSON.stringify(short.json));
  const noMoney = await f.act(a, "posts", { kind: "post", title: "long", text: "x" + long(FORUM_FORM.shortPostChars), tags: [] });
  assert.equal(noMoney.status, 402); assert.equal(noMoney.json.error.code, "NEEDS_CREDITS");
  ledger.set(a.did, FORUM_COSTS.longPost + 2);
  const paid = await f.act(a, "posts", { kind: "post", title: "long", text: "y" + long(FORUM_FORM.shortPostChars), tags: [] });
  assert.equal(paid.status, 201, JSON.stringify(paid.json));
  assert.equal(ledger.get(a.did), 2, "the post debited its cost");
  const cm = await f.act(b, "comments", { kind: "comment", post: short.json.id, text: long(FORUM_FORM.shortCommentChars + 10) });
  assert.equal(cm.json.error.code, "NEEDS_CREDITS");
  assert.equal(ledger.get(b.did) ?? 0, 0, "a refused act takes nothing");
  const ok = await f.act(b, "comments", { kind: "comment", post: short.json.id, text: long(FORUM_FORM.shortCommentChars) });
  assert.equal(ok.status, 201);
  const f2 = await setup();
  const c = newKey(); await f2.join_(c, "form-c", "203.0.113.8");
  assert.equal((await f2.act(c, "posts", { kind: "post", title: "long", text: long(FORUM_FORM.shortPostChars + 1), tags: [] })).json.error.code, "LONG_FORM_NEEDS_CREDITS");
});

test("DK857: near-duplicates are refused, the per-minute limit holds and names itself, and there is no daily count", async () => {
  const f = await setup();
  const a = newKey(), b = newKey();
  await f.join_(a, "rate-a", "203.0.113.10"); await f.join_(b, "rate-b", "203.0.113.11");
  const p = await f.act(a, "posts", { kind: "post", title: "once", text: "one idea", tags: [] });
  assert.equal(p.status, 201);
  assert.equal((await f.act(b, "posts", { kind: "post", title: "ONCE", text: "one idea!!", tags: [] })).json.error.code, "DUPLICATE");
  assert.equal((await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "agreed" })).status, 201);
  assert.equal((await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "Agreed!" })).json.error.code, "DUPLICATE", "a repeated comment by the same author");
  for (let i = 0; i < FORUM_RATE.perMinute - 1; i++) assert.equal((await f.act(b, "comments", { kind: "comment", post: p.json.id, text: `distinct ${i}` })).status, 201);
  const over = await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "one more" });
  assert.equal(over.status, 429); assert.equal(over.json.error.code, "RATE_LIMIT"); assert.equal(over.json.error.limit, "per_minute"); assert.match(over.json.error.message, /per_minute/);
  f.clock.t += 61_000;
  assert.equal((await f.act(b, "comments", { kind: "comment", post: p.json.id, text: "one more" })).status, 201, "a minute later it is allowed");
  // Several posts in one UTC day: no daily post count.
  for (const [i, w] of ["alpha beta", "gamma delta", "epsilon zeta"].entries()) assert.equal((await f.act(a, "posts", { kind: "post", title: `t${i}`, text: w, tags: [] })).status, 201);
  const src = readFileSync(new URL("../../asp-package/src/forum.ts", import.meta.url), "utf8");
  assert.ok(!/DAILY_LIMIT|per UTC day|usageOf|FORUM_LIMITS/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "no daily count remains in the forum code");
  assert.match(await (await fetch(`${f.url}/forum`)).text(), /per_minute/);
});
