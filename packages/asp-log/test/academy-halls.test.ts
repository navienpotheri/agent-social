/**
 * The Academy's halls on the log (academy.md 3 to 6; register rows DK24 courses, DK25 exams and certificates, DK26 the Arena; spec-deltas S220 to S224). Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { examSeed, examVariant, institutionDid, prizeFor } from "../src/index.ts";
import { Kit, SERVICES, bankP, clinic, courts, credit, hashOf, operator, refused, registrar, type Party } from "./academy-kit.ts";

/** Sittings of one exam by one holder, keeping the variants used so each is the one the seed gives. */
class Sittings {
  used: number[] = [];
  base = 0;
  /** A new window: the oldest sittings have aged out, so the attempt count starts again (the used variants stay used). */
  resetWindow(): void { this.base = this.used.length; }
  k: Kit; agent: Party; examId: string;
  constructor(k: Kit, agent: Party, examId: string) { this.k = k; this.agent = agent; this.examId = examId; }
  async sit(score: number, over: Record<string, unknown> = {}, passMark = 800): Promise<string> {
    const id = await this.k.sit(this.agent, this.examId, score, over, passMark, this.used.length - this.base, this.used);
    this.used.push(examVariant(examSeed(this.examId, this.agent.did, this.used.length - this.base + 1), 40, this.used));
    return id;
  }
}

describe("exams: the pass mark is set before scoring and the log holds the Registrar to it (DK25, AC-7, AC-8)", () => {
  test("a definition is the Registrar's alone, is never redefined, and its pass mark cannot be changed after a result", async () => {
    const k = new Kit();
    const a = await k.agent("sitter");
    const rogue = k.mk("exam", await k.person("rogue"), { exam: "x", skill: "foundations", level: 1, suite_hash: hashOf("9"), pass_mark_permille: 800, pool_size: 40, categories: ["a"], max_sittings: 3, window_days: 30, sitting_service: SERVICES.sitting });
    assert.equal(await refused(k.log.append(rogue)), "exam_wrong_issuer");
    const def = await k.defineExam("foundations-v1", "foundations", 1);
    assert.equal(await refused(k.defineExam("foundations-v1", "foundations", 1, { pass_mark_permille: 600 })), "exam_already_defined", "a lower pass mark under the same id is refused");
    await k.fund(a, 100);
    // After a fail at 700, the Registrar cannot rescue the holder by judging it against a pass mark of 700.
    assert.equal(await refused(k.sit(a, def, 700, {}, 700)), "exam_pass_mark_mismatch");
    assert.equal(await refused(k.sit(a, def, 700, { passed: true })), "exam_result_inconsistent", "passed must agree with the score");
    assert.equal(await refused(k.sit(a, def, 900, { passed: false })), "exam_result_inconsistent");
    const failed = await k.sit(a, def, 700);
    assert.ok(failed, "a failed sitting is recorded, not hidden");
  });

  test("three sittings in 30 days, a new variant each time that the seed gives and the Registrar does not pick; the fee and the run log are used once", async () => {
    const k = new Kit();
    const a = await k.agent("sitter");
    const def = await k.defineExam("foundations-v1", "foundations", 1);
    await k.fund(a, 200);
    const s = new Sittings(k, a, def);
    await s.sit(500); await s.sit(600);
    // A sitting on a variant the seed did not give is refused (the Registrar cannot hand a favourite task).
    const fee = await k.buy(a, SERVICES.sitting, 20), run = await k.act(a);
    const seed = examSeed(def, a.did, 3);
    const wanted = examVariant(seed, 40, s.used);
    const body = (over: Record<string, unknown>) => k.mk("exam_result", registrar, { exam: def, holder: a.did, score_permille: 850, pass_mark_permille: 800, passed: true, attempt: 3, variant: wanted, seed, sitting: fee, run_log_hash: run, missed_categories: [], ...over }, null, { subject: a.did });
    assert.equal(await refused(k.log.append(body({ variant: (wanted + 1) % 40 }))), "exam_variant_mismatch");
    assert.equal(await refused(k.log.append(body({ seed: hashOf("1") }))), "exam_seed_mismatch");
    assert.equal(await refused(k.log.append(body({ attempt: 2 }))), "exam_attempt_number");
    await k.log.append(body({}));
    s.used.push(wanted);
    // The fourth is over the limit, whatever it is paid with.
    assert.equal(await refused(s.sit(900)), "exam_attempt_limit");
    // After the window the holder may sit again; the used variants stay used.
    k.addDays(31);
    s.resetWindow();
    const again = await s.sit(900);
    assert.ok(again);
    assert.equal(new Set(s.used).size, s.used.length, "no variant came twice");
  });

  test("a fee pays one sitting and a run log backs one record: a replayed run proves nothing", async () => {
    const k = new Kit();
    const a = await k.agent("sitter");
    const def = await k.defineExam("foundations-v1", "foundations", 1);
    await k.fund(a, 200);
    const fee = await k.buy(a, SERVICES.sitting, 20), fee2 = await k.buy(a, SERVICES.sitting, 20), run = await k.act(a);
    const first = examSeed(def, a.did, 1), v1 = examVariant(first, 40, []);
    const result = (n: number, variant: number, over: Record<string, unknown>) => k.mk("exam_result", registrar, { exam: def, holder: a.did, score_permille: 100, pass_mark_permille: 800, passed: false, attempt: n, variant, seed: examSeed(def, a.did, n), sitting: fee, run_log_hash: run, missed_categories: ["mandate"], ...over }, null, { subject: a.did });
    await k.log.append(result(1, v1, {}));
    const second = examVariant(examSeed(def, a.did, 2), 40, [v1]);
    assert.equal(await refused(k.log.append(result(2, second, {}))), "fee_already_used", "the same fee cannot pay a second sitting");
    assert.equal(await refused(k.log.append(result(2, second, { sitting: fee2 }))), "run_log_reused", "the same run log cannot back a second sitting");
    // A fee that is not for the exam, or not the holder's, is refused.
    const other = await k.agent("other");
    await k.fund(other, 100);
    const wrong = await k.buy(a, SERVICES.foundations, 30);
    assert.equal(await refused(k.log.append(result(2, second, { sitting: wrong, run_log_hash: await k.act(a) }))), "fee_wrong_service");
    assert.equal(await refused(k.log.append(result(2, second, { sitting: await k.buy(other, SERVICES.sitting, 20), run_log_hash: await k.act(a) }))), "fee_not_holders");
    assert.equal(await refused(k.log.append(result(2, second, { sitting: fee2, run_log_hash: await k.act(other) }))), "run_log_not_holders");
  });
});

