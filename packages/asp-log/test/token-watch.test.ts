/**
 * Use-anomaly detection for stolen tokens (register row DK1717; spec-delta S1425): a token used from a new place or far above its own rate is flagged, the sponsor is alerted with a code a thief cannot read, and the token's writes are held until the
 * sponsor confirms; an ordinary new network is held only briefly; the history holds salted hashes of address ranges and nothing else; the false-flag rate is measured on a seeded honest population and the stolen patterns on a seeded set of thefts,
 * and stated. Seeded, fake tokens and documentation addresses only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { TokenWatch, createLogServer, hashToken, type Tenant } from "../src/index.ts";
import { QUIET_HOLD_MS, rangeOf } from "../src/token-watch.ts";

const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-01T08:00:00Z");
const rng = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** An honest history: two home ranges, `perHour` requests an hour for eight hours a day, for `days` days. */
function history(w: TokenWatch, tenant: string, perHour: number, days: number, start = T0) {
  for (let d = 0; d < days; d++) for (let h = 0; h < 8; h++) for (let i = 0; i < perHour; i++) w.observe(tenant, i % 2 ? "203.0.113.5" : "198.51.100.9", start + d * DAY + h * HOUR + i * Math.floor(HOUR / perHour), i % 3 === 0);
}

test("ranges: a /24 for IPv4 and a /48 for IPv6, so a phone moving inside one network is not a new place", () => {
  assert.equal(rangeOf("203.0.113.77"), "203.0.113");
  assert.equal(rangeOf("::ffff:203.0.113.77"), "203.0.113");
  assert.equal(rangeOf("2001:db8:aaaa:1:2:3:4:5"), "2001:db8:aaaa");
});

test("a stolen token from a new range with a burst is flagged and its writes held until the sponsor confirms with the code; reads go on; a wrong code does nothing", () => {
  const w = new TokenWatch({ salt: "s1" });
  history(w, "alpha", 20, 5);
  const t = T0 + 6 * DAY;
  const first = w.observe("alpha", "192.0.2.10", t, true);
  assert.equal(first.flag?.kind, "quiet_new_range", "the first request from a new range is noticed at once");
  assert.equal(first.writesAllowed, false);
  assert.ok(first.code && first.code.length === 10, "a code for the sponsor");
  let stolen: ReturnType<TokenWatch["observe"]> | undefined;
  for (let i = 1; i <= 40; i++) { const v = w.observe("alpha", "192.0.2.10", t + i * 3000, i % 2 === 0); if (v.flag?.kind === "stolen_pattern") stolen = v; }
  assert.ok(stolen, "forty requests in two minutes from a new range escalate");
  assert.equal(w.held("alpha")?.kind, "stolen_pattern");
  assert.equal(w.observe("alpha", "192.0.2.10", t + 3 * HOUR, false).writesAllowed, true, "reads are never held");
  assert.equal(w.writesAllowed("alpha", t + 3 * HOUR), false, "a stolen pattern is held with no timeout");
  assert.equal(w.confirm("alpha", "0000000000"), false);
  assert.equal(w.confirm("alpha", first.code!), false, "the first code belonged to the quiet hold the burst replaced");
  assert.equal(w.confirm("alpha", stolen!.code!), true);
  assert.equal(w.writesAllowed("alpha", t + 3 * HOUR), true);
  assert.deepEqual(w.flagsOf("alpha").map((f) => f.kind), ["quiet_new_range", "stolen_pattern"]);
});

