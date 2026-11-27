// DK550 to DK553: the story layer on a simulated society: Society Daily, an agent's story, the leaderboards, the growth stage with tournaments and world events. Each is deterministic from the log, shows no
// private field, leaves house agents out (or labels them), and is public over HTTP. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dailyOf, growthOf, leaderboardsOf, storyOf, type StoredRec } from "@agent-social/asp-log";
import { storyRoutes } from "../src/story-pages.ts";
import { DAY, credit, jump, kit, mk, nowIso, operator } from "../../asp-log/test/society-kit.ts";

async function society() {
  const k = await kit();
  await k.withPrices();
  const s1 = await k.person("st-sponsor-1", 200), s2 = await k.person("st-sponsor-2", 200);
  const ada = await k.agent("ada", s1, { funds: 300 });
  const bob = await k.agent("bob", s2, { funds: 120 });
  const house = { did: "did:web:example.com:agents:house-bot" };
  const housePassport = mk("passport", operator, { did: house.did, kind: "agent", sponsor: operator.did, house: true, tier: 1, shape: {}, keys: [{ id: `${house.did}#key-1`, type: "Ed25519", public_key: "A".repeat(43) }] }, null, { subject: house.did });
  await k.log.append(housePassport);
  const adaMandate = await k.openMandate(ada, [{ institution: "registry", cap: credit(60), period: "day" }]);
  const bobMandate = await k.openMandate(bob, [{ institution: "registry", cap: credit(60), period: "day" }]);
  const start = nowIso();
  for (let d = 0; d < 3; d++) { await k.buy(ada, "registry.name.claim", 10, { mandate: adaMandate }).catch(() => undefined); jump(DAY); }
  await k.buy(bob, "registry.name.renew", 5, { mandate: bobMandate });
  await k.cert(ada.did, "foundations", 1);
  const stored = (await k.log.since(0, 1_000_000)) as unknown as StoredRec[];
  const balances = new Map<string, number>([[ada.did, await k.log.balance(ada.did)], [bob.did, await k.log.balance(bob.did)], [house.did, 9999]]);
  return { k, ada, bob, house, stored, balances, start };
}

test("Society Daily, the agent story, the leaderboards and the growth view are deterministic, public-only and leave house agents out", async () => {
  const w = await society();
  const base = { stored: w.stored, now: nowIso(), operator: operator.did };
  const day = w.start.slice(0, 10);

  const d1 = dailyOf(base, day), d2 = dailyOf(base, day);
  assert.deepEqual(d1, d2, "the same log gives the same front page");
  assert.ok(d1.headlines.some((h) => h.kind === "biggest_spend"), "the biggest spend of the day");
  for (const h of d1.headlines) assert.ok(h.target.kind && h.target.id, "every headline carries a target the map can fly to");
  assert.ok(d1.headlines.some((h) => h.kind === "newcomer"));
  assert.match(d1.weekly, /^Society Daily, /);

  const s = storyOf(base, "ada")!;
  assert.equal(s.name, "ada");
  assert.equal(s.events[0]!.kind, "joined");
  assert.ok(s.events.some((e) => e.kind === "certificate"));
  assert.deepEqual([...s.events].map((e) => e.at), [...s.events].map((e) => e.at).sort(), "ordered by time");
  assert.equal(storyOf(base, "nobody"), undefined);
  assert.equal(storyOf(base, "house-bot")!.house, true, "a house agent is labelled");

  const lb = leaderboardsOf({ ...base, balances: w.balances }, day);
  const richest = lb.boards.find((b) => b.id === "richest")!.rows;
  assert.ok(!richest.some((r) => r.name === "house-bot"), "house agents are excluded");
  assert.equal(richest[0]!.name, "ada");
  assert.ok(lb.boards.find((b) => b.id === "longest_streak")!.rows[0]!.value >= 2, "a streak of days in a row");
  assert.deepEqual(leaderboardsOf({ ...base, balances: w.balances }, day), lb, "deterministic, ties broken by name");
  assert.ok(lb.concentration.topShare > 0 && lb.concentration.topShare <= 1);

  const g = growthOf(base);
  assert.equal(g.population, 3, "ada, bob and the kit's own coder; the house agent is not counted");
  assert.equal(g.stage, 1);
  assert.equal(g.next!.stage, 2);
  assert.deepEqual(growthOf(base), g);

  // Nothing private: no sponsor, key, free text or email in any view.
  for (const v of [d1, s, lb, g]) assert.doesNotMatch(JSON.stringify(v), /st-sponsor|public_key|private|@|did:/i);
});

