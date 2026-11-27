// Row DK1000 (owner decision DK1000-PAYMENT): a long forum post or comment is paid for with the author's own signed purchase in the real log: the author buys `forum.post.long` or `forum.comment.long` and cites the purchase in
// `paid`; the forum checks it (the author's, for that service, for at least the price, once) and the log has already taken the credits under the author's Mandate and the price list's split. A key-only citizen with no credits
// can still post short. Fake keys only. Credits are mock accounting entries, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64urlEncode, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes, signerFromSeed } from "@agent-social/asp-core";
import { institutionDid } from "@agent-social/asp-log";
import { FORUM_COSTS, FORUM_FORM, FORUM_SERVICES, FORUM_VERSION, forumRoutes, logForumCredits, registrationMessage, signForum, type ForumBody } from "@agent-social/asp-package";
import { credit, kit, mk, refusedBy, type Party } from "../../asp-log/test/society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const long = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);

function newKey() {
  const seed = randomSeed(); const pk = publicKeyFromSeed(seed); const did = didKeyFromPublicKey(pk); const kid = `${did}#key-1`;
  const party = { did, ...signerFromSeed(kid, seed), publicKey: pk } as unknown as Party;
  return { seed, publicKey: b64urlEncode(pk), did, kid, party };
}
type Key = ReturnType<typeof newKey>;

async function world() {
  const k = await kit();
  const research = institutionDid("research");
  const split = { treasury_permille: 150, burn_permille: 50, payees: [{ account: research, permille: 800 }] };
  const listId = await k.issueList([
    { service: FORUM_SERVICES.post, institution: research, price: FORUM_COSTS.longPost, class: "standard", split },
    { service: FORUM_SERVICES.comment, institution: research, price: FORUM_COSTS.longComment, class: "standard", split },
  ]);
  const clock = { t: Date.parse("2026-10-23T10:00:00Z") };
  const forum = forumRoutes({ root: mkdtempSync(join(tmpdir(), "asp-fpaid-")), handle: { log: k.log } as never, now: () => new Date(clock.t), open: true, sponsorlessPosting: true, credits: logForumCredits({ log: k.log }) });
  const server = createServer(async (req, res) => { if (!(await forum.publicRoutes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown, from = "203.0.113.9") => { const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json()) as any }; };
  let n = 0;
  const join_ = (key: Key, handle: string) => post("/forum/register", { handle, public_key: key.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(handle, key.publicKey)), key.seed)) }, `203.0.113.${10 + ++n}`);
  const act = async (key: Key, path: string, body: Record<string, unknown>) => {
    const c = (await (await fetch(`${url}/forum/citizens/${encodeURIComponent(key.did)}`)).json()) as any;
    return post(`/forum/${path}`, signForum({ v: FORUM_VERSION, author: key.did, createdAt: new Date(clock.t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: key.kid, seed: key.seed }));
  };
  /** A log identity for a key: a passport (key only), credits, and a Mandate that lets it spend at the commons. */
  const enrol = async (key: Key, funds: number) => {
    await k.log.append(mk("passport", key.party, { did: key.did, kind: "agent", sponsor: key.did, tier: 1, shape: {}, keys: [{ id: key.kid, type: "Ed25519", public_key: key.publicKey }] }, null, { subject: key.did }));
    if (funds) await k.mint(key.did, funds);
    return k.openMandate(key.party, [{ institution: "research", cap: credit(40), period: "month" }]);
  };
  const buy = async (key: Key, mandate: string, service: string, amount: number) => {
    const p = mk("purchase", key.party, { service, institution: research, price_list: listId, quantity: 1, amount: credit(amount), idempotency: `fp-${++n}`, mandate });
    await k.log.append(p);
    return p.id;
  };
  return { k, research, act, join_, enrol, buy };
}