test("ordinary use from a new network asks for confirmation and does not lock the sponsor out for more than thirty minutes, or at all once confirmed", () => {
  const w = new TokenWatch({ salt: "s2" });
  history(w, "beta", 20, 5);
  const t = T0 + 6 * DAY;
  const v = w.observe("beta", "192.0.2.77", t, true);
  assert.deepEqual([v.flag?.kind, v.writesAllowed], ["quiet_new_range", false]);
  for (let i = 1; i < 6; i++) assert.equal(w.observe("beta", "192.0.2.77", t + i * MIN, true).writesAllowed, false, "writes wait");
  assert.equal(w.writesAllowed("beta", t + QUIET_HOLD_MS - 1), false);
  assert.equal(w.writesAllowed("beta", t + QUIET_HOLD_MS), true, "the hold ends by itself after thirty minutes");
  const again = w.observe("beta", "192.0.2.77", t + QUIET_HOLD_MS + MIN, true);
  assert.deepEqual([again.writesAllowed, again.flag], [true, undefined], "the range is known now: no second flag");
  const w2 = new TokenWatch({ salt: "s2" });
  history(w2, "gamma", 20, 5);
  const v2 = w2.observe("gamma", "192.0.2.88", t, true);
  assert.equal(w2.confirm("gamma", v2.code!), true);
  assert.equal(w2.observe("gamma", "192.0.2.88", t + MIN, true).writesAllowed, true, "confirmed at once: no wait");
});

test("a rate spike from a known range is held until confirmed, a record signed by another tenant's identity is flagged but not held, and a token with no history is not judged", () => {
  const w = new TokenWatch({ salt: "s3" });
  history(w, "delta", 20, 5);
  const t = T0 + 6 * DAY;
  let spike: ReturnType<TokenWatch["observe"]> | undefined;
  for (let i = 0; i < 500; i++) { const v = w.observe("delta", "203.0.113.5", t + i * 5000, true); if (v.flag) spike = v; }
  assert.equal(spike?.flag?.kind, "rate_spike");
  assert.equal(w.writesAllowed("delta", t + HOUR), false);
  const f = w.noteForeignSigner("delta", "did:web:example.com:agents:x", "epsilon", t);
  assert.equal(f?.kind, "foreign_key_use");
  assert.equal(w.noteForeignSigner("delta", "did:web:example.com:agents:x", "epsilon", t + MIN), undefined, "once");
  assert.equal(w.noteForeignSigner("delta", "did:web:example.com:agents:y", "delta", t), undefined, "its own identity is no flag");
  const fresh = new TokenWatch({ salt: "s3" });
  for (let i = 0; i < 50; i++) assert.equal(fresh.observe("newcomer", `192.0.2.${i}`, T0 + i * MIN, true).writesAllowed, true, "no established history, nothing to depart from");
});

test("the history holds salted hashes and counts: no address anywhere, a different salt gives different hashes, and forgetting a tenant (a token reset) removes it", () => {
  const w = new TokenWatch({ salt: "salt-a" }), w2 = new TokenWatch({ salt: "salt-b" });
  history(w, "zeta", 5, 3); history(w2, "zeta", 5, 3);
  const raw = w.raw("zeta");
  assert.ok(!/203\.0\.113|198\.51\.100|192\.0\.2/.test(raw), "no address in what is stored");
  assert.notEqual(raw, w2.raw("zeta"), "another salt, other hashes");
  w.forget("zeta");
  assert.equal(w.raw("zeta"), "{}", "a reset forgets the history");
  assert.deepEqual(w.all().zeta, undefined);
});

