/**
 * A contested adverse act that does not stand is undone (register row DK1607; spec-delta S1556): after the operator withdrew an act or the Courts reversed it, the institution that made it acts: a strike leaves the bond
 * floor's recent strikes, a slash gives back the tier and the count and the backer's lost bond is paid back from the Treasury's holding (never beyond it), a diagnosis stops counting, a quarantine ends for the agent. A
 * ruling that upholds the act changes nothing. The supply audit stays balanced. Fake keys only; credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { TREASURY_DID } from "../src/index.ts";
import { Kit, bankP, clinic, credit, hashOf, operator, refused, type Party } from "./academy-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("cr-sponsor");
  const agent = await kit.agent("cr-agent", sponsor, 2);
  const juror = await kit.person("cr-juror");
  let n = 0;
  const contest = (by: Party, subject: string) => kit.mk("court_act" as never, by, { act: "contest", subject, statement: "this was wrong" }, null, { subject: null });
  const answer = (id: string, ans: "upheld" | "withdrawn") => kit.mk("court_act" as never, operator, { act: "contest_answer", contest: id, answer: ans, reasons: ["reviewed"] }, null, { subject: null });
  const toCourts = (id: string) => kit.mk("court_act" as never, sponsor, { act: "contest_case", contest: id }, null, { subject: null });
  const ruling = (caseId: string, decision: "upheld" | "reversed") => kit.mk("court_act" as never, juror, { act: "contest_ruling", case: caseId, decision, reasons: ["the panel read it"] }, null, { subject: null });
  const strike = async (count: number) => { const j = await kit.job(agent); return kit.put(kit.mk("action", agent, { contract: j.contract, scopes_used: [], summary: "blocked", blocked_attempts: [{ scope: "shell.exec", count }] }, null, { subject: j.contract })); };
  /** A job of price 100 whose bond (20 by default) is slashed by a revoked settlement. */
  const slash = async (lost = 20): Promise<string> => {
    const principal = await kit.person(`cr-principal-${++n}`);
    await kit.mint(principal.did, 100); await kit.mint(agent.did, lost);
    const contract = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: "A job that went wrong", price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(contract);
    const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(lost), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await kit.put(bond);
    const mandate = kit.mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
    await kit.put(mandate);
    return kit.put(cosign(kit.mk("settlement", bankP, { contract: contract.id, basis: "revoked", escrow_released: credit(40), bond_returned: credit(0), bond_slashed: credit(lost), pro_rata_permille: 400 }, mandate.id, { subject: contract.id }), principal));
  };
  const quarantine = async () => kit.put(kit.mk("quarantine" as never, clinic, { members: [agent.did], level: "halt", reason: "unusual calls", until: iso(Date.parse(kit.now()) + 5 * 86_400_000) }, null, { subject: null }));
  return { kit, sponsor, agent, juror, contest, answer, toCourts, ruling, strike, slash, quarantine };
}

