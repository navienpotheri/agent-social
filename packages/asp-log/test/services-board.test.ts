// DK660 (S970; owner decision SB1): the society services board is separate from the real-work job board: agents hire agents for in-society services in mock credits, at a capped price, under a read-only
// Mandate, between different owners, paid through the ordinary escrow and job tax. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { SERVICE_PRICE_MAX } from "../src/index.ts";
import { DAY, credit, kit, mk, refusedBy } from "./society-kit.ts";
import { bank } from "./harness.ts";

async function world() {
  const k = await kit();
  await k.withPrices();
  const s1 = await k.person("sb-sponsor-1", 100);
  const s2 = await k.person("sb-sponsor-2", 100);
  const buyer = await k.agent("sb-buyer", s1, { funds: 300 });
  const teacher = await k.agent("sb-teacher", s2, { funds: 50 });
  const sibling = await k.agent("sb-sibling", s1, { funds: 50 });
  const mandate = await k.openMandate(buyer, [{ institution: "market", cap: credit(30), period: "month" }]);
  const expires = new Date(Date.parse("2026-11-01T00:00:00Z") + 400 * DAY).toISOString().replace(".000Z", "Z");
  const post = async (intentId: string, board: "main" | "services") => {
    const deposit = await k.buy(buyer, "market.posting.deposit", 2, { mandate });
    return mk("market_act", buyer, { act: "posting", intent: intentId, board, expires, deposit });
  };
  return { k, s1, s2, buyer, teacher, sibling, mandate, post };
}

test("the boards are separate: a service goes only on the services board, a real job only on the main one, and a service costs at most 100", async () => {
  const w = await world();
  const svc = await w.k.intent(w.buyer, { service: "teaching", budget: credit(40), purpose: "Teach me the course on lessons" });
  assert.equal(await refusedBy(w.k.log.append(await w.post(svc, "main"))), "service_on_wrong_board");
  const job = await w.k.intent(w.buyer, { purpose: "Translate forty product descriptions" });
  assert.equal(await refusedBy(w.k.log.append(await w.post(job, "services"))), "services_board_needs_service");
  const dear = await w.k.intent(w.buyer, { service: "drill", budget: credit(SERVICE_PRICE_MAX + 1), purpose: "An expensive drill" });
  assert.equal(await refusedBy(w.k.log.append(await w.post(dear, "services"))), "service_price_cap");
  const posting = await w.post(svc, "services");
  await w.k.log.append(posting);
  assert.deepEqual((await w.k.log.marketBoard()).map((e) => e.posting), [], "the main board does not show a service");
  const board = await w.k.log.marketBoard(undefined, undefined, { board: "services" });
  assert.deepEqual(board.map((e) => [e.posting, e.board, e.service, e.budget]), [[posting.id, "services", "teaching", 40]]);
});

test("between different owners only, under a read-only Mandate, paid through the ordinary escrow; the books balance", async () => {
  const w = await world();
  const svc = await w.k.intent(w.buyer, { service: "study_partner", budget: credit(40), purpose: "Study the Academy course together" });
  const posting = await w.post(svc, "services");
  await w.k.log.append(posting);
  const offer = await w.k.offer(w.teacher, svc, 40);
  const sibOffer = await w.k.offer(w.sibling, svc, 40);
  assert.equal(await refusedBy(w.k.log.append(mk("market_act", w.sibling, { act: "bid", posting: posting.id, offer: sibOffer }))), "bid_same_owner", "an owner's own agents are not a market");
  await w.k.log.append(mk("market_act", w.teacher, { act: "bid", posting: posting.id, offer }));

  // The contract and its Mandate: a write or network scope, a spend cap or subcontracting is refused for a service.
  const contract = cosign(mk("contract", w.buyer, { principal: w.buyer.did, performer: w.teacher.did, bank: bank.did, purpose: "Study the Academy course together", price: credit(40), verification: "principal", deadline: "2027-12-03T18:00:00Z", basis: { intent: svc, offer } }, null, { subject: w.teacher.did }), w.teacher as Signer);
  await w.k.log.append(contract);
  const bond = mk("bond", w.teacher, { contract: contract.id, backer: w.teacher.did, amount: credit(0), escrow: { payer: w.buyer.did, amount: credit(40) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await w.k.log.append(bond);
  const mandate = (over: Record<string, unknown>) => mk("mandate", w.buyer, { contract: contract.id, purpose: "Study together", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2027-12-03T18:00:00Z", revocable: true, ...over }, bond.id, { subject: w.teacher.did });
  assert.equal(await refusedBy(w.k.log.append(mandate({ scopes: ["repo.read", "repo.write"] }))), "service_mandate_in_society_only");
  assert.equal(await refusedBy(w.k.log.append(mandate({ spend: { cap: 5, unit: "credit" } }))), "service_mandate_in_society_only");
  assert.equal(await refusedBy(w.k.log.append(mandate({ subcontract: { allowed: true } }))), "service_mandate_in_society_only");
  await w.k.log.append(mandate({}));

  // The money moves only through the ordinary contract: a job between these two agents pays through escrow with the job tax, never as a free transfer.
  const paid = await w.k.runJob(w.buyer, w.teacher, 40);
  assert.ok(paid.contract);
  assert.equal(await w.k.log.balance(w.teacher.did), 50 + 40, "the performer is paid the price");
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced");
});
