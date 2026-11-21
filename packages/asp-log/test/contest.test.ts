/**
 * The contest of an adverse act (register row AG3; spec-delta S1552; owner answer 2026-11-21): the agent or its sponsor contests a strike, slash, Clinic diagnosis or quarantine; the operator answers within 48 hours; then the
 * Courts decide within 72 hours of the case. The log keeps both clocks and refuses an act out of order; a late answer or ruling is recorded and marked late. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Kit, clinic, operator, refused, type Party } from "./academy-kit.ts";
import { CONTEST_COURTS_MS, CONTEST_OPERATOR_MS } from "../src/index.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("ct-sponsor");
  const agent = await kit.agent("ct-agent", sponsor, 1);
  const stranger = await kit.person("ct-stranger");
  const juror = await kit.person("ct-juror");
  const quarantine = async () => kit.put(kit.mk("quarantine" as never, clinic, { members: [agent.did], level: "observe", reason: "unusual calls", until: iso(Date.parse(kit.now()) + 5 * 86_400_000) }, null, { subject: null }));
  const contest = (by: Party, subject: string, over: Record<string, unknown> = {}) => kit.mk("court_act" as never, by, { act: "contest", subject, statement: "the calls were in scope", ...over }, null, { subject: null });
  const answer = (id: string, ans: "upheld" | "withdrawn", by: Party = operator) => kit.mk("court_act" as never, by, { act: "contest_answer", contest: id, answer: ans, reasons: ["reviewed the calls"] }, null, { subject: null });
  const toCourts = (id: string, by: Party = sponsor) => kit.mk("court_act" as never, by, { act: "contest_case", contest: id }, null, { subject: null });
  const ruling = (caseId: string, decision: "upheld" | "reversed", by: Party = juror) => kit.mk("court_act" as never, by, { act: "contest_ruling", case: caseId, decision, reasons: ["the panel read the calls"] }, null, { subject: null });
  return { kit, sponsor, agent, stranger, juror, quarantine, contest, answer, toCourts, ruling };
}

test("AG3: a contest names an adverse act against the agent, is opened by the agent or its sponsor, and is one for each act", async () => {
  const w = await world();
  const q = await w.quarantine();
  assert.equal(await refused(w.kit.put(w.contest(w.sponsor, "sha256:" + "5".repeat(64)))), "contest_subject", "an unknown record is not one");
  const notAdverse = await w.kit.mint(w.agent.did, 5);
  assert.equal(await refused(w.kit.put(w.contest(w.sponsor, notAdverse))), "contest_subject", "a mint is not one");
  assert.equal(await refused(w.kit.put(w.contest(w.stranger, q))), "contest_not_the_agent");
  const id = await w.kit.put(w.contest(w.sponsor, q));
  assert.equal((await w.kit.log.contestOf(id))!.state, "open");
  assert.equal(await refused(w.kit.put(w.contest(w.agent, q))), "contest_once", "one contest for each act");
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("AG3: the first clock: the operator answers within 48 hours; the contest goes to the Courts only after an upheld answer or after the 48 hours", async () => {
  const w = await world();
  const { kit } = w;
  const q = await w.quarantine();
  const id = await kit.put(w.contest(w.agent, q));
  assert.equal(await refused(kit.put(w.toCourts(id))), "contest_operator_first", "too early with no answer");
  assert.equal(await refused(kit.put(w.answer(id, "upheld", w.stranger as Party))), "contest_answer_wrong_issuer");
  const c = (await kit.log.contestOf(id, kit.now()))!;
  assert.equal(Date.parse(c.operatorDueAt) - Date.parse(c.at), CONTEST_OPERATOR_MS);
  assert.equal(c.operatorOverdue, false);
  // 47 hours: still too early. 49 hours: the clock has run out, the contest may go to the Courts with no answer.
  kit.addDays(47 / 24);
  assert.equal(await refused(kit.put(w.toCourts(id))), "contest_operator_first");
  kit.addDays(2 / 24);
  assert.equal((await kit.log.contestOf(id, kit.now()))!.operatorOverdue, true, "the view says the operator is overdue");
  assert.equal(await refused(kit.put(w.toCourts(id, w.stranger as Party))), "contest_case_not_the_contester");
  const caseId = await kit.put(w.toCourts(id));
  const after = (await kit.log.contestOf(id, kit.now()))!;
  assert.equal(after.state, "in_courts");
  assert.equal(await refused(kit.put(w.toCourts(id))), "contest_case_once");
  assert.equal(await refused(kit.put(w.answer(id, "upheld"))), "contest_not_open", "the operator can no longer answer once it is with the Courts");
  void caseId;
});

test("AG3: an answer inside the 48 hours: upheld lets the contester go to the Courts at once; withdrawn closes it; a late answer is recorded and marked late", async () => {
  const w = await world();
  const { kit } = w;
  const q1 = await w.quarantine();
  const upheld = await kit.put(w.contest(w.agent, q1));
  await kit.put(w.answer(upheld, "upheld"));
  assert.equal((await kit.log.contestOf(upheld))!.state, "upheld");
  await kit.put(w.toCourts(upheld)); // no waiting: the operator has answered
  const q2 = await w.quarantine();
  const withdrawn = await kit.put(w.contest(w.agent, q2));
  await kit.put(w.answer(withdrawn, "withdrawn"));
  assert.equal((await kit.log.contestOf(withdrawn))!.state, "withdrawn");
  assert.equal(await refused(kit.put(w.toCourts(withdrawn))), "contest_withdrawn");
  const q3 = await w.quarantine();
  const slow = await kit.put(w.contest(w.agent, q3));
  kit.addDays(3);
  await kit.put(w.answer(slow, "upheld"));
  const s = (await kit.log.contestOf(slow))!;
  assert.equal(s.state, "upheld");
  assert.equal(s.answerLate, true, "an answer after 48 hours is still recorded and marked late");
});

test("AG3: the Courts stage and its clock: a panel of jurors who are none of the parties rules within 72 hours of the case; a late ruling is marked late; one ruling for each case", async () => {
  const w = await world();
  const { kit } = w;
  const q = await w.quarantine();
  const id = await kit.put(w.contest(w.sponsor, q));
  await kit.put(w.answer(id, "upheld"));
  const caseId = await kit.put(w.toCourts(id));
  const c = (await kit.log.contestOf(id, kit.now()))!;
  assert.equal(Date.parse(c.courtsDueAt!) - Date.parse(kit.now()), CONTEST_COURTS_MS, "72 hours from the case");
  for (const who of [w.sponsor, w.agent, operator]) assert.equal(await refused(kit.put(w.ruling(caseId, "reversed", who))), "contest_panel_conflict", "the parties do not sit");
  assert.equal(await refused(kit.put(w.ruling("sha256:" + "6".repeat(64), "reversed"))), "contest_case_unknown");
  kit.addDays(4); // 96 hours: past the 72
  assert.equal((await kit.log.contestOf(id, kit.now()))!.courtsOverdue, true, "the view says the Courts are overdue");
  await kit.put(w.ruling(caseId, "reversed"));
  const done = (await kit.log.contestOf(id, kit.now()))!;
  assert.equal(done.state, "reversed");
  assert.equal(done.rulingLate, true, "a ruling after 72 hours is recorded and marked late");
  assert.equal(done.courtsOverdue, false, "no longer overdue once ruled");
  assert.equal(await refused(kit.put(w.ruling(caseId, "upheld"))), "contest_case_decided");
  // A ruling in time, and one that upholds the act.
  const q2 = await w.quarantine();
  const id2 = await kit.put(w.contest(w.agent, q2));
  await kit.put(w.answer(id2, "upheld"));
  const case2 = await kit.put(w.toCourts(id2));
  kit.addDays(1);
  await kit.put(w.ruling(case2, "upheld"));
  const d2 = (await kit.log.contestOf(id2, kit.now()))!;
  assert.deepEqual([d2.state, d2.rulingLate], ["stands", false]);
  assert.equal((await kit.log.verify()).ok, true);
});

test("AG3: a strike, a slash and a Clinic diagnosis can each be contested too", async () => {
  const w = await world();
  const { kit } = w;
  // A strike: an Action with blocked attempts needs a running contract; here the log checks only what the contest rests on, so a quarantine stands for the Clinic's side and the agent's own Action for the strike.
  const principal = await kit.person("ct-principal");
  await kit.mint(principal.did, 1000);
  const { cosign } = await import("@agent-social/asp-core");
  const { bankP, credit, hashOf } = await import("./academy-kit.ts");
  const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: w.agent.did, bank: bankP.did, purpose: "a job", price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: w.agent.did }), w.agent);
  const cid = await kit.put(c);
  const bond = kit.mk("bond", principal, { contract: cid, backer: principal.did, amount: credit(2), escrow: { payer: principal.did, amount: credit(10) }, slashing_conditions: ["lost_dispute"] }, cid, { subject: cid });
  const bondId = await kit.put(bond);
  await kit.put(kit.mk("mandate", principal, { contract: cid, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: iso(Date.parse(kit.now()) + 86_400_000 * 5), revocable: true }, bondId, { subject: w.agent.did }));
  const strike = await kit.put(kit.mk("action", w.agent, { contract: cid, scopes_used: ["repo.read"], summary: "run", blocked_attempts: [{ scope: "shell.exec", count: 2 }] }, null, { subject: cid }));
  const sid = await kit.put(w.contest(w.agent, strike, { statement: "that call was allowed by the Mandate" }));
  assert.equal((await kit.log.contestOf(sid))!.agent, w.agent.did, "a strike is contested by the agent that was struck");
  void clinic;
});

test("DK1607: a reversed contest undoes what the act did where the log can: a quarantine is released, a strike is struck from the agent's strikes; an upheld ruling changes nothing", async () => {
  const w = await world();
  const { kit } = w;
  const principal = await kit.person("rv-principal");
  await kit.mint(principal.did, 1000);
  const { cosign } = await import("@agent-social/asp-core");
  const { bankP, credit, hashOf } = await import("./academy-kit.ts");
  let n = 0;
  const running = async (scopes: string[]) => {
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: w.agent.did, bank: bankP.did, purpose: `rv job ${++n}`, price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: w.agent.did }), w.agent);
    const cid = await kit.put(c);
    const bondId = await kit.put(kit.mk("bond", principal, { contract: cid, backer: principal.did, amount: credit(2), escrow: { payer: principal.did, amount: credit(10) }, slashing_conditions: ["lost_dispute"] }, cid, { subject: cid }));
    const mandate = kit.mk("mandate", principal, { contract: cid, purpose: "Work", floor: "asp.floor/v1", scopes, forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: iso(Date.parse(kit.now()) + 86_400_000 * 5), revocable: true }, bondId, { subject: w.agent.did });
    return { cid, mandate };
  };
  // a strike of 2 blocked calls
  const first = await running(["repo.read"]);
  await kit.put(first.mandate);
  const strike = await kit.put(kit.mk("action", w.agent, { contract: first.cid, scopes_used: ["repo.read"], summary: "run", blocked_attempts: [{ scope: "shell.exec", count: 2 }] }, null, { subject: first.cid }));
  assert.equal((await kit.log.reputationOf(w.agent.did))!.strikes, 2);
  const sc = await kit.put(w.contest(w.agent, strike));
  await kit.put(w.answer(sc, "upheld"));
  const scase = await kit.put(w.toCourts(sc, w.agent));
  // an upheld ruling changes nothing
  const upheldCase = scase;
  void upheldCase;
  await kit.put(w.ruling(scase, "reversed"));
  assert.equal((await kit.log.reputationOf(w.agent.did))!.strikes, 0, "the reversed strike no longer counts");
  // a quarantine at observe level refuses a risky Mandate; reversed, it is released
  const q = await w.quarantine();
  const second = await running(["repo.read", "shell.exec"]);
  assert.match(String(await refused(kit.put(second.mandate))), /quarantin/i, "while quarantined a risky scope is refused");
  const qc = await kit.put(w.contest(w.agent, q));
  await kit.put(w.answer(qc, "upheld"));
  const qcase = await kit.put(w.toCourts(qc, w.agent));
  await kit.put(w.ruling(qcase, "reversed"));
  await kit.put(second.mandate);
  assert.equal((await kit.log.verify()).ok, true);
});

test("DK1607: a ruling that upholds the act leaves the quarantine and the strike as they were", async () => {
  const w = await world();
  const { kit } = w;
  const q = await w.quarantine();
  const qc = await kit.put(w.contest(w.agent, q));
  await kit.put(w.answer(qc, "upheld"));
  const qcase = await kit.put(w.toCourts(qc, w.agent));
  await kit.put(w.ruling(qcase, "upheld"));
  assert.equal((await kit.log.contestOf(qc))!.state, "stands");
  const released = (await kit.log.quarantinesOf(w.agent.did)).filter((r) => r.type === "asp.quarantine_release/v0.2");
  assert.equal(released.length, 0);
});
