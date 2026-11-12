/**
 * Leisure and Events (docs/institutions/leisure-events.md; register rows DK36, DK37; spec-delta S272). Fake keys only. Credits are accounting entries, not money.
 * DK36: a festival with a contest runs end to end and the entry fees and prizes reconcile. DK37: recreation's effects are stated, measured (the meeting view) and priced (the entry), and it never changes standing.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { ENTRY_SERVICE, EVENTS_CATALOGUE, EVENTS_DID, TREASURY_DID, defaultPrizes, eventsCalendar, eventsReconciliation, meeting, souvenirsOf, splitParts } from "../src/index.ts";
import { DAY, mk, nowIso, operator, owner, refusedBy, treasury } from "./society-kit.ts";
import { events, shopsWorld } from "./shops-kit.ts";
import type { Party } from "./society-kit.ts";

const HOUR = 3_600_000;
const SHA = "sha256:" + "a".repeat(64);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const SPEND = [{ institution: "events", cap: 60 }];

async function world() {
  const w = await shopsWorld({});
  const log = w.log;
  /** Sponsors s1..sN each with `per` agents, funded and holding a Mandate that lists events and a running job (so each has a run log to cite). */
  const cast = async (sponsors: number, per = 1) => {
    const out: { a: Party; sponsor: Party; mandate: string; contract: string }[] = [];
    for (let s = 1; s <= sponsors; s++) {
      const sponsor = await w.k.person(`ev-sponsor-${s}`, 10);
      for (let i = 1; i <= per; i++) {
        const ag = await w.k.agent(`ev-${s}-${i}`, sponsor, { tier: 1, funds: 100 });
        const g = await w.agentWith(`ev-${s}-${i}`, { agent: ag, spend: SPEND, running: true });
        out.push({ a: ag, sponsor, mandate: g.mandate, contract: g.contract });
      }
    }
    return out;
  };
  /** The Treasury funds the pool: a budget (the first needs the owner's co-signature) and a payment. */
  const fundPool = async (amount: number) => {
    await w.k.mint(TREASURY_DID, amount);
    const b = mk("budget", treasury, { institution: EVENTS_DID, period: nowIso().slice(0, 7), amount: { value: amount, unit: "credit" }, purpose: "festival prizes" }, null, { cosigners: [owner] });
    await log.append(b);
    await log.append(mk("treasury_payment", treasury, { budget: b.id, to: EVENTS_DID, amount: { value: amount, unit: "credit" }, memo: "first festival" }));
  };
  const event = (over: Record<string, unknown> = {}) => {
    const t0 = Date.parse(nowIso());
    return clean({ act: "event", form: "contest", title: "Autumn contest", place: "room:autumn", opens: iso(t0 + HOUR), starts: iso(t0 + 73 * HOUR), entries_close: iso(t0 + 73 * HOUR), ends: iso(t0 + 75 * HOUR), capacity: 0, per_sponsor_cap: 2, min_tier: 1, entry_service: ENTRY_SERVICE, rules_sha256: SHA, judging: { kind: "scored", scorer_sha256: SHA, min_sponsors: 4 }, prizes: [{ rank: 1, amount: 50 }, { rank: 2, amount: 30 }, { rank: 3, amount: 20 }], ...over });
  };
  const clean = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
  const issue = async (over: Record<string, unknown> = {}) => { const r = mk("events_act", events, event(over)); await log.append(r); return r.id; };
  const buyEntry = async (c: { a: Party; mandate: string }) => w.buy(c.a, ENTRY_SERVICE, c.mandate);
  const enter = async (c: { a: Party; mandate: string; contract: string }, ev: string, over: Record<string, unknown> = {}) => {
    const p = await buyEntry(c);
    const act = mk("action", c.a, { contract: c.contract, scopes_used: [], summary: "contest run" }, null, { subject: c.contract });
    await log.append(act);
    const r = mk("events_act", c.a, { act: "entry", event: ev, purchase: p.id, artifact_sha256: SHA, run_log_hash: act.id, ...over });
    await log.append(r);
    return { purchase: p.id, entry: r.id };
  };
  const result = (ev: string, ranking: string[], awards: [string, number][], over: Record<string, unknown> = {}, sponsors = 5) => mk("events_act", events, { act: "contest_result", event: ev, rules_sha256: SHA, ranking: ranking.map((agent, i) => ({ agent, rank: i + 1, score: 100 - i })), awards: awards.map(([agent, amount]) => ({ agent, amount })), entries: ranking.length, distinct_sponsors: sponsors, evidence_sha256: SHA, ...over });
  return { ...w, cast, fundPool, event, issue, enter, buyEntry, result, jump: w.jump };
}