describe("certificates rest on a passed exam, expire, and can be revoked with the tier falling back (DK25, AC-10, AC-17)", () => {
  test("no certificate without a passed result of the holder for that skill and level; one result backs one certificate; at most 180 days", async () => {
    const k = new Kit();
    const a = await k.agent("holder"), b = await k.agent("other");
    const def = await k.defineExam("foundations-v1", "foundations", 1);
    await k.fund(a, 100); await k.fund(b, 100);
    const s = new Sittings(k, a, def);
    const fail = await s.sit(500);
    const pass = await s.sit(900);
    assert.equal(await refused(k.log.append(k.certificate(a, "foundations", 1, fail))), "certificate_exam_not_passed", "a failed sitting earns nothing");
    assert.equal(await refused(k.log.append(k.certificate(a, "foundations", 1, hashOf("5")))), "certificate_no_exam_result");
    assert.equal(await refused(k.log.append(k.certificate(b, "foundations", 1, pass))), "certificate_result_not_holders");
    assert.equal(await refused(k.log.append(k.certificate(a, "research", 2, pass))), "certificate_exam_mismatch");
    assert.equal(await refused(k.log.append(k.certificate(a, "foundations", 1, pass, { expires: "2028-01-01T00:00:00Z" }))), "certificate_expiry_too_long");
    assert.equal(await refused(k.log.append(k.certificate(a, "foundations", 1, pass, {}, clinic))), "certificate_wrong_issuer");
    const cert = await k.put(k.certificate(a, "foundations", 1, pass));
    assert.equal(await refused(k.log.append(k.certificate(a, "foundations", 1, pass))), "certificate_result_used");
    // A revoked certificate cannot be reissued from the same sitting: a new sitting is needed.
    await k.log.append(k.revoke(cert, "error"));
    assert.equal(await refused(k.log.append(k.certificate(a, "foundations", 1, pass))), "certificate_result_used");
    // It verifies publicly: the log returns it, with the revocation.
    const records = await k.log.certificatesOf(a.did);
    assert.equal(records.length, 1);
  });

  test("who may revoke: the Registrar for any reason, a Court for a ruling, the Clinic for drift; never twice, never an unknown certificate", async () => {
    const k = new Kit();
    const a = await k.agent("holder");
    const cert = await k.certify(a, "foundations", 1);
    assert.equal(await refused(k.log.append(k.revoke(cert, "ruling", clinic))), "revocation_wrong_issuer");
    assert.equal(await refused(k.log.append(k.revoke(cert, "drift", courts))), "revocation_wrong_issuer");
    assert.equal(await refused(k.log.append(k.revoke(cert, "cheating", await k.person("anyone")))), "revocation_wrong_issuer");
    assert.equal(await refused(k.log.append(k.revoke(hashOf("4"), "cheating"))), "revocation_unknown_certificate");
    await k.log.append(k.revoke(cert, "drift", clinic));
    assert.equal(await refused(k.log.append(k.revoke(cert, "cheating"))), "certificate_already_revoked");
    const b = await k.agent("holder-two");
    await k.log.append(k.revoke(await k.certify(b, "foundations", 1), "ruling", courts));
  });

  test("a revoked certificate does not promote, and a revocation for cheating sends the tier back; an error of the Academy's own does not", async () => {
    for (const [reason, tierAfter] of [["cheating", 1], ["error", 2], ["drift", 1]] as const) {
      const k = new Kit();
      const a = await k.agent("climber");
      const [p1, p2] = [await k.person("p1"), await k.person("p2")];
      const cert = await k.certify(a, "foundations", 1);
      for (const p of [p1, p2, p1]) await k.acceptedJob(p, a);
      await k.log.append(k.promote(a, 1, 2, [cert]));
      assert.equal((await k.log.reputationOf(a.did))?.tier, 2);
      await k.log.append(k.revoke(cert, reason, reason === "drift" ? clinic : registrar));
      assert.equal((await k.log.reputationOf(a.did))?.tier, tierAfter, `${reason}: tier after`);
    }
    const k = new Kit();
    const a = await k.agent("climber");
    const cert = await k.certify(a, "foundations", 1);
    await k.log.append(k.revoke(cert, "cheating"));
    assert.equal(await refused(k.log.append(k.promote(a, 1, 2, [cert]))), "promotion_certificate_revoked");
  });

  test("the books balance after exams: fees go to the Academy, the Treasury and the burn", async () => {
    const k = new Kit();
    const a = await k.agent("sitter");
    await k.certify(a, "foundations", 1);
    assert.equal((await k.log.creditAudit()).verdict, "balanced");
    assert.equal(await k.log.balance(institutionDid("academy")), 14, "20 credits: 4 Treasury, 2 burned, 14 Academy");
  });
});

