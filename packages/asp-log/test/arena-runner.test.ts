/**
 * The Arena's match runner, void seasons and ring report (register row DK131; spec-delta S485; academy.md 6). Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, institutionDid, ringReport, runSeason, commitTask, type RevealedTask } from "../src/index.ts";
import { Kit, SERVICES, bankP, clinic, courts, credit, operator, owner, party, refused, registrar, treasury, type Party } from "./academy-kit.ts";

const academyP = party(institutionDid("academy"), 57);
const OPENS = "2026-11-02T00:00:00Z", CLOSES = "2026-12-01T00:00:00Z", AFTER = "2026-12-02T00:00:00Z";
const TASKS: RevealedTask[] = [
  { id: "t1", weight: 3, salt: "s1", rule: { kind: "equals", value: "42" } },
  { id: "t2", weight: 2, salt: "s2", rule: { kind: "contains", value: "refund" } },
  { id: "t3", weight: 1, salt: "s3", rule: { kind: "matches", value: "^ok-\\d+$" } },
];
const committed = TASKS.map(commitTask);

function kitWithAcademy() {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, academyP].map((p) => [p.kid, p.publicKey])));
  return new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
}
const season = async (k: Kit, over: Record<string, unknown> = {}) => { await k.priceList(); return k.put(k.mk("arena", registrar, { arena: "refactoring", season: "2026-q4", min_tier: 2, entry_service: SERVICES.arena, min_distinct_sponsors: 3, opens: OPENS, closes: CLOSES, prize_split_permille: [500, 300, 200], ...over })); };
const enter = async (k: Kit, a: Party) => { await k.fund(a, 10); const fee = await k.buy(a, SERVICES.arena, 10); return { entry: await k.put(k.mk("arena_entry", a, { arena: "refactoring", season: "2026-q4", fee_purchase: fee }, null, { subject: a.did })), fee }; };

test("the runner scores hidden rules from recorded outputs, ranks with a seeded tie-break that reproduces, and refuses a rule that was changed after the commitment", () => {
  const out = (t1: string, t2: string, t3: string) => ({ t1, t2, t3 });
  const entrants = [
    { agent: "a", sponsor: "sa", runLogHash: "h-a", outputs: out("42", "a refund was issued", "ok-7") },     // 3+2+1 = 6 of 6: 1000
    { agent: "b", sponsor: "sb", runLogHash: "h-b", outputs: out("42", "nothing", "nope") },                  // 3: 500
    { agent: "c", sponsor: "sc", runLogHash: "h-c", outputs: out("41", "refund", "ok-1") },                   // 2+1: 500
    { agent: "d", sponsor: "sd", runLogHash: "h-d", outputs: out("", "", "") },                               // 0
  ];
  const run = runSeason({ committed, revealed: TASKS, entrants, seed: "seed-1", minDistinctSponsors: 3 });
  assert.equal(run.void, false);
  assert.deepEqual(run.results.map((r) => [r.agent, r.score, r.rank]).slice(0, 1), [["a", 1000, 1]]);
  assert.deepEqual(run.results.map((r) => r.agent).slice(-1), ["d"]);
  assert.equal(new Set(run.results.slice(1, 3).map((r) => r.agent)).size, 2);
  assert.deepEqual(run.results[0].passed, ["t1", "t2", "t3"]);
  assert.deepEqual(run.results[0].opponents.sort(), ["b", "c", "d"], "opponents are entrants of other sponsors");
  assert.deepEqual(runSeason({ committed, revealed: TASKS, entrants: [...entrants].reverse(), seed: "seed-1", minDistinctSponsors: 3 }), run, "the same entries and seed give the same table in any order");
  assert.throws(() => runSeason({ committed, revealed: [{ ...TASKS[0], rule: { kind: "equals", value: "41" } }, TASKS[1], TASKS[2]], entrants, seed: "s", minDistinctSponsors: 3 }), /rule_changed/);
  assert.throws(() => runSeason({ committed, revealed: TASKS.slice(0, 2), entrants, seed: "s", minDistinctSponsors: 3 }), /rule_not_revealed/);
});

test("a season with too few sponsors or no entries is void in the runner", () => {
  const e = (agent: string, sponsor: string) => ({ agent, sponsor, runLogHash: `h-${agent}`, outputs: {} });
  assert.deepEqual(runSeason({ committed, revealed: TASKS, entrants: [e("a", "s1"), e("b", "s2"), e("c", "s3")], seed: "s", minDistinctSponsors: 3 }), { void: true, reason: "too_few_sponsors", results: [] });
  assert.deepEqual(runSeason({ committed, revealed: TASKS, entrants: [], seed: "s", minDistinctSponsors: 3 }), { void: true, reason: "no_entries", results: [] });
});

describe("on the log", () => {
  test("a season is scored by the runner and its table is accepted by the log in rank order; the runner's opponents satisfy the independence rule", async () => {
    const k = kitWithAcademy();
    const agents = await Promise.all(["a", "b", "c", "d"].map((n) => k.agent(n, undefined, 2)));
    await season(k);
    k.at("2026-11-05T00:00:00Z");
    for (const a of agents) await enter(k, a);
    const outputs = [["42", "refund", "ok-1"], ["42", "x", "x"], ["1", "refund", "x"], ["", "", ""]];
    const entrants = await Promise.all(agents.map(async (a, i) => ({ agent: a.did, sponsor: k.sponsors.get(a.did)!.did, runLogHash: await k.act(a), outputs: { t1: outputs[i][0], t2: outputs[i][1], t3: outputs[i][2] } })));
    const run = runSeason({ committed, revealed: TASKS, entrants, seed: "log-seed", minDistinctSponsors: 3 });
    assert.equal(run.void, false);
    k.at(AFTER);
    for (const r of run.results) await k.log.append(k.mk("arena_result", registrar, { arena: "refactoring", season: "2026-q4", agent: r.agent, score: r.score, rank: r.rank, field_size: r.field_size, opponents: r.opponents, run_log_hash: r.run_log_hash }, null, { subject: r.agent }));
    assert.equal((await k.log.creditAudit()).verdict, "balanced");
  });

  test("a season with too few sponsors is declared void only when it truly cannot be scored; afterwards no result is accepted, each entry fee is refunded by the Academy and not before, and the books balance", async () => {
    const k = kitWithAcademy();
    const [a, b, c] = await Promise.all(["a", "b", "c"].map((n) => k.agent(n, undefined, 2)));
    const void_ = (reason = "too_few_sponsors", season = "2026-q4") => k.mk("arena_void", registrar, { arena: "refactoring", season, reason });
    await season(k);
    k.at("2026-11-05T00:00:00Z");
    const fees = [];
    for (const x of [a, b, c]) fees.push((await enter(k, x)).fee);
    const refund = (fee: string, by: Party = academyP) => k.mk("receipt", by, { purchase: fee, status: "refunded", refund_amount: credit(10) }, fee);
    assert.equal(await refused(k.log.append(void_())), "arena_not_closed", "not before the season closes");
    assert.equal(await refused(k.log.append(refund(fees[0]))), "refund_arena_fee_not_void", "an entry fee is not refunded while the season stands");
    k.at(AFTER);
    assert.equal(await refused(k.log.append(k.mk("arena_void", a, { arena: "refactoring", season: "2026-q4", reason: "too_few_sponsors" }))), "arena_void_wrong_issuer");
    assert.equal(await refused(k.log.append(void_("no_entries"))), "arena_void_not_justified", "three agents entered");
    const before = await k.log.balance(institutionDid("academy"));
    await k.log.append(void_());
    assert.equal(await refused(k.log.append(void_())), "arena_void_exists");
    assert.equal(await refused(k.log.append(k.mk("arena_result", registrar, { arena: "refactoring", season: "2026-q4", agent: a.did, score: 1, rank: 1, field_size: 3, opponents: [b.did, c.did], run_log_hash: await k.act(a) }, null, { subject: a.did }))), "arena_season_void");
    for (const f of fees) await k.log.append(refund(f));
    assert.ok((await k.log.balance(institutionDid("academy"))) < before, "the Academy gave the fees back");
    for (const x of [a, b, c]) assert.equal(await k.log.balance(x.did), 10, "each entrant has its fee back in full");
    assert.equal((await k.log.creditAudit()).verdict, "balanced", "void, refunds and the books");
  });

  test("a season that can be scored is not void, and a season with a result cannot be declared void", async () => {
    const k = kitWithAcademy();
    const agents = await Promise.all(["a", "b", "c", "d"].map((n) => k.agent(n, undefined, 2)));
    await season(k);
    k.at("2026-11-05T00:00:00Z");
    for (const x of agents) await enter(k, x);
    k.at(AFTER);
    assert.equal(await refused(k.log.append(k.mk("arena_void", registrar, { arena: "refactoring", season: "2026-q4", reason: "too_few_sponsors" }))), "arena_void_not_justified", "four sponsors can be scored");
  });

  test("a ring of agents across sponsors shows in the report: entrants who did work for each other or for each other's sponsors are linked, with the ranks they took, flagged when they fill the top", async () => {
    const k = kitWithAcademy();
    const [x, y] = [await k.agent("x", undefined, 2), await k.agent("y", undefined, 2)];
    const honest = await Promise.all(["h1", "h2"].map((n) => k.agent(n, undefined, 2)));
    await k.acceptedJob(k.sponsors.get(y.did)!, x); // x did a job for y's sponsor, then both enter
    await season(k);
    k.at("2026-11-05T00:00:00Z");
    const field = [x, y, ...honest];
    for (const a of field) await enter(k, a);
    k.at(AFTER);
    const order = [x, y, honest[0], honest[1]];
    for (const [i, a] of order.entries()) {
      const others = field.filter((o) => o.did !== a.did);
      await k.log.append(k.mk("arena_result", registrar, { arena: "refactoring", season: "2026-q4", agent: a.did, score: 900 - i * 100, rank: i + 1, field_size: 4, opponents: others.map((o) => o.did), run_log_hash: await k.act(a) }, null, { subject: a.did }));
    }
    const report = await k.log.arenaRingReport("refactoring", "2026-q4");
    assert.equal(report.field, 4);
    assert.equal(report.linked.length, 1);
    assert.deepEqual(report.linked[0].agents, [x.did, y.did].sort());
    assert.equal(report.linked[0].sponsors.length, 2, "two sponsors that look independent");
    assert.deepEqual(report.linked[0].ranks, [1, 2]);
    assert.equal(report.topConcentration, true, "linked agents hold ranks 1 and 2");
    // No work between them, no ring; one sponsor's own agents are not a cross-sponsor ring.
    assert.deepEqual(ringReport([{ agent: "a", sponsor: "s1", rank: 1 }, { agent: "b", sponsor: "s2", rank: 2 }]).linked, []);
    assert.deepEqual(ringReport([{ agent: "a", sponsor: "s1", rank: 1 }, { agent: "b", sponsor: "s1", rank: 2 }], [["a", "b"]]).linked, []);
  });
});
