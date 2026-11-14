// The world engine (register rows DK76, DK77; docs/spec-deltas.md S170): a seeded generator, signed calendar and day records, replay, tamper checks,
// and an effect the rest of the system reads without ever moving a tier, a standing or an eligibility. Fake keys, made fresh in each run.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AspError, b64urlEncode, createRecord, defaultSchemas, publicKeyFromSeed, signerFromSeed, staticResolver, verifyRecord, type AspRecord } from "@agent-social/asp-core";
import { EventLog, MemoryStore } from "../src/index.ts";
import { GENERATOR, WORLD_DID, dayBody, effectivePrice, explainDay, generateDay, seedCommitment, worldStateAt, calendarBetween } from "../src/world.ts";

const seed = new Uint8Array(randomBytes(32));
const world = { did: WORLD_DID, ...signerFromSeed(`${WORLD_DID}#key-1`, seed) };
const SEED = "test-seed-alpha";
const T = (iso: string) => iso;

async function freshLog() {
  const log = new EventLog(new MemoryStore(), { now: () => new Date("2026-11-20T00:00:00Z") });
  await log.append(createRecord({
    type: "passport", issuer: WORLD_DID, subject: WORLD_DID, prev: null, issued_at: "2026-11-01T00:00:00Z",
    body: { did: WORLD_DID, kind: "org", keys: [{ id: world.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(seed)) }] },
  }, world));
  return log;
}
const worldRecord = (body: Record<string, unknown>, issuedAt: string) => createRecord({ type: "world", issuer: WORLD_DID, subject: null, prev: null, body, issued_at: issuedAt }, world);
const codeOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof AspError) return e.detail ?? e.code; throw e; } return undefined; };

/** The first day from 2026-11-12 on whose events include `type`. */
function firstDayWith(type: string, s = SEED): string {
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.parse("2026-11-12T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
    if (generateDay(s, day).some((e) => e.event_type === type)) return day;
  }
  throw new Error(`no ${type} in 400 days`);
}

