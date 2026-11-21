// Row DK1365 (spec-delta S1460; owner decision of 2026-11-21): the open door has no hard limits. The old door turned the 4th enrolment from an address and the 201st of a day away; this one prices an address by what it has
// done (proof of work rising with its recent enrolments, falling back as they age), queues a rush instead of refusing it, bans by key, and closes the queue only near capacity. Fake keys; an injected clock.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { b64urlEncode, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { AdaptiveDoor, KeyOnlyBans, Signup, addressHash, createLogServer, keyProofMessage, solveChallenge, type Tenant } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

function make(over: Record<string, unknown> = {}, clock?: { t: number }) {
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: "0".repeat(64) }];
  const bans = new KeyOnlyBans();
  const s = new Signup({ tenants: () => tenants, add: (x) => { tenants.push(x); }, termsVersion: "v1", termsUrl: "https://example.org/terms", difficulty: 2, secret: Buffer.alloc(32, 7), bans, ...(clock ? { now: () => clock.t } : {}), ...over });
  const attempt = (address: string, name: string, seed = randomSeed()) => {
    const ch = s.challenge(address);
    return { ch, res: s.registerKeyOnly(address, { name, accept_terms: true, terms_version: "v1", challenge: ch.challenge, nonce: solveChallenge(ch.salt, ch.difficulty), public_key: b64urlEncode(publicKeyFromSeed(seed)), key_proof: b64urlEncode(signBytes(keyProofMessage(ch.challenge, name), seed)) }), seed };
  };
  return { s, tenants, bans, attempt };
}
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

test("the work an address must do rises for each doubling of its recent enrolments above a free allowance, falls back when they age out, and never touches another address", () => {
  const clock = { t: 1_000_000 };
  const d = new AdaptiveDoor({ baseBits: 20, freePerHour: 6, maxExtraBits: 16, drainPerMinute: 1_000_000, now: () => clock.t });
  const busy = addressHash("198.51.100.1"), quiet = addressHash("198.51.100.2");
  const bits: number[] = [];
  for (let i = 0; i < 400; i++) { bits.push(d.bitsFor(busy)); assert.equal(d.admit(busy, {} as never).state, "go"); }
  assert.deepEqual([bits[0], bits[5], bits[6], bits[12], bits[24], bits[48], bits[96], bits[192], bits[384]], [20, 20, 21, 22, 23, 24, 25, 26, 27], "one more bit for every doubling above 6 an hour");
  assert.equal(d.bitsFor(quiet), 20, "another address pays the base cost");
  // an hour later the busy address is back to the base
  clock.t += 3_600_001;
  assert.equal(d.bitsFor(busy), 20, "it falls back when it stops");
  // the rise has a ceiling on the work, not on the count
  const big = new AdaptiveDoor({ baseBits: 20, freePerHour: 6, maxExtraBits: 4, drainPerMinute: 1e9, now: () => clock.t });
  for (let i = 0; i < 5000; i++) big.admit(busy, {} as never);
  assert.equal(big.bitsFor(busy), 24);
});

test("10,000 enrolments from one address all succeed: none is refused for how many there were, each costs more work than the last few, and another address is not affected", () => {
  const { s, tenants, attempt } = make({ door: { drainPerMinute: 1_000_000, maxExtraBits: 8 } });
  const t0 = Date.now();
  let hardest = 0;
  for (let i = 0; i < 10_000; i++) {
    const { ch, res } = attempt("203.0.113.9", `agent-${String(i).padStart(5, "0")}`);
    if (!res.ok) assert.fail(`enrolment ${i} was refused: ${res.code} ${res.message}`);
    hardest = Math.max(hardest, ch.difficulty);
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`DK1365: 10,000 key-only enrolments from one address, hardest proof ${hardest} bits, ${Math.round(secs)} seconds`);
  assert.equal(tenants.filter((t) => t.signup?.keyOnly).length, 10_000);
  assert.equal(new Set(tenants.map((t) => t.signup?.keyOnly?.publicKey)).size, 10_001, "every key enrolled once (and the admin, which has none)");
  assert.equal(hardest, 2 + 8, `the work rose to its ceiling for the busiest stretch (${hardest} bits)`);
  assert.equal(s.challenge("203.0.113.77").difficulty, 2, "a new address is still at the base cost");
});