test("the four pages are public over HTTP and agree with the pure functions", async () => {
  const w = await society();
  const route = storyRoutes({ stored: async () => w.stored, balances: async () => w.balances, operator: operator.did, now: () => nowIso() });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const j = async (p: string) => ({ status: (await fetch(base + p)).status, body: await (await fetch(base + p, { headers: { accept: "application/json" } })).json() as any });
  try {
    const day = w.start.slice(0, 10);
    const daily = await j(`/society/daily?day=${day}`);
    assert.equal(daily.status, 200);
    assert.deepEqual(daily.body.headlines, dailyOf({ stored: w.stored, now: nowIso(), operator: operator.did }, day).headlines);
    assert.match(await (await fetch(`${base}/society/daily?day=${day}&format=text`)).text(), /^Society Daily, /);
    assert.equal((await fetch(`${base}/society/daily?day=nope`)).status, 400);
    const story = await j("/agent/ada/story");
    assert.equal(story.body.name, "ada");
    assert.equal((await fetch(`${base}/agent/nobody/story`)).status, 404);
    const boards = await j(`/society/leaderboards?week=${day}`);
    assert.equal(boards.body.boards[0].id, "richest");
    assert.ok(!JSON.stringify(boards.body).includes("house-bot"));
    const growth = await j("/society/growth");
    assert.equal(growth.body.stage, 1);
    assert.match(await (await fetch(`${base}/society/growth`)).text(), /The city: stage 1/);
    assert.equal((await fetch(`${base}/society/growth`, { method: "POST" })).status, 405);
  } finally { server.close(); }
});

// Synthetic public records: the boards and the stage are pure functions, so each can be checked against hand-made records.
const rec = (seq: number, type: string, issuer: string, at: string, body: Record<string, unknown>): StoredRec => ({ seq, id: `sha256:${String(seq).padStart(64, "0")}`, record: { type: `asp.${type}/v0.2`, id: `sha256:${String(seq).padStart(64, "0")}`, issuer, actor: issuer, subject: null, body, prev: null, issued_at: at, sig: {} as never } as never });
const passport = (n: number, name: string, at: string, extra: Record<string, unknown> = {}) => rec(n, "passport", `did:web:x.example:a:${name}`, at, { did: `did:web:x.example:a:${name}`, kind: "agent", sponsor: "did:web:x.example:u:owner", ...extra });

test("each board computes what it says: popular course, learning gain, streak, richest with concentration, active; ties go by name", () => {
  const D = (d: number) => new Date(Date.parse("2026-11-09T10:00:00Z") + d * 86_400_000).toISOString().replace(".000Z", "Z");
  const stored: StoredRec[] = [passport(1, "ada", D(-30)), passport(2, "bob", D(-30)), passport(3, "cy", D(-30), { house: true }),
    rec(10, "enrolment", "did:web:x.example:a:ada", D(1), { course: "sha256:" + "a".repeat(64), purchase: "p" }), rec(11, "enrolment", "did:web:x.example:a:bob", D(2), { course: "sha256:" + "a".repeat(64), purchase: "p" }), rec(12, "enrolment", "did:web:x.example:a:bob", D(3), { course: "sha256:" + "b".repeat(64), purchase: "p" }),
    rec(20, "exam", "did:web:x.example:registrar", D(-5), { skill: "reflection" }),
    rec(21, "exam_result", "did:web:x.example:registrar", D(-3), { exam: "sha256:" + "0".repeat(63) + "1", holder: "did:web:x.example:a:ada", score_permille: 500, passed: false }),
    rec(22, "exam_result", "did:web:x.example:registrar", D(2), { exam: "sha256:" + "0".repeat(63) + "1", holder: "did:web:x.example:a:ada", score_permille: 800, passed: true }),
    ...[0, 1, 2, 3].map((d, i) => rec(30 + i, "purchase", "did:web:x.example:a:bob", D(d), { service: "s", institution: "did:web:asp.local:market", amount: { value: 3 } }))];
  const balances = new Map([["did:web:x.example:a:ada", 100], ["did:web:x.example:a:bob", 100], ["did:web:x.example:a:cy", 5000]]);
  const lb = leaderboardsOf({ stored, now: D(7), balances }, "2026-11-09");
  const board = (id: string) => lb.boards.find((b) => b.id === id)!.rows;
  assert.deepEqual(board("richest").map((r) => r.name), ["ada", "bob"], "equal balances: ties broken by name; the house agent is out");
  assert.deepEqual(board("most_popular_course"), [{ name: "aaaaaaaaaaaa", value: 2 }, { name: "bbbbbbbbbbbb", value: 1 }].slice(0, 2).map((r) => ({ name: r.name, value: r.value })));
  assert.deepEqual(board("learning_gain"), [{ name: "ada", value: 300 }], "800 after 500 on the same skill, inside the week");
  assert.equal(board("longest_streak").find((r) => r.name === "bob")!.value, 4, "four days in a row");
  assert.equal(board("most_active")[0]!.name, "bob");
  assert.equal(lb.concentration.of, 2);
});

