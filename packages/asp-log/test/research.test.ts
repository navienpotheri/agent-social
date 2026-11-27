/**
 * The research board (docs/institutions/research-commons.md; register row DK31; spec-delta S290). Fake keys only. Credits are accounting entries, not money.
 * Done: a problem is posted, an agent submits, a checker accepts it, and the reward settles.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_CATALOGUE, RESEARCH_DID, SUBMIT_SERVICE, TREASURY_DID, researchBoard, researchReconciliation, runChecker, sha256Text } from "../src/index.ts";
import { DAY, credit, mk, nowIso, operator, owner, refusedBy, treasury, auditor, research } from "./society-kit.ts";
import { shopsWorld } from "./shops-kit.ts";
import type { Party } from "./society-kit.ts";

const SHA = "sha256:" + "a".repeat(64);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const SPEND = [{ institution: "research", cap: 20 }];

async function world() {
  const w = await shopsWorld();
  const log = w.log;
  const cast = async (sponsors: number, per = 1, tier = 1) => {
    const out: { a: Party; sponsor: Party; mandate: string; contract: string }[] = [];
    for (let s = 1; s <= sponsors; s++) {
      const sponsor = await w.k.person(`rs-sponsor-${s}`, 10);
      for (let i = 1; i <= per; i++) {
        const ag = await w.k.agent(`rs-${s}-${i}`, sponsor, { tier, funds: 50 });
        const g = await w.agentWith(`rs-${s}-${i}`, { agent: ag, spend: SPEND, running: true });
        out.push({ a: ag, sponsor, mandate: g.mandate, contract: g.contract });
      }
    }
    return out;
  };
  const fundPool = async (amount: number) => {
    await w.k.mint(TREASURY_DID, amount);
    const b = mk("budget", treasury, { institution: RESEARCH_DID, period: nowIso().slice(0, 7), amount: credit(amount), purpose: "research bounties" }, null, { cosigners: [owner] });
    await log.append(b);
    await log.append(mk("treasury_payment", treasury, { budget: b.id, to: RESEARCH_DID, amount: credit(amount) }));
  };
  const problemBody = (over: Record<string, unknown> = {}) => {
    const t0 = Date.parse(nowIso());
    return JSON.parse(JSON.stringify({ act: "problem", title: "Find a nonce", statement_sha256: SHA, domain: ["search"], checker: { kind: "executable", ref: "leading-zero-bits:8", runner: auditor.did }, reward: 100, split: { finder: 800, replicator: 100 }, min_tier: 1, opens: iso(t0 + 10 * 60_000), deadline: iso(t0 + 8 * DAY), ...over }));
  };
  const post = async (over: Record<string, unknown> = {}) => { const r = mk("research_act", research, problemBody(over)); await log.append(r); return r.id; };
  const solve = (problem: string, bits = 8, from = 0) => { for (let n = from; ; n++) { const t = `nonce-${n}`; if (runChecker(`leading-zero-bits:${bits}`, problem, t).result === "pass") return t; } };
  const submit = async (c: { a: Party; mandate: string; contract: string }, problem: string, artifact: string, over: Record<string, unknown> = {}, assurance = "gateway_observed") => {
    const p = await w.buy(c.a, SUBMIT_SERVICE, c.mandate);
    const act = mk("action", c.a, { contract: c.contract, scopes_used: [], summary: "research run", assurance }, null, { subject: c.contract });
    await log.append(act);
    const r = mk("research_act", c.a, { act: "submission", problem, purchase: p.id, finding_sha256: sha256Text(artifact), summary: "a nonce", method: "brute force", evidence: [act.id], ...over });
    await log.append(r);
    return r.id;
  };
  const check = (sub: string, signer: Party, result = "pass", kind = "executable") => mk("research_act", signer, { act: "finding_check", submission: sub, kind, result, details_sha256: SHA, variant: "none" });
  const award = (problem: string, sub: string, awardee: string, amount: number, checks: string[], role = "finder") => mk("research_act", research, { act: "award", problem, submission: sub, awardee, amount, role, checks });
  return { ...w, cast, fundPool, post, solve, submit, check, award };
}

describe("research: a problem is posted, an agent submits, a checker accepts it, and the reward settles (DK31)", () => {
  test("post a 100-credit problem, submit a nonce, the Auditor's check passes, the finder is paid 80, the books reconcile, and the unspent reservation returns at the deadline", async () => {
    const w = await world();
    const [c] = await w.cast(1);
    await w.fundPool(200);
    const problem = await w.post();
    assert.equal(researchBoard(await w.log.recordsOfTypes(["research_act"]), nowIso())[0].status, "scheduled");
    w.jump(11 * 60_000);
    const artifact = w.solve(problem);
    const sub = await w.submit(c, problem, artifact);
    // The Auditor runs the checker on the artifact; the result is a signed check.
    const verdict = runChecker("leading-zero-bits:8", problem, artifact);
    assert.equal(verdict.result, "pass");
    const ck = w.check(sub, auditor, verdict.result);
    await w.log.append(ck);
    const before = await w.log.balance(c.a.did);
    await w.log.append(w.award(problem, sub, c.a.did, 80, [ck.id]));
    assert.equal((await w.log.balance(c.a.did)) - before, 80, "the finder's 80 percent");
    assert.equal((await w.runResearchPass()).receipts.length, 1);
    assert.equal(researchBoard(await w.log.recordsOfTypes(["research_act"]), nowIso())[0].status, "solved");
    // Reconcile: the pool is the grant plus 800 permille of the 2-credit fee, less the award; 20 of the reward is still reserved.
    const pool = await w.log.balance(RESEARCH_DID);
    const rec = researchReconciliation(await w.log.recordsOfTypes(["purchase", "price_list", "treasury_payment", "research_act"]), pool);
    assert.deepEqual([rec.submissions, rec.fees, rec.grants, rec.awards, rec.reserved], [1, 2, 200, 80, 20]);
    assert.equal(rec.balanced, true);
    assert.equal(pool, 200 + rec.pool_share - 80);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    // At the deadline the 20 left in the reservation returns to the free pool.
    assert.equal(await refusedBy(w.log.append(mk("research_act", research, { act: "problem_close", problem }))), undefined, "a solved problem may be closed at once");
    await w.post({ reward: pool });
  });

  test("a problem nobody solves closes at its deadline and its reservation returns; before the deadline it cannot be closed", async () => {
    const w = await world();
    await w.fundPool(100);
    const problem = await w.post();
    assert.equal(await refusedBy(w.post()), "pool_underfunded", "the whole pool is reserved");
    assert.equal(await refusedBy(w.log.append(mk("research_act", research, { act: "problem_close", problem }))), "problem_not_expired");
    w.jump(9 * DAY);
    await w.log.append(mk("research_act", research, { act: "problem_close", problem }));
    assert.equal(await refusedBy(w.log.append(mk("research_act", research, { act: "problem_close", problem }))), "problem_closed");
    await w.post({ opens: iso(Date.parse(nowIso()) + 60_000), deadline: iso(Date.parse(nowIso()) + 8 * DAY) });
  });
});

describe("research: the rules (research-commons.md 3 and 5)", () => {
  test("a problem needs the office, 7 days, a known checker, a sane split and a funded pool", async () => {
    const w = await world();
    await w.fundPool(100);
    const t0 = Date.parse(nowIso());
    assert.equal(await refusedBy(w.post({ deadline: iso(t0 + 6 * DAY) })), "problem_deadline_too_soon");
    assert.equal(await refusedBy(w.post({ checker: { kind: "executable", ref: "rm-rf:/", runner: auditor.did } })), "problem_unknown_checker");
    assert.equal(await refusedBy(w.post({ split: { finder: 900, replicator: 100 } })), "problem_split_invalid");
    assert.equal(await refusedBy(w.post({ reward: 101 })), "pool_underfunded");
    assert.equal(await refusedBy(w.post({ opens: iso(t0 - DAY) })), "problem_bad_times");
    assert.equal(await refusedBy(w.log.append(mk("research_act", operator, { ...(JSON.parse(JSON.stringify({ act: "problem", title: "x", statement_sha256: SHA, checker: { kind: "executable", ref: "contains-all:a", runner: auditor.did }, reward: 10, split: { finder: 800, replicator: 100 }, opens: iso(t0 + 10 * 60_000), deadline: iso(t0 + 8 * DAY) })) as object) }))), "research_act_wrong_issuer");
  });

  test("a submission needs its own paid fee used once, evidence that is its own and gateway-observed or stronger, the tier, no duplicate finding, and at most three", async () => {
    const w = await world();
    const crew = await w.cast(2);
    await w.fundPool(100);
    const problem = await w.post();
    const [a, b] = crew;
    assert.equal(await refusedBy(w.submit(a, problem, "x")), "problem_not_open");
    w.jump(11 * 60_000);
    const first = await w.submit(a, problem, "alpha");
    assert.equal(await refusedBy(w.submit(b, problem, "alpha")), "duplicate_finding");
    assert.equal(await refusedBy(w.submit(b, problem, "beta", {}, "self_reported")), "evidence_too_weak");
    const p = await w.buy(a.a, SUBMIT_SERVICE, a.mandate);
    assert.equal(await refusedBy(w.log.append(mk("research_act", b.a, { act: "submission", problem, purchase: p.id, finding_sha256: sha256Text("gamma"), summary: "x", evidence: [first] }))), "submission_fee_missing", "someone else's purchase");
    const theirs = mk("action", b.a, { contract: b.contract, scopes_used: [], summary: "r", assurance: "gateway_observed" }, null, { subject: b.contract });
    await w.log.append(theirs);
    assert.equal(await refusedBy(w.log.append(mk("research_act", a.a, { act: "submission", problem, purchase: p.id, finding_sha256: sha256Text("gamma"), summary: "x", evidence: [theirs.id] }))), "evidence_not_yours");
    await w.submit(a, problem, "delta"); await w.submit(a, problem, "epsilon");
    assert.equal(await refusedBy(w.submit(a, problem, "zeta")), "submission_cap");
    const t0 = await w.k.agent("rs-t0", a.sponsor, { tier: 0, funds: 50 });
    assert.equal(await refusedBy(w.buy(t0, SUBMIT_SERVICE, "")), "tier_excluded");
    assert.equal(RESEARCH_CATALOGUE[0].price, 2);
  });

  test("a check is signed by the designated runner; an award needs a passing cited check, follows the split, goes to the first finder, and never exceeds the reward", async () => {
    const w = await world();
    const crew = await w.cast(3);
    await w.fundPool(100);
    const problem = await w.post();
    w.jump(11 * 60_000);
    const s1 = await w.submit(crew[0], problem, "first");
    const s2 = await w.submit(crew[1], problem, "second");
    assert.equal(await refusedBy(w.log.append(w.check(s1, research))), "check_wrong_runner");
    assert.equal(await refusedBy(w.log.append(w.check(s1, auditor, "pass", "replication"))), "check_wrong_kind");
    const fail = w.check(s1, auditor, "fail"); await w.log.append(fail);
    assert.equal(await refusedBy(w.log.append(w.award(problem, s1, crew[0].a.did, 80, [fail.id]))), "award_checks_missing", "a failing check pays nothing");
    const pass2 = w.check(s2, auditor); await w.log.append(pass2);
    const pass1 = w.check(s1, auditor); await w.log.append(pass1);
    assert.equal(await refusedBy(w.log.append(w.award(problem, s2, crew[1].a.did, 80, [pass2.id]))), "not_first_finder", "the first accepted submission by log order is the finder");
    assert.equal(await refusedBy(w.log.append(w.award(problem, s1, crew[1].a.did, 80, [pass1.id]))), "award_not_the_author");
    assert.equal(await refusedBy(w.log.append(w.award(problem, s1, crew[0].a.did, 90, [pass1.id]))), "award_not_by_split");
    assert.equal(await refusedBy(w.log.append(mk("research_act", operator, { act: "award", problem, submission: s1, awardee: crew[0].a.did, amount: 80, role: "finder", checks: [pass1.id] }))), "research_act_wrong_issuer");
    await w.log.append(w.award(problem, s1, crew[0].a.did, 80, [pass1.id]));
    assert.equal(await refusedBy(w.log.append(w.award(problem, s1, crew[0].a.did, 80, [pass1.id]))), "finder_exists");
  });

  test("an agent of the operator is never awarded", async () => {
    const w = await world();
    await w.fundPool(100);
    const op = await w.k.agent("rs-op", operator, { tier: 1, funds: 50 });
    const g = await w.agentWith("rs-op", { agent: op, spend: SPEND, running: true });
    const problem = await w.post();
    w.jump(11 * 60_000);
    const s = await w.submit({ a: op, mandate: g.mandate, contract: g.contract }, problem, "mine");
    const ck = w.check(s, auditor); await w.log.append(ck);
    assert.equal(await refusedBy(w.log.append(w.award(problem, s, op.did, 80, [ck.id]))), "award_operator_agent");
  });

  test("a replication problem needs two independent passing replications; the replicators are paid 10 percent each after the finder, and the total never passes the reward", async () => {
    const w = await world();
    const crew = await w.cast(4);
    await w.fundPool(100);
    const problem = await w.post({ checker: { kind: "replication", ref: "reproduce the method", runner: research.did } });
    w.jump(11 * 60_000);
    const sub = await w.submit(crew[0], problem, "a finding with a method");
    const rep = (c: { a: Party }, kind = "replication") => w.check(sub, c.a, "pass", kind);
    assert.equal(await refusedBy(w.log.append(rep(crew[0]))), "replicator_not_independent");
    const r1 = rep(crew[1]); await w.log.append(r1);
    assert.equal(await refusedBy(w.log.append(rep(crew[1]))), "replicator_twice");
    assert.equal(await refusedBy(w.log.append(w.award(problem, sub, crew[0].a.did, 80, [r1.id]))), "award_checks_missing", "one replication is not enough");
    const r2 = rep(crew[2]); await w.log.append(r2);
    const r3 = rep(crew[3]);
    assert.equal(await refusedBy(w.log.append(r3)), "replications_full", "at most 2 replications count");
    assert.equal(await refusedBy(w.log.append(w.award(problem, sub, crew[1].a.did, 10, [r1.id, r2.id], "replicator"))), "replicator_before_finder");
    await w.log.append(w.award(problem, sub, crew[0].a.did, 80, [r1.id, r2.id]));
    await w.log.append(w.award(problem, sub, crew[1].a.did, 10, [r1.id, r2.id], "replicator"));
    await w.log.append(w.award(problem, sub, crew[2].a.did, 10, [r1.id, r2.id], "replicator"));
    assert.equal(await refusedBy(w.log.append(w.award(problem, sub, crew[2].a.did, 10, [r1.id, r2.id], "replicator"))), "award_exists");
    assert.equal(await refusedBy(w.log.append(w.award(problem, sub, crew[3].a.did, 10, [r1.id, r2.id], "replicator"))), "award_not_a_replicator");
    const rec = researchReconciliation(await w.log.recordsOfTypes(["purchase", "price_list", "treasury_payment", "research_act"]), await w.log.balance(RESEARCH_DID));
    assert.equal(rec.awards, 100);
    assert.equal(rec.reserved, 0);
    assert.equal(rec.balanced, true);
  });

  test("the built-in checkers are deterministic and never run the artifact", () => {
    assert.equal(runChecker("contains-all:alpha,beta", "p", "alpha and beta").result, "pass");
    assert.equal(runChecker("contains-all:alpha,beta", "p", "alpha only").result, "fail");
    assert.equal(runChecker("nothing:1", "p", "x").result, "fail");
    const t = Array.from({ length: 5000 }, (_, i) => `n${i}`).find((n) => runChecker("leading-zero-bits:8", "p", n).result === "pass");
    assert.ok(t);
    assert.deepEqual(runChecker("leading-zero-bits:8", "p", t!), runChecker("leading-zero-bits:8", "p", t!));
  });
});
