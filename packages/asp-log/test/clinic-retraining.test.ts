// The Clinic's retraining path (DK29, clinic.md CL-10): an agent that repeat slashes excluded (tier 0) is returned to tier 1 only by the whole path: 30 days, a clean exam after the slash, the sponsor's
// re-vouching, and the Clinic's signature; then a Mandate may be granted to it again. Fake keys only.
// The exams are taken while the agent still has a tier (an exam run needs a Mandate and a Bond, which tier 0 cannot get: that gap is register row DK140); the slash is then placed in the log's record
// at the date the scenario needs, so the rules about dates can be tested one by one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore } from "../src/index.ts";
import { Kit, clinic, operator, owner, registrar, treasury, courts, bankP, refused, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const nowOf = (kit: InstanceType<typeof Kit>) => Date.parse((kit as unknown as { tick(): string }).tick());
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const store = new MemoryStore();
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey])));
  const log = new EventLog(store, { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  const kit = new Kit(log);
  const sponsor = await kit.person("retrain-sponsor");
  const agent = await kit.agent("retrain-agent", sponsor, 1);
  const exclude = (slashedAt: string, retrained?: number) => store.transaction(async (tx) => {
    await tx.putReputation({ did: agent.did, tier: 0, slashCount: 2, strikeLog: [] });
    await tx.putMarker(`slashed_at:${agent.did}`, slashedAt);
    if (retrained !== undefined) await tx.putMarker(`retrained:${agent.did}`, String(retrained));
  });
  const revouch = (reason = "reviewed its last 20 runs and its new exam") => kit.put(kit.mk("revouch", sponsor, { agent: agent.did, reason }, null, { subject: agent.did }));
  const release = (exam: string, vouch: string, over: Record<string, unknown> = {}, by: Party = clinic) => kit.mk("retraining_release", by, { agent: agent.did, exam_result: exam, revouch: vouch, ...over }, null, { subject: agent.did });
  return { kit, log, store, sponsor, agent, exclude, revouch, release };
}

test("a tier 0 agent gets no bond; only the sponsor can vouch again; the Clinic returns it only with a clean exam after the slash, the re-vouching and 30 days; then it can be bonded and given a Mandate again", async () => {
  const { kit, log, sponsor, agent, exclude, revouch, release } = await world();
  const stranger = await kit.person("someone-else");
  const ordinary = await kit.agent("never-slashed", sponsor, 1);
  kit.addDays(1);
  const exam = await kit.passedResult(agent, "foundations", 1); // the clean exam, taken after the slash below
  await exclude(iso(nowOf(kit) - 26 * DAY)); // slashed 26 days ago

  // Excluded: no bond, so no job and no Mandate.
  const contract = kit.mk("contract", sponsor, { principal: sponsor.did, performer: agent.did, bank: bankP.did, purpose: "work after retraining", price: { value: 0, unit: "credit" }, verification: "deterministic", deadline: "2027-02-01T00:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: agent.did, cosigners: [agent] });
  await kit.put(contract);
  const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: { value: 0, unit: "credit" }, escrow: { payer: sponsor.did, amount: { value: 0, unit: "credit" } }, slashing_conditions: ["lost_dispute"] }, contract.id, { subject: contract.id });
  assert.equal(await refused(kit.put(bond)), "tier_excluded", "tier 0 takes no bond");

  // Re-vouching: only the sponsor, only for an excluded agent.
  assert.equal(await refused(kit.put(kit.mk("revouch", stranger, { agent: agent.did, reason: "trust me" }, null, { subject: agent.did }))), "revouch_not_the_sponsor");
  assert.equal(await refused(kit.put(kit.mk("revouch", sponsor, { agent: ordinary.did, reason: "no need" }, null, { subject: ordinary.did }))), "revouch_not_excluded");
  const vouch = await revouch();

  // The release: the Clinic only, and each part of the path.
  assert.equal(await refused(kit.put(release(exam, vouch, {}, sponsor))), "retraining_wrong_issuer", "the sponsor cannot release");
  assert.equal(await refused(kit.put(release(exam, vouch))), "retraining_too_soon", "the exam and the re-vouching are in place, but it is 26 days since the slash");
  kit.addDays(9); // 35 days after the slash
  assert.equal(await refused(kit.put(release("sha256:" + "9".repeat(64), vouch))), "retraining_exam_unknown");
  assert.equal(await refused(kit.put(release(exam, contract.id))), "retraining_revouch_unknown", "a record that is not a re-vouching");
  await kit.put(release(exam, vouch));
  assert.deepEqual(await log.reputationOf(agent.did), { tier: 1, slashCount: 2, strikes: 0 }, "back to tier 1; the slashes stay on its record");

  // Reopened: the bond that was refused is accepted and the Mandate is granted.
  await kit.put(bond);
  await kit.put(kit.mk("mandate", sponsor, { contract: contract.id, purpose: "work after retraining", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2027-06-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did }));
  // (verify() is not asserted here: the tier 0 state was placed in the store directly, as repeat slashes would have left it, so a replay from the records alone does not start from it.)
});

test("the path cannot be shortened: another agent's exam, a failed exam, an exam from before the slash, an agent that is not excluded, and a third return are each refused", async () => {
  const { kit, log, sponsor, agent, exclude, revouch, release } = await world();
  const other = await kit.agent("other-agent", sponsor, 1);
  kit.addDays(1);
  const examOld = await kit.passedResult(agent, "foundations", 1);
  const otherExam = await kit.passedResult(other, "foundations", 1);
  await kit.fund(agent, 40);
  const failed = await kit.sit(agent, await kit.defineExam("fail-1", "foundations", 1), 100);
  kit.addDays(9);
  const examNew = await kit.passedResult(agent, "tool-use", 1); // a second exam, so the sitting count of the first does not apply
  await exclude(iso(nowOf(kit) - 5 * DAY)); // the slash falls between the two exams: the old exam is from before it
  const vouch = await revouch("after the slash");
  kit.addDays(26); // 31 days after the slash
  assert.equal(await refused(kit.put(release(otherExam, vouch))), "retraining_exam_not_holders");
  assert.equal(await refused(kit.put(release(failed, vouch))), "retraining_exam_not_passed");
  assert.equal(await refused(kit.put(release(examOld, vouch))), "retraining_exam_before_slash", "an exam from before the slash is not a retraining exam");
  await kit.put(release(examNew, vouch));
  assert.equal((await log.reputationOf(agent.did))?.tier, 1);
  // Not excluded any more: a second release is refused; and after two returns a third is refused.
  assert.equal(await refused(kit.put(release(examNew, vouch))), "retraining_not_excluded");
  await exclude(iso(nowOf(kit) - 40 * DAY), 2);
  assert.equal(await refused(kit.put(release(examNew, vouch))), "retraining_limit", "two returns is the most; a third needs a Court");
});