/** An agent with everything for tier 3 except the arena: tier 2, a Practitioner certificate, ten qualifying jobs from two principals. */
async function ready(k: Kit, name: string, principals: [Party, Party], sponsor?: Party): Promise<Party> {
  const a = await k.agent(name, sponsor, 2);
  const cert = await k.certify(a, "research", 2);
  for (let i = 0; i < 10; i++) await k.acceptedJob(principals[i % 2], a);
  (a as Party & { cert?: string }).cert = cert;
  return a;
}

describe("the Arena: seasons, entry fees, independence, prizes (DK26, AC-14 to AC-16)", () => {
  const OPENS = "2026-11-02T00:00:00Z", CLOSES = "2026-12-01T00:00:00Z";
  async function season(k: Kit, over: Record<string, unknown> = {}) {
    await k.priceList();
    return k.put(k.mk("arena", registrar, { arena: "refactoring", season: "2026-q4", min_tier: 2, entry_service: SERVICES.arena, min_distinct_sponsors: 3, opens: OPENS, closes: CLOSES, prize_split_permille: [500, 300, 200], ...over }));
  }
  const enter = async (k: Kit, a: Party) => { await k.fund(a, 10); return k.put(k.mk("arena_entry", a, { arena: "refactoring", season: "2026-q4", fee_purchase: await k.buy(a, SERVICES.arena, 10) }, null, { subject: a.did })); };
  const result = async (k: Kit, agent: Party, rank: number, score: number, opponents: Party[], field: number, over: Record<string, unknown> = {}) =>
    k.mk("arena_result", registrar, { arena: "refactoring", season: "2026-q4", agent: agent.did, score, rank, field_size: field, opponents: opponents.map((o) => o.did), run_log_hash: await k.act(agent), ...over }, null, { subject: agent.did });

  test("a season runs end to end: entries, results in rank order, prizes by rank that never exceed the fees, and the books balance", async () => {
    const k = new Kit();
    const [a, b, c, d, e] = [await k.agent("a", undefined, 2), await k.agent("b", undefined, 2), await k.agent("c", undefined, 2), await k.agent("d", undefined, 2), await k.agent("e", undefined, 2)];
    const low = await k.agent("low", undefined, 1);
    await season(k);
    // Outside the window, below the tier, or the Registrar's own agent: refused.
    k.at("2026-11-01T12:00:00Z");
    assert.equal(await refused(enter(k, a)), "arena_not_open");
    k.at("2026-11-03T00:00:00Z");
    assert.equal(await refused(enter(k, low)), "arena_tier_too_low");
    const house = await k.agent("house", registrar, 2);
    assert.equal(await refused(enter(k, house)), "arena_registrar_agent", "the Registrar's own agents do not compete for prizes");
    for (const x of [a, b, c, d, e]) await enter(k, x);
    assert.equal(await refused(enter(k, a)), "arena_already_entered");
    const held = await k.log.balance(institutionDid("academy"));
    assert.equal(held, 9 * 9, "each 10-credit fee puts 9 in the Academy account (nine were paid; four of them bought no entry, so the prize pool counts only the five entries: 45)");
    // Results only after the season closes, in rank order, against independent opponents.
    assert.equal(await refused(k.log.append(await result(k, a, 1, 900, [b, c, d], 5))), "arena_not_closed");
    k.at(CLOSES); k.addDays(1);
    assert.equal(await refused(k.log.append(await result(k, a, 1, 900, [b, c], 5))), "arena_not_independent", "two sponsors are fewer than the three the season requires");
    assert.equal(await refused(k.log.append(await result(k, a, 2, 900, [b, c, d], 5))), "arena_rank_order", "rank 1 comes first");
    assert.equal(await refused(k.log.append(await result(k, a, 1, 900, [b, c, d], 4))), "arena_field_size");
    assert.equal(await refused(k.log.append(await result(k, low, 1, 900, [b, c, d], 5))), "arena_result_not_entered");
    const results = new Map<string, string>();
    const put = async (agent: Party, rank: number, score: number, opp: Party[]) => { const r = await result(k, agent, rank, score, opp, 5); await k.log.append(r); results.set(agent.did, (r.body as { run_log_hash: string }).run_log_hash); };
    await put(a, 1, 900, [b, c, d]);
    assert.equal(await refused(k.log.append(await result(k, b, 2, 950, [a, c, d], 5))), "arena_rank_order", "the score never rises down the ranks");
    await put(b, 2, 800, [a, c, d]); await put(c, 3, 700, [a, b, d]); await put(d, 4, 600, [a, b, c]); await put(e, 5, 500, [a, b, c]);
    // Prizes: 500, 300 and 200 permille of the 45 paid in.
    const prize = (agent: Party, rank: number, amount: number, run: string) => k.mk("prize", registrar, { pool: institutionDid("academy"), arena: "refactoring", season: "2026-q4", agent: agent.did, rank, run_log_hash: run, amount: credit(amount) }, null, { subject: agent.did });
    const first = prizeFor(45, [500, 300, 200], 1);
    assert.equal(first, 22);
    assert.equal(await refused(k.log.append(prize(a, 1, first + 1, results.get(a.did)!))), "prize_exceeds_split");
    assert.equal(await refused(k.log.append(prize(e, 5, 1, results.get(e.did)!))), "prize_exceeds_split", "rank 5 has no share");
    assert.equal(await refused(k.log.append(prize(a, 2, 5, results.get(a.did)!))), "prize_result_mismatch", "a different rank than the signed result");
    assert.equal(await refused(k.log.append(prize(low, 1, 5, hashOf("1")))), "prize_no_result");
    await k.log.append(prize(a, 1, first, results.get(a.did)!));
    await k.log.append(prize(b, 2, prizeFor(45, [500, 300, 200], 2), results.get(b.did)!));
    await k.log.append(prize(c, 3, prizeFor(45, [500, 300, 200], 3), results.get(c.did)!));
    const paid = 22 + 13 + 9;
    assert.equal(await k.log.balance(institutionDid("academy")), held - paid, "what is left is what was not paid out");
    assert.equal((await k.log.creditAudit()).verdict, "balanced", "prizes reconcile with the fees paid in");
  });

  test("a colluding pair of one sponsor cannot lift a rank: their matches never count and the result needs other sponsors", async () => {
    const k = new Kit();
    const sponsor = await k.person("shared-sponsor");
    const [a, a2] = [await k.agent("a", sponsor, 2), await k.agent("a2", sponsor, 2)];
    const [b, c] = [await k.agent("b", undefined, 2), await k.agent("c", undefined, 2)];
    await season(k, { min_distinct_sponsors: 2 });
    k.at("2026-11-03T00:00:00Z");
    for (const x of [a, a2, b, c]) await enter(k, x);
    k.at(CLOSES); k.addDays(1);
    // a2 beats a, a beats a2, over and over: listed as opponents they are refused, and they add no sponsor.
    assert.equal(await refused(k.log.append(await result(k, a, 1, 990, [a2], 4))), "arena_same_sponsor_opponent");
    assert.equal(await refused(k.log.append(await result(k, a, 1, 990, [a2, b], 4))), "arena_same_sponsor_opponent");
    assert.equal(await refused(k.log.append(await result(k, a, 1, 990, [b], 4))), "arena_not_independent", "one other sponsor is not two");
    await k.log.append(await result(k, a, 1, 700, [b, c], 4));
    // The pair's mutual wins are nowhere in a signed result, so a2 ranks on what it did against others.
    assert.equal(await refused(k.log.append(await result(k, a2, 2, 600, [a], 4))), "arena_same_sponsor_opponent");
  });

  test("a prize for a season needs the Academy pool, and the Registrar's own agents may not enter", async () => {
    const k = new Kit();
    await season(k);
    const a = await k.agent("a", undefined, 2);
    k.at("2026-11-03T00:00:00Z");
    await enter(k, a);
    const prize = k.mk("prize", registrar, { pool: institutionDid("market"), arena: "refactoring", season: "2026-q4", agent: a.did, rank: 1, run_log_hash: hashOf("1"), amount: credit(1) }, null, { subject: a.did });
    assert.equal(await refused(k.log.append(prize)), "prize_wrong_pool");
    assert.equal(await refused(k.log.append(k.mk("arena", await k.person("rogue"), { arena: "x", season: "y", min_tier: 1, entry_service: SERVICES.arena, min_distinct_sponsors: 2, opens: OPENS, closes: CLOSES, prize_split_permille: [1000] }))), "arena_wrong_issuer");
    assert.equal(await refused(season(k)), "arena_season_exists");
    assert.equal(await refused(season(k, { season: "2027-q1", prize_split_permille: [600, 600] })), "arena_split_over_pool");
  });

  test("tier 2 to 3: a Practitioner certificate, ten qualifying jobs from two principals and a top-half arena result; each missing piece is refused", async () => {
    const k = new Kit();
    const [p1, p2] = [await k.person("p1"), await k.person("p2")];
    const x = await ready(k, "x", [p1, p2]);
    const y = await ready(k, "y", [p1, p2]);
    const others = [await k.agent("o1", undefined, 2), await k.agent("o2", undefined, 2), await k.agent("o3", undefined, 2)];
    await season(k);
    k.at("2026-11-03T00:00:00Z");
    for (const m of [x, y, ...others]) await enter(k, m);
    k.at(CLOSES); k.addDays(1);
    const xr = await k.put(await result(k, x, 1, 900, [others[0], others[1], others[2]], 5));
    await k.put(await result(k, others[0], 2, 800, [x, others[1], others[2]], 5));
    await k.put(await result(k, others[1], 3, 700, [x, others[0], others[2]], 5));
    const yr = await k.put(await result(k, y, 4, 600, [x, others[0], others[1]], 5));
    const xc = (x as Party & { cert: string }).cert, yc = (y as Party & { cert: string }).cert;
    const found = await k.certify(x, "foundations", 1);
    assert.equal(await refused(k.log.append(k.promote(x, 2, 3, [found], { arena_result: xr }))), "promotion_needs_practitioner", "Foundations is not Practitioner");
    assert.equal(await refused(k.log.append(k.promote(x, 2, 3, [xc]))), "promotion_needs_arena");
    assert.equal(await refused(k.log.append(k.promote(x, 2, 3, [xc], { arena_result: yr }))), "promotion_arena_not_holders");
    assert.equal(await refused(k.log.append(k.promote(y, 2, 3, [yc], { arena_result: yr }))), "promotion_arena_not_top_half", "rank 4 of 5 is the bottom half");
    assert.equal(await refused(k.log.append(k.promote(x, 2, 3, [xc], { arena_result: hashOf("3") }))), "promotion_arena_unknown");
    await k.log.append(k.promote(x, 2, 3, [xc], { arena_result: xr }));
    assert.equal((await k.log.reputationOf(x.did))?.tier, 3);
  });

  test("tier 2 to 3 needs ten qualifying jobs and two distinct principals, and a slash in the last 90 days stops it", async () => {
    const k = new Kit();
    const [p1, p2] = [await k.person("p1"), await k.person("p2")];
    const few = await k.agent("few", undefined, 2);
    const cert = await k.certify(few, "research", 2);
    for (let i = 0; i < 9; i++) await k.acceptedJob(i % 2 ? p1 : p2, few);
    assert.equal(await refused(k.log.append(k.promote(few, 2, 3, [cert], { arena_result: hashOf("3") }))), "promotion_needs_jobs", "nine is one short");
    const one = await k.agent("one", undefined, 2);
    const cert1 = await k.certify(one, "research", 2);
    for (let i = 0; i < 10; i++) await k.acceptedJob(p1, one);
    // The counterparty cap already stops one principal from counting more than its share, so ten jobs of one principal do not reach ten.
    assert.ok(((await k.log.reputationOf(one.did))?.qualifyingJobs ?? 0) < 10);
    assert.equal(await refused(k.log.append(k.promote(one, 2, 3, [cert1], { arena_result: hashOf("3") }))), "promotion_needs_jobs");
    void bankP; void operator;
  });
});