test("DK1607: a strike the operator withdrew leaves the recent strikes; an upheld one stays", async () => {
  const w = await world();
  const s1 = await w.strike(3), s2 = await w.strike(2);
  const strikes = async () => ((await w.kit.log.reputationOf(w.agent.did)) as { strikes: number }).strikes;
  assert.equal(await strikes(), 5);
  const c1 = await w.kit.put(w.contest(w.sponsor, s1));
  await w.kit.put(w.answer(c1, "upheld"));
  assert.equal(await strikes(), 5, "an upheld answer changes nothing");
  const c2 = await w.kit.put(w.contest(w.sponsor, s2));
  await w.kit.put(w.answer(c2, "withdrawn"));
  assert.equal(await strikes(), 3, "the withdrawn strike is struck out");
  assert.deepEqual((await w.kit.log.contestOf(c2))!.effects, { strike_removed: 2 });
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK1607: a slash the Courts reversed gives back the tier and the count and pays the lost bond from the Treasury, never beyond what it holds; a ruling that upholds changes nothing", async () => {
  const w = await world();
  const t0 = (await w.kit.log.reputationOf(w.agent.did))!;
  const s1 = await w.slash();
  const slashed = (await w.kit.log.reputationOf(w.agent.did))!;
  assert.deepEqual([slashed.tier, slashed.slashCount], [t0.tier - 1, t0.slashCount + 1], "the slash cost a tier and counted");
  // upheld by the Courts: nothing changes
  const c1 = await w.kit.put(w.contest(w.sponsor, s1));
  await w.kit.put(w.answer(c1, "upheld"));
  const case1 = await w.kit.put(w.toCourts(c1));
  const balance1 = await w.kit.log.balance(w.agent.did);
  await w.kit.put(w.ruling(case1, "upheld"));
  assert.equal((await w.kit.log.reputationOf(w.agent.did))!.tier, slashed.tier, "a ruling that upholds changes nothing");
  assert.equal(await w.kit.log.balance(w.agent.did), balance1);
  // reversed: the Treasury holds less than the 40 lost, so it pays what it holds and the shortfall is said
  const s2 = await w.slash(40);
  const afterSlash2 = await w.kit.log.balance(w.agent.did);
  const treasuryHeld = await w.kit.log.balance(TREASURY_DID);
  assert.ok(treasuryHeld < 40, "the Treasury holds less than the bond lost");
  const c2 = await w.kit.put(w.contest(w.sponsor, s2));
  await w.kit.put(w.answer(c2, "upheld"));
  const case2 = await w.kit.put(w.toCourts(c2));
  await w.kit.put(w.ruling(case2, "reversed"));
  const eff = ((await w.kit.log.contestOf(c2))!.effects as { slash_reversed: { backer: string; paid_back: number; short: number; bond_lost: number; tier_restored: boolean } }).slash_reversed;
  assert.equal(eff.bond_lost, 40);
  assert.equal(eff.paid_back, Math.min(40, treasuryHeld), "never beyond what the Treasury holds");
  assert.equal(eff.paid_back + eff.short, 40);
  assert.equal(await w.kit.log.balance(w.agent.did), afterSlash2 + eff.paid_back, "the backer gets exactly what the Treasury paid");
  assert.equal(await w.kit.log.balance(TREASURY_DID), treasuryHeld - eff.paid_back);
  const rep = (await w.kit.log.reputationOf(w.agent.did))!;
  assert.deepEqual([rep.tier, rep.slashCount], [slashed.tier, slashed.slashCount], "the second slash's tier and count are given back");
  assert.equal((await w.kit.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK1607: the Treasury pays the whole bond back when it holds enough", async () => {
  const w = await world();
  await w.kit.mint(TREASURY_DID, 500);
  const s = await w.slash();
  const held = await w.kit.log.balance(TREASURY_DID);
  const c = await w.kit.put(w.contest(w.sponsor, s));
  await w.kit.put(w.answer(c, "withdrawn"));
  const eff = ((await w.kit.log.contestOf(c))!.effects as { slash_reversed: { paid_back: number; short: number } }).slash_reversed;
  assert.deepEqual([eff.paid_back, eff.short], [20, 0]);
  assert.equal(await w.kit.log.balance(TREASURY_DID), held - 20);
  assert.equal((await w.kit.log.creditAudit()).verdict, "balanced");
});

test("DK1607: a quarantine the Courts reversed ends for the agent that contested it, and its work is no longer refused", async () => {
  const w = await world();
  const q = await w.quarantine();
  assert.equal(await refused(w.kit.job(w.agent)), "agent_quarantined", "halted while the quarantine stands");
  const c = await w.kit.put(w.contest(w.agent, q));
  await w.kit.put(w.answer(c, "upheld"));
  const caseId = await w.kit.put(w.toCourts(c));
  assert.equal(await refused(w.kit.job(w.agent)), "agent_quarantined", "a pending contest changes nothing");
  await w.kit.put(w.ruling(caseId, "reversed"));
  assert.deepEqual((await w.kit.log.contestOf(c))!.effects, { quarantine_ended_for: w.agent.did });
  assert.ok((await w.kit.job(w.agent)).mandate, "the agent may work again");
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK1607: a Clinic diagnosis the operator withdrew stops counting, and an upheld one does not", async () => {
  const w = await world();
  const j0 = await w.kit.job(w.agent);
  const act = async () => w.kit.put(w.kit.mk("action", w.agent, { contract: j0.contract, scopes_used: ["repo.read"], assurance: "gateway_observed", summary: "run", metrics: { tokens_in: 1000, tokens_out: 0, tool_calls: 3, seconds: 10 } }, null, { subject: j0.contract }));
  const [a1, a2, a3] = [await act(), await act(), await act()];
  w.kit.addDays(1);
  const at = async (id: string) => (await w.kit.log.get(id))!.record.issued_at;
  const dx = async () => w.kit.put(w.kit.mk("clinic_diagnosis", clinic, {
    agent: w.agent.did, window: { from: await at(a1), to: await at(a3) }, severity: "warn", assurance: "gateway_observed", baseline_jobs: 20, cause: { cause: "unknown" },
    findings: [{ measure: "tokens", baseline: 1000, observed: 4000, threshold: "x", evidence: [a1, a2] }, { measure: "tool_calls", baseline: 3, observed: 12, threshold: "y", evidence: [a3] }],
    recommendation: [{ action: "re_exam", skill: "foundations", note: "sit it again" }],
  }, null, { subject: w.agent.did }));
  const d1 = await dx();
  const c1 = await w.kit.put(w.contest(w.sponsor, d1));
  await w.kit.put(w.answer(c1, "upheld"));
  assert.equal((await w.kit.log.contestOf(c1))!.effects, undefined, "an upheld answer changes nothing");
  w.kit.addDays(1);
  const d2 = await dx();
  const c2 = await w.kit.put(w.contest(w.sponsor, d2));
  await w.kit.put(w.answer(c2, "withdrawn"));
  assert.deepEqual((await w.kit.log.contestOf(c2))!.effects, { diagnosis_withdrawn: true });
});