describe("the seeded generator", () => {
  test("two runs with the same seed give identical events; another seed gives different ones", () => {
    const days = Array.from({ length: 120 }, (_, i) => new Date(Date.parse("2026-11-12T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
    const a = days.map((d) => generateDay(SEED, d)), b = days.map((d) => generateDay(SEED, d)), c = days.map((d) => generateDay("test-seed-beta", d));
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    const kinds = new Set(a.flat().map((e) => e.event_type));
    assert.ok(kinds.size >= 4, `120 days should show most of the catalogue, saw ${[...kinds].join(", ")}`);
    assert.ok(a.flat().length > 20, "the society is never still for long");
  });

  test("every fired event carries the draw and chance that fired it, and explainDay agrees", () => {
    const day = firstDayWith("price_shock");
    const ev = generateDay(SEED, day).find((e) => e.event_type === "price_shock")!;
    assert.ok(ev.draw < ev.chance);
    const why = explainDay(SEED, day).find((x) => x.type === "price_shock")!;
    assert.deepEqual([why.draw, why.chance, why.fired], [ev.draw, ev.chance, true]);
  });

  test("an unknown generator version or a bad day is refused", () => {
    assert.throws(() => generateDay(SEED, "2026-11-12", "asp-world-gen/9"), /unknown world generator/);
    assert.throws(() => generateDay(SEED, "2026-02-30"), /not a day/);
  });
});

describe("world records in the log", () => {
  test("a day record is signed, hash-chained into the log, replayable, and the whole log verifies", async () => {
    const log = await freshLog();
    const day = firstDayWith("price_shock");
    const r = await log.append(worldRecord({ ...dayBody(SEED, day) }, `${day}T01:00:00Z`));
    assert.equal(r.duplicate, false);
    assert.equal((await log.worldRecords()).length, 1);
    const stored = (await log.worldRecords())[0];
    assert.equal(stored.id, r.id);
    assert.equal((stored.body as { seed: string }).seed, SEED, "the seed is in the record, so anyone can run it again");
    assert.deepEqual((stored.body as { events: unknown }).events, generateDay(SEED, day));
    const v = await log.verify();
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.ok(v.head.seq >= 2);
  });

  test("a tampered event record fails verification: by signature, and by the generator when the authority itself lies", async () => {
    const log = await freshLog();
    const day = firstDayWith("price_shock");
    const good = worldRecord(dayBody(SEED, day), `${day}T01:00:00Z`);
    // 1. Someone edits the multiplier after signing.
    const edited = structuredClone(good) as AspRecord<{ events: { effect: { value: number } }[] }>;
    edited.body.events[0].effect.value = 2000;
    const resolve = staticResolver({ [world.kid]: publicKeyFromSeed(seed) });
    assert.throws(() => verifyRecord(good, resolve, defaultSchemas()) && verifyRecord(edited, resolve, defaultSchemas()), /BAD_ID|BAD_SIGNATURE|does not match/);
    assert.ok(await codeOf(log.append(edited)));
    // 2. The authority signs events that the seed does not give.
    const lie = dayBody(SEED, day);
    lie.events = structuredClone(lie.events); lie.events[0].effect.value = 1500 === lie.events[0].effect.value ? 700 : 1500;
    assert.equal(await codeOf(log.append(worldRecord(lie, `${day}T01:00:00Z`))), "event_not_reproducible");
    // 3. A day with an event added that the seed did not fire.
    const extra = dayBody(SEED, day);
    extra.events = [...extra.events, { ...extra.events[0], event_id: `${day}:service_outage`, event_type: "service_outage" }];
    assert.equal(await codeOf(log.append(worldRecord(extra, `${day}T01:00:00Z`))), "event_not_reproducible");
    // 4. A seed that does not match its commitment, and a seed revealed as another.
    const wrongCommit = { ...dayBody(SEED, day), seed_commitment: seedCommitment("someone-else") };
    assert.equal(await codeOf(log.append(worldRecord(wrongCommit, `${day}T01:00:00Z`))), "seed_commitment_mismatch");
    assert.equal((await log.worldRecords()).length, 0, "none of the bad records was stored");
    // The good one still goes in.
    await log.append(good);
    assert.equal((await log.verify()).ok, true);
  });

  test("only the world authority signs; a day cannot be announced before it starts", async () => {
    const log = await freshLog();
    const day = firstDayWith("price_shock");
    const other = signerFromSeed("did:web:example.com:agents:rogue#key-1", new Uint8Array(randomBytes(32)));
    const rogue = createRecord({ type: "world", issuer: "did:web:example.com:agents:rogue", subject: null, prev: null, body: dayBody(SEED, day), issued_at: `${day}T01:00:00Z` }, other);
    const code = await codeOf(new EventLog(new MemoryStore(), { fallbackResolver: staticResolver({ [other.kid]: other.publicKey }) }).append(rogue));
    assert.equal(code, "world_not_authority");
    assert.equal(await codeOf(log.append(worldRecord(dayBody(SEED, day), `${new Date(Date.parse(`${day}T00:00:00Z`) - 3_600_000).toISOString()}`))), "world_day_not_started");
  });

  test("calendar entries: 72 hours' notice, a seed commitment for a shock, bounds on a price multiplier, a sane window", async () => {
    const log = await freshLog();
    const entry = (over: Record<string, unknown>) => ({
      kind: "calendar_entry", entry_id: "spring-review", source: "market", event_kind: "scheduled", title: "Price list review",
      starts: "2026-12-01T00:00:00Z", ends: "2026-12-02T00:00:00Z", effect: { type: "price_multiplier", target: "code", value: 1100 }, ...over,
    });
    assert.equal(await codeOf(log.append(worldRecord(entry({}), "2026-11-30T00:00:00Z"))), "world_notice_too_short");
    assert.equal(await codeOf(log.append(worldRecord(entry({ event_kind: "shock" }), "2026-11-30T00:00:00Z"))), "seed_not_committed");
    assert.equal(await codeOf(log.append(worldRecord(entry({ effect: { type: "price_multiplier", target: "code", value: 4000 } }), "2026-11-20T00:00:00Z"))), "calendar_out_of_bounds");
    assert.equal(await codeOf(log.append(worldRecord(entry({ ends: "2026-12-01T00:00:00Z" }), "2026-11-20T00:00:00Z"))), "world_bad_window");
    const ok = await log.append(worldRecord(entry({}), "2026-11-20T00:00:00Z"));
    assert.equal(ok.duplicate, false);
    const seeded = await log.append(worldRecord(entry({ entry_id: "drill-1", event_kind: "drill", seed_commitment: seedCommitment("d"), generator: GENERATOR, effect: { type: "service_outage", target: "market", value: 0 } }), "2026-11-30T00:00:00Z"));
    assert.equal(seeded.duplicate, false);
    assert.equal((await log.verify()).ok, true);
  });
});

describe("what the rest of the system reads", () => {
  test("a price shock changes the effective price inside its window, and only there", async () => {
    const log = await freshLog();
    const day = firstDayWith("price_shock");
    const ev = generateDay(SEED, day).find((e) => e.event_type === "price_shock")!;
    await log.append(worldRecord(dayBody(SEED, day), `${day}T00:30:00Z`));
    const during = await log.worldState(`${day}T12:00:00Z`);
    assert.equal(during.priceMultiplier[ev.effect.target], ev.effect.value);
    assert.equal(effectivePrice(100, ev.effect.target, during), Math.round((100 * ev.effect.value) / 1000));
    assert.ok(during.because.some((b) => b.id === ev.event_id));
    const after = await log.worldState(new Date(Date.parse(ev.ends) + 1000).toISOString());
    assert.equal(after.priceMultiplier[ev.effect.target], undefined);
    assert.equal(effectivePrice(100, ev.effect.target, after), 100);
    const before = await log.worldState(new Date(Date.parse(`${day}T00:00:00Z`) - 1000).toISOString());
    assert.equal(before.priceMultiplier[ev.effect.target], undefined);
  });

  test("outages, tax-free windows and open job types come from the same records; overlapping shocks stay inside the bounds", async () => {
    const recs = [
      worldRecord({ kind: "calendar_entry", entry_id: "a", source: "market", event_kind: "event", title: "x", starts: "2026-12-01T00:00:00Z", ends: "2026-12-03T00:00:00Z", effect: { type: "price_multiplier", target: "code", value: 2000 } }, "2026-11-20T00:00:00Z"),
      worldRecord({ kind: "calendar_entry", entry_id: "b", source: "market", event_kind: "event", title: "y", starts: "2026-12-01T00:00:00Z", ends: "2026-12-03T00:00:00Z", effect: { type: "price_multiplier", target: "code", value: 2000 } }, "2026-11-20T00:00:00Z"),
      worldRecord({ kind: "calendar_entry", entry_id: "c", source: "market", event_kind: "event", title: "z", starts: "2026-12-01T00:00:00Z", ends: "2026-12-03T00:00:00Z", effect: { type: "service_outage", target: "forum", value: 0 } }, "2026-11-20T00:00:00Z"),
      worldRecord({ kind: "calendar_entry", entry_id: "d", source: "treasury", event_kind: "event", title: "w", starts: "2026-12-01T00:00:00Z", ends: "2026-12-03T00:00:00Z", effect: { type: "tax_free", target: "all", value: 1000 } }, "2026-11-20T00:00:00Z"),
      worldRecord({ kind: "calendar_entry", entry_id: "e", source: "market", event_kind: "event", title: "v", starts: "2026-12-01T00:00:00Z", ends: "2026-12-03T00:00:00Z", effect: { type: "job_type_open", target: "translation", value: 0 } }, "2026-11-20T00:00:00Z"),
    ];
    const s = worldStateAt(recs, "2026-12-02T00:00:00Z");
    assert.equal(s.priceMultiplier.code, 2000, "two doublings are held at the 200% bound");
    assert.deepEqual([s.outages, s.taxFree, s.openJobTypes], [["forum"], true, ["translation"]]);
    const quiet = worldStateAt(recs, "2026-12-05T00:00:00Z");
    assert.deepEqual([quiet.outages, quiet.taxFree, quiet.openJobTypes, quiet.priceMultiplier], [[], false, [], {}]);
    assert.equal(calendarBetween(recs, new Date("2026-12-02T00:00:00Z"), new Date("2026-12-04T00:00:00Z")).length, 5);
  });

  test("credits never buy standing: an effect cannot name a tier, rank, standing or eligibility, and an event leaves them where they were", async () => {
    const schemas = defaultSchemas();
    const base = { kind: "calendar_entry", entry_id: "t", source: "market", event_kind: "event", title: "t", starts: "2026-12-01T00:00:00Z", ends: "2026-12-02T00:00:00Z" };
    assert.equal(schemas.isValid("world", { ...base, effect: { type: "price_multiplier", target: "code", value: 1000 } }), true);
    for (const bad of [{ type: "tier_up", target: "code", value: 1 }, { type: "price_multiplier", target: "code", value: 1000, tier: 3 }, { type: "price_multiplier", target: "code", value: 1000, standing: 100 }, { type: "eligibility", target: "all", value: 1 }]) {
      assert.equal(schemas.isValid("world", { ...base, effect: bad }), false, JSON.stringify(bad));
    }
    assert.equal(schemas.isValid("world", { ...base, effect: { type: "tax_free", target: "all", value: 1000 }, tier: 2 }), false, "no field on the record itself either");

    // The ledger-side view of standing is the same before and after a day of events.
    const log = await freshLog();
    const probe = "did:web:example.com:agents:probe";
    await log.mint(probe, 300);
    const snap = async () => JSON.stringify({ bal: await log.balance(probe), rep: await log.reputationOf(probe), pp: await log.passport(probe), audit: (await log.creditAudit()).verdict });
    const before = await snap();
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.parse("2026-11-12T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      await log.append(worldRecord(dayBody(SEED, day), `${day}T03:00:00Z`));
    }
    assert.equal(await snap(), before);
    const state = await log.worldState("2026-12-01T12:00:00Z");
    assert.deepEqual(Object.keys(state).sort(), ["at", "because", "gatherings", "openJobTypes", "outages", "priceMultiplier", "taxFree"]);
  });

  test("replay: running the generator again on a logged day gives the logged events", async () => {
    const log = await freshLog();
    for (let i = 0; i < 10; i++) {
      const day = new Date(Date.parse("2026-11-12T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      await log.append(worldRecord(dayBody(SEED, day), `${day}T03:00:00Z`));
    }
    for (const r of await log.worldRecords()) {
      const b = r.body as { day: string; seed: string; generator: string; events: unknown };
      assert.deepEqual(generateDay(b.seed, b.day, b.generator), b.events);
    }
    void T;
  });
});
