// Register row DK791 (S1350): the operator signs the forum head and the log witnesses it; a changed forum act, a rewritten chain and a truncated chain are each detected against the signed head.
// Setup after forum-pulse.test.ts. Fake keys only; credits are accounting entries, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlEncode, canonicalBytes, createRecord, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, sha256Id, signBytes, signerFromSeed } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { FORUM_VERSION, LocalLog, forumRoutes, registrationMessage, signForum, type ForumBody } from "@agent-social/asp-package";

const tenants: Tenant[] = [{ name: "agents", role: "tenant", tokenSha256: hashToken("checkpoint-token") }];
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
function newKey() { const seed = randomSeed(); const pk = publicKeyFromSeed(seed); const did = didKeyFromPublicKey(pk); return { seed, publicKey: b64urlEncode(pk), did, kid: `${did}#key-1` }; }
type Key = ReturnType<typeof newKey>;

async function setup() {
  const t = Date.parse("2026-10-23T10:00:00Z");
  const op = newKey();
  const logDir = mkdtempSync(join(tmpdir(), "asp-fc-log-"));
  writeFileSync(join(logDir, "operator.json"), JSON.stringify({ operator: op.did }));
  const handle = await LocalLog.open(logDir);
  const root = mkdtempSync(join(tmpdir(), "asp-fc-"));
  const forum = forumRoutes({ root, handle, now: () => new Date(t), open: true, sponsorlessPosting: true });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown, from = "203.0.113.9") => { const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json()) as any }; };
  const get = async (path: string) => { const r = await fetch(`${url}/forum/${path}`); return { status: r.status, json: (await r.json()) as any }; };
  const join_ = async (k: Key, h: string, from: string) => post("/forum/register", { handle: h, public_key: k.publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(h, k.publicKey)), k.seed)) }, from);
  const act = async (k: Key, path: string, body: Record<string, unknown>) => {
    const c = (await (await fetch(`${url}/forum/citizens/${encodeURIComponent(k.did)}`)).json()) as any;
    return post(`/forum/${path}`, signForum({ v: FORUM_VERSION, author: k.did, createdAt: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), prev: c.last, ...body } as ForumBody, { kid: k.kid, seed: k.seed }));
  };
  /** An identity in the log, so the log can check its signature (the operator needs one to sign a checkpoint). */
  const passport = async (k: Key) => {
    const rec = createRecord({ type: "passport", issuer: k.did, subject: k.did, prev: null, issued_at: "2026-10-23T09:00:00Z", body: { did: k.did, kind: "human", tier: 1, shape: {}, purpose: "a checkpoint test", keys: [{ id: k.kid, type: "Ed25519", public_key: k.publicKey }] } } as never, signerFromSeed(k.kid, k.seed));
    await handle.append(rec);
  };
  await passport(op);
  /** The operator signs the head as `asp forum checkpoint` does and appends it to the log. */
  const checkpoint = async (signedBy: Key = op, at = "2026-10-23T10:05:00Z") => {
    const head = (await get("head")).json;
    const rec = createRecord({ type: "forum_checkpoint" as never, issuer: signedBy.did, subject: null, prev: null, body: { forum_seq: head.seq, forum_head: head.hash }, issued_at: at }, signerFromSeed(signedBy.kid, signedBy.seed));
    return handle.log.append(rec);
  };
  return { get, join_, act, checkpoint, passport, root, op };
}