test("a rush is queued, not refused: the front of the queue is the address with the fewest enrolments, tickets are served as the minute allows, and nothing is dropped", () => {
  const clock = { t: 5_000_000 };
  const { s, tenants, attempt } = make({ door: { drainPerMinute: 5, maxQueue: 100 } }, clock);
  const tickets: { name: string; ticket: string; position: number }[] = [];
  const busyFirst = ["10.0.0.1", "10.0.0.1", "10.0.0.1"];
  for (let i = 0; i < 5; i++) assert.equal(code(attempt("10.0.0.1", `early-${i}`).res), "ok", `${i}: the first five of the minute go straight in`);
  // now a rush: the busy address again, and two new addresses
  const order = [["10.0.0.1", "late-a"], ["10.0.0.1", "late-b"], ["10.0.0.2", "fresh-a"], ["10.0.0.3", "fresh-b"]];
  for (const [addr, name] of order) {
    const { res } = attempt(addr, name);
    assert.equal(res.ok, false); if (!res.ok) { assert.equal(res.status, 202); assert.equal(res.code, "QUEUED"); assert.ok(res.queue); tickets.push({ name, ticket: res.queue!.ticket, position: res.queue!.position }); }
  }
  void busyFirst;
  assert.equal(tenants.length, 1 + 5, "nobody queued has a tenant yet");
  // fresh addresses are ahead of the busy one, whatever the order they arrived in
  const pos = Object.fromEntries(tickets.map((t) => [t.name, (s.door.poll(t.ticket) as { position: number }).position]));
  assert.ok(pos["fresh-a"] < pos["late-a"] && pos["fresh-b"] < pos["late-a"] && pos["late-a"] < pos["late-b"], JSON.stringify(pos));
  // the minute has not passed: all still waiting
  const early = s.registerKeyOnly("10.0.0.2", { ticket: tickets[2].ticket });
  assert.equal(early.ok, false); if (!early.ok) { assert.equal(early.status, 202); assert.match(early.message, /number \d+ in the queue/); }
  // a minute later five slots: all four are served, fresh first
  clock.t += 60_001;
  const first = s.registerKeyOnly("x", { ticket: tickets[2].ticket });
  assert.equal(first.ok, true, "fresh-a is served");
  if (first.ok) assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  for (const t of [tickets[3], tickets[0], tickets[1]]) assert.equal(s.registerKeyOnly("x", { ticket: t.ticket }).ok, true, `${t.name} is served`);
  assert.equal(tenants.length, 1 + 5 + 4, "all of them, none refused, none dropped");
  // a ticket is used once and an unknown one is not a free pass
  const again = s.registerKeyOnly("x", { ticket: tickets[2].ticket });
  assert.equal(again.ok, false); if (!again.ok) assert.equal(again.code, "TICKET_UNKNOWN");
  const nope = s.registerKeyOnly("x", { ticket: "made-up" });
  assert.equal(nope.ok, false); if (!nope.ok) assert.equal(nope.status, 404);
});

test("the circuit breaker closes the queue only near capacity, tells the agent to come back in a minute, and drops nothing already queued", () => {
  const clock = { t: 9_000_000 };
  const { s, attempt } = make({ door: { drainPerMinute: 1, maxQueue: 3 } }, clock);
  assert.equal(code(attempt("10.1.0.1", "first-one").res), "ok");
  const queued = ["q-one", "q-two", "q-three"].map((n, i) => { const r = attempt(`10.1.1.${i}`, n).res; assert.equal(r.ok, false); return r.ok ? "" : r.status === 202 ? r.queue!.ticket : `status ${r.status}`; });
  assert.ok(queued.every((t) => !t.startsWith("status")), "three wait");
  const busy = attempt("10.1.2.1", "over-capacity").res;
  assert.equal(busy.ok, false); if (!busy.ok) { assert.equal(busy.status, 503); assert.equal(busy.code, "DOOR_BUSY"); assert.equal(busy.retryAfterSec, 60); assert.match(busy.message, /nothing is wrong with your enrolment/); }
  clock.t += 60_001;
  assert.equal(s.registerKeyOnly("x", { ticket: queued[0] }).ok, true, "the queue still serves what it holds");
  assert.equal(s.door.stats().waiting, 2);
});