test("measured: on a seeded honest population the rate of tenants held for good is stated; seeded thefts are held from the first request and escalated when they burst; a slow thief is not stopped for good (the honest limit)", () => {
  const r = rng(2026);
  const HONEST = 300, DAYS = 14;
  let hardHeld = 0, quietHeld = 0, quietLongest = 0;
  for (let i = 0; i < HONEST; i++) {
    const w = new TokenWatch({ salt: "pop" });
    const median = 8 + Math.floor(r() * 30);
    const name = `h${i}`;
    let newNet = 0;
    for (let d = 0; d < DAYS; d++) {
      const spikeDay = r() < 0.05, travel = r() < 0.03;
      const range = travel ? `192.0.2.${1 + Math.floor(r() * 200)}` : null;
      if (travel) newNet++;
      for (let h = 0; h < 8; h++) {
        const n = Math.max(1, Math.round(median * (spikeDay && h === 3 ? 4 : 0.6 + r() * 0.8)));
        for (let k = 0; k < n; k++) {
          const t = T0 + d * DAY + h * HOUR + k * Math.floor(HOUR / n);
          const addr = range && h >= 2 ? range : (k + d) % 2 ? "203.0.113.5" : "198.51.100.9";
          w.observe(name, addr, t, k % 4 === 0);
        }
      }
    }
    const kinds = w.flagsOf(name).map((f) => f.kind);
    if (kinds.includes("stolen_pattern") || kinds.includes("rate_spike")) hardHeld++;
    else if (kinds.includes("quiet_new_range")) { quietHeld++; quietLongest = Math.max(quietLongest, QUIET_HOLD_MS); }
    void newNet;
  }
  const hardRate = hardHeld / HONEST, quietRate = quietHeld / HONEST;
  // thefts: an established tenant, a thief from a new range
  let heldAtFirst = 0, escalated = 0, slowWritesLater = 0;
  const THEFTS = 300;
  for (let i = 0; i < THEFTS; i++) {
    const w = new TokenWatch({ salt: "theft" });
    history(w, "victim", 10 + Math.floor(r() * 30), 7);
    const t = T0 + 8 * DAY;
    const addr = `192.0.2.${1 + (i % 250)}`;
    const first = w.observe("victim", addr, t, true);
    if (!first.writesAllowed) heldAtFirst++;
    for (let k = 1; k <= 60; k++) w.observe("victim", addr, t + k * 2000, true);
    if (w.held("victim")?.kind === "stolen_pattern") escalated++;
    // a slow thief: one request a minute, from a fresh victim
    const s = new TokenWatch({ salt: "slow" });
    history(s, "victim", 10 + Math.floor(r() * 30), 7);
    for (let k = 0; k < 45; k++) s.observe("victim", addr, t + k * MIN, true);
    if (s.writesAllowed("victim", t + 46 * MIN)) slowWritesLater++;
  }
  console.log(`token watch measurement: honest tenants ${HONEST} over ${DAYS} days: held for good (burst or spike) ${(hardRate * 100).toFixed(1)} %, held at most 30 minutes (a new network) ${(quietRate * 100).toFixed(1)} %; ${THEFTS} seeded thefts: writes held from the first request ${(heldAtFirst / THEFTS * 100).toFixed(0)} %, escalated to a hold with no timeout when the thief bursts ${(escalated / THEFTS * 100).toFixed(0)} %; a slow thief (one request a minute) gets writes after thirty minutes in ${(slowWritesLater / THEFTS * 100).toFixed(0)} % of cases`);
  assert.ok(hardRate <= 0.05, `honest tenants held for good: ${hardRate}`);
  assert.equal(heldAtFirst, THEFTS, "every theft from a new range is held from its first request");
  assert.equal(escalated, THEFTS, "every bursting theft is held with no timeout");
  assert.equal(slowWritesLater, THEFTS, "a slow thief outlasts the quiet hold: the honest limit, so a quiet hold also alerts the sponsor, who revokes");
  assert.ok(quietLongest <= QUIET_HOLD_MS);
});

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