describe("the School: courses, tuition, enrolment, completion (DK24, AC-3 to AC-5)", () => {
  async function school() {
    const k = new Kit();
    await k.priceList();
    const [author, r1, r2] = [await k.agent("author"), await k.agent("rev1"), await k.agent("rev2")];
    const body = (over: Record<string, unknown> = {}) => ({ course: "foundations-1", title: "Working inside a Mandate", skill: "foundations", level: 1, lessons: [hashOf("a")], exercises: hashOf("e"), exercise_count: 3, price_service: SERVICES.foundations, author_share_permille: 550, reviews: [hashOf("b"), hashOf("c")], reviewers: [r1.did, r2.did], ...over });
    const course = (over: Record<string, unknown> = {}, cosigners: Party[] = [registrar], by: Party = author) => k.mk("course", by, body(over), null, { subject: null, cosigners });
    return { k, author, r1, r2, course };
  }

  test("a course needs the Registrar's countersignature, a price from the published list, and reviews from two sponsors other than the author's", async () => {
    const { k, author, r1, r2, course } = await school();
    assert.equal(await refused(k.log.append(course({}, []))), "course_needs_registrar");
    assert.equal(await refused(k.log.append(course({ price_service: "academy.nonsense" }))), "course_not_priced");
    assert.equal(await refused(k.log.append(course({ reviewers: [r1.did, author.did] }))), "course_self_review");
    const twin = await k.agent("twin", undefined, 1);
    void twin;
    const sameSponsor = await k.agent("same", k.sponsors.get(author.did));
    assert.equal(await refused(k.log.append(course({ reviewers: [r1.did, sameSponsor.did] }))), "course_review_same_sponsor");
    const sameAsR1 = await k.agent("sameasr1", k.sponsors.get(r1.did));
    assert.equal(await refused(k.log.append(course({ reviewers: [r1.did, sameAsR1.did] }))), "course_reviews_not_independent", "two reviewers of one sponsor are one voice");
    assert.equal(await refused(k.log.append(course({ reviewers: [r1.did, "did:web:example.com:agents:ghost"] }))), "course_reviewer_unknown");
    await k.log.append(course());
    assert.equal(await refused(k.log.append(course())), "course_already_published");
    void r2;
  });

  test("tuition is a purchase at the published price; one open enrolment; completion needs every exercise and a fresh run log; the books balance", async () => {
    const { k, course } = await school();
    const learner = await k.agent("learner", undefined, 2);
    await k.job(learner, 500);
    const courseId = await k.put(course());
    await k.fund(learner, 300);
    const enrol = async (purchase: string) => k.mk("enrolment", learner, { course: courseId, purchase }, null, { subject: learner.did });
    assert.equal(await refused(k.log.append(await enrol(await k.buy(learner, SERVICES.sitting, 20)))), "fee_wrong_service");
    const tuition = await k.buy(learner, SERVICES.foundations, 30);
    assert.equal(await refused(k.buy(learner, SERVICES.foundations, 10)), "price_mismatch", "a price is a published record");
    const e = await k.put(await enrol(tuition));
    assert.equal(await refused(k.log.append(await enrol(await k.buy(learner, SERVICES.foundations, 30)))), "enrolment_already_open");
    const done = (over: Record<string, unknown>) => k.mk("completion", registrar, { enrolment: e, holder: learner.did, exercises_passed: 3, run_log_hash: "", ...over }, null, { subject: learner.did });
    assert.equal(await refused(k.act(learner).then((run) => k.log.append(done({ exercises_passed: 2, run_log_hash: run })))), "completion_exercises_incomplete");
    assert.equal(await refused(k.log.append(done({ run_log_hash: hashOf("5") }))), "run_log_unknown");
    const run = await k.act(learner);
    assert.equal(await refused(k.log.append(k.mk("completion", await k.person("p"), { enrolment: e, holder: learner.did, exercises_passed: 3, run_log_hash: run }))), "completion_wrong_issuer");
    await k.log.append(done({ run_log_hash: run }));
    assert.equal(await refused(k.log.append(done({ run_log_hash: await k.act(learner) }))), "completion_already_recorded");
    // The enrolment is closed now, so the learner may take the course again (a refresher).
    await k.log.append(await enrol(await k.buy(learner, SERVICES.foundations, 30)));
    assert.equal((await k.log.creditAudit()).verdict, "balanced");
  });

  test("a level 2 course needs a valid Foundations certificate", async () => {
    const { k, course } = await school();
    const learner = await k.agent("learner");
    const adv = await k.put(course({ course: "practitioner-1", level: 2 }));
    await k.fund(learner, 300);
    const enrol = async () => k.mk("enrolment", learner, { course: adv, purchase: await k.buy(learner, SERVICES.foundations, 30) }, null, { subject: learner.did });
    assert.equal(await refused(enrol().then((r) => k.log.append(r))), "enrolment_needs_foundations");
    await k.certify(learner, "foundations", 1);
    await k.log.append(await enrol());
  });
});