test("accountability stays on the key: a banned key and a banned address are refused at the door, queued or not; and a name or a key can enrol once", () => {
  const { s, bans, attempt } = make({ door: { drainPerMinute: 1_000_000 } });
  const a = attempt("10.2.0.1", "good-agent"); assert.equal(code(a.res), "ok");
  bans.ban({ publicKey: b64urlEncode(publicKeyFromSeed(a.seed)), addressHash: addressHash("10.2.0.1"), reason: "3 slashes", at: "2026-11-02T00:00:00Z" });
  assert.equal(code(attempt("10.2.0.9", "same-key", a.seed).res), "KEY_BANNED");
  assert.equal(code(attempt("10.2.0.1", "same-address").res), "ADDRESS_BANNED");
  assert.equal(code(attempt("10.2.0.9", "good-agent").res), "NAME_TAKEN");
  const seed = randomSeed();
  assert.equal(code(attempt("10.2.0.5", "one-key", seed).res), "ok");
  assert.equal(code(attempt("10.2.0.6", "two-key", seed).res), "KEY_ENROLLED");
  void s;
});

test("the day's cap and the count per address no longer refuse a key-only agent, while a person's own sign-up keeps its limits", () => {
  const { s, attempt } = make({ dailyCap: 2, perAddressPerDay: 1, door: { drainPerMinute: 1_000_000 } });
  for (let i = 0; i < 30; i++) assert.equal(code(attempt("10.3.0.1", `agent-${i}-x`).res), "ok", `${i}`);
  assert.equal(s.info().keyOnly, true);
  // a person's anonymous sign-up (the proof-of-work route) is still capped: the cap is about people and the Google route
  const ch = s.challenge("10.3.0.2");
  const r = s.register("10.3.0.2", { name: "a-person", accept_terms: true, terms_version: "v1", challenge: ch.challenge, nonce: solveChallenge(ch.salt, ch.difficulty) });
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, "SIGNUP_FULL");
});

async function service(over: Record<string, unknown> = {}) {
  const { s, tenants } = make(over);
  const server = createLogServer({ handle: undefined as never, tenants, signup: s, noAuth: false, trustProxy: true });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, tenants, s };
}

test("over HTTP: the challenge says the address's own difficulty, a rush gets 202 with a ticket and Retry-After, the ticket is redeemed for a token, and nothing answers 429 for a count", async () => {
  const { url, tenants } = await service({ door: { drainPerMinute: 2, freePerHour: 2 } });
  const get = (ip: string) => fetch(`${url}/signup/challenge`, { headers: { "x-forwarded-for": ip } }).then((r) => r.json() as Promise<{ challenge: string; salt: string; difficulty: number }>);
  const post = async (ip: string, name: string) => {
    const ch = await get(ip), seed = randomSeed();
    return fetch(`${url}/signup/key`, { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: JSON.stringify({ name, accept_terms: true, terms_version: "v1", challenge: ch.challenge, nonce: solveChallenge(ch.salt, ch.difficulty), public_key: b64urlEncode(publicKeyFromSeed(seed)), key_proof: b64urlEncode(signBytes(keyProofMessage(ch.challenge, name), seed)) }) });
  };
  assert.equal((await get("203.0.113.5")).difficulty, 2);
  const statuses: number[] = [];
  let ticket = "";
  for (let i = 0; i < 6; i++) { const r = await post("203.0.113.5", `http-agent-${i}`); statuses.push(r.status); if (r.status === 202) { const j = (await r.json()) as { ticket: string; position: number; eta_sec: number; queued: boolean }; assert.equal(j.queued, true); assert.ok(j.position >= 1); assert.ok(Number(r.headers.get("retry-after")) >= 1); ticket = j.ticket; } }
  assert.ok(!statuses.includes(429) && !statuses.includes(503), `no count refused anyone: ${statuses}`);
  assert.deepEqual(statuses.slice(0, 2), [201, 201]); assert.ok(statuses.slice(2).every((s) => s === 202), `the rest are queued: ${statuses}`);
  assert.ok((await get("203.0.113.5")).difficulty > 2, "the busy address now pays more work");
  assert.equal((await get("203.0.113.6")).difficulty, 2, "and another does not");
  const waiting = await fetch(`${url}/signup/key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }) });
  assert.equal(waiting.status, 202, "still waiting inside the minute");
  assert.equal(tenants.filter((t) => t.signup?.keyOnly).length, 2);
});