describe("events: a festival with a contest runs end to end and the fees and prizes reconcile (DK36)", () => {
  test("the Treasury grants a pool, the office issues a festival with a gathering and a contest, five sponsors RSVP, attend and enter, the result pays three prizes, and the books reconcile", async () => {
    const w = await world();
    const crew = await w.cast(5);
    await w.fundPool(200);
    assert.equal(await w.log.balance(EVENTS_DID), 200);
    const t0 = Date.parse(nowIso());
    // The festival is a container; the gathering and the contest are inside it. The contest reserves its 100 of prizes from the pool.
    const fest = await w.issue({ form: "festival", title: "Autumn festival", entry_service: undefined, judging: undefined, prizes: undefined, starts: iso(t0 + 72 * HOUR + 60_000), ends: iso(t0 + 80 * HOUR), entries_close: iso(t0 + 72 * HOUR + 60_000) });
    const gather = await w.issue({ form: "gathering", title: "Open house", parent: fest, capacity: 10, entry_service: undefined, judging: undefined, prizes: undefined, starts: iso(t0 + 74 * HOUR), ends: iso(t0 + 76 * HOUR), entries_close: iso(t0 + 74 * HOUR) });
    const contest = await w.issue({ parent: fest, starts: iso(t0 + 74 * HOUR), entries_close: iso(t0 + 74 * HOUR), ends: iso(t0 + 76 * HOUR) });
    const cal = eventsCalendar(await w.log.recordsOfTypes(["events_act"]), nowIso());
    assert.deepEqual(cal.map((e) => [e.form, e.state]), [["festival", "scheduled"], ["gathering", "scheduled"], ["contest", "scheduled"]]);
    // Entries open an hour after the announcement: every sponsor's agent pays the 20 and enters.
    w.jump(2 * HOUR);
    for (const c of crew) await w.enter(c, contest);
    // At the event: RSVP, attend, and a conversation in the room.
    w.jump(73 * HOUR);
    for (const c of crew) await w.log.append(mk("events_act", c.a, { act: "rsvp", event: gather }));
    for (const c of crew) await w.log.append(mk("events_act", c.a, { act: "attend", event: gather }));
    const ranking = crew.map((c) => c.a.did);
    const res = w.result(contest, ranking, [[ranking[0], 50], [ranking[1], 30], [ranking[2], 20]]);
    const before = await Promise.all(ranking.map((d) => w.log.balance(d)));
    await w.log.append(res);
    const after = await Promise.all(ranking.map((d) => w.log.balance(d)));
    assert.deepEqual(after.map((x, i) => x - before[i]), [50, 30, 20, 0, 0]);
    // The office delivers: a receipt for each of the 5 entries and the souvenirs.
    const run = await w.runEventsPass();
    assert.equal(run.receipts.length, 5);
    assert.deepEqual(run.refused, []);
    assert.equal(souvenirsOf(await w.log.recordsOfTypes(["events_act"]), ranking[0]).map((s) => s.kind).sort().join(), "attended,entered,placed:1");
    assert.equal(souvenirsOf(await w.log.recordsOfTypes(["events_act"]), ranking[4]).map((s) => s.kind).sort().join(), "attended,entered");
    // Reconcile: 5 entries of 20 = 100: the pool got its 850 permille, the Treasury 100, 50 was burned; prizes 100 were paid; the pool balance is the grant plus its share less the awards.
    const parts = splitParts(20, EVENTS_CATALOGUE[0].split);
    const pool = await w.log.balance(EVENTS_DID);
    const rec = eventsReconciliation(await w.log.recordsOfTypes(["purchase", "price_list", "receipt", "treasury_payment", "events_act"]), pool);
    assert.deepEqual([rec.entries, rec.fees, rec.pool_share, rec.treasury_share, rec.burned, rec.grants, rec.awards], [5, 100, 5 * parts.payees[0].amount, 5 * parts.treasury, 5 * parts.burn, 200, 100]);
    assert.equal(rec.pool_share + rec.treasury_share + rec.burned, rec.fees, "every entry fee is split to the credit");
    assert.equal(rec.balanced, true);
    assert.equal(pool, 200 + rec.pool_share - 100);
    assert.equal(rec.reserved, 0, "the reservation is spent");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal(eventsCalendar(await w.log.recordsOfTypes(["events_act"]), nowIso()).find((e) => e.id === contest)!.state, "results");
  });
});

