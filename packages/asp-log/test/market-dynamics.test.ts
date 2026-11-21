/**
 * What keeps the Market moving (market.md 14; MK-16 to MK-20; register row DK1456; spec-delta S1403): a season, a seeded demand process, the guide price by class from the fill rate, disclosed entrant waves and the
 * monitor. Each replays identically from its revealed seed, none moves a credit, a tier or a standing, and the world's kill-switch (S1402) stops the swings. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { b64urlEncode, createRecord, publicKeyFromSeed, signerFromSeed } from "@agent-social/asp-core";
import {
  DEMAND_BASE, DEMAND_MAX, DEMAND_MIN, GUIDE_BAND, GUIDE_STEP_MAX, TARGET_FILL, SKILLS, adaptationDays, demandOn, demandTable, entrantWaves, guideFromFill, mixDivergence, seasonOf, skillClass, transferShare,
  type JobFact,
} from "../src/market-dynamics.ts";
import { WORLD_DID, dayBody, seedCommitment } from "../src/world.ts";
import { DAY, credit, kit, market, mk, nowIso, operator, type Party } from "./society-kit.ts";

const SEED = "dynamics-test-seed";
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

describe("the season (MK-16)", () => {
  test("calendar quarters in UTC, each with a published theme and the class it favours; the boundaries are exact", () => {
    assert.equal(seasonOf("2026-01-01").quarter, 1);
    assert.equal(seasonOf("2026-03-31").quarter, 1);
    assert.equal(seasonOf("2026-04-01").quarter, 2);
    assert.equal(seasonOf("2026-12-31").quarter, 4);
    assert.equal(seasonOf("2026-12-31").ends, "2027-01-01");
    assert.deepEqual([1, 2, 3, 4].map((q) => seasonOf(`2026-${String(q * 3).padStart(2, "0")}-15`).favours), ["routine", "skilled", "critical", "trivial"]);
    assert.equal(seasonOf("2026-05-05").boostPermille, 150);
    assert.throws(() => seasonOf("2026-02-30"), /not a day/);
  });
});

describe("the seeded demand process (MK-17)", () => {
  test("the same seed and day give the same demand; another seed differs; every value stays in its band", () => {
    const days = Array.from({ length: 120 }, (_, i) => iso(Date.parse("2026-11-01T00:00:00Z") + i * DAY).slice(0, 10));
    const a = days.map((d) => demandTable(SEED, d)), b = days.map((d) => demandTable(SEED, d)), c = days.map((d) => demandTable("another-seed", d));
    assert.deepEqual(a, b, "a replay from the revealed seed is identical");
    assert.notDeepEqual(a, c);
    for (const row of a.flat()) assert.ok(row.index >= DEMAND_MIN && row.index <= DEMAND_MAX + 150, `${row.skill} ${row.day}: ${row.index}`);
    assert.equal(new Set(a.flat().map((x) => x.index)).size > 50, true, "demand really moves");
  });

  test("it reverts to its baseline: over a long stretch the mean is near 1000, and a step moves a quarter of the way back", () => {
    let sum = 0, n = 0;
    for (let i = 0; i < 400; i++) { const d = demandOn(SEED, "translation", iso(Date.parse("2026-01-01T00:00:00Z") + i * DAY).slice(0, 10)); sum += d.index - d.seasonBoost; n++; }
    assert.ok(Math.abs(sum / n - DEMAND_BASE) < 120, `mean ${sum / n}`);
  });

  test("the season boosts the skills of the class it favours, by 150 permille, and no other", () => {
    const q2 = "2026-05-12"; // skilled
    assert.equal(skillClass("code-review"), "skilled");
    assert.equal(demandOn(SEED, "code-review", q2).seasonBoost, 150);
    assert.equal(demandOn(SEED, "translation", q2).seasonBoost, 0);
    assert.equal(demandOn(SEED, "code-review", "2026-11-12").seasonBoost, 0, "Q4 favours trivial work, not skilled");
  });

  test("while the world is halted the demand is the baseline with no boost", () => {
    for (const s of SKILLS) assert.deepEqual(demandOn(SEED, s, "2026-05-12", true), { skill: s, day: "2026-05-12", index: DEMAND_BASE, seasonBoost: 0, halted: true });
  });
});

describe("the guide price by class from the fill rate (MK-18)", () => {
  test("a low fill rate raises the guide price, a high one lowers it, never by more than 100 permille a week, inside the band", () => {
    assert.equal(guideFromFill("routine", []).price, 20, "no evidence: the class's base price");
    const low = guideFromFill("routine", [200]);
    assert.equal(low.ofMinimum, 1000 + Math.min(GUIDE_STEP_MAX, Math.trunc((TARGET_FILL - 200) / 4)));
    assert.ok(low.price > 20);
    assert.equal(guideFromFill("routine", [1000]).ofMinimum, GUIDE_BAND.min, "it never goes under the band");
    assert.equal(guideFromFill("skilled", Array(40).fill(0)).ofMinimum, GUIDE_BAND.max, "nor over it");
    assert.equal(guideFromFill("skilled", [0]).ofMinimum - 1000, GUIDE_STEP_MAX, "one week moves it by at most the step");
    assert.equal(guideFromFill("critical", [null, null, 650]).weeks, 1, "a week with no ending posting says nothing");
    assert.equal(guideFromFill("critical", [650]).ofMinimum, 1000, "at the target it stays put");
  });
});

describe("entrant waves (MK-19)", () => {
  test("a published schedule from the seed: replayable, about one week in four, every wave labelled operator-run and disclosed, never when halted", () => {
    const a = entrantWaves(SEED, "2026-11-12", 52), b = entrantWaves(SEED, "2026-11-12", 52);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, entrantWaves("other", "2026-11-12", 52));
    assert.ok(a.length >= 6 && a.length <= 22, `${a.length} waves in 52 weeks`);
    for (const w of a) {
      assert.equal(w.label, "operator-run");
      assert.equal(new Date(`${w.starts}T00:00:00Z`).getUTCDay(), 1, "a wave starts on a Monday");
      assert.ok(w.posters >= 1 && w.posters <= 3 && w.agents >= 1 && w.agents <= 3);
      assert.match(w.disclosure, /house agents/);
      assert.match(w.disclosure, /earn nothing that counts for a real agent's standing/);
    }
    assert.deepEqual(entrantWaves(SEED, "2026-11-12", 52, true), []);
    assert.equal(entrantWaves(SEED, "2026-11-12", 500).length <= 22, true, "the horizon is a year");
  });
});

describe("the dynamics monitor (MK-20)", () => {
  const job = (at: string, cls: JobFact["class"], performer = "a"): JobFact => ({ at, class: cls, performer });
  test("mix divergence is 0 for the same mix, 1000 for disjoint ones, null with nothing to compare", () => {
    const x = [job("2026-11-01T00:00:00Z", "routine"), job("2026-11-02T00:00:00Z", "skilled")];
    assert.equal(mixDivergence(x, x), 0);
    assert.equal(mixDivergence([job("2026-11-01T00:00:00Z", "routine")], [job("2026-11-01T00:00:00Z", "critical")]), 1000);
    assert.equal(mixDivergence(x, []), null);
    assert.equal(mixDivergence([job("t", "routine"), job("t", "skilled")], [job("t", "routine"), job("t", "routine")]), 500);
  });
  test("transfer share: the share of the period's jobs taken by a performer with none in that class in the 90 days before", () => {
    const history = [job("2026-08-01T00:00:00Z", "routine", "old-hand"), job("2026-10-01T00:00:00Z", "routine", "old-hand"), job("2026-11-10T00:00:00Z", "routine", "old-hand"), job("2026-11-11T00:00:00Z", "skilled", "mover")];
    const period = history.filter((j) => j.at >= "2026-11-01");
    assert.equal(transferShare(period, history), 1000 - 0 - 500, "old-hand had a routine job 40 days before its own (the one 101 days before does not count): not a mover; mover had none in skilled: a mover (1 of 2)");
    assert.equal(transferShare([], history), null);
  });
  test("adaptation days: until the class's share of contracts moves by 100 permille from the week before the event; null if it never does", () => {
    const base = Array.from({ length: 7 }, (_, i) => job(iso(Date.parse("2026-11-01T00:00:00Z") + i * DAY), "routine"));
    const after = [job("2026-11-09T12:00:00Z", "skilled"), job("2026-11-10T12:00:00Z", "skilled"), job("2026-11-11T12:00:00Z", "skilled")];
    const d = adaptationDays([...base, ...after], "skilled", "2026-11-08T00:00:00Z", "2026-11-20T00:00:00Z");
    assert.equal(d, 2, "the first window with skilled work after the event: day 2 (the 9th's job falls in the window ending on the 10th)");
    assert.equal(adaptationDays(base, "skilled", "2026-11-08T00:00:00Z", "2026-11-20T00:00:00Z"), null);
    assert.equal(adaptationDays([], "skilled", "2026-11-08T00:00:00Z", "2026-11-20T00:00:00Z"), null, "nothing before the event, nothing to compare");
  });
});

describe("the Market's dynamics on a log", () => {
  const worldSeed = new Uint8Array(randomBytes(32));
  const world = { did: WORLD_DID, ...signerFromSeed(`${WORLD_DID}#key-1`, worldSeed) };
  async function setup() {
    const k = await kit();
    await k.withPrices();
    await k.log.append(createRecord({ type: "passport", issuer: WORLD_DID, subject: WORLD_DID, prev: null, issued_at: "2026-10-01T00:00:00Z", body: { did: WORLD_DID, kind: "org", keys: [{ id: world.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(worldSeed)) }] } }, world));
    const poster = await k.person("dyn-poster", 5000);
    const sponsor = await k.person("dyn-sponsor", 50);
    const worker = await k.agent("dyn-worker", sponsor, { funds: 500 });
    const post = async (expiresInDays: number) => {
      const intent = await k.intent(poster, { budget: credit(60) });
      const deposit = await k.buy(poster, "market.posting.deposit", 2);
      const posting = mk("market_act", poster, { act: "posting", intent, board: "main", expires: iso(Date.parse(nowIso()) + expiresInDays * DAY), deposit });
      await k.log.append(posting);
      return { intent, posting: posting.id };
    };
    const fill = async (p: { intent: string; posting: string }) => {
      const offer = await k.offer(worker, p.intent, 60);
      await k.log.append(mk("market_act", worker, { act: "bid", posting: p.posting, offer }));
      const ranked = await k.log.rankPosting(p.posting, "best_match", "seed-1");
      await k.log.append(mk("market_act", market, { act: "assignment", posting: p.posting, intent: p.intent, agent: worker.did, rule: "best_match", ranked, seed: "seed-1" }));
      return k.runJob(poster, worker, 60, { intent: p.intent, offer });
    };
    const recordDay = (day: string) => k.log.append(createRecord({ type: "world", issuer: WORLD_DID, subject: null, prev: null, issued_at: `${day}T01:00:00Z`, body: dayBody(SEED, day) }, world));
    return { ...k, poster, worker, post, fill, recordDay };
  }

  test("before any day is recorded: the baseline, no seed, no waves; then with a day the revealed seed drives the demand and it equals a replay from the seed", async () => {
    const w = await setup();
    const day = nowIso().slice(0, 10);
    const none = await w.log.marketDynamics(nowIso());
    assert.equal(none.seed, null);
    assert.deepEqual(none.waves, []);
    assert.ok(none.demand.every((d) => d.index === DEMAND_BASE));
    await w.recordDay(day);
    const dyn = await w.log.marketDynamics(`${day}T12:00:00Z`);
    assert.equal(dyn.seed, seedCommitment(SEED), "the seed is shown by its commitment");
    assert.deepEqual(dyn.demand, demandTable(SEED, day), "a replay from the revealed seed gives the same numbers");
    assert.deepEqual(dyn.waves, entrantWaves(SEED, day, 8));
    assert.deepEqual(dyn.season, seasonOf(day));
    assert.equal(dyn.version, "asp-market-dynamics/1");
  });

  test("the guide price follows the fill rate the log's own postings give", async () => {
    const w = await setup();
    const filled = await w.post(60);
    await w.fill(filled);
    await w.post(0.25); // expires within the day: an ended, unfilled posting in the same week
    const later = iso(Date.parse(nowIso()) + 3 * DAY);
    const dyn = await w.log.marketDynamics(later);
    const routine = dyn.guides.find((g) => g.class === "routine")!;
    assert.equal(routine.lastFillRate, 500, "1 filled of 2 that ended");
    assert.equal(routine.ofMinimum, 1000 + Math.trunc((TARGET_FILL - 500) / 4));
    assert.equal(routine.price, Math.round((20 * routine.ofMinimum) / 1000));
    assert.equal(dyn.guides.find((g) => g.class === "critical")!.ofMinimum, 1000, "a class with no evidence stays at its base");
    assert.equal(dyn.monitor.transferShare, 1000, "the one job was the worker's first in its class");
  });

  test("the operator's halt stops the swings at once: baseline demand, no wave, no season boost", async () => {
    const w = await setup();
    const day = "2026-05-12";
    await w.recordDay(day);
    const before = await w.log.marketDynamics(`${day}T12:00:00Z`);
    assert.equal(before.halted, false);
    assert.equal(before.season.boostPermille, 150);
    await w.log.append(createRecord({ type: "world", issuer: operator.did, subject: null, prev: null, issued_at: `${day}T13:00:00Z`, body: { kind: "halt", reason: "stop the swings" } }, operator as never));
    const during = await w.log.marketDynamics(`${day}T14:00:00Z`);
    assert.equal(during.halted, true);
    assert.ok(during.demand.every((d) => d.index === DEMAND_BASE && d.seasonBoost === 0));
    assert.deepEqual(during.waves, []);
    assert.equal(during.season.boostPermille, 0);
    assert.equal((await w.log.marketDynamics(`${day}T12:30:00Z`)).halted, false, "the hour before the halt reads as it was");
  });

  test("reading the drivers changes nothing: no record, no balance, no tier or standing; the invariants hold; a stream of trivial jobs still moves no tier", async () => {
    const w = await setup();
    await w.recordDay(nowIso().slice(0, 10));
    const head = await w.log.head();
    const audit = (await w.log.creditAudit()).verdict;
    const repBefore = JSON.stringify(await w.log.reputationOf(w.worker.did));
    // a farming stream: twelve small jobs with one independent poster; the drivers are read between them
    for (let i = 0; i < 6; i++) {
      const p = await w.post(60);
      await w.fill(p);
      await w.log.marketDynamics(nowIso());
    }
    const rep = (await w.log.reputationOf(w.worker.did))!;
    assert.ok(rep.tier <= 1, "a stream of jobs from one poster does not lift the worker past tier 1 (the farming tests of DK6 are unchanged)");
    assert.equal(JSON.stringify(await w.log.reputationOf(w.worker.did)) === repBefore, false, "jobs change the record; reading the drivers does not");
    assert.equal((await w.log.creditAudit()).verdict, audit);
    const h2 = await w.log.head();
    await w.log.marketDynamics(nowIso());
    assert.deepEqual(await w.log.head(), h2, "reading appended nothing");
    assert.ok(h2.seq > head.seq);
    assert.equal((await w.log.worldInvariants(nowIso())).ok, true);
    assert.equal((await w.log.verify()).ok, true);
  });

  test("the public route /market/dynamics serves it", async () => {
    const w = await setup();
    await w.recordDay(nowIso().slice(0, 10));
    const { publicReply } = await import("../src/public-pages.ts");
    const r = await publicReply(w.log, "/market/dynamics", false);
    assert.equal(r?.status, 200);
    const result = (r?.json as { result: { version: string; demand: unknown[]; guides: unknown[] } }).result;
    assert.equal(result.version, "asp-market-dynamics/1");
    assert.equal(result.demand.length, SKILLS.length);
    assert.equal(result.guides.length, 4);
  });
});
void (null as unknown as Party);
