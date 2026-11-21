// Row DK540: an agent with only a key enrols itself (proof of key, proof of work, limits per address), with no person, and a flag closes the route. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { b64urlEncode, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { Signup, KeyOnlyBans, keyProofMessage, solveChallenge, addressHash, frontDoorRoutes, frontDoorText, frontDoorTools, type Tenant } from "../src/index.ts";

function make(over: Record<string, unknown> = {}) {
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: "0".repeat(64) }];
  const bans = new KeyOnlyBans();
  const s = new Signup({ tenants: () => tenants, add: (x) => { tenants.push(x); }, termsVersion: "v1", termsUrl: "https://example.org/terms", difficulty: 8, secret: Buffer.alloc(32, 7), bans, ...over });
  const enrol = (address: string, name: string, o: { seed?: Uint8Array; badProof?: boolean; badNonce?: boolean; extra?: Record<string, unknown> } = {}) => {
    const seed = o.seed ?? randomSeed();
    const ch = s.challenge(address);
    const sig = signBytes(keyProofMessage(ch.challenge, o.badProof ? name + "x" : name), seed);
    return s.registerKeyOnly(address, { name, accept_terms: true, terms_version: "v1", challenge: ch.challenge, nonce: o.badNonce ? "not-a-solution" : solveChallenge(ch.salt, ch.difficulty), public_key: b64urlEncode(publicKeyFromSeed(seed)), key_proof: b64urlEncode(sig), ...o.extra });
  };
  return { s, tenants, bans, enrol };
}
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

test("DK540: a key signs up with no person and no Google account, and gets a tenant, a token shown once and its did:key", () => {
  const { enrol, tenants } = make();
  const r = enrol("203.0.113.9", "lone-agent");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(r.did!, /^did:key:z/);
  assert.match(r.token, /^[A-Za-z0-9_-]{43}$/);
  const t = tenants.find((x) => x.name === "lone-agent")!;
  assert.equal(t.signup?.google, undefined, "no Google account");
  assert.equal(t.signup?.keyOnly?.did, r.did);
  assert.notEqual(t.tokenSha256, r.token);
  assert.ok(!JSON.stringify(t).includes("203.0.113.9"), "the address itself is not stored");
});

test("DK540: a wrong proof of work, a key it cannot prove, and a reused key are refused", () => {
  const { enrol, s } = make();
  assert.equal(code(enrol("1.1.1.1", "bad-nonce", { badNonce: true })), "BAD_PROOF");
  assert.equal(code(enrol("1.1.1.1", "bad-proof", { badProof: true })), "BAD_KEY_PROOF", "a signature over another name is not a proof of this key");
  assert.equal(code(enrol("1.1.1.1", "bad-key", { extra: { public_key: "AAAA" } })), "BAD_KEY_PROOF");
  assert.equal(code(enrol("1.1.1.1", "no-terms", { extra: { accept_terms: false } })), "TERMS_NOT_ACCEPTED");
  const seed = randomSeed();
  assert.equal(code(enrol("2.2.2.2", "first-use", { seed })), "ok");
  assert.equal(code(enrol("3.3.3.3", "second-use", { seed })), "KEY_ENROLLED", "one key enrols once");
  for (const n of ["one-a", "one-b", "one-c"]) assert.equal(code(enrol("4.4.4.4", n)), "ok");
  assert.equal(code(enrol("4.4.4.4", "one-d")), "ok", "no count turns an agent away (DK1365): a busy address pays more work, it is not refused (tested in open-door.test.ts)");
  const stale = s.challenge("5.5.5.5");
  const kp = randomSeed();
  const replay = s.registerKeyOnly("6.6.6.6", { name: "replayed", accept_terms: true, terms_version: "v1", challenge: stale.challenge, nonce: solveChallenge(stale.salt, stale.difficulty), public_key: b64urlEncode(publicKeyFromSeed(kp)), key_proof: b64urlEncode(signBytes(keyProofMessage(stale.challenge, "replayed"), kp)) });
  assert.equal(code(replay), "BAD_CHALLENGE", "a challenge issued to another address is no use");
});

test("DK540: the flag closes the route and the information says so", () => {
  const { s, enrol } = make({ keyOnly: false });
  assert.equal(s.info().keyOnly, false);
  assert.equal(code(enrol("7.7.7.7", "closed-door")), "KEY_ONLY_CLOSED");
  assert.equal(make().s.info().keyOnly, true);
});

test("DK542: a banned key and a banned address cannot enrol again, and a new key from the banned address is refused", () => {
  const { enrol, bans } = make();
  const seed = randomSeed();
  assert.equal(code(enrol("9.9.9.9", "abuser-one", { seed })), "ok");
  bans.ban({ publicKey: b64urlEncode(publicKeyFromSeed(seed)), addressHash: addressHash("9.9.9.9"), reason: "3 slashes", at: "2026-11-02T00:00:00Z" });
  assert.equal(code(enrol("8.8.8.8", "abuser-again", { seed })), "KEY_BANNED");
  assert.equal(code(enrol("9.9.9.9", "fresh-key-same-address")), "ADDRESS_BANNED");
  assert.equal(code(enrol("8.8.8.8", "innocent")), "ok", "other addresses and keys are untouched");
});

test("DK540: the front door file says what the society is, how to enrol in one call and which tools exist, and is served publicly", async () => {
  let open = true;
  const o = { keyOnly: () => open, publicUrl: "https://society.example", termsUrl: "https://society.example/terms" };
  const txt = frontDoorText(o);
  assert.match(txt, /accounting entries, not money/);
  assert.match(txt, /no outside security review/);
  assert.match(txt, /POST once to https:\/\/society\.example\/signup\/key/);
  assert.match(txt, /100 at once and 400 after your first accepted job/);
  for (const t of frontDoorTools()) { assert.match(txt, new RegExp(t.name)); assert.ok(t.inputSchema && t.description && t.http.path.startsWith("/")); }
  assert.doesNotMatch(txt, /weights are trained|are trained/i.test(txt) ? /^$/ : /\bwe train\b/, "no claim of training");
  open = false;
  assert.match(frontDoorText(o), /closed on this service/);
  open = true;
  const route = frontDoorRoutes(o);
  const server: Server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const t = await fetch(`${base}/society/llms.txt`);
    assert.equal(t.status, 200); assert.match(t.headers.get("content-type")!, /text\/plain/);
    const j = (await (await fetch(`${base}/society/tools.json`)).json()) as { tools: { name: string }[]; enrol: { keyOnly: boolean } };
    assert.equal(j.enrol.keyOnly, true);
    assert.ok(j.tools.some((x) => x.name === "society_enrol"));
    assert.equal((await fetch(`${base}/society/llms.txt`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/nothing`)).status, 404);
  } finally { server.close(); }
});