describe("events: the record rules at their boundaries (leisure-events.md 9)", () => {
  test("an event 71 hours out is refused and 72 is accepted; times must be in order; prizes above the pool are refused and reserved ones cannot be reserved twice", async () => {
    const w = await world();
    await w.fundPool(100);
    const t0 = Date.parse(nowIso());
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ starts: iso(t0 + 71 * HOUR), entries_close: iso(t0 + 71 * HOUR), ends: iso(t0 + 75 * HOUR) })))), "event_notice_too_short");
    // The boundary exactly: announced at `at`, starting 72 hours later is accepted and one second sooner is not.
    const at = new Date(t0 + 60_000).toISOString().replace(".000Z", "Z");
    const exact = (starts: number) => mk("events_act", events, w.event({ opens: at, starts: iso(starts), entries_close: iso(starts), ends: iso(starts + 2 * HOUR) }), null, { at });
    assert.equal(await refusedBy(w.log.append(exact(Date.parse(at) + 72 * HOUR - 1000))), "event_notice_too_short");
    await w.log.append(exact(Date.parse(at) + 72 * HOUR));
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ ends: iso(t0 + 70 * HOUR) })))), "event_bad_times");
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ prizes: [{ rank: 1, amount: 50 }] })))), "event_pool_underfunded", "100 in the pool, 100 already reserved");
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ prizes: [{ rank: 2, amount: 5 }] })))), "prize_table_invalid");
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ judging: undefined })))), "contest_needs_judging");
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ judging: { kind: "scored", min_sponsors: 2 } })))), "contest_min_sponsors_too_low");
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ entry_service: "events.nothing" })))), "event_unknown_entry_service");
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ form: "gathering", prizes: [{ rank: 1, amount: 5 }] })))), "gathering_has_no_prizes");
    assert.equal(await refusedBy(w.log.append(mk("events_act", operator, w.event()))), "events_act_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, w.event({ form: "gathering", prizes: undefined, judging: undefined, entry_service: undefined, parent: "sha256:" + "f".repeat(64) })))), "event_parent_unknown");
  });

  test("the prize table is reserved from the pool and returns to it on a cancellation", async () => {
    const w = await world();
    await w.fundPool(100);
    const a = await w.issue();
    assert.equal(await refusedBy(w.issue()), "event_pool_underfunded");
    await w.log.append(mk("events_act", events, { act: "event_cancel", event: a, reason: "the room is closed" }));
    await w.issue(); // the reservation came back
    assert.equal(await refusedBy(w.log.append(mk("events_act", events, { act: "event_cancel", event: a, reason: "again" }))), "event_not_open");
  });

  test("RSVP and attendance: tier, capacity, seats per sponsor, one each, the window", async () => {
    const w = await world();
    const crew = await w.cast(3, 3); // three sponsors, three agents each
    const t0 = Date.parse(nowIso());
    const ev = await w.issue({ form: "gathering", capacity: 4, entry_service: undefined, judging: undefined, prizes: undefined, starts: iso(t0 + 73 * HOUR), entries_close: iso(t0 + 73 * HOUR), ends: iso(t0 + 75 * HOUR) });
    const rsvp = (c: { a: Party }) => w.log.append(mk("events_act", c.a, { act: "rsvp", event: ev }));
    await rsvp(crew[0]);
    assert.equal(await refusedBy(rsvp(crew[0])), "rsvp_exists");
    await rsvp(crew[1]);
    assert.equal(await refusedBy(rsvp(crew[2])), "event_sponsor_seats", "two seats per sponsor");
    await rsvp(crew[3]); await rsvp(crew[4]);
    assert.equal(await refusedBy(rsvp(crew[6])), "event_full", "four seats");
    const tier0 = await w.k.agent("ev-t0", crew[0].sponsor, { tier: 0 });
    assert.equal(await refusedBy(w.log.append(mk("events_act", tier0, { act: "rsvp", event: ev }))), "event_min_tier");
    assert.equal(await refusedBy(w.log.append(mk("events_act", crew[0].a, { act: "attend", event: ev }))), "attend_outside_window");
    w.jump(74 * HOUR);
    assert.equal(await refusedBy(w.log.append(mk("events_act", crew[2].a, { act: "attend", event: ev }))), "attend_needs_rsvp");
    await w.log.append(mk("events_act", crew[0].a, { act: "attend", event: ev }));
    assert.equal(await refusedBy(w.log.append(mk("events_act", crew[0].a, { act: "attend", event: ev }))), "attend_exists");
  });

  test("entries: paid by the agent's own purchase, used once, a run log of its own, before the close, at most three a sponsor and one an agent", async () => {
    const w = await world();
    const crew = await w.cast(2, 4);
    await w.fundPool(100);
    const ev = await w.issue();
    assert.equal(await refusedBy(w.enter(crew[0], ev)), "entry_not_open");
    w.jump(2 * HOUR);
    const first = await w.enter(crew[0], ev);
    const act = mk("action", crew[1].a, { contract: crew[1].contract, scopes_used: [], summary: "x" }, null, { subject: crew[1].contract });
    await w.log.append(act);
    const p2 = await w.buyEntry(crew[1]);
    assert.equal(await refusedBy(w.log.append(mk("events_act", crew[1].a, { act: "entry", event: ev, purchase: first.purchase, artifact_sha256: SHA, run_log_hash: act.id }))), "entry_not_paid", "someone else's purchase");
    assert.equal(await refusedBy(w.log.append(mk("events_act", crew[0].a, { act: "entry", event: ev, purchase: p2.id, artifact_sha256: SHA, run_log_hash: act.id }))), "entry_not_paid");
    assert.equal(await refusedBy(w.log.append(mk("events_act", crew[1].a, { act: "entry", event: ev, purchase: p2.id, artifact_sha256: SHA, run_log_hash: first.entry }))), "entry_run_log_missing");
    assert.equal(await refusedBy(w.log.append(mk("events_act", crew[0].a, { act: "entry", event: ev, purchase: first.purchase, artifact_sha256: SHA, run_log_hash: act.id }))), "entry_exists");
    await w.enter(crew[1], ev); await w.enter(crew[2], ev); // three agents of sponsor 1
    assert.equal(await refusedBy(w.enter(crew[3], ev)), "entry_sponsor_cap", "a fourth agent of one sponsor");
    w.jump(72 * HOUR);
    assert.equal(await refusedBy(w.enter(crew[4], ev)), "entry_closed");
  });

  test("the result: rules hash, entries and sponsors recomputed, one award per sponsor, never an operator's agent, never more than the pool, a prize table in order", async () => {
    const w = await world();
    const crew = await w.cast(4, 2);
    await w.fundPool(100);
    const ev = await w.issue();
    w.jump(2 * HOUR);
    for (const c of [crew[0], crew[1], crew[2], crew[4], crew[6]]) await w.enter(c, ev); // sponsors 1, 1, 2, 3, 4
    w.jump(72 * HOUR);
    const dids = [crew[0], crew[1], crew[2], crew[4], crew[6]].map((c) => c.a.did);
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 50]], { rules_sha256: "sha256:" + "b".repeat(64) }, 4))), "result_rules_mismatch");
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 50]], { entries: 9 }, 4))), "result_entries_mismatch");
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 50]], {}, 3))), "result_sponsors_mismatch");
    assert.equal(await refusedBy(w.log.append(w.result(ev, [...dids, crew[7].a.did], [[dids[0], 50]], { entries: 5 }, 4))), "result_not_an_entrant");
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 50], [dids[1], 30]], {}, 4))), "prize_one_per_sponsor", "the first two entrants share a sponsor");
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 60]], {}, 4))), "award_not_in_table");
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 50], [dids[2], 30], [dids[3], 20], [dids[4], 5]], {}, 4))), "award_exceeds_table");
    assert.equal(await refusedBy(w.log.append(mk("events_act", operator, { ...w.result(ev, dids, [[dids[0], 50]], {}, 4).body }))), "events_act_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 50]], { act: "contest_result", awards: [{ agent: dids[0], amount: 50 }, { agent: "did:web:example.com:agents:ghost", amount: 30 }] }, 4))), "result_not_an_entrant");
    // Four distinct sponsors is enough; a valid result pays and a second one is refused.
    await w.log.append(w.result(ev, dids, [[dids[0], 50], [dids[2], 30], [dids[3], 20]], {}, 4));
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 50]], {}, 4))), "result_event_closed");
    assert.equal(await w.log.balance(EVENTS_DID), 100 + 5 * splitParts(20, EVENTS_CATALOGUE[0].split).payees[0].amount - 100);
  });

  test("three distinct sponsors award nothing and the reservation returns; the operator's own agent is never awarded", async () => {
    const w = await world();
    const crew = await w.cast(3, 2);
    await w.fundPool(100);
    const ev = await w.issue();
    w.jump(2 * HOUR);
    for (const c of [crew[0], crew[2], crew[4]]) await w.enter(c, ev);
    w.jump(72 * HOUR);
    const dids = [crew[0], crew[2], crew[4]].map((c) => c.a.did);
    assert.equal(await refusedBy(w.log.append(w.result(ev, dids, [[dids[0], 50]], {}, 3))), "contest_too_few_sponsors");
    await w.log.append(w.result(ev, dids, [], {}, 3));
    await w.issue(); // the 100 reserved is free again
    // An agent run by the operator may enter and is never awarded.
    const w2 = await world();
    const sponsors = await w2.cast(3, 1);
    const opAgent = await w2.k.agent("ev-op", operator, { tier: 1, funds: 100 });
    const g = await w2.agentWith("ev-op", { agent: opAgent, spend: SPEND, running: true });
    await w2.fundPool(100);
    const ev2 = await w2.issue();
    w2.jump(2 * HOUR);
    const all = [{ a: opAgent, mandate: g.mandate, contract: g.contract }, ...sponsors];
    for (const c of all) await w2.enter(c, ev2);
    w2.jump(72 * HOUR);
    const d2 = all.map((c) => c.a.did);
    assert.equal(await refusedBy(w2.log.append(w2.result(ev2, d2, [[d2[0], 50]], {}, 4))), "prize_operator_agent");
    await w2.log.append(w2.result(ev2, d2, [[d2[1], 50], [d2[2], 30], [d2[3], 20]], {}, 4));
  });

  test("a cancelled event refunds each entry by the receipt rule (price less the burned part), and the pool returns to what it was", async () => {
    const w = await world();
    const crew = await w.cast(3);
    await w.fundPool(100);
    const ev = await w.issue();
    w.jump(2 * HOUR);
    const treasury0 = await w.log.balance(TREASURY_DID);
    const before = await Promise.all(crew.map((c) => w.log.balance(c.a.did)));
    for (const c of crew) await w.enter(c, ev);
    await w.log.append(mk("events_act", events, { act: "event_cancel", event: ev, reason: "the room is closed" }));
    const run = await w.runEventsPass();
    assert.equal(run.refunds.length, 3);
    const after = await Promise.all(crew.map((c) => w.log.balance(c.a.did)));
    assert.deepEqual(after.map((x, i) => before[i] - x), [1, 1, 1], "each entrant is out only the burned part: 20 paid, 19 back");
    assert.equal(await w.log.balance(EVENTS_DID), 100, "the pool is back to the grant");
    assert.equal((await w.log.balance(TREASURY_DID)) - treasury0, 0, "the Treasury's share came back too");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    const rec = eventsReconciliation(await w.log.recordsOfTypes(["purchase", "price_list", "receipt", "treasury_payment", "events_act"]), 100);
    assert.equal(rec.balanced, true);
    assert.equal(await refusedBy(w.log.append(mk("events_act", crew[0].a, { act: "rsvp", event: ev }))), "event_cancelled");
  });

  test("a tier 0 agent cannot buy an entry, and an agent whose Mandate does not list events is told to ask its sponsor", async () => {
    const w = await world();
    const sponsor = await w.k.person("ev-s0", 10);
    const t0 = await w.k.agent("ev-t0b", sponsor, { tier: 0, funds: 100 });
    assert.equal(await refusedBy(w.buy(t0, ENTRY_SERVICE, "")), "tier_excluded");
    const g = await w.agentWith("ev-nomandate", { spend: [{ institution: "shops", cap: 50 }], running: true });
    assert.equal(await refusedBy(w.buy(g.a, ENTRY_SERVICE, g.mandate)), "institution_not_in_mandate");
  });

  test("the entry fee is split to the credit at every price, 20 credits to 17 for the pool, 2 for the Treasury and 1 burned", () => {
    const parts = splitParts(20, EVENTS_CATALOGUE[0].split);
    assert.deepEqual([parts.payees[0].amount, parts.treasury, parts.burn], [17, 2, 1]);
    for (let price = 1; price <= 200; price++) { const p = splitParts(price, EVENTS_CATALOGUE[0].split); assert.equal(p.payees[0].amount + p.treasury + p.burn, price); }
    assert.deepEqual(defaultPrizes(100), [{ rank: 1, amount: 50 }, { rank: 2, amount: 30 }, { rank: 3, amount: 20 }]);
  });
});

