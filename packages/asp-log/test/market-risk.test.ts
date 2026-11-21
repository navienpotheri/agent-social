/**
 * The Market's risk model (market.md 13.1; register rows DK1455 and DK43; spec-delta S1404): a versioned model the Treasury publishes and the owner co-signs, a suggested bond and escrow on every offer next to the
 * offered one, a replay of a candidate model over the past, and a kill-switch that restores the previous behaviour. The suggestion is never binding. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DAY, credit, jump, kit, market, mk, nowIso, owner, refusedBy, treasury } from "./society-kit.ts";
import { ZERO_TERMS, onlyRemovesRule, suggestRisk, type RiskTerms } from "../src/market-risk.ts";
import { cosign, createRecord } from "@agent-social/asp-core";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const terms = (over: Partial<RiskTerms> = {}): RiskTerms => ({
  class_permille: { trivial: -50, routine: 0, skilled: 50, critical: 150 }, verification_permille: { deterministic: -80, principal: 0, arbiter: 40 }, poster_permille: 120, escrow_share_permille: 800, ...over,
});

describe("the suggestion (pure)", () => {
  test("floor plus class, verification and poster terms, capped between 0 and the whole price; the bond rounds up; no model is the floor and the whole price", () => {
    const i = { price: 100, floorPermille: 300, jobClass: "routine" as const, verification: "principal" as const, posterLostPermille: 0 };
    assert.deepEqual(suggestRisk(null, i), { bondPermille: 300, bond: 30, escrow: 100, parts: { floor: 300, class: 0, verification: 0, poster: 0 } });
    assert.deepEqual(suggestRisk(terms(), { ...i, jobClass: "critical", verification: "arbiter", posterLostPermille: 1000 }), { bondPermille: 610, bond: 61, escrow: 80, parts: { floor: 300, class: 150, verification: 40, poster: 120 } });
    assert.equal(suggestRisk(terms(), { ...i, floorPermille: 950, jobClass: "critical", verification: "arbiter", posterLostPermille: 1000 }).bondPermille, 1000, "never above the whole price");
    assert.equal(suggestRisk(terms({ class_permille: { trivial: -200, routine: -200, skilled: -200, critical: -200 } }), { ...i, floorPermille: 50, verification: "deterministic" }).bondPermille, 0, "never below zero");
    assert.equal(suggestRisk(terms(), { ...i, price: 7, floorPermille: 333 }).bond, Math.ceil((7 * 333) / 1000));
    assert.deepEqual(ZERO_TERMS.class_permille, { trivial: 0, routine: 0, skilled: 0, critical: 0 });
    assert.equal(onlyRemovesRule(terms(), ZERO_TERMS), false, "zero raises the negative terms (-50, -80): a model that gave a discount is not only removed by it");
    assert.equal(onlyRemovesRule(terms({ class_permille: { trivial: 0, routine: 0, skilled: 50, critical: 150 }, verification_permille: { deterministic: 0, principal: 0, arbiter: 40 } }), ZERO_TERMS), true);
  });
});

describe("the model record in the log", () => {
  const publish = (version: number, t: RiskTerms, effective: string, cosigners = [owner], by = treasury, at?: string) =>
    mk("market_act", by, { act: "risk_model", model_version: version, terms: t, effective_from: effective }, null, { cosigners: cosigners as never, ...(at ? { at } : {}) });

  test("only the Treasury publishes; the first version needs the owner; versions run 1, 2, 3; a model is not retroactive", async () => {
    const k = await kit();
    const at = nowIso();
    assert.equal(await refusedBy(k.log.append(publish(1, terms(), iso(Date.parse(at) + DAY), [owner], market as never))), "risk_model_wrong_issuer");
    assert.equal(await refusedBy(k.log.append(publish(1, terms(), iso(Date.parse(at) + DAY), []))), "risk_model_needs_cosign");
    assert.equal(await refusedBy(k.log.append(publish(2, terms(), iso(Date.parse(at) + DAY)))), "risk_model_version");
    assert.equal(await refusedBy(k.log.append(publish(1, terms(), iso(Date.parse(at) - 3 * DAY)))), "risk_model_retroactive");
    await k.log.append(publish(1, terms(), iso(Date.parse(nowIso()) + 60_000)));
    assert.equal(await refusedBy(k.log.append(publish(1, terms(), iso(Date.parse(nowIso()) + DAY)))), "risk_model_version", "a version is published once");
    assert.equal((await k.log.riskModel(iso(Date.parse(at) + 5 * DAY)))?.version, 1);
    assert.equal(await k.log.riskModel(iso(Date.parse(at) - DAY)), null, "before its effective time there is no model in force");
  });

  test("a model that adds a term takes effect 72 hours after it is published; one that only removes rule (the kill-switch) may take effect at once, and the previous behaviour returns", async () => {
    const k = await kit();
    const plain = terms({ class_permille: { trivial: 0, routine: 0, skilled: 50, critical: 150 }, verification_permille: { deterministic: 0, principal: 0, arbiter: 40 } });
    await k.log.append(publish(1, plain, iso(Date.parse(nowIso()) + 60_000)));
    const now = Date.parse(nowIso());
    const harsher = { ...plain, poster_permille: 200 };
    assert.equal(await refusedBy(k.log.append(publish(2, harsher, iso(now + 71 * 3600_000)))), "risk_model_notice");
    await k.log.append(publish(2, harsher, iso(Date.parse(nowIso()) + 72 * 3600_000 + 120_000)));
    // the kill-switch: a model with no extra term, effective at once, needs no notice and no owner
    const killed = await k.log.append(publish(3, ZERO_TERMS, iso(Date.parse(nowIso()) + 60_000), []));
    void killed;
    const later = iso(Date.parse(nowIso()) + 2 * 3600_000);
    assert.equal((await k.log.riskModel(later))?.version, 3);
    assert.deepEqual((await k.log.riskModel(later))?.terms, ZERO_TERMS);
    // a log replays the same
    assert.equal((await k.log.verify()).ok, true);
  });
});

describe("the suggestion on an offer, and the replay", () => {
  async function world() {
    const k = await kit();
    await k.withPrices();
    const poster = await k.person("risk-poster", 5000);
    const sponsor = await k.person("risk-sponsor", 50);
    const worker = await k.agent("risk-worker", sponsor, { funds: 500 });
    const intent = await k.intent(poster, { budget: credit(80), class: "skilled" });
    const offer = await k.offer(worker, intent, 80);
    return { ...k, k, poster, worker, intent, offer };
  }

  test("with no model the suggestion is the performer's floor and the whole price; with one it adds the terms, and it is never binding", async () => {
    const w = await world();
    const none = await w.log.suggestedBond(w.offer);
    assert.equal(none.modelVersion, null);
    assert.equal(none.suggestion.escrow, 80);
    assert.deepEqual(none.suggestion.parts, { floor: none.input.floorPermille, class: 0, verification: 0, poster: 0 });
    await w.log.append(mk("market_act", treasury, { act: "risk_model", model_version: 1, terms: terms(), effective_from: iso(Date.parse(nowIso()) + 60_000) }, null, { cosigners: [owner] }));
    const at = iso(Date.parse(nowIso()) + DAY);
    const s = await w.log.suggestedBond(w.offer, at);
    assert.equal(s.modelVersion, 1);
    assert.equal(s.input.jobClass, "skilled", "the intent declares a skilled job");
    assert.equal(s.suggestion.parts.class, 50);
    assert.equal(s.suggestion.parts.verification, 0, "principal verification");
    assert.equal(s.suggestion.escrow, Math.ceil((80 * 800) / 1000), "the model's escrow share");
    assert.equal(s.offered, 0, "the offer itself offers no bond");
    // never binding: a job with a bond of zero, below the suggestion, still runs to settlement
    const job = await w.runJob(w.poster, w.worker, 80, { intent: w.intent, offer: w.offer });
    assert.ok(job.contract);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    await assert.rejects(w.log.suggestedBond("sha256:" + "0".repeat(64)), /not an offer/);
  });

  test("the replay says what a model would lock against what was locked, and whether it would have locked more on the jobs that were slashed", async () => {
    const w = await world();
    await w.runJob(w.poster, w.worker, 80, { intent: w.intent, offer: w.offer });
    const later = iso(Date.parse(nowIso()) + 3600_000);
    const zero = await w.log.riskReplay(null, 90, later);
    assert.equal(zero.contracts, 1);
    assert.equal(zero.lockedActual, 0, "the bond that was locked was zero");
    const strict = await w.log.riskReplay(terms({ class_permille: { trivial: 0, routine: 100, skilled: 300, critical: 300 } }), 90, later);
    assert.ok(strict.lockedSuggested > zero.lockedSuggested, "a stricter model would have locked more");
    assert.ok(strict.maxSuggestedPermille <= 1000, "and never more than the price: an absurd model shows here before it is published");
    assert.equal(strict.contracts, 1);
    const narrow = await w.log.riskReplay(terms(), 1, iso(Date.parse(nowIso()) + 40 * DAY));
    assert.equal(narrow.contracts, 0, "a window that holds no settlement");
  });

  test("a slash is counted, and the replay says whether the model would have locked more on that job than was locked", async () => {
    const { Kit, bankP, credit: cr, hashOf, operator: op, owner: ow, treasury: tr, registrar, clinic, courts } = await import("./academy-kit.ts");
    const { staticResolver } = await import("@agent-social/asp-core");
    const { EventLog, MemoryStore } = await import("../src/index.ts");
    const resolver = staticResolver(Object.fromEntries([op, ow, tr, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey])));
    const kit = new Kit(new EventLog(new MemoryStore(), { operator: op.did, owner: ow.did, fallbackResolver: resolver }));
    const principal = await kit.person("rr-principal"); await kit.mint(principal.did, 1000);
    const sponsor = await kit.person("rr-sponsor");
    const agent = await kit.agent("rr-agent", sponsor, 1); await kit.mint(agent.did, 100);
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: "a slashed job", price: cr(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    const bond = kit.mk("bond", agent, { contract: c.id, backer: agent.did, amount: cr(20), escrow: { payer: principal.did, amount: cr(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c.id, { subject: c.id });
    await kit.put(bond);
    const mandate = kit.mk("mandate", principal, { contract: c.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
    await kit.put(mandate);
    await kit.put(cosign(kit.mk("settlement", bankP, { contract: c.id, basis: "revoked", pro_rata_permille: 0, escrow_released: cr(0), bond_returned: cr(0), bond_slashed: cr(20) }, mandate.id, { subject: c.id }), principal));
    const at = new Date(Date.parse(kit.now()) + 3600_000).toISOString().replace(".000Z", "Z");
    const none = await kit.log.riskReplay(null, 90, at);
    assert.deepEqual([none.contracts, none.slashes, none.slashedCredits, none.lockedActual], [1, 1, 20, 20]);
    assert.equal(none.suggestionWouldLockMoreOnSlashed, 1, "no model: the performer's floor alone is above the 20 that was locked");
    assert.equal(none.lockedSuggested, 65, "read on today's records: the slash since raised the performer's floor to 650 permille");
    const strict = await kit.log.riskReplay(terms({ class_permille: { trivial: 0, routine: 400, skilled: 0, critical: 0 }, verification_permille: { deterministic: 300, principal: 0, arbiter: 0 } }), 90, at);
    assert.ok(strict.lockedSuggested > none.lockedSuggested, `a strict model would have locked ${strict.lockedSuggested} against ${none.lockedSuggested} with none`);
    assert.equal(strict.suggestionWouldLockMoreOnSlashed, 1, "it would have locked more on the job that was slashed");
  });

  test("the public routes serve the model in force and the suggestion for an offer; a missing offer is 400, an unknown one 404", async () => {
    const w = await world();
    const { publicReply } = await import("../src/public-pages.ts");
    assert.equal((await publicReply(w.log, "/market/risk-model", false))?.status, 200);
    const r = await publicReply(w.log, `/market/suggest?offer=${w.offer}`, false);
    assert.equal(r?.status, 200);
    assert.equal((r?.json as { result: { suggestion: { escrow: number } } }).result.suggestion.escrow, 80);
    assert.equal((await publicReply(w.log, "/market/suggest", false))?.status, 400);
    assert.equal((await publicReply(w.log, `/market/suggest?offer=sha256:${"0".repeat(64)}`, false))?.status, 404);
  });
});
void jump; void createRecord;