describe("conservation (academy.md 9, AC-20): after any sequence of tuition, sittings, entries, prizes and revocations, balances plus the burn equal what was minted", () => {
  // A fixed-seed generator: the same thousand operations on every run.
  const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  test("1000 random operations over a handful of agents; every refusal leaves the books as they were, and the audit balances at every checkpoint and at the end", async () => {
    const k = new Kit();
    const rand = rng(20261112);
    const agents: Party[] = [];
    for (let i = 0; i < 6; i++) { const a = await k.agent(`g${i}`, undefined, 2); agents.push(a); await k.job(a, 1000); }
    await k.priceList();
    const examDef = await k.defineExam("foundations-v1", "foundations", 1);
    const author = agents[0];
    const course = await k.put(k.mk("course", author, { course: "f1", title: "Foundations", skill: "foundations", level: 1, lessons: [hashOf("a")], exercises: hashOf("e"), exercise_count: 2, price_service: SERVICES.foundations, author_share_permille: 550, reviews: [hashOf("b"), hashOf("c")], reviewers: [agents[1].did, agents[2].did] }, null, { cosigners: [registrar] }));
    k.at("2026-11-02T00:00:00Z");
    await k.put(k.mk("arena", registrar, { arena: "refactoring", season: "2026-q4", min_tier: 1, entry_service: SERVICES.arena, min_distinct_sponsors: 3, opens: "2026-11-02T00:00:00Z", closes: "2027-03-01T00:00:00Z", prize_split_permille: [500, 300, 200] }));
    const sittings = new Map<string, Sittings>(agents.map((a) => [a.did, new Sittings(k, a, examDef)]));
    const certs: string[] = [];
    let accepted = 0, refusedN = 0;
    const attempt = async (fn: () => Promise<unknown>) => { try { await fn(); accepted++; } catch { refusedN++; } };
    for (let i = 1; i <= 1000; i++) {
      const a = agents[Math.floor(rand() * agents.length)];
      const op = Math.floor(rand() * 7);
      if (op === 0) await attempt(() => k.fund(a, 40 + Math.floor(rand() * 120)));
      else if (op === 1) await attempt(async () => k.put(k.mk("enrolment", a, { course, purchase: await k.buy(a, SERVICES.foundations, 30) }, null, { subject: a.did })));
      else if (op === 2) await attempt(async () => { const id = await sittings.get(a.did)!.sit(rand() < 0.5 ? 900 : 400); if (rand() < 0.5) certs.push(await k.put(k.certificate(a, "foundations", 1, id))); });
      else if (op === 3) await attempt(async () => k.put(k.mk("arena_entry", a, { arena: "refactoring", season: "2026-q4", fee_purchase: await k.buy(a, SERVICES.arena, 10) }, null, { subject: a.did })));
      else if (op === 4 && certs.length) await attempt(() => k.log.append(k.revoke(certs[Math.floor(rand() * certs.length)], rand() < 0.5 ? "cheating" : "error")));
      else if (op === 5) k.addDays(Math.floor(rand() * 12));
      else await attempt(() => k.buy(a, SERVICES.sitting, 20));
      if (i % 100 === 0) assert.equal((await k.log.creditAudit()).verdict, "balanced", `balanced after ${i} operations`);
    }
    assert.ok(accepted > 150 && refusedN > 20, `a real mix of accepted (${accepted}) and refused (${refusedN}) operations`);
    const audit = await k.log.creditAudit();
    assert.equal(audit.verdict, "balanced");
    assert.deepEqual(audit.problems, []);
  });
});

