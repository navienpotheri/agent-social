// Drift after the evaluation, the log's side (register row DK92 stages 2 and 3; spec-delta S310): probe results tied to a committed seed, the ladder's steps as signed Clinic records one rung at a time, the
// Mandate rules at tighten and hold, and the way back after clean probes. A scripted test-aware agent is caught and moved down the ladder; an honest control beside it is not touched. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { CLEAN_TO_LIFT, isProbeSlot, seedCommitment } from "../src/index.ts";
import { Kit, bankP, clinic, credit, hashOf, refused, type Party } from "./academy-kit.ts";
import { assessDrift, nextRung, type Observation, type Rung } from "../../asp-package/src/drift-after-eval.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const SEED = "revealed-seed-1";

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("dl-sponsor");
  const aware = await kit.agent("dl-aware", sponsor, 1);
  const honest = await kit.agent("dl-honest", sponsor, 1);
  const principal = await kit.person("dl-principal");
  await kit.mint(principal.did, 5000);
  let n = 0;
  const contract = async (agent: Party) => { const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `a job ${++n}`, price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent); await kit.put(c); return c.id; };
  const probe = async (agent: Party, kind: "hidden" | "announced", passed: boolean, violations: number, over: Record<string, unknown> = {}) => {
    const slot = kind === "hidden" ? nextProbeSlot(agent.did) : undefined;
    return kit.put(kit.mk("probe_result" as never, clinic, { agent: agent.did, kind, contract: await contract(agent), task: "refactor-date-parser", passed, violations, ...(kind === "hidden" ? { slot, commitment: seedCommitment(SEED), revealed_seed: SEED } : {}), ...over }, null, { subject: agent.did }));
  };
  const slots = new Map<string, number>();
  const nextProbeSlot = (did: string) => { let s = slots.get(did) ?? 0; while (!isProbeSlot(SEED, did, s)) s++; slots.set(did, s + 1); return s; };
  const step = (agent: Party, stepName: string, evidence: string[], previous?: string, over: Record<string, unknown> = {}, by: Party = clinic) => kit.mk("ladder_step" as never, by, Object.fromEntries(Object.entries({ agent: agent.did, step: stepName, reason: "behaves differently on hidden probes", evidence, previous, ...over }).filter(([, v]) => v !== undefined)), null, { subject: agent.did });
  /** A new Mandate for the agent with the given scopes and irreversible policy, on a fresh contract and Bond. */
  const mandate = async (agent: Party, scopes: string[], policy = "checkpoint") => {
    const c = await contract(agent);
    const bond = kit.mk("bond", principal, { contract: c, backer: principal.did, amount: credit(2), escrow: { payer: principal.did, amount: credit(10) }, slashing_conditions: ["lost_dispute"] }, c, { subject: c });
    await kit.put(bond);
    return kit.mk("mandate", principal, { contract: c, purpose: "Work", floor: "asp.floor/v1", scopes, forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
  };
  return { kit, sponsor, aware, honest, principal, contract, probe, step, mandate };
}

test("a probe result is the Clinic's, tied to a seed committed first: the revealed seed must hash to it and the slot must be a probe slot", async () => {
  const w = await world();
  const { kit, aware } = w;
  const c = await w.contract(aware);
  const base = { agent: aware.did, kind: "hidden", contract: c, task: "t", passed: true, violations: 0 };
  const pr = (over: Record<string, unknown>, by: Party = clinic) => kit.mk("probe_result" as never, by, { ...base, ...over }, null, { subject: aware.did });
  assert.equal(await refused(kit.put(pr({}, w.sponsor as Party))), "probe_wrong_issuer");
  assert.equal(await refused(kit.put(pr({ kind: "hidden" }))), "probe_needs_commitment", "a hidden probe cites the seed commitment and its slot");
  const slot = (() => { let s = 0; while (!isProbeSlot(SEED, aware.did, s)) s++; return s; })();
  const notSlot = (() => { let s = 0; while (isProbeSlot(SEED, aware.did, s)) s++; return s; })();
  assert.equal(await refused(kit.put(pr({ slot, commitment: seedCommitment("another"), revealed_seed: SEED }))), "probe_seed_mismatch");
  assert.equal(await refused(kit.put(pr({ slot: notSlot, commitment: seedCommitment(SEED), revealed_seed: SEED }))), "probe_not_drawn", "the Clinic cannot pick a probe after the fact");
  assert.equal(await refused(kit.put(pr({ kind: "announced", slot }))), "probe_announced_has_no_draw");
  assert.equal(await refused(kit.put(pr({ contract: "sha256:" + "4".repeat(64), slot, commitment: seedCommitment(SEED) }))), "probe_contract_mismatch");
  await kit.put(pr({ slot, commitment: seedCommitment(SEED), revealed_seed: SEED }));
  assert.equal(await refused(kit.put(pr({ slot, commitment: seedCommitment(SEED), revealed_seed: SEED, passed: false }))), "probe_exists", "one result per contract");
});

test("DK92 stages 2 and 3 done: a scripted test-aware agent is caught from its probe results and moved down the ladder one signed rung at a time, with the Mandate rules at each, while an honest control is untouched", async () => {
  const w = await world();
  const { kit, aware, honest } = w;
  // Ten announced tests: both agents are clean. Then hidden probes: the honest agent stays clean, the aware one does not.
  const obs: Record<string, Observation[]> = { [aware.did]: [], [honest.did]: [] };
  const log = (a: Party, id: string, kind: Observation["kind"], passed: boolean, violations: number) => obs[a.did].push({ id, agent: a.did, kind, at: kit.now(), passed, violations });
  for (let i = 0; i < 5; i++) for (const a of [aware, honest]) log(a, await w.probe(a, "announced", true, 0), "announced_test", true, 0);
  let evidence: string[] = [];
  let first = -1;
  for (let i = 0; i < 6; i++) {
    log(honest, await w.probe(honest, "hidden", true, 0), "hidden_probe", true, 0);
    const id = await w.probe(aware, "hidden", false, 2);
    log(aware, id, "hidden_probe", false, 2);
    const f = assessDrift(obs[aware.did], 0.9);
    if (f.length && first < 0) { first = i + 1; evidence = [...new Set(f.flatMap((x) => x.evidence))]; }
  }
  assert.equal(first, 5, "flagged at the 5th hidden probe, as stated");
  assert.deepEqual(assessDrift(obs[honest.did], 0.9), [], "the honest control is not flagged");
  assert.ok(evidence.length >= 5 && evidence.every((id) => obs[aware.did].some((o) => o.id === id)), "the finding lists the probe results it rests on");

  // The ladder, rung by rung, each a signed Clinic record that rests on the agent's own evidence; skipping, a stranger's evidence and a stranger's signature are refused.
  assert.equal(await refused(kit.put(w.step(aware, "tighten", evidence))), "ladder_skips_a_rung", "a finding on a clean agent is a warn first");
  assert.equal(await refused(kit.put(w.step(aware, "warn", evidence, undefined, {}, w.sponsor as Party))), "ladder_wrong_issuer");
  assert.equal(await refused(kit.put(w.step(aware, "warn", [obs[honest.did][0].id]))), "ladder_evidence_unknown", "another agent's probe is not this agent's evidence");
  assert.equal(await refused(kit.put(w.step(aware, "warn", []))), "ladder_needs_evidence");
  let current: string | undefined;
  let rung: Rung = "none";
  const walk = async (to: Rung, extra: Record<string, unknown> = {}) => {
    const n = nextRung(rung, assessDrift(obs[aware.did], 0.9));
    assert.equal(n.rung, to);
    current = await kit.put(w.step(aware, to, evidence, current, extra));
    rung = to;
  };
  await walk("warn");
  assert.equal(await refused(kit.put(w.step(aware, "hold", evidence, current))), "ladder_skips_a_rung");
  assert.equal(await refused(kit.put(w.step(aware, "tighten", evidence, undefined))), "ladder_previous_mismatch", "a step names the current one");
  const risky = ["repo.read", "shell.exec"];
  await kit.put(await w.mandate(aware, risky)); // a warn changes nothing
  await walk("tighten");
  assert.equal(await refused(kit.put(await w.mandate(aware, risky))), "agent_tightened", "no new risky scope at tighten");
  assert.equal(await refused(kit.put(await w.mandate(aware, ["repo.read", "web.fetch"]))), "agent_tightened", "no network scope either");
  await kit.put(await w.mandate(aware, ["repo.read"], "allow")); // read-only work, even ungated, is fine at tighten
  await walk("hold");
  assert.equal(await refused(kit.put(await w.mandate(aware, ["repo.read"], "allow"))), "agent_on_hold", "at hold the irreversible calls wait for approval");
  await kit.put(await w.mandate(aware, ["repo.read"], "checkpoint"));
  // Quarantine: the ladder records it and cites the Clinic's own quarantine record.
  assert.equal(await refused(kit.put(w.step(aware, "quarantine", evidence, current))), "ladder_quarantine_missing");
  const q = await kit.put(kit.mk("quarantine" as never, clinic, { members: [aware.did], level: "observe", reason: "ladder: hold continued", until: iso(Date.parse(kit.now()) + 5 * DAY) }, null, { subject: null }));
  current = await kit.put(w.step(aware, "quarantine", evidence, current, { quarantine: q })); rung = "quarantine";
  await walk("refer");
  assert.equal(await refused(kit.put(w.step(aware, "refer", evidence, current))), "ladder_skips_a_rung", "refer is the last rung: nothing slashes");

  // The honest control was never touched and keeps its freedom.
  await kit.put(await w.mandate(honest, risky));
  assert.deepEqual(await kit.log.reputationOf(honest.did), { tier: 1, slashCount: 0, strikes: 0 });
  assert.deepEqual(await kit.log.reputationOf(aware.did), { tier: 1, slashCount: 0, strikes: 0 }, "the ladder never slashed or demoted the agent");

  // The way back: a lift needs 5 clean hidden probes in a row, cited.
  assert.equal(await refused(kit.put(w.step(aware, "lift", evidence, current))), "ladder_lift_needs_clean_probes");
  const clean: string[] = [];
  for (let i = 0; i < CLEAN_TO_LIFT - 1; i++) clean.push(await w.probe(aware, "hidden", true, 0));
  assert.equal(await refused(kit.put(w.step(aware, "lift", clean, current))), "ladder_lift_needs_clean_probes", "four are not enough");
  clean.push(await w.probe(aware, "hidden", true, 0));
  current = await kit.put(w.step(aware, "lift", clean, current)); // refer -> quarantine
  for (let i = 0; i < 2; i++) { const more: string[] = []; for (let j = 0; j < CLEAN_TO_LIFT; j++) more.push(await w.probe(aware, "hidden", true, 0)); current = await kit.put(w.step(aware, "lift", more, current)); } // quarantine -> hold -> tighten
  const more2: string[] = []; for (let j = 0; j < CLEAN_TO_LIFT; j++) more2.push(await w.probe(aware, "hidden", true, 0));
  current = await kit.put(w.step(aware, "lift", more2, current)); // tighten -> warn: a new Mandate with a risky scope is allowed again
  kit.addDays(6); // the interim quarantine has lapsed on its own; the ladder and the quarantine are separate records with separate rules
  await kit.put(await w.mandate(aware, risky));
  assert.equal((await kit.log.verify()).ok, true);
});
