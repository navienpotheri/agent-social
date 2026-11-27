/**
 * The live society page's data feed (register row DK290; spec-delta S360): derived only from public records through a whitelist, so no private field can appear; flows from the records; a day replay that
 * matches the log; a simulated society and a real log both give the same shape. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PLACES, dayReplay, flowsOf, simulatedFeed, societyMap, type MapFeed, type RepLike, type StoredLike } from "../src/index.ts";
import { DAY, jump, kit, mk, nowIso, operator, registrar } from "./society-kit.ts";

const SECRET = "SECRET-PLAN-9f3a";
const FORBIDDEN_KEYS = ["balance", "balances", "sponsor", "keys", "public_key", "publicKey", "purpose", "temperament", "email", "token", "secret", "summary", "text", "memory", "mandate", "scopes"];

async function world() {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("map-sponsor", 400);
  const bot = await k.agent("map-bot", sponsor, { tier: 1, funds: 100, skills: ["code"] });
  const house = await k.agent("map-house", operator, { tier: 1, funds: 50 });
  await k.cert(bot.did, "code"); // an exam fee (a purchase from the Academy), a certificate (a lesson)
  const poster = await k.person("map-poster", 400);
  await k.runJob(poster, bot, 60); // a settled job
  const stored = async (): Promise<StoredLike[]> => (await k.log.since(0, 100000)) as never;
  const rep = async () => { const m = new Map<string, RepLike>(); for (const d of [bot.did, house.did]) { const r = await k.log.reputationOf(d); if (r) m.set(d, r as never); } return m; };
  const feed = async (over: Record<string, unknown> = {}) => { const h = await k.log.head(); return societyMap({ stored: await stored(), head: { seq: h.seq, hash: h.logHash }, now: nowIso(), rep: await rep(), operator: operator.did, ...over }); };
  return { k, sponsor, bot, house, poster, stored, rep, feed };
}
const walk = (v: unknown, f: (key: string, val: unknown) => void) => { if (Array.isArray(v)) v.forEach((x) => walk(x, f)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { f(k, x); walk(x, f); } };

describe("the feed from a real log", () => {
  test("twelve places, the agents as dots with their tier and standing, house agents labelled, and the flows the records carry: a settlement, a purchase and a lesson", async () => {
    const w = await world();
    const f = await w.feed();
    assert.deepEqual(f.places.map((p) => p.id), PLACES.map((p) => p.id));
    assert.equal(f.places.length, 12);
    const bot = f.agents.find((a) => a.id === w.bot.did)!;
    assert.equal(bot.name, "map-bot", "an agent is shown by name");
    assert.equal(bot.tier, 1);
    assert.equal(bot.standing.certificates, 1);
    assert.equal(bot.house, false);
    assert.equal(f.agents.find((a) => a.id === w.house.did)!.house, true, "an agent the operator sponsors is a house agent");
    const kinds = new Set(f.flows.map((x) => x.kind));
    for (const kind of ["settlement", "purchase", "lesson"]) assert.ok(kinds.has(kind as never), `a ${kind} flow`);
    const settle = f.flows.find((x) => x.kind === "settlement")!;
    assert.deepEqual([settle.from, settle.to, settle.amount], ["outside", w.bot.did, 60], "a person is shown as the outside, the agent as its dot, the price as the amount");
    const buy = f.flows.find((x) => x.kind === "purchase")!;
    assert.deepEqual([buy.from, buy.to], [w.bot.did, "academy"], "an institution account is its place");
    assert.ok(f.flows.every((x, i, a) => i === 0 || a[i - 1].seq <= x.seq), "log order");
    assert.match(f.note, /not money/);
  });

  test("a registry name replaces the handle; a quarantine and a suspension show as the dot's state and lift when they end", async () => {
    const w = await world();
    const at = nowIso();
    const quar = mk("quarantine", registrar, { members: [w.bot.did], level: "observe", reason: "drift", until: new Date(Date.parse(at) + 3 * DAY).toISOString().replace(".000Z", "Z") });
    const records = [...(await w.stored()), { seq: 9000, id: "q1", record: quar }];
    const f = societyMap({ stored: records, head: { seq: 9000, hash: "h" }, now: new Date(Date.parse(at) + 60_000).toISOString(), rep: await w.rep() });
    assert.equal(f.agents.find((a) => a.id === w.bot.did)!.state, "quarantined");
    const later = societyMap({ stored: records, head: { seq: 9000, hash: "h" }, now: new Date(Date.parse(at) + 4 * DAY).toISOString(), rep: await w.rep() });
    assert.equal(later.agents.find((a) => a.id === w.bot.did)!.state, "active", "the quarantine ended");
  });

  test("economy, alarms and world events are passed through as given, and a poll after a seq keeps only the newer flows", async () => {
    const w = await world();
    const full = await w.feed({ economy: { minted: 1, circulating: 1, burned: 0, treasury: 0, verdict: "balanced" }, alarms: [{ id: "QUIET", since: "2026-11-01T00:00:00Z", says: "quiet" }], events: [{ at: Date.parse("2026-11-01T00:00:00Z"), type: "price_change", title: "a price change" }] });
    assert.equal(full.economy?.verdict, "balanced");
    assert.equal(full.health?.alarms[0].id, "QUIET");
    assert.equal(full.world[0].type, "price_change");
    const mid = full.flows[Math.floor(full.flows.length / 2)].seq;
    const live = await w.feed({ after: mid });
    assert.ok(live.flows.length > 0 && live.flows.length < full.flows.length);
    assert.ok(live.flows.every((x) => x.seq > mid), "a live poll returns only what arrived since");
    const old = await w.feed({ days: 1 });
    jump(3 * DAY);
    const later = await w.feed({ days: 1 });
    assert.equal(old.flows.length > 0 && later.flows.length === 0, true, "flows older than the window are left out");
  });
});

describe("no private field can appear (owner decision 2026-11-13: public or aggregated data only)", () => {
  test("an agent with a secret purpose, a temperament, a sponsor and keys is a dot with none of them: no field of the feed is private, and the sponsor is only an opaque group", async () => {
    const w = await world();
    const k = w.k;
    const sponsor2 = await k.person("secret-sponsor", 10);
    const secretive = await k.agent("secretive", sponsor2, { tier: 1, funds: 10 });
    const stored = [...(await w.stored())];
    // A passport that carries free text: the purpose and temperament an agent wrote about itself.
    const rich = mk("passport", sponsor2, { did: secretive.did, kind: "agent", sponsor: sponsor2.did, tier: 1, shape: {}, purpose: SECRET_TEXT(), temperament: "hides the plan", keys: [{ id: secretive.kid, type: "Ed25519", public_key: "AAAA-private-key-material" }] }, null, { subject: secretive.did });
    stored.push({ seq: 99999, id: rich.id, record: rich });
    const f = societyMap({ stored, head: { seq: 99999, hash: "h" }, now: nowIso(), rep: await w.rep(), operator: operator.did });
    const text = JSON.stringify(f);
    for (const bad of [SECRET, "hides the plan", "AAAA-private-key-material", sponsor2.did, w.sponsor.did]) assert.equal(text.includes(bad), false, `the feed carries "${bad}"`);
    walk(f, (key) => assert.equal(FORBIDDEN_KEYS.includes(key), false, `a field named ${key} is in the feed`));
    const dot = f.agents.find((a) => a.id === secretive.did)!;
    assert.deepEqual(Object.keys(dot).sort(), ["group", "house", "id", "name", "standing", "state", "tier"], "an agent dot has exactly the whitelisted fields");
    assert.match(dot.group, /^[0-9a-f]{6}$/, "the sponsor appears only as an opaque group for colouring");
  });

  test("a flow carries a kind, two nodes, an amount and a fixed label: never a summary or a memo, whatever the record held", async () => {
    const w = await world();
    const f = await w.feed();
    for (const x of f.flows) assert.deepEqual(Object.keys(x).filter((k) => !["seq", "at", "kind", "from", "to", "label", "amount"].includes(k)), []);
    assert.ok(f.flows.every((x) => x.label.length <= 80 && !x.label.includes(SECRET)));
    // A person who is not an agent is never named: only "outside".
    const nodes = new Set(f.flows.flatMap((x) => [x.from, x.to]));
    for (const n of nodes) assert.ok(n === "outside" || PLACES.some((p) => p.id === n) || f.agents.some((a) => a.id === n), `node ${n}`);
    assert.equal(JSON.stringify(f).includes("map-poster"), false, "a person (the poster) is not shown");
  });
});

const SECRET_TEXT = () => `My plan is ${SECRET}: do not tell anyone`;

describe("the replay of a day matches the log", () => {
  test("the day's flows are exactly the flows of the records issued that day, with their seq range; another day is empty", async () => {
    const w = await world();
    const stored = await w.stored();
    const ids = new Set(stored.filter((s) => s.record.type === "asp.passport/v0.2" && (s.record.body as { kind: string }).kind === "agent").map((s) => (s.record.body as { did: string }).did));
    const day = nowIso().slice(0, 10);
    const replay = dayReplay(stored, ids, day);
    const direct = flowsOf(stored, ids).filter((f) => f.at.slice(0, 10) === day);
    assert.deepEqual(replay.flows, direct);
    assert.ok(replay.flows.length > 0);
    // Every replayed flow's seq is a record of that day in the log, and no record of that day that carries a flow is missing.
    for (const f of replay.flows) assert.equal(stored.find((s) => s.seq === f.seq)!.record.issued_at.slice(0, 10), day);
    const withFlow = new Set(replay.flows.map((f) => f.seq));
    for (const s of stored.filter((x) => x.record.issued_at.slice(0, 10) === day)) {
      const kinds = ["asp.purchase/v0.2", "asp.certificate/v0.2", "asp.prize/v0.2"];
      if (kinds.includes(s.record.type)) assert.ok(withFlow.has(s.seq), `${s.record.type} at seq ${s.seq} is in the replay`);
    }
    assert.deepEqual([replay.firstSeq, replay.lastSeq], [replay.flows[0].seq, replay.flows.at(-1)!.seq]);
    assert.deepEqual(dayReplay(stored, ids, "2020-01-01").flows, []);
    // And the whole-feed flows split exactly by day.
    const feed = await w.feed({ days: 30 });
    const days = new Set(feed.flows.map((f) => f.at.slice(0, 10)));
    assert.equal([...days].reduce((n, d) => n + dayReplay(stored, ids, d).flows.length, 0), feed.flows.length);
  });
});

describe("a simulated society and a real log give the same shape", () => {
  const shape = (f: MapFeed) => ({ top: Object.keys(f).sort(), agent: Object.keys(f.agents[0]).sort(), flow: Object.keys(f.flows[0]).sort() });
  test("the simulated feed is reproducible from its seed, has the same fields as a real feed and passes the same privacy scan", async () => {
    const a = simulatedFeed(5), b = simulatedFeed(5), c = simulatedFeed(6);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.notEqual(JSON.stringify(a), JSON.stringify(c));
    assert.equal(a.agents.length, 40);
    assert.equal(a.flows.length, 200);
    const real = await (await world()).feed();
    assert.deepEqual(shape(a).top, shape(real).top);
    assert.deepEqual(shape(a).agent, shape(real).agent);
    assert.deepEqual(shape(a).flow.filter((k) => k !== "amount"), shape(real).flow.filter((k) => k !== "amount"));
    walk(a, (key) => assert.equal(FORBIDDEN_KEYS.includes(key), false, key));
    assert.match(a.note, /simulated/);
  });
});
