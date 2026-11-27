/**
 * A team on one contract (register row JO6; spec-delta S1702): the lead states each member's part and share, every other member cosigns, the shares add up to 1000, and when the contract is paid the log pays each
 * member its share of what is released and the lead the rest, so the books balance. Each refusal is named. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bank } from "./harness.ts";
import { credit, kit, mk, refusedBy, type Party } from "./society-kit.ts";

async function world() {
  const k = await kit();
  const principal = await k.person("tm-principal", 5000);
  const lead = await k.agent("tm-lead", await k.person("tm-lead-sponsor", 100), { funds: 2000 });
  const m1 = await k.agent("tm-m1", await k.person("tm-m1-sponsor", 100), { funds: 100 });
  const m2 = await k.agent("tm-m2", await k.person("tm-m2-sponsor", 100), { funds: 100 });
  const split = (contract: string, by: Party, cosigners: Party[], members: { agent: string; share_permille: number; part: string }[], over: Record<string, unknown> = {}) => mk("team_split", by, { contract, members, ...over }, null, { subject: contract, cosigners });
  const trio = (a = 500, b = 300, c = 200) => [{ agent: lead.did, share_permille: a, part: "plans and reviews" }, { agent: m1.did, share_permille: b, part: "writes the parser" }, { agent: m2.did, share_permille: c, part: "writes the tests" }];
  return { k, principal, lead, m1, m2, split, trio };
}

test("JO6: a team is the lead's statement, cosigned by every other member, before delivery and once; its shares add up to 1000 and the members are known and not the principal", async () => {
  const w = await world();
  const j = await w.k.runJob(w.principal, w.lead, 100, undefined, { stopAt: "mandate" });
  const stranger = await w.k.person("tm-stranger", 10);
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.principal, [w.m1, w.m2], w.trio()))), "team_split_not_the_lead", "the principal does not state the team");
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.m1], w.trio()))), "team_split_needs_member_consent", "m2 has not cosigned");
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.m1, stranger], w.trio()))), "team_split_needs_member_consent", "a stranger's cosignature is not m2's");
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.m1, w.m2], w.trio(500, 300, 100)))), "team_split_shares", "900 is not 1000");
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.m1, w.m2], w.trio(500, 400, 200)))), "team_split_shares", "1100 is not 1000");
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.m1], [{ agent: w.m1.did, share_permille: 500, part: "a" }, { agent: w.m2.did, share_permille: 500, part: "b" }]))), "team_split_lead_missing", "the lead is a member of its own team");
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.m1], [{ agent: w.lead.did, share_permille: 500, part: "a" }, { agent: w.lead.did, share_permille: 500, part: "b" }]))), "team_split_duplicate_member");
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.principal], [{ agent: w.lead.did, share_permille: 800, part: "a" }, { agent: w.principal.did, share_permille: 200, part: "b" }]))), "team_split_principal_member", "the principal does not work for itself");
  const ghost = "did:web:example.com:agents:tm-ghost";
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.m1], [{ agent: w.lead.did, share_permille: 800, part: "a" }, { agent: ghost, share_permille: 200, part: "b" }]))), "team_member_unknown");
  assert.equal(await refusedBy(w.k.log.append(w.split("sha256:" + "9".repeat(64), w.lead, [w.m1, w.m2], w.trio()))), "team_split_unknown_contract");
  await w.k.log.append(w.split(j.contract, w.lead, [w.m1, w.m2], w.trio()));
  assert.equal(await refusedBy(w.k.log.append(w.split(j.contract, w.lead, [w.m1, w.m2], w.trio(400, 400, 200)))), "team_split_known", "once");
  const team = await w.k.log.teamOf(j.contract);
  assert.equal(team!.lead, w.lead.did);
  assert.deepEqual(team!.members.map((m) => [m.agent, m.share_permille]), [[w.lead.did, 500], [w.m1.did, 300], [w.m2.did, 200]]);
  assert.equal(await w.k.log.teamOf("sha256:" + "8".repeat(64)), null);
  const late = await w.k.runJob(w.principal, w.lead, 100, undefined, { settle: false });
  assert.equal(await refusedBy(w.k.log.append(w.split(late.contract, w.lead, [w.m1, w.m2], w.trio()))), "team_split_too_late", "after delivery the split is not changed");
});

test("JO6: when the contract is paid the log pays each member its share of what is released and the lead the rest, and the books balance", async () => {
  const w = await world();
  const j = await w.k.runJob(w.principal, w.lead, 100, undefined, { stopAt: "mandate" });
  await w.k.log.append(w.split(j.contract, w.lead, [w.m1, w.m2], w.trio(500, 333, 167)));
  const delivery = mk("delivery", w.lead, { contract: j.contract, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, j.mandate, { subject: j.contract });
  await w.k.log.append(delivery);
  const accept = mk("attestation", w.principal, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: j.contract });
  await w.k.log.append(accept);
  const [l0, a0, b0] = [await w.k.log.balance(w.lead.did), await w.k.log.balance(w.m1.did), await w.k.log.balance(w.m2.did)];
  await w.k.log.append(mk("settlement", bank, { contract: j.contract, basis: "accepted", cites: accept.id, escrow_released: credit(100), fees: credit(2), bond_returned: credit(0), bond_slashed: credit(0) }, accept.id, { subject: j.contract, cosigners: [w.principal] }));
  assert.equal((await w.k.log.balance(w.m1.did)) - a0, 33, "333 permille of 100, rounded down");
  assert.equal((await w.k.log.balance(w.m2.did)) - b0, 16, "167 permille of 100, rounded down");
  assert.equal((await w.k.log.balance(w.lead.did)) - l0, 51, "the lead keeps its 500 permille and the rounding: 100 - 33 - 16");
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced", "what was released is what was paid out");
});

test("JO6: a contract with no team pays the performer all of it, as before", async () => {
  const w = await world();
  const before = await w.k.log.balance(w.lead.did);
  await w.k.runJob(w.principal, w.lead, 100);
  assert.equal((await w.k.log.balance(w.lead.did)) - before, 100);
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced");
});
