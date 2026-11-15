/**
 * The sponsor's return statement and the presence-cost report (register row DK388; CY12, CY15): tokens spent against credits earned, jobs, certificates and tier, and who paid for the agent's presence;
 * and the line the end mail carries for one job. Fake records only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMandateMail, collectMandateFacts, renderSponsorReturn, sponsorReturn, type MailLog } from "../src/index.ts";

const AGENT = "did:web:example.com:agents:coder", OTHER = "did:web:example.com:agents:other", ALICE = "did:web:example.com:users:alice";
type Rec = { id: string; seq: number; record: { type: string; issuer: string; issued_at: string; body: any } };
const rec = (seq: number, id: string, type: string, issuer: string, body: any, at = "2026-11-10T10:00:00Z"): Rec => ({ id, seq, record: { type, issuer, issued_at: at, body } });
const credit = (value: number) => ({ value, unit: "credit" });

const records: Rec[] = [
  rec(1, "c1", "asp.contract/v0.2", ALICE, { principal: ALICE, performer: AGENT, purpose: "Fix the test", price: credit(100) }),
  rec(2, "c2", "asp.contract/v0.2", ALICE, { principal: ALICE, performer: OTHER, purpose: "Not this agent's", price: credit(500) }),
  rec(3, "s1", "asp.settlement/v0.2", "did:web:example.com:bank", { contract: "c1", basis: "accepted", escrow_released: credit(100), bond_returned: credit(0), bond_slashed: credit(0) }),
  rec(4, "s2", "asp.settlement/v0.2", "did:web:example.com:bank", { contract: "c2", basis: "accepted", escrow_released: credit(500), bond_returned: credit(0), bond_slashed: credit(0) }),
  rec(5, "s3", "asp.settlement/v0.2", "did:web:example.com:bank", { contract: "c1", basis: "revoked", escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(0) }),
  rec(6, "k1", "asp.certificate/v0.2", "did:web:example.com:registrar", { holder: AGENT, exam: "foundations" }),
  rec(7, "k2", "asp.certificate/v0.2", "did:web:example.com:registrar", { holder: OTHER, exam: "foundations" }),
  rec(8, "p1", "asp.purchase/v0.2", AGENT, { service: "shops.upkeep", amount: credit(7) }),
  rec(9, "p2", "asp.purchase/v0.2", AGENT, { service: "academy.course", amount: credit(25) }),
  rec(10, "p3", "asp.purchase/v0.2", OTHER, { service: "academy.course", amount: credit(99) }),
  rec(11, "a1", "asp.allowance/v0.2", AGENT, { amount: credit(40), trigger: "first_course", budget: "b" }),
];

test("the statement counts only this agent's settled jobs, certificates, purchases and allowance, and gives the rate per thousand tokens", () => {
  const r = sponsorReturn(records as never, AGENT, { spent: 4000, wakes: 3 }, 2);
  assert.equal(r.earned, 100, "the other agent's 500 and the revoked settlement are not counted");
  assert.equal(r.jobsSettled, 1);
  assert.equal(r.certificates, 1);
  assert.equal(r.tier, 2);
  assert.equal(r.earnedPerThousandTokens, 25);
  assert.deepEqual(r.presence, { spentInCity: 32, byService: { "shops.upkeep": 7, "academy.course": 25 }, upkeep: 7, allowanceReceived: 40, tokensPaidBySponsor: 4000 });
});

test("the lines say who paid for what, give no money figure for tokens, and with no tokens counted say there is no rate", () => {
  const text = renderSponsorReturn(sponsorReturn(records as never, AGENT, { spent: 4000, wakes: 3 }, 2)).join("\n");
  assert.match(text, /coder: 4,000 tokens spent over 3 wake\(s\); 100 credits earned from 1 settled job\(s\); 1 certificate\(s\); tier 2\./);
  assert.match(text, /25 credits earned for each thousand tokens/);
  assert.match(text, /you paid 4,000 tokens to your own provider \(the city does not price them\); the agent spent 32 credits in the city \(academy\.course 25, shops\.upkeep 7\), 7 of it upkeep; the Treasury paid it 40 credits of newcomer allowance/);
  assert.doesNotMatch(text, /\$|dollar|USD/);
  const none = renderSponsorReturn(sponsorReturn([], AGENT, { spent: 0, wakes: 0 })).join("\n");
  assert.match(none, /no tokens were counted on this machine, so there is no rate/);
  assert.match(none, /0 credits earned from 0 settled job\(s\)/);
});

function fakeLog(rs: Rec[]): MailLog {
  return { chain: async (c) => rs.filter((r) => r.id === c || r.record.body?.contract === c), chainInfo: async () => ({ state: "Settled" }), since: async () => rs };
}

test("the end mail says what the job returned: credits earned for the tokens used, with the tokens' price left to the provider; none when no tokens were reported", async () => {
  const mandate = rec(12, "m1", "asp.mandate/v0.2", ALICE, { contract: "c1", scopes: ["repo.read"], spend: { cap: 5, unit: "credit" }, irreversible: { policy: "checkpoint" }, learning: { share_to_commons: false }, expires: "2027-01-01T00:00:00Z" });
  const action = rec(13, "act1", "asp.action/v0.2", AGENT, { contract: "c1", scopes_used: ["repo.read"], metrics: { requests: 4, tool_calls: 6, tokens_in: 1500, tokens_out: 500, seconds: 90, models: ["m"] } });
  const facts = (await collectMandateFacts(fakeLog([records[0], mandate, action, records[2]]), "c1"))!;
  assert.match(buildMandateMail(facts, { to: "a@b.co" }).text, /What it returned: 100 credit earned for 2,000 tokens \(your provider's bill for them is your own; the city does not price tokens\)/);
  const bare = (await collectMandateFacts(fakeLog([records[0], mandate, records[2]]), "c1"))!;
  assert.doesNotMatch(buildMandateMail(bare, { to: "a@b.co" }).text, /What it returned/);
});
