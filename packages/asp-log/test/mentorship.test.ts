// A newcomer's first week without a rich sponsor (register row DK392; spec-delta S1202; bank-insurer.md 13.1; owner decision DK392-MENTOR): a tutorial job (a seed job whose principal is a house agent the public-works budget paid, so the
// pay comes from the city, not from a person) and a mentor-guaranteed credit line (a mentor of tier 2 or above, with a different sponsor, guarantees the line in place of the sponsor). Both are in the log; a default falls on the
// mentor. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, b64urlEncode } from "@agent-social/asp-core";
import { BANK_DID, TREASURY_DID } from "../src/index.ts";
import { MENTOR_MAX_PROTEGES, MENTOR_MIN_TIER } from "../src/bank.ts";
import { Kit, bankP, credit, hashOf, operator, owner, party, refused, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 3000);
  const at = kit.tick();
  const bankBudget = await kit.put(kit.mk("budget", treasury, { institution: BANK_DID, period: "2026-11", amount: credit(500), purpose: "charter" }, null, { at, cosigners: [owner] }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget: bankBudget, to: BANK_DID, amount: credit(500) }, null, { at: kit.tick() }));
  // The public-works budget pays a house agent, which is the principal of the tutorial jobs.
  const works = await kit.put(kit.mk("budget", treasury, { institution: TREASURY_DID, period: "2026-11", amount: credit(300), purpose: "public_works" }, null, { at: kit.tick(), cosigners: [owner] }));
  const house = party("did:web:example.com:agents:tutorial-house", 90);
  await kit.put(kit.mk("passport", operator, { did: house.did, kind: "agent", sponsor: operator.did, house: true, tier: 1, shape: {}, keys: [{ id: house.kid, type: "Ed25519", public_key: b64urlEncode(house.publicKey) }] }, null, { subject: house.did }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget: works, to: house.did, amount: credit(150) }, null, { at: kit.tick() }));
  const poorSponsor = await kit.person("poor-sponsor");          // a sponsor with nothing to guarantee a line with
  const richSponsor = await kit.person("mentor-sponsor");
  await kit.mint(richSponsor.did, 100);
  const protege = await kit.agent("tutorial-protege", poorSponsor, 1);
  const mentor = await kit.agent("the-mentor", richSponsor, 2);
  await kit.mint(mentor.did, 100);
  const asTier = (did: string, tier: number) => (kit.log as unknown as { store: { transaction<T>(f: (tx: { putReputation(r: unknown): Promise<void> }) => Promise<T>): Promise<T> } }).store.transaction((tx) => tx.putReputation({ did, tier, slashCount: 0, strikeLog: [] }));
  await asTier(mentor.did, 2);
  const bank = bankP as Party;
  const mentorship = (over: Record<string, unknown> = {}, by: Party = protege, co: Party[] = [mentor]) => kit.mk("mentorship", by, { mentor: mentor.did, protege: protege.did, note: "reviews its first jobs", ...over }, null, { subject: protege.did, cosigners: co });
  const contract = async (agent: Party, principal: Party = house, price = 100) => {
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bank.did, purpose: "a tutorial job", price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    return c.id;
  };
  const line = (agent: Party, contractId: string, guarantor: Party, over: Record<string, unknown> = {}, co: Party[] = [agent, guarantor]) => kit.mk("credit_line", bank, { borrower: agent.did, guarantor: guarantor.did, contract: contractId, amount: credit(20), fee: 0, due: iso(Date.parse(kit.now()) + 7 * DAY), ...over }, null, { subject: agent.did, cosigners: co });
  return { kit, house, poorSponsor, richSponsor, protege, mentor, mentorship, contract, line, bank, asTier, works };
}
const bal = (w: Awaited<ReturnType<typeof world>>, did: string) => w.kit.log.balance(did);