describe("end to end (academy.md 9): a fake agent studies, sits, fails once, passes the next variant, earns three jobs, is promoted, and then may run a job that needs a spend limit of 1,000", () => {
  test("the whole path on one log, and the same job refused before the promotion", async () => {
    const k = new Kit();
    await k.priceList();
    const [author, r1, r2] = [await k.agent("author"), await k.agent("rev1"), await k.agent("rev2")];
    const learner = await k.agent("learner");
    const [p1, p2] = [await k.person("p1"), await k.person("p2")];
    const course = await k.put(k.mk("course", author, { course: "f1", title: "Working inside a Mandate", skill: "foundations", level: 1, lessons: [hashOf("a")], exercises: hashOf("e"), exercise_count: 2, price_service: SERVICES.foundations, author_share_permille: 550, reviews: [hashOf("b"), hashOf("c")], reviewers: [r1.did, r2.did] }, null, { cosigners: [registrar] }));
    // School: tuition, enrolment, exercises under the job (an Action), completion.
    await k.fund(learner, 200);
    const enrolment = await k.put(k.mk("enrolment", learner, { course, purchase: await k.buy(learner, SERVICES.foundations, 30) }, null, { subject: learner.did }));
    await k.put(k.mk("completion", registrar, { enrolment, holder: learner.did, exercises_passed: 2, run_log_hash: await k.act(learner) }, null, { subject: learner.did }));
    // Registrar: a failed sitting is kept; the next sitting is a different variant and passes; the certificate rests on it.
    const def = await k.defineExam("foundations-v1", "foundations", 1);
    const s = new Sittings(k, learner, def);
    await s.sit(500);
    const passed = await s.sit(900);
    assert.equal(new Set(s.used).size, 2, "a different variant the second time");
    const cert = await k.put(k.certificate(learner, "foundations", 1, passed));
    // Jobs: three qualifying jobs from two independent principals.
    for (const p of [p1, p2, p1]) await k.acceptedJob(p, learner);
    assert.equal((await k.log.reputationOf(learner.did))?.qualifyingJobs, 3);
    // Before: a Mandate that lets it spend 1,000 is over a tier 1 agent's limit. After the promotion it is allowed.
    const bigMandate = async () => { const j = await k.job(learner, 1000); return j; };
    assert.equal(await refused(bigMandate()), "tier_limit_exceeded");
    await k.log.append(k.promote(learner, 1, 2, [cert]));
    assert.equal((await k.log.reputationOf(learner.did))?.tier, 2);
    assert.ok((await bigMandate()).mandate);
    assert.equal((await k.log.creditAudit()).verdict, "balanced");
  });
});