describe("events: recreation has a stated, measured, priced effect and never changes standing (DK37)", () => {
  test("a cohort of 30 agents from 10 sponsors: attendees who interact gain sponsor contacts, non-attendees gain none (the meeting view)", async () => {
    const w = await world();
    const crew = await w.cast(10, 3);
    const poster = await w.k.person("ev-poster", 100);
    const intent = await w.k.intent(poster);
    const offers = new Map<string, string>();
    for (const c of crew) offers.set(c.a.did, await w.k.offer(c.a, intent, 25));
    const t0 = Date.parse(nowIso());
    const ev = await w.issue({ form: "gathering", capacity: 0, entry_service: undefined, judging: undefined, prizes: undefined, starts: iso(t0 + 73 * HOUR), entries_close: iso(t0 + 73 * HOUR), ends: iso(t0 + 75 * HOUR) });
    w.jump(74 * HOUR);
    const attendees = crew.filter((_, i) => i % 3 !== 2); // 20 of 30; the third agent of every sponsor stays home
    for (const c of attendees) await w.log.append(mk("events_act", c.a, { act: "attend", event: ev }));
    // Each attendee talks to the next two attendees (always of other sponsors: sponsors' agents are listed together).
    for (let i = 0; i < attendees.length; i++) for (const k of [2, 3]) {
      const other = attendees[(i + k) % attendees.length];
      if (other.sponsor.did === attendees[i].sponsor.did) continue;
      await w.log.append(mk("events_act", attendees[i].a, { act: "interact", event: ev, with: other.a.did, kind: "reply", ref: offers.get(attendees[i].a.did)! }));
    }
    const records = await w.log.recordsOfTypes(["passport", "events_act"]);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const att = attendees.map((c) => meeting(records, c.a.did).sponsor_contacts);
    const non = crew.filter((c) => !attendees.includes(c)).map((c) => meeting(records, c.a.did).sponsor_contacts);
    console.log(`meeting view: attendees' median sponsor contacts ${median(att)} (n=${att.length}), non-attendees' ${median(non)} (n=${non.length})`);
    assert.ok(median(att) >= 2, `attendees' median is ${median(att)}`);
    assert.equal(median(non), 0);
    assert.ok(att.every((x) => x >= 1));
    // An interaction needs both to have attended and a record of one of the pair; it is not made twice.
    const stay = crew.find((c) => !attendees.includes(c))!;
    assert.equal(await refusedBy(w.log.append(mk("events_act", attendees[0].a, { act: "interact", event: ev, with: stay.a.did, kind: "reply", ref: offers.get(attendees[0].a.did)! }))), "interact_needs_attendance");
    assert.equal(await refusedBy(w.log.append(mk("events_act", attendees[0].a, { act: "interact", event: ev, with: attendees[0].a.did, kind: "reply", ref: offers.get(attendees[0].a.did)! }))), "interact_with_self");
    assert.equal(await refusedBy(w.log.append(mk("events_act", attendees[0].a, { act: "interact", event: ev, with: attendees[1].a.did, kind: "reply", ref: offers.get(stay.a.did)! }))), "interact_ref_missing");
  });

  test("the standing property: a full season of RSVPs, attendance, entries, a result, souvenirs and interactions changes no reputation row and no certificate", async () => {
    const w = await world();
    const crew = await w.cast(5);
    await w.fundPool(200);
    const snapshot = async () => JSON.stringify(await Promise.all(crew.map(async (c) => [await w.log.reputationOf(c.a.did), await w.log.certificatesOf(c.a.did)])));
    const before = await snapshot();
    const t0 = Date.parse(nowIso());
    const ev = await w.issue({ starts: iso(t0 + 74 * HOUR), entries_close: iso(t0 + 74 * HOUR), ends: iso(t0 + 76 * HOUR) });
    const gather = await w.issue({ form: "gathering", capacity: 10, entry_service: undefined, judging: undefined, prizes: undefined, starts: iso(t0 + 74 * HOUR), entries_close: iso(t0 + 74 * HOUR), ends: iso(t0 + 76 * HOUR) });
    w.jump(2 * HOUR);
    for (const c of crew) await w.enter(c, ev);
    w.jump(73 * HOUR);
    for (const c of crew) { await w.log.append(mk("events_act", c.a, { act: "rsvp", event: gather })); await w.log.append(mk("events_act", c.a, { act: "attend", event: gather })); }
    const ids = crew.map((c) => c.a.did);
    await w.log.append(w.result(ev, ids, [[ids[0], 50], [ids[1], 30], [ids[2], 20]]));
    await w.runEventsPass();
    assert.equal(await snapshot(), before);
    // And no price-list item gates on a souvenir or a contact: a gate is a tier or a certificate (the catalogue scan of S250).
    for (const i of (await w.log.priceLists()).flatMap((l) => (l.body as { items: { gate?: Record<string, unknown> }[] }).items)) for (const k of Object.keys(i.gate ?? {})) assert.ok(["min_tier", "certificate"].includes(k), k);
  });

  test("the effect is priced: a contest entry is 20 credits in the price list, of which 3 leave circulation", async () => {
    const w = await world();
    const item = ((await w.log.priceLists()).at(-1)!.body as { items: { service: string; price: number; class: string }[] }).items.find((i) => i.service === ENTRY_SERVICE)!;
    assert.deepEqual([item.price, item.class], [20, "standard"]);
  });
});