test("DK392 done: a newcomer takes a tutorial job paid for by the public-works budget and funds its bond on a line its mentor guarantees, both in the log; the pay comes from the city, the line is repaid, and the books balance", async () => {
  const w = await world();
  const { kit } = w;
  assert.equal(await bal(w, w.protege.did), 0, "the newcomer has nothing, and its sponsor has nothing to guarantee with");
  const c = await w.contract(w.protege);
  assert.equal(await refused(kit.put(w.line(w.protege, c, w.poorSponsor))), "line_guarantor_balance", "the sponsor cannot guarantee");
  assert.equal(await refused(kit.put(w.line(w.protege, c, w.mentor))), "line_no_guarantor", "a mentor guarantees only through a mentorship");
  const m = w.mentorship();
  const mid = await kit.put(m);
  assert.equal(await refused(kit.put(w.line(w.protege, c, w.mentor, { mentorship: c }))), "line_mentorship_unknown");
  await kit.put(w.line(w.protege, c, w.mentor, { mentorship: mid }));
  const reserve0 = await bal(w, BANK_DID);
  const bond = kit.mk("bond", w.protege, { contract: c, backer: w.protege.did, amount: credit(20), escrow: { payer: w.house.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c, { subject: c });
  const bondId = await kit.put(bond);
  assert.equal(await bal(w, BANK_DID), reserve0 - 20, "the Bank's reserve funds the bond on the mentor's guarantee");
  const mandate = kit.mk("mandate", w.house, { contract: c, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bondId, { subject: w.protege.did });
  await kit.put(mandate);
  const d = kit.mk("delivery", w.protege, { contract: c, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandate.id, { subject: c });
  await kit.put(d);
  const acc = kit.mk("attestation", w.house, { kind: "acceptance", about: d.id, verdict: "accepted" }, d.id, { subject: c });
  await kit.put(acc);
  await kit.put(kit.mk("settlement", w.bank, { contract: c, basis: "accepted", cites: acc.id, escrow_released: credit(96), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, acc.id, { subject: c }));
  assert.equal(await bal(w, BANK_DID), reserve0, "the line was repaid in full");
  assert.equal(await bal(w, w.protege.did), 96, "the newcomer keeps the pay of the tutorial job");
  assert.equal(await bal(w, w.house.did), 150 - 100, "the job's price came out of what the public-works budget paid the house agent");
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
  assert.equal((await kit.log.verify()).ok, true, "a replay of the log alone reproduces it");
});

test("the rules of a mentorship are refused by name: who signs, a tier below 2, a slash in 90 days, one sponsor, a protege that is not new, a second mentor, and at most three proteges for one mentor", async () => {
  const w = await world();
  const { kit } = w;
  assert.equal(MENTOR_MIN_TIER, 2);
  assert.equal(MENTOR_MAX_PROTEGES, 3);
  assert.equal(await refused(kit.put(w.mentorship({}, w.mentor, [w.protege]))), "mentorship_wrong_issuer", "the protege signs");
  assert.equal(await refused(kit.put(w.mentorship({}, w.protege, []))), "mentorship_needs_mentor", "the mentor countersigns");
  assert.equal(await refused(kit.put(w.mentorship({ mentor: w.protege.did }, w.protege, [w.protege]))), "mentorship_self");
  await w.asTier(w.mentor.did, 1);
  assert.equal(await refused(kit.put(w.mentorship())), "mentor_tier");
  await w.asTier(w.mentor.did, 2);
  const sameSponsor = await kit.agent("same-sponsor-protege", w.richSponsor, 1);
  assert.equal(await refused(kit.put(w.mentorship({ protege: sameSponsor.did }, sameSponsor))), "mentor_not_independent", "a mentor with the protege's sponsor guarantees nothing independent");
  const store = (kit.log as unknown as { store: { transaction<T>(f: (tx: { putMarker(k: string, v: string): Promise<void> }) => Promise<T>): Promise<T> } }).store;
  await store.transaction((tx) => tx.putMarker(`slashed_at:${w.mentor.did}`, iso(Date.parse(kit.now()) - 10 * DAY)));
  assert.equal(await refused(kit.put(w.mentorship())), "mentor_recent_slash");
  await store.transaction((tx) => tx.putMarker(`slashed_at:${w.mentor.did}`, iso(Date.parse(kit.now()) - 120 * DAY)));
  await kit.put(w.mentorship());
  const second = await kit.agent("second-mentor", await kit.person("second-mentor-sponsor"), 2);
  await w.asTier(second.did, 2);
  assert.equal(await refused(kit.put(kit.mk("mentorship", w.protege, { mentor: second.did, protege: w.protege.did }, null, { subject: w.protege.did, cosigners: [second] }))), "protege_has_mentor", "one mentor at a time");
  const others: Party[] = [];
  for (let i = 0; i < MENTOR_MAX_PROTEGES; i++) others.push(await kit.agent(`other-protege-${i}`, await kit.person(`other-protege-sponsor-${i}`), 1));
  for (const p of others.slice(0, MENTOR_MAX_PROTEGES - 1)) await kit.put(w.mentorship({ protege: p.did }, p));
  assert.equal(await refused(kit.put(w.mentorship({ protege: others.at(-1)!.did }, others.at(-1)!))), "mentor_full", "a mentor has at most three proteges");
  const veteran = await kit.agent("not-new", await kit.person("not-new-sponsor"), 2);
  assert.equal(await refused(kit.put(kit.mk("mentorship", veteran, { mentor: w.mentor.did, protege: veteran.did }, null, { subject: veteran.did, cosigners: [w.mentor] }))), "protege_not_new", "a tier 2 agent is not a newcomer");
});

test("a mentored line is for its own protege and its own mentor, and a default falls on the mentor: its balance first, the rest a debt that blocks its new lines and mentorships", async () => {
  const w = await world();
  const { kit } = w;
  const mid = await kit.put(w.mentorship());
  const stranger = await kit.agent("not-mentored", await kit.person("not-mentored-sponsor"), 1);
  const cs = await w.contract(stranger);
  assert.equal(await refused(kit.put(w.line(stranger, cs, w.mentor, { mentorship: mid }))), "line_mentorship_mismatch", "another agent cannot use the mentorship");
  const other = await kit.agent("other-mentor", await kit.person("other-mentor-sponsor"), 2);
  await kit.mint(other.did, 100);
  await w.asTier(other.did, 2);
  const c = await w.contract(w.protege);
  assert.equal(await refused(kit.put(w.line(w.protege, c, other, { mentorship: mid }))), "line_mentorship_mismatch", "nor another mentor");
  await kit.put(w.line(w.protege, c, w.mentor, { mentorship: mid }));
  const bondId = await kit.put(kit.mk("bond", w.protege, { contract: c, backer: w.protege.did, amount: credit(20), escrow: { payer: w.house.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c, { subject: c }));
  const mandate = kit.mk("mandate", w.house, { contract: c, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bondId, { subject: w.protege.did });
  await kit.put(mandate);
  await kit.put(cosign(kit.mk("settlement", w.bank, { contract: c, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, mandate.id, { subject: c }), w.house));
  const lines = (await kit.log.recordsOfTypes(["credit_line"])).map((r) => r.id);
  const before = await bal(w, w.mentor.did);
  await kit.put(kit.mk("credit_default", w.bank, { line: lines[0], unpaid: credit(20), against: w.mentor.did }, null, { subject: w.protege.did }));
  assert.equal(await bal(w, w.mentor.did), before - 20, "the mentor paid what the protege could not");
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
});