async function populated() {
  const f = await setup();
  const a = newKey(), b = newKey();
  await f.join_(a, "cp-a", "203.0.113.71"); await f.join_(b, "cp-b", "203.0.113.72");
  const p1 = await f.act(a, "posts", { kind: "post", title: "first", text: "the first post by a", tags: [] });
  const p2 = await f.act(b, "posts", { kind: "post", title: "second", text: "the second post by b", tags: [] });
  const c1 = await f.act(a, "comments", { kind: "comment", post: p2.json.id, text: "a answers b" });
  assert.equal(p1.status, 201); assert.equal(p2.status, 201); assert.equal(c1.status, 201);
  return { f, a, b, p1, p2, c1 };
}
type ChainLine = { seq: number; id: string; prevHash: string; hash: string };
const readChain = (root: string) => readFileSync(join(root, "chain.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ChainLine);

test("DK791: the head says it is unsigned until the operator checkpoints; then it carries the signed checkpoint and matches, and verify counts it", async () => {
  const { f } = await populated();
  const h0 = (await f.get("head")).json;
  assert.equal(h0.signed, null);
  const res = await f.checkpoint();
  assert.ok(res.id);
  const h1 = (await f.get("head")).json;
  assert.equal(h1.signed.forum_seq, 3);
  assert.equal(h1.signed.forum_head, h0.hash);
  assert.equal(h1.signed.signed_by, f.op.did);
  assert.equal(h1.signed.matches, true);
  const v = (await f.get("verify")).json;
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.equal(v.checkpoints, 1);
  assert.equal(v.latest_checkpoint.forum_seq, 3);
});

test("DK791: the forum grows past a checkpoint and still verifies; a later checkpoint moves forward and the old one still holds", async () => {
  const { f, b, p1 } = await populated();
  await f.checkpoint();
  await f.act(b, "comments", { kind: "comment", post: p1.json.id, text: "b answers a, after the checkpoint" });
  assert.equal((await f.get("verify")).json.ok, true);
  assert.equal((await f.get("head")).json.signed.matches, true, "the chain at 3 acts is still what was signed");
  await f.checkpoint();
  const v = (await f.get("verify")).json;
  assert.equal(v.ok, true); assert.equal(v.checkpoints, 2); assert.equal(v.latest_checkpoint.forum_seq, 4);
});

test("DK791: a forum act changed after the checkpoint, a rewritten chain and a truncated chain are each detected against the signed head", async () => {
  // 1. A forum act changed on disk: the document no longer hashes to its id, so the walk finds it.
  const one = await populated();
  await one.f.checkpoint();
  const first = readChain(one.f.root)[0]!;
  const docFile = join(one.f.root, "docs", first.id.replace(":", "-") + ".json");
  writeFileSync(docFile, JSON.stringify({ ...JSON.parse(readFileSync(docFile, "utf8")), text: "the first post, quietly edited" }));
  const v1 = (await one.f.get("verify")).json;
  assert.equal(v1.ok, false);
  assert.ok(v1.problems.some((p: string) => /was changed after it was recorded/.test(p)), JSON.stringify(v1.problems));

  // 2. A chain rewritten consistently (two acts swapped, every chain hash recomputed): each hash follows from the one before, so only the signed head catches it.
  const two = await populated();
  await two.f.checkpoint();
  const l2 = readChain(two.f.root);
  const swapped = [l2[1]!.id, l2[0]!.id, l2[2]!.id];
  let prev = "sha256:" + "0".repeat(64);
  const rebuilt = swapped.map((id, i) => { const hash = sha256Id(canonicalBytes({ prevHash: prev, id })); const e = { ...l2[i]!, id, prevHash: prev, hash }; prev = hash; return e; });
  writeFileSync(join(two.f.root, "chain.ndjson"), rebuilt.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const v2 = (await two.f.get("verify")).json;
  assert.equal(v2.ok, false);
  assert.ok(v2.problems.some((p: string) => /the operator signed/.test(p)), JSON.stringify(v2.problems));

  // 3. A chain with acts cut off after the checkpoint.
  const three = await populated();
  await three.f.checkpoint();
  const l3 = readFileSync(join(three.f.root, "chain.ndjson"), "utf8").split("\n").filter(Boolean);
  writeFileSync(join(three.f.root, "chain.ndjson"), l3.slice(0, 2).join("\n") + "\n");
  const v3 = (await three.f.get("verify")).json;
  assert.equal(v3.ok, false);
  assert.ok(v3.problems.some((p: string) => /chain now holds 2/.test(p)), JSON.stringify(v3.problems));
});

test("DK791: the log refuses a checkpoint from anyone but the operator and one that does not move forward", async () => {
  const { f } = await populated();
  const other = newKey();
  await f.passport(other);
  await assert.rejects(f.checkpoint(other), /forum_checkpoint_wrong_issuer|not the operator/);
  await f.checkpoint();
  await assert.rejects(f.checkpoint(f.op, "2026-10-23T10:06:00Z"), /forum_checkpoint_not_forward|must be later/);
});
