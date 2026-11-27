// DK140 (clinic.md CL-10, spec-delta S260): a tier 0 agent sits the retraining exam under a remedial Mandate, and the retraining release then returns it. Nothing is placed in the store by hand: the agent is
// excluded by a real slash (a settlement that slashes its own bond), the remedial Mandate, the exam, the re-vouching and the release are all records the log accepts or refuses by its rules. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver, cosign } from "@agent-social/asp-core";
import { EventLog, MemoryStore, examSeed, examVariant, institutionDid } from "../src/index.ts";
import { Kit, bankP, clinic, courts, credit, hashOf, operator, owner, refused, registrar, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const academy = institutionDid("academy");
const REMEDIAL_SITTING = "academy.exam_sitting.remedial";
const STANDARD_SITTING = "academy.exam_sitting";
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey])));
  const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  const kit = new Kit(log);
  const sponsor = await kit.person("remedial-sponsor");
  const agent = await kit.agent("remedial-agent", sponsor, 1);
  const split = (t: number, b: number, a: number) => ({ treasury_permille: t, burn_permille: b, payees: [{ account: academy, permille: a }] });
  const at = kit.tick();
  kit.list = await kit.put(kit.mk("price_list", treasury, { version: 1, effective_from: at, bounds_version: 1, job_tax_permille: 50, items: [
    { service: STANDARD_SITTING, institution: academy, price: 20, split: split(200, 100, 700), class: "standard" },
    { service: REMEDIAL_SITTING, institution: academy, price: 10, split: split(250, 0, 750), class: "remedial" },
  ] }, null, { at }));
  return { kit, log, sponsor, agent };
}