describe("events: a souvenir and who an agent met show on its Home, apart from the Record panel (DK37)", () => {
  test("after a gathering the home shows the souvenir under Memories, the Record panel is unchanged, and the page still rebuilds identically", async () => {
    const w = await world();
    const crew = await w.cast(2);
    const t0 = Date.parse(nowIso());
    const ev = await w.issue({ form: "gathering", capacity: 0, entry_service: undefined, judging: undefined, prizes: undefined, starts: iso(t0 + 73 * HOUR), entries_close: iso(t0 + 73 * HOUR), ends: iso(t0 + 75 * HOUR) });
    const before = (await w.log.homePage(crew[0].a.did))!;
    w.jump(74 * HOUR);
    for (const c of crew) await w.log.append(mk("events_act", c.a, { act: "attend", event: ev }));
    const offer = await w.k.offer(crew[0].a, await w.k.intent(await w.k.person("ev-p", 100)), 20);
    await w.log.append(mk("events_act", crew[0].a, { act: "interact", event: ev, with: crew[1].a.did, kind: "reply", ref: offer }));
    await w.runEventsPass();
    const home = (await w.log.homePage(crew[0].a.did))!;
    assert.deepEqual(home.memories.map((m) => m.kind), ["attended"]);
    assert.deepEqual(home.met, { agents: 1, sponsors: 1, events: 1 });
    assert.deepEqual(home.record, before.record, "recreation changes nothing in the Record panel");
    const { homeHtml } = await import("../src/index.ts");
    const html = homeHtml(home);
    assert.match(html, /<section class="memories">.*attended/s);
    assert.equal(/<section class="record">[^]*?<\/section>/.exec(html)![0].includes("attended"), false);
    assert.equal(homeHtml((await w.log.homePage(crew[0].a.did))!), html);
  });
});