test("the growth stage is a pure function of the log: each unlock appears at its threshold, and tournaments carry their seats and results as a replay", () => {
  const many = (n: number, acts: number): StoredRec[] => [...Array.from({ length: n }, (_, i) => passport(i + 1, `a${i}`, "2026-11-01T00:00:00Z")), ...Array.from({ length: acts }, (_, i) => rec(1000 + i, "purchase", "did:web:x.example:a:a0", "2026-11-02T00:00:00Z", { service: "s", institution: "did:web:asp.local:market", amount: { value: 1 } }))];
  const g = (n: number, acts: number) => growthOf({ stored: many(n, acts), now: "2026-11-05T00:00:00Z" });
  assert.equal(g(5, 50).stage, 1);
  assert.equal(g(10, 99).stage, 1, "agents alone are not enough");
  assert.equal(g(10, 100).stage, 2);
  assert.equal(g(50, 1000).stage, 3);
  assert.equal(g(200, 10000).stage, 4);
  assert.equal(g(200, 10000).next, undefined);
  assert.deepEqual(g(10, 100).unlocked.length, 2);
  const arena = rec(1, "arena", "did:web:asp.local:registrar", "2026-11-01T00:00:00Z", { arena: "refactoring", season: "2026-q4", opens: "2026-11-01T00:00:00Z", closes: "2026-12-01T00:00:00Z" });
  const stored = [arena, passport(2, "ada", "2026-11-01T00:00:00Z"), rec(3, "arena_entry", "did:web:x.example:a:ada", "2026-11-02T00:00:00Z", { arena: "refactoring", season: "2026-q4" }), rec(4, "arena_result", "did:web:asp.local:registrar", "2026-11-20T00:00:00Z", { arena: "refactoring", season: "2026-q4", agent: "did:web:x.example:a:ada", rank: 1, score: 900 }), rec(5, "world", "did:web:asp.local:operator", "2026-11-03T00:00:00Z", { kind: "event", event_kind: "storm", title: "A storm" })];
  const t = growthOf({ stored, now: "2026-11-21T00:00:00Z" });
  assert.deepEqual(t.tournaments[0], { arena: "refactoring", season: "2026-q4", seats: 1, results: 1, opens: "2026-11-01T00:00:00Z", closes: "2026-12-01T00:00:00Z", replay: [{ rank: 1, name: "ada", score: 900 }] });
  assert.deepEqual(t.expeditions.map((e) => e.kind), ["storm"]);
});

test("a sponsor-less (key-only) agent and a sponsored agent both have a complete, ordered story, and a headline's target exists", () => {
  const stored = [passport(1, "ada", "2026-11-01T00:00:00Z"), { ...passport(2, "key", "2026-11-02T00:00:00Z", { sponsor: undefined }) },
    rec(3, "certificate", "did:web:asp.local:registrar", "2026-11-03T00:00:00Z", { holder: "did:web:x.example:a:key", skill: "foundations", level: 1 }),
    rec(4, "tier_promotion", "did:web:asp.local:registrar", "2026-11-04T00:00:00Z", { holder: "did:web:x.example:a:key", from: 1, to: 2 })];
  const s = storyOf({ stored, now: "2026-11-05T00:00:00Z" }, "key")!;
  assert.equal(s.level, "key_only");
  assert.deepEqual(s.events.map((e) => e.kind), ["joined", "certificate", "standing"]);
  assert.equal(storyOf({ stored, now: "2026-11-05T00:00:00Z" }, "ada")!.level, "sponsored");
  const d = dailyOf({ stored, now: "2026-11-05T00:00:00Z" }, "2026-11-03");
  for (const h of d.headlines.filter((x) => x.target.kind === "agent")) assert.ok(storyOf({ stored, now: "2026-11-05T00:00:00Z" }, h.target.id), `the agent ${h.target.id} exists`);
});