/** A contract between the sponsor (principal) and the agent, a Bond backed by `backer`, and a Mandate; returns the ids. The Mandate body is the remedial one unless `over` changes it. */
async function remedialJob(kit: Kit, sponsor: Party, agent: Party, backer: Party, over: Record<string, unknown> = {}, bondAmount = 5) {
  const contract = cosign(kit.mk("contract", sponsor, { principal: sponsor.did, performer: agent.did, bank: bankP.did, purpose: "retraining exam", price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
  await kit.put(contract);
  const bond = kit.mk("bond", backer, { contract: contract.id, backer: backer.did, amount: credit(bondAmount), escrow: { payer: sponsor.did, amount: credit(10) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await kit.put(bond);
  const body: Record<string, unknown> = {
    contract: contract.id, purpose: "Sit the Foundations exam for the Clinic", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" },
    subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [],
    expires: iso(Date.parse(kit.now()) + 10 * DAY), revocable: true, remedial: { purpose: "clinic_exam", sponsor: sponsor.did }, institution_spend: [{ institution: "academy", cap: credit(20), period: "month" }], ...over,
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  const mandate = kit.mk("mandate", sponsor, body, bond.id, { subject: agent.did });
  return { contract: contract.id, bond: bond.id, mandate };
}

/** The job and Bond, then the Mandate put into the log (so a refusal of the Mandate is the one the test sees). */
const tryMandate = async (...a: Parameters<typeof remedialJob>) => kit_put(a[0], (await remedialJob(...a)).mandate);
const kit_put = (kit: Kit, r: Parameters<Kit["put"]>[0]) => kit.put(r);

test("a tier 0 agent sits the Foundations exam under a remedial Mandate, and the retraining release returns it, with nothing placed in the store by hand", async () => {
  const { kit, log, sponsor, agent } = await world();
  const ordinary = await kit.agent("never-slashed", sponsor, 1);
  const stranger = await kit.person("someone-else");

  // 1. A real slash puts the agent at tier 0: the agent backed a bond, the job was revoked, the bond was slashed.
  await kit.mint(agent.did, 60); await kit.mint(sponsor.did, 800); await kit.mint(stranger.did, 50);
  const contract = cosign(kit.mk("contract", sponsor, { principal: sponsor.did, performer: agent.did, bank: bankP.did, purpose: "a job that goes wrong", price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
  await kit.put(contract);
  const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(20), escrow: { payer: sponsor.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await kit.put(bond);
  const m0 = kit.mk("mandate", sponsor, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
  await kit.put(m0);
  const settle = cosign(kit.mk("settlement", bankP, { contract: contract.id, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, m0.id, { subject: contract.id }), sponsor);
  await kit.put(settle);
  const slashedAt = Date.parse(settle.issued_at);
  assert.equal((await log.reputationOf(agent.did))?.tier, 0, "the slash demoted it to tier 0");

  // 2. At tier 0 the ordinary routes are shut: no Mandate, no bond of its own.
  assert.equal(await refused(tryMandate(kit, sponsor, agent, sponsor, { remedial: undefined })), "tier_excluded", "an ordinary Mandate is refused at tier 0, and the refusal names the remedial one");

  // 3. The remedial Mandate is refused wherever it is wider than a retraining needs.
  assert.equal(await refused(tryMandate(kit, sponsor, ordinary, sponsor)), "remedial_not_excluded", "only for an agent at tier 0");
  assert.equal(await refused(tryMandate(kit, sponsor, agent, sponsor, { remedial: { purpose: "clinic_exam", sponsor: stranger.did } })), "remedial_wrong_sponsor");
  assert.equal(await refused(tryMandate(kit, sponsor, agent, sponsor, { scopes: ["repo.read", "repo.push"] })), "remedial_scope_not_read_only");
  assert.equal(await refused(tryMandate(kit, sponsor, agent, sponsor, { scopes: ["repo.read", "web.read"] })), "remedial_scope_not_read_only", "a network scope is not allowed even when it reads");
  assert.equal(await refused(tryMandate(kit, sponsor, agent, sponsor, { spend: { cap: 5, unit: "credit" } })), "remedial_spend_not_zero");
  assert.equal(await refused(tryMandate(kit, sponsor, agent, sponsor, { subcontract: { allowed: true } })), "remedial_not_minimal");
  assert.equal(await refused(tryMandate(kit, sponsor, agent, sponsor, { institution_spend: [{ institution: "shops", cap: credit(5), period: "month" }] })), "remedial_institution");
  assert.equal(await refused(tryMandate(kit, sponsor, agent, sponsor, { expires: iso(Date.parse(kit.now()) + 30 * DAY) })), "remedial_too_long");
  assert.equal(await refused(tryMandate(kit, sponsor, agent, stranger)), "remedial_bond_backer", "the sponsor backs the Bond, not a stranger");
  const ownBond = await refused((async () => { // the agent cannot back its own Bond at tier 0
    const c = cosign(kit.mk("contract", sponsor, { principal: sponsor.did, performer: agent.did, bank: bankP.did, purpose: "x", price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    await kit.put(kit.mk("bond", agent, { contract: c.id, backer: agent.did, amount: credit(5), escrow: { payer: sponsor.did, amount: credit(10) }, slashing_conditions: ["lost_dispute"] }, c.id, { subject: c.id }));
  })());
  assert.equal(ownBond, "tier_excluded");

  // 4. The accepted one: read-only, spend 0, the sponsor backs the Bond.
  const job = await remedialJob(kit, sponsor, agent, sponsor);
  await kit.put(job.mandate);
  kit.jobs.set(agent.did, { contract: job.contract, mandate: job.mandate.id });
  assert.equal(await refused(kit.put(kit.mk("action", agent, { contract: job.contract, scopes_used: ["repo.push"], summary: "writes" }, null, { subject: job.contract }))), "scope_violation", "the run is held to read-only scopes");

  // 5. The Foundations exam under it: a remedial sitting fee (a standard one is refused at tier 0), a run log from the job, the Registrar's result.
  kit.addDays(1);
  await kit.fund(agent, 40);
  assert.equal(await refused(kit.buy(agent, STANDARD_SITTING, 20)), "tier_excluded", "a tier 0 agent buys remedial items only");
  const examId = await kit.defineExam("retraining-foundations", "foundations", 1, { sitting_service: REMEDIAL_SITTING });
  const fee = await kit.buy(agent, REMEDIAL_SITTING, 10);
  const run = await kit.put(kit.mk("action", agent, { contract: job.contract, scopes_used: ["repo.read"], summary: "the exam run" }, null, { subject: job.contract }));
  const seed = examSeed(examId, agent.did, 1);
  const exam = await kit.put(kit.mk("exam_result", registrar, { exam: examId, holder: agent.did, score_permille: 900, pass_mark_permille: 800, passed: true, attempt: 1, variant: examVariant(seed, 40, []), seed, sitting: fee, run_log_hash: run, missed_categories: [] }, null, { subject: agent.did }));
  assert.ok(Date.parse((await log.get(exam))!.record.issued_at) > slashedAt, "the exam was taken after the slash");

  // 6. The path: the sponsor vouches again; the release is refused before 30 days and accepted after; the agent is back at tier 1.
  const vouch = await kit.put(kit.mk("revouch", sponsor, { agent: agent.did, reason: "it sat the exam under a remedial Mandate and I reviewed the run" }, null, { subject: agent.did }));
  const release = () => kit.mk("retraining_release", clinic, { agent: agent.did, exam_result: exam, revouch: vouch }, null, { subject: agent.did });
  assert.equal(await refused(kit.put(release())), "retraining_too_soon");
  kit.addDays(31);
  await kit.put(release());
  assert.deepEqual(await log.reputationOf(agent.did), { tier: 1, slashCount: 1, strikes: 0 }, "back at tier 1; the slash stays on its record");

  // 7. Reopened: an ordinary Mandate is granted again; the remedial one is not a way to buy anything else.
  const again = await remedialJob(kit, sponsor, agent, agent, { remedial: undefined, institution_spend: undefined });
  await kit.put(again.mandate);
  const beforeSpend = kit.mk("purchase", agent, { service: STANDARD_SITTING, institution: academy, price_list: kit.list, quantity: 1, amount: credit(20), mandate: job.mandate.id, idempotency: "after-release" }, null, { subject: agent.did });
  assert.equal(await refused(kit.put(beforeSpend)), "remedial_mandate_buys_remedial_only", "the remedial Mandate buys remedial or essential items only");
  assert.equal((await log.verify()).ok, true, "a replay of the log alone reproduces the whole path");
});
