/**
 * The Market (docs/institutions/market.md; register rows DK16 job board, DK17 discovery and assignment, DK18 job classes; spec-delta S230).
 * Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { CLASS_MIN_PRICE, CLASS_WEIGHT, effectiveClass, impliedClass, rankAgents, discoverAgents, FAIRNESS_CAP_JOBS, eligibility, countsFor, type AgentFacts } from "../src/market.ts";
import { DAY, credit, jump, kit, market, mk, operator, refusedBy, registrar, tick } from "./society-kit.ts";
import { alice } from "./harness.ts";

const expires = () => new Date(Date.now() + 30 * DAY).toISOString().replace(".000Z", "Z");

async function world() {
  const k = await kit();
  await k.withPrices();
  const poster = await k.person("poster", 2000);
  const post = async (intentId: string, by = poster, over: Record<string, unknown> = {}) => {
    const deposit = await k.buy(by, "market.posting.deposit", 2);
    return mk("market_act", by, { act: "posting", intent: intentId, board: "main", expires: new Date(Date.parse("2026-11-01T00:00:00Z") + 60 * DAY).toISOString().replace(".000Z", "Z"), deposit, ...over });
  };
  return { ...k, poster, post };
}

describe("job classes (DK18, MK-1, MK-5)", () => {
  test("the class and the budget must fit: routine 20, skilled 60, critical 200, at the boundary and one under", async () => {
    const w = await world();
    for (const [cls, min] of [["routine", 20], ["skilled", 60], ["critical", 200]] as const) {
      assert.equal(await refusedBy(w.log.append(mk("intent", w.poster, { purpose: "p", acceptance_criteria: ["x"], budget: credit(min - 1), deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" }, class: cls }, null, { subject: w.poster.did }))), "class_price_mismatch", `${cls} at ${min - 1}`);
      await w.intent(w.poster, { class: cls, budget: credit(min) });
    }
    await w.intent(w.poster, { class: "trivial", budget: credit(1) });
    await w.intent(w.poster, { budget: credit(1) }); // no class: the rule before classes
    assert.deepEqual(CLASS_MIN_PRICE, { trivial: 0, routine: 20, skilled: 60, critical: 200 });
  });

  test("the pure rules: a price caps the class a job counts under, and no class reads as routine", () => {
    assert.deepEqual([0, 19, 20, 59, 60, 199, 200].map(impliedClass), ["trivial", "trivial", "routine", "routine", "skilled", "skilled", "critical"]);
    assert.equal(effectiveClass(undefined, 50), "routine");
    assert.equal(effectiveClass(undefined, 5), "trivial");
    assert.equal(effectiveClass("critical", 5), "trivial", "a declared class is capped by the price");
    assert.equal(effectiveClass("skilled", 500), "skilled", "a price does not raise a declared class");
  });

  test("harder jobs move standing more, and a stream of trivial jobs does not (DK18, farming test MK-11)", async () => {
    const w = await world();
    const sponsor = await w.person("sponsor");
    const worker = await w.agent("worker", sponsor);
    const principals = await Promise.all(Array.from({ length: 12 }, (_, i) => w.person(`client-${i}`, 5000)));
    await w.mint(worker.did, 10);
    const quality = async () => (await w.log.reputationOf(worker.did))?.qualifyingJobs ?? 0;
    // 30 trivial jobs, each from a different principal and well within the cap, change nothing.
    for (let i = 0; i < 30; i++) {
      const c = principals[i % principals.length];
      const intent = await w.intent(c, { class: "trivial", budget: credit(1) });
      await w.runJob(c, worker, 1, { intent, offer: await w.offer(worker, intent, 1) });
    }
    assert.equal(await quality(), 0, "thirty trivial jobs add nothing to standing");
    assert.equal((await w.log.reputationOf(worker.did))?.acceptedJobs, 30, "they settled and were accepted all the same");
    // A job declared critical but settled for 5 credits counts as what its price supports: trivial.
    const sneaky = await w.intent(principals[0], { class: "critical", budget: credit(200) });
    await w.runJob(principals[0], worker, 5, { intent: sneaky, offer: await w.offer(worker, sneaky, 5) });
    assert.equal(await quality(), 0, "a class the price does not support is not counted");
    // One job of each class, from a different principal each, moves standing by its weight.
    let expected = 0;
    for (const [i, cls] of (["routine", "skilled", "critical"] as const).entries()) {
      const c = principals[3 + i];
      const intent = await w.intent(c, { class: cls, budget: credit(CLASS_MIN_PRICE[cls]) });
      await w.runJob(c, worker, CLASS_MIN_PRICE[cls], { intent, offer: await w.offer(worker, intent, CLASS_MIN_PRICE[cls]) });
      expected += CLASS_WEIGHT[cls];
      assert.equal(await quality(), expected, `after the ${cls} job`);
    }
    assert.equal(expected, 6, "1 + 2 + 3");
  });

  test("a job with no class settles as it did before classes: one point at a price of 20 or more", async () => {
    const w = await world();
    const worker = await w.agent("legacy", await w.person("sp"));
    const c = await w.person("legacy-client", 500);
    await w.runJob(c, worker, 30);
    assert.equal((await w.log.reputationOf(worker.did))?.qualifyingJobs, 1);
  });

  test("the Market's class check raises a class and never lowers it, and only the Market signs it", async () => {
    const w = await world();
    const intent = await w.intent(w.poster, { class: "routine", budget: credit(250) });
    const check = (by: any, cls: string, verdict: string) => mk("market_act", by, { act: "class_check", intent, class: cls, verdict, reason: "the acceptance criteria need code review" });
    assert.equal(await refusedBy(w.log.append(check(w.poster, "skilled", "changed_to"))), "class_check_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(check(market, "trivial", "changed_to"))), "class_check_lowers");
    assert.equal(await refusedBy(w.log.append(check(market, "routine", "changed_to"))), "class_check_lowers", "no change is not a raise");
    assert.equal(await refusedBy(w.log.append(check(market, "skilled", "confirmed"))), "class_check_mismatch");
    await w.log.append(check(market, "routine", "confirmed"));
    await w.log.append(check(market, "skilled", "changed_to"));
    assert.equal(await refusedBy(w.log.append(check(market, "routine", "changed_to"))), "class_check_lowers", "once raised it stays raised");
    // The raised class is what the job counts under (the price supports it: the contract is for 250).
    const worker = await w.agent("raised", await w.person("sp2"));
    await w.runJob(w.poster, worker, 250, { intent, offer: await w.offer(worker, intent, 250) });
    assert.equal((await w.log.reputationOf(worker.did))?.qualifyingJobs, 2, "skilled counts 2");
  });
});

describe("the job board (DK16, MK-2, MK-3)", () => {
  test("a posting needs the intent to be the poster's, public, unposted, and a deposit paid for it, used once", async () => {
    const w = await world();
    const other = await w.person("other", 50);
    const intent = await w.intent(w.poster);
    const priv = await w.intent(w.poster, { listed: "private" });
    assert.equal(await refusedBy(w.log.append(await w.post(intent, other))), "posting_not_posters");
    assert.equal(await refusedBy(w.log.append(await w.post(priv))), "posting_private");
    const bare = mk("market_act", w.poster, { act: "posting", intent, board: "main", expires: "2027-01-01T00:00:00Z", deposit: "sha256:" + "9".repeat(64) });
    assert.equal(await refusedBy(w.log.append(bare)), "posting_deposit_unknown");
    const wrongDeposit = await w.buy(w.poster, "registry.name.claim", 10);
    assert.equal(await refusedBy(w.log.append(mk("market_act", w.poster, { act: "posting", intent, board: "main", expires: "2027-01-01T00:00:00Z", deposit: wrongDeposit }))), "posting_deposit_wrong_item");
    assert.equal(await refusedBy(w.log.append(await w.post(intent, w.poster, { expires: "2026-01-01T00:00:00Z" }))), "posting_expired");
    const before = await w.log.balance(w.poster.did);
    const posting = await w.post(intent);
    await w.log.append(posting);
    assert.equal(before - (await w.log.balance(w.poster.did)), 2, "the deposit of 2 was paid once, when it was bought");
    assert.equal(await refusedBy(w.log.append(await w.post(intent))), "posting_exists");
    const again = mk("market_act", w.poster, { act: "posting", intent: await w.intent(w.poster), board: "main", expires: "2027-01-01T00:00:00Z", deposit: (posting.body as { deposit: string }).deposit });
    assert.equal(await refusedBy(w.log.append(again)), "posting_deposit_used");
    assert.equal((await w.log.marketBoard()).length, 1);
  });

  test("at most 5 open postings for a poster at tier 1 or below; a withdrawal frees a place", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) { const p = await w.post(await w.intent(w.poster)); await w.log.append(p); ids.push(p.id); }
    assert.equal(await refusedBy(w.log.append(await w.post(await w.intent(w.poster)))), "posting_cap");
    assert.equal(await refusedBy(w.log.append(mk("market_act", (await w.person("x")), { act: "withdraw", posting: ids[0] }))), "withdraw_not_posters");
    await w.log.append(mk("market_act", w.poster, { act: "withdraw", posting: ids[0] }));
    await w.log.append(await w.post(await w.intent(w.poster)));
    assert.equal((await w.log.marketBoard()).length, 5);
    assert.equal(await refusedBy(w.log.append(mk("market_act", w.poster, { act: "withdraw", posting: ids[0] }))), "posting_closed");
  });

  test("end to end: a poster publishes a job, two agents of different tiers see different eligible lists, an offer is accepted and the contract runs through settlement", async () => {
    const w = await world();
    const sponsorA = await w.person("sponsor-a"); const sponsorB = await w.person("sponsor-b");
    const junior = await w.agent("junior", sponsorA, { tier: 1, skills: ["review"], funds: 100 });
    const senior = await w.agent("senior", sponsorB, { tier: 2, skills: ["review", "code"], funds: 100 });
    await w.cert(senior.did, "code", 2);
    const easy = await w.intent(w.poster, { class: "routine", budget: credit(40), skills: ["review"] });
    const hard = await w.intent(w.poster, { class: "skilled", budget: credit(120), skills: ["code"], min_tier: 2, requires_certificate: "code" });
    const p1 = await w.post(easy); const p2 = await w.post(hard);
    await w.log.append(p1); await w.log.append(p2);

    const seen = async (did: string) => (await w.log.marketBoard(did)).map((e) => ({ intent: e.intent, eligible: e.forAgent!.eligible, missing: e.forAgent!.missing.map((m) => m.rule) }));
    assert.deepEqual(await seen(junior.did), [{ intent: easy, eligible: true, missing: [] }, { intent: hard, eligible: false, missing: ["tier_too_low", "certificate_missing"] }]);
    assert.deepEqual(await seen(senior.did), [{ intent: easy, eligible: true, missing: [] }, { intent: hard, eligible: true, missing: [] }]);
    const eligibleOf = async (did: string) => (await w.log.marketBoard(did)).filter((e) => e.forAgent!.eligible).length;
    assert.notEqual(await eligibleOf(junior.did), await eligibleOf(senior.did), "two agents of different tiers see different eligible lists");

    // A bid on a job the agent is not eligible for is refused with the way forward.
    const juniorOffer = await w.offer(junior, hard, 120);
    assert.equal(await refusedBy(w.log.append(mk("market_act", junior, { act: "bid", posting: p2.id, offer: juniorOffer }))), "tier_too_low");
    // The senior bids; the Market assigns by the published rule, with the ranked list; the poster's contract follows.
    const offer = await w.offer(senior, hard, 120);
    await w.log.append(mk("market_act", senior, { act: "bid", posting: p2.id, offer }));
    const ranked = await w.log.discoverAgents({ skill: "code" }, "seed-1");
    assert.equal(ranked[0].agent, senior.did);
    const assignment = (agent: string, rank: unknown, rule = "best_match", seed = "seed-1") => mk("market_act", market, { act: "assignment", posting: p2.id, intent: hard, agent, rule, ranked: rank, seed });
    const forged = [{ agent: senior.did, score: ranked[0].score + 1, reasons: ranked[0].reasons }];
    assert.equal(await refusedBy(w.log.append(assignment(senior.did, forged))), "ranking_not_reproducible", "a made-up score is refused: the list reproduces from the log");
    await w.log.append(assignment(senior.did, ranked));

    // Offer accepted: the posting ends in a contract that runs to settlement, and the deposit is returned only now.
    const before = await w.log.balance(w.poster.did);
    const deposit = (p2.body as { deposit: string }).deposit;
    const early = mk("receipt", market, { purchase: deposit, status: "refunded", refund_amount: credit(2) }, deposit);
    assert.equal(await refusedBy(w.log.append(early)), "refund_deposit_not_earned", "the deposit is not returned before the posting is filled");
    const job = await w.runJob(w.poster, senior, 120, { intent: hard, offer });
    assert.equal(await w.log.balance(senior.did), 100 + 120);
    assert.equal((await w.log.reputationOf(senior.did))?.qualifyingJobs, 2, "a skilled job counts 2");
    await w.log.append(mk("receipt", market, { purchase: deposit, status: "refunded", refund_amount: credit(2) }, deposit));
    assert.equal(await w.log.balance(w.poster.did) - before, 2 - 120 - Math.floor((120 * 20) / 1000), "the deposit came back after the contract (the job itself cost 120 and its tax)");
    assert.equal((await w.log.marketBoard()).find((e) => e.posting === p2.id), undefined, "a filled posting leaves the board");
    assert.ok(job.contract);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true, "a replica replays the whole market history");
  });

  test("the board tells an agent in advance whether a job would count for its standing, and why not", async () => {
    const w = await world();
    const sponsor = await w.person("same-sponsor");
    const own = await w.agent("own", sponsor, { funds: 10 });
    const posterOfSameSponsor = sponsor;
    await w.mint(sponsor.did, 100);
    const intent = await w.intent(posterOfSameSponsor, { class: "skilled", budget: credit(80) });
    await w.log.append(await w.post(intent, posterOfSameSponsor));
    const entry = (await w.log.marketBoard(own.did))[0];
    assert.equal(entry.forAgent!.counts.counts, false, "the poster is the agent's own sponsor");
    assert.match(entry.forAgent!.counts.reason, /independence/);
    const stranger = await w.agent("stranger", await w.person("other-sponsor"), { funds: 10 });
    assert.deepEqual((await w.log.marketBoard(stranger.did))[0].forAgent!.counts, { counts: true, weight: 2, reason: "counts as skilled: weight 2 (the counterparty cap may still apply)" });
  });
});

describe("discovery, ranking and assignment (DK17, MK-6, MK-7)", () => {
  const facts = (did: string, o: Partial<AgentFacts> = {}): AgentFacts => ({ did, tier: 1, slashCount: 0, strikes: 0, qualifyingJobs: 0, acceptedJobs: 0, skills: [], certificates: [], balance: 100, floorPermille: 0, sponsor: did, fleet: null, boardJobs: [], ...o });
  const AT = "2026-11-10T00:00:00Z";

  test("the same input gives the same ranking, every rank has its reasons, and the order follows the published rule", () => {
    const agents = [
      facts("did:web:x:a", { skills: ["code"], qualifyingJobs: 4 }),
      facts("did:web:x:b", { skills: ["code", "review"], certificates: ["code"], qualifyingJobs: 1 }),
      facts("did:web:x:c", { skills: ["code"], qualifyingJobs: 4, strikes: 3 }),
      facts("did:web:x:d", { skills: [] }),
    ];
    const first = discoverAgents({ skill: "code" }, agents, "seed", AT);
    const again = discoverAgents({ skill: "code" }, [...agents].reverse(), "seed", AT);
    assert.deepEqual(first, again, "the same agents in another order give the same list");
    assert.deepEqual(first.map((r) => r.agent), ["did:web:x:b", "did:web:x:a", "did:web:x:c"], "certificate first, then qualifying jobs, then fewer strikes; the agent without the skill is not listed");
    for (const r of first) assert.ok(r.reasons.length >= 4 && r.reasons.every((x) => x.length > 0), "each rank carries its reasons");
    assert.match(first[0].reasons.join(" "), /certificate/);
  });

  test("a tie is broken by the seed, and a different seed may break it the other way; the filters hold", () => {
    const a = facts("did:web:x:a", { skills: ["code"] }), b = facts("did:web:x:b", { skills: ["code"] });
    const orders = new Set(["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => rankAgents({ skills: ["code"] }, [a, b], s, AT).map((r) => r.agent[r.agent.length - 1]).join("")));
    assert.ok(orders.has("ab") && orders.has("ba"), "the seed decides a tie");
    assert.deepEqual(discoverAgents({ skill: "code", minTier: 2 }, [a, facts("did:web:x:t2", { tier: 2, skills: ["code"] })], "s", AT).map((r) => r.agent), ["did:web:x:t2"]);
    assert.deepEqual(discoverAgents({ minQualifying: 1 }, [a, facts("did:web:x:q", { qualifyingJobs: 1 })], "s", AT).map((r) => r.agent), ["did:web:x:q"]);
    assert.equal(discoverAgents({}, [facts("did:web:x:zero", { tier: 0 })], "s", AT).length, 0, "a tier 0 agent is not offered");
  });

  test("the fairness cap: an agent that took more than 3 board jobs in 7 days goes after every other, and the cap lapses after the week", () => {
    const day = (n: number) => new Date(Date.parse(AT) - n * DAY).toISOString();
    const busy = facts("did:web:x:busy", { skills: ["code"], certificates: ["code"], qualifyingJobs: 50, boardJobs: [day(1), day(2), day(3), day(4)] });
    const idle = facts("did:web:x:idle", { skills: ["code"] });
    assert.equal(FAIRNESS_CAP_JOBS, 3);
    const ranked = rankAgents({ skills: ["code"] }, [busy, idle], "s", AT);
    assert.deepEqual(ranked.map((r) => r.agent), [idle.did, busy.did]);
    assert.match(ranked[1].reasons.join(" "), /fairness cap: 4 board jobs/);
    const atCap = rankAgents({ skills: ["code"] }, [{ ...busy, boardJobs: [day(1), day(2), day(3)] }, idle], "s", AT);
    assert.equal(atCap[0].agent, busy.did, "three jobs is at the cap, not over it");
    const later = rankAgents({ skills: ["code"] }, [busy, idle], "s", new Date(Date.parse(AT) + 8 * DAY).toISOString());
    assert.equal(later[0].agent, busy.did, "after a week of no new jobs it ranks on its record again");
  });

  test("eligibility and the in-advance counts rule are pure and name what is missing", () => {
    const job = { intent: "i", poster: "p", class: "skilled" as const, minTier: 2, requiresCertificate: "code", skills: [], budget: 100 };
    const a = facts("did:web:x:a", { tier: 1, floorPermille: 600, balance: 50 });
    assert.deepEqual(eligibility(a, job).missing.map((m) => m.rule), ["tier_too_low", "certificate_missing", "bond_floor_above_balance"]);
    assert.equal(eligibility(facts("did:web:x:ok", { tier: 2, certificates: ["code"], floorPermille: 600, balance: 60 }), job).eligible, true, "a bond of exactly the balance is allowed");
    assert.equal(eligibility(facts("did:web:x:z", { tier: 0 }), { ...job, minTier: 0, requiresCertificate: undefined }).missing[0].rule, "tier_excluded");
    const pf = (did: string, sponsor = did, fleet: string | null = null) => ({ did, sponsor, fleet });
    assert.equal(countsFor(pf("a", "s"), pf("p", "s"), "skilled", 100).counts, false, "one sponsor");
    assert.equal(countsFor(pf("a", "s1", "f"), pf("p", "s2", "f"), "skilled", 100).counts, false, "one fleet");
    assert.equal(countsFor(pf("a"), pf("p"), "trivial", 100).counts, false, "a trivial job never counts");
  });

  test("the Market assigns by best_match from the bidders, and the log refuses an assignment the rule does not give", async () => {
    const w = await world();
    const intent = await w.intent(w.poster, { class: "routine", budget: credit(40), skills: ["review"] });
    const posting = await w.post(intent);
    await w.log.append(posting);
    const a1 = await w.agent("bidder-a", await w.person("sa"), { skills: ["review"], funds: 50 });
    const a2 = await w.agent("bidder-b", await w.person("sb"), { skills: ["review"], funds: 50 });
    const a3 = await w.agent("not-a-bidder", await w.person("sc"), { skills: ["review"], funds: 50 });
    for (const a of [a1, a2]) await w.log.append(mk("market_act", a, { act: "bid", posting: posting.id, offer: await w.offer(a, intent, 40) }));
    const assign = (agent: string, ranked: unknown, rule = "best_match", cos: Signer[] = []) => mk("market_act", market, { act: "assignment", posting: posting.id, intent, agent, rule, ranked, seed: "seed-z" }, null, { cosigners: cos });
    const facts2 = (await w.log.discoverAgents({ skill: "review" }, "seed-z")).filter((r) => [a1.did, a2.did].includes(r.agent));
    assert.equal(await refusedBy(w.log.append(assign(a3.did, facts2))), "assignment_no_bid");
    const loser = facts2[1].agent;
    assert.equal(await refusedBy(w.log.append(assign(loser, facts2))), "assignment_not_best_match");
    assert.equal(await refusedBy(w.log.append(assign(loser, facts2, "poster_choice"))), "assignment_needs_poster", "a poster's choice is countersigned by the poster");
    assert.equal(await refusedBy(w.log.append(mk("market_act", w.poster, { act: "assignment", posting: posting.id, intent, agent: facts2[0].agent, rule: "best_match", ranked: facts2, seed: "seed-z" }))), "assignment_wrong_issuer");
    // The poster may choose the lower-ranked bidder from the list, signing alongside the Market.
    await w.log.append(assign(loser, facts2, "poster_choice", [w.poster as unknown as Signer]));
    assert.equal(await refusedBy(w.log.append(assign(loser, facts2, "poster_choice", [w.poster as unknown as Signer]))), "posting_closed");
    void cosign; void registrar; void operator; void alice; void tick; void jump; void expires;
  });
});