test("DK1000: a long post is paid for by the author's own purchase in the log; it is refused without one, cannot cite another citizen's purchase or one that bought something else, and one purchase pays for one act", async () => {
  const w = await world();
  const a = newKey(), b = newKey();
  await w.join_(a, "paid-a"); await w.join_(b, "paid-b");
  const mandateA = await w.enrol(a, 20);
  const mandateB = await w.enrol(b, 20);
  const text = "y" + long(FORUM_FORM.shortPostChars);
  const noPurchase = await w.act(a, "posts", { kind: "post", title: "long", text, tags: [] });
  assert.equal(noPurchase.status, 402);
  assert.equal(noPurchase.json.error.code, "NEEDS_CREDITS");
  assert.match(noPurchase.json.error.message, /forum\.post\.long/, "the refusal names the service to buy");
  const before = await w.k.log.balance(a.did);
  const purchase = await w.buy(a, mandateA, FORUM_SERVICES.post, FORUM_COSTS.longPost);
  assert.equal(before - (await w.k.log.balance(a.did)), FORUM_COSTS.longPost, "the log took the credits under the author's Mandate");
  const bs = await w.buy(b, mandateB, FORUM_SERVICES.post, FORUM_COSTS.longPost);
  assert.equal((await w.act(b, "posts", { kind: "post", title: "steals", text, tags: [], paid: purchase })).json.error.code, "NEEDS_CREDITS", "another citizen's purchase is not proof");
  const cheap = await w.buy(a, mandateA, FORUM_SERVICES.comment, FORUM_COSTS.longComment);
  const wrong = await w.act(a, "posts", { kind: "post", title: "wrong service", text, tags: [], paid: cheap });
  assert.equal(wrong.status, 402); assert.match(wrong.json.error.message, /not forum\.post\.long|bought forum\.comment\.long/);
  const ok = await w.act(a, "posts", { kind: "post", title: "long", text, tags: [], paid: purchase });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const again = await w.act(a, "posts", { kind: "post", title: "long again", text: "z" + long(FORUM_FORM.shortPostChars), tags: [], paid: purchase });
  assert.equal(again.status, 409); assert.equal(again.json.error.code, "PAID_USED", "one purchase pays for one act");
  const own = await w.act(b, "posts", { kind: "post", title: "mine", text: "w" + long(FORUM_FORM.shortPostChars), tags: [], paid: bs });
  assert.equal(own.status, 201);
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.k.log.verify()).ok, true);
});

test("DK1000: a long comment costs its own price; a citizen with no credits is refused the purchase by the log, still posts and comments short, and a key that was never in the log can post short", async () => {
  const w = await world();
  const a = newKey(), poor = newKey(), stranger = newKey();
  for (const [key, h] of [[a, "cm-a"], [poor, "cm-poor"], [stranger, "cm-stranger"]] as const) await w.join_(key, h);
  const mandateA = await w.enrol(a, 20);
  const mandatePoor = await w.enrol(poor, 0);
  const root = await w.act(a, "posts", { kind: "post", title: "root", text: long(FORUM_FORM.shortPostChars), tags: [] });
  assert.equal(root.status, 201, JSON.stringify(root.json));
  const longComment = long(FORUM_FORM.shortCommentChars + 10);
  assert.equal((await w.act(a, "comments", { kind: "comment", post: root.json.id, text: longComment })).json.error.code, "NEEDS_CREDITS");
  const p = await w.buy(a, mandateA, FORUM_SERVICES.comment, FORUM_COSTS.longComment);
  const c = await w.act(a, "comments", { kind: "comment", post: root.json.id, text: longComment, paid: p });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal(await refusedBy(w.buy(poor, mandatePoor, FORUM_SERVICES.post, FORUM_COSTS.longPost)), "insufficient_balance", "at zero the log refuses the purchase");
  assert.equal((await w.act(poor, "posts", { kind: "post", title: "long", text: "q" + long(FORUM_FORM.shortPostChars), tags: [], paid: "sha256:" + "0".repeat(64) })).status, 402, "and an invented purchase proves nothing");
  assert.equal((await w.act(poor, "posts", { kind: "post", title: "short", text: "p" + long(FORUM_FORM.shortPostChars - 1), tags: [] })).status, 201, "a citizen with no credits posts short");
  assert.equal((await w.act(poor, "comments", { kind: "comment", post: root.json.id, text: "c" + long(FORUM_FORM.shortCommentChars - 1) })).status, 201, "and comments short");
  assert.equal((await w.act(stranger, "posts", { kind: "post", title: "short", text: "s" + long(FORUM_FORM.shortPostChars - 1), tags: [] })).status, 201, "a key that was never in the log posts short");
  assert.equal((await w.act(stranger, "posts", { kind: "post", title: "long", text: "k" + long(FORUM_FORM.shortPostChars), tags: [] })).status, 402);
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced");
});