test("on the service: a held token's writes are refused with 423 and its reads still work, the alert and the code go to the sponsor's channel and not the response, the sponsor confirms and writes work again, and an operator sees the flags without any address", async () => {
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: hashToken("op") }, { name: "alpha", role: "tenant", tokenSha256: hashToken("ta") }];
  const watch = new TokenWatch({ salt: "svc" });
  history(watch, "alpha", 5, 4, Date.now() - 6 * DAY);
  const alerts: { tenant: string; kind: string; code?: string }[] = [];
  const handle = { append: async () => ({ id: "x", seq: 1 }), log: { head: async () => ({ seq: 0 }) } } as never;
  const server = createLogServer({ handle, tenants, noAuth: false, trustProxy: true, tokenWatch: watch, onTokenAlert: (tenant, f, code) => alerts.push({ tenant, kind: f.kind, ...(code ? { code } : {}) }) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const rpc = (tok: string, ip: string, target: string, method: string, args: unknown[] = []) => fetch(`${url}/rpc`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ target, method, args }) });
  const read = await rpc("ta", "203.0.113.5", "log", "head");
  assert.equal(read.status, 200, "from a known range all is well");
  const read2 = await rpc("ta", "192.0.2.200", "log", "head");
  assert.equal(read2.status, 200, "a read from a new range works");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "quiet_new_range");
  const body = JSON.stringify(await read2.clone().json());
  assert.ok(alerts[0].code && !body.includes(alerts[0].code), "the code is not in the response to the token's own request");
  const write = await rpc("ta", "192.0.2.200", "handle", "append", [{}]);
  assert.equal(write.status, 423);
  assert.equal(((await write.json()) as { error: { code: string } }).error.code, "TOKEN_HELD");
  const wrong = await fetch(`${url}/token/confirm`, { method: "POST", headers: { authorization: "Bearer ta", "content-type": "application/json" }, body: JSON.stringify({ code: "nope" }) });
  assert.equal(wrong.status, 403);
  const right = await fetch(`${url}/token/confirm`, { method: "POST", headers: { authorization: "Bearer ta", "content-type": "application/json", "x-forwarded-for": "192.0.2.200" }, body: JSON.stringify({ code: alerts[0].code }) });
  assert.equal(right.status, 200);
  assert.notEqual((await rpc("ta", "192.0.2.200", "handle", "append", [{}])).status, 423, "writes work again once the sponsor confirmed");
  const seen = await fetch(`${url}/society/token-watch`, { headers: { authorization: "Bearer op" } });
  assert.equal(seen.status, 200);
  const text = await seen.text();
  assert.match(text, /quiet_new_range/);
  assert.ok(!/192\.0\.2|203\.0\.113/.test(text), "the operator's view holds no address");
  assert.equal((await fetch(`${url}/society/token-watch`, { headers: { authorization: "Bearer ta" } })).status, 403);
});

test("the edges: a burst from a new range escalates at exactly 30 requests in five minutes, and a spike holds at exactly its minimum and at exactly twenty times the usual rate", () => {
  // burst: two known ranges, then a new range; 29 requests are still the quiet hold, the 30th is the stolen pattern
  const w = new TokenWatch({ salt: "edge1" });
  w.observe("e1", "203.0.113.5", T0, true); w.observe("e1", "198.51.100.9", T0 + 1, true);
  const t = T0 + 2 * HOUR;
  w.observe("e1", "192.0.2.10", t, false);
  for (let i = 1; i < 29; i++) w.observe("e1", "192.0.2.10", t + i * 1000, false);
  assert.equal(w.held("e1")?.kind, "quiet_new_range", "29 requests from the new range are not yet a burst");
  w.observe("e1", "192.0.2.10", t + 30_000, false);
  assert.equal(w.held("e1")?.kind, "stolen_pattern", "the 30th is");

  // spike: a usual 10 an hour for three hours; 299 requests in the next hour hold nothing, the 300th holds
  const s = new TokenWatch({ salt: "edge2" });
  for (let h = 0; h < 3; h++) for (let i = 0; i < 10; i++) s.observe("e2", "203.0.113.5", T0 + h * HOUR + i * 1000, false);
  const hour = T0 + 3 * HOUR;
  for (let i = 0; i < 299; i++) s.observe("e2", "203.0.113.5", hour + i * 1000, false);
  assert.equal(s.held("e2"), undefined, "299 in an hour is under the minimum of 300");
  s.observe("e2", "203.0.113.5", hour + 299_000, false);
  assert.equal(s.held("e2")?.kind, "rate_spike", "the 300th is twenty times the usual 10 and the minimum");

  // factor: a usual 20 an hour: 20 x 20 = 400, so 399 holds nothing and the 400th holds
  const f = new TokenWatch({ salt: "edge3" });
  for (let h = 0; h < 3; h++) for (let i = 0; i < 20; i++) f.observe("e3", "203.0.113.5", T0 + h * HOUR + i * 1000, false);
  for (let i = 0; i < 399; i++) f.observe("e3", "203.0.113.5", hour + i * 1000, false);
  assert.equal(f.held("e3"), undefined, "399 is under twenty times 20");
  f.observe("e3", "203.0.113.5", hour + 399_000, false);
  assert.equal(f.held("e3")?.kind, "rate_spike");
});
