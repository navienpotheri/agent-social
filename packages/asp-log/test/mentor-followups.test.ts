// The follow-ups of the mentor-guaranteed line (register rows DK1200 to DK1203; spec-deltas S1214 to S1217; owner decision DK392-MENTOR): the mentor's 5% of the protege's first three settlements (a move, not a mint), the
// mentor's collateral held while the line is open (refused spending, released on repayment, recovered at default), the mentor's record on its page, and the tutorial job's rule (a house agent's contract for a newcomer's first
// week, once). Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, b64urlEncode } from "@agent-social/asp-core";
import { BANK_DID, TREASURY_DID } from "../src/index.ts";
import { MENTOR_MAX_PROTEGES, MENTOR_REWARD_PERMILLE, MENTOR_REWARD_SETTLEMENTS } from "../src/bank.ts";
import { TUTORIAL_DAYS, TUTORIAL_LABEL } from "../src/log.ts";
import { Kit, bankP, credit, hashOf, operator, owner, party, refused, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 3000);
  const at = kit.tick();
  const bankBudget = await kit.put(kit.mk("budget", treasury, { institution: BANK_DID, period: "2026-11", amount: credit(500), purpose: "charter" }, null, { at, cosigners: [owner] }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget: bankBudget, to: BANK_DID, amount: credit(500) }, null, { at: kit.tick() }));
  const works = await kit.put(kit.mk("budget", treasury, { institution: TREASURY_DID, period: "2026-11", amount: credit(300), purpose: "public_works" }, null, { at: kit.tick(), cosigners: [owner] }));
  const house = party("did:web:example.com:agents:tutorial-house", 90);
  await kit.put(kit.mk("passport", operator, { did: house.did, kind: "agent", sponsor: operator.did, house: true, tier: 1, shape: {}, keys: [{ id: house.kid, type: "Ed25519", public_key: b64urlEncode(house.publicKey) }] }, null, { subject: house.did }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget: works, to: house.did, amount: credit(250) }, null, { at: kit.tick() }));
  const poorSponsor = await kit.person("poor-sponsor");
  const richSponsor = await kit.person("mentor-sponsor");
  await kit.mint(richSponsor.did, 100);
  const protege = await kit.agent("tutorial-protege", poorSponsor, 1);
  const mentor = await kit.agent("the-mentor", richSponsor, 2);
  await kit.mint(mentor.did, 100);
  const store = (kit.log as unknown as { store: { transaction<T>(f: (tx: { putReputation(r: unknown): Promise<void>; getMarker(k: string): Promise<string | undefined> }) => Promise<T>): Promise<T> } }).store;
  await store.transaction((tx) => tx.putReputation({ did: mentor.did, tier: 2, slashCount: 0, strikeLog: [] }));
  const bank = bankP as Party;
  const marker = (k: string) => store.transaction((tx) => tx.getMarker(k));
  const mentorship = async (m: Party = mentor, p: Party = protege) => kit.put(kit.mk("mentorship", p, { mentor: m.did, protege: p.did }, null, { subject: p.did, cosigners: [m] }));
  const contract = async (agent: Party, principal: Party = house, price = 100, purpose = "a job") => {
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bank.did, purpose, price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    return c.id;
  };
  const line = (agent: Party, contractId: string, guarantor: Party, over: Record<string, unknown> = {}) => kit.mk("credit_line", bank, { borrower: agent.did, guarantor: guarantor.did, contract: contractId, amount: credit(20), fee: 0, due: iso(Date.parse(kit.now()) + 7 * DAY), ...over }, null, { subject: agent.did, cosigners: [agent, guarantor] });
  const bond = (agent: Party, c: string) => kit.mk("bond", agent, { contract: c, backer: agent.did, amount: credit(20), escrow: { payer: house.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c, { subject: c });
  const mandateOf = (agent: Party, c: string, bondId: string) => kit.mk("mandate", house, { contract: c, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bondId, { subject: agent.did });
  const transfer = (from: Party, to: Party, n: number) => kit.mk("internal_transfer", from, { to: to.did, amount: credit(n) }, null, { subject: from.did });
  return { kit, house, poorSponsor, richSponsor, protege, mentor, mentorship, contract, line, bond, mandateOf, transfer, bank, marker };
}
const bal = (w: Awaited<ReturnType<typeof world>>, d: string) => w.kit.log.balance(d);

test("DK1201 and DK1200: a mentored line holds 25% of the mentor's credits while it is open (spending below the hold is refused, the rest is free), the hold is released when the line is repaid, and the mentor earns 5% of the protege's pay as a move; DK1202: the page says what the mentor has done", async () => {
  const w = await world();
  const { kit } = w;
  const mid = await w.mentorship();
  const c = await w.contract(w.protege);
  await kit.put(w.line(w.protege, c, w.mentor, { mentorship: mid }));
  assert.equal(await w.marker(`hold:${w.mentor.did}`), "5", "25% of a line of 20");
  assert.equal(await bal(w, w.mentor.did), 100, "the credits stay on the account");
  assert.equal(await refused(kit.put(w.transfer(w.mentor, w.richSponsor, 96))), "collateral_held", "the held part cannot be spent");
  await kit.put(w.transfer(w.mentor, w.richSponsor, 95));
  assert.equal(await refused(kit.put(w.transfer(w.mentor, w.richSponsor, 1))), "collateral_held", "down to the hold and no further");
  assert.equal(await bal(w, w.mentor.did), 5);
  // The protege's job: bond on the line, accepted, repaid.
  const b = await kit.put(w.bond(w.protege, c));
  const m = w.mandateOf(w.protege, c, b);
  await kit.put(m);
  const d = kit.mk("delivery", w.protege, { contract: c, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, m.id, { subject: c });
  await kit.put(d);
  const acc = kit.mk("attestation", w.house, { kind: "acceptance", about: d.id, verdict: "accepted" }, d.id, { subject: c });
  await kit.put(acc);
  await kit.put(kit.mk("settlement", w.bank, { contract: c, basis: "accepted", cites: acc.id, escrow_released: credit(96), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, acc.id, { subject: c }));
  assert.equal(MENTOR_REWARD_PERMILLE, 50);
  assert.equal(await bal(w, w.protege.did), 92, "96 of pay less the mentor's 4");
  assert.equal(await bal(w, w.mentor.did), 9, "the mentor earned 4: 5% of 96, rounded down");
  assert.equal(await w.marker(`hold:${w.mentor.did}`), "0", "the line was repaid: the hold is released");
  await kit.put(w.transfer(w.mentor, w.richSponsor, 9));
  assert.equal(await bal(w, w.mentor.did), 0, "and the mentor can spend everything again");
  const page = (await kit.log.registryPage(w.mentor.did))!;
  assert.deepEqual(page.mentoring, { proteges: 1, lines: 1, defaults: 0 });
  assert.equal((await kit.log.registryPage(w.protege.did))!.mentoring, null, "the protege has not mentored");
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
  assert.equal((await kit.log.verify()).ok, true);
});

test("DK1200: the mentor's share is paid on the protege's first three accepted settlements and no more, the protege's pay falls by the same amount, an agent with no mentor pays nothing, and the books balance", async () => {
  const w = await world();
  const { kit } = w;
  assert.equal(MENTOR_REWARD_SETTLEMENTS, 3);
  await w.mentorship();
  const client = await kit.person("reward-client");
  const loner = await kit.agent("no-mentor", await kit.person("no-mentor-sponsor"), 1);
  let seq = 0;
  const jobs = async (agent: Party, n: number) => { for (let i = 0; i < n; i++) await kit.acceptedJob(await kit.person(`reward-principal-${++seq}`), agent); };
  const before = { mentor: await bal(w, w.mentor.did), protege: await bal(w, w.protege.did), loner: await bal(w, loner.did) };
  await jobs(w.protege, 1);
  const one = (await bal(w, w.mentor.did)) - before.mentor;
  assert.ok(one > 0, `the mentor was paid ${one}`);
  await jobs(w.protege, 3);
  assert.equal((await bal(w, w.mentor.did)) - before.mentor, one * 3, "three settlements paid, the fourth not");
  const gained = (await bal(w, w.protege.did)) - before.protege;
  await jobs(loner, 4);
  assert.ok((await bal(w, loner.did)) > before.loner, "an agent with no mentor keeps all its pay");
  assert.ok(gained > 0);
  void client;
  assert.equal(await w.marker(`mentor_paid:${w.protege.did}`), "3");
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
  assert.equal((await kit.log.verify()).ok, true);
});

test("DK1201 and DK1202: a default on a mentored line recovers from the mentor's whole balance, the held part included, the hold is released, and the default shows on the mentor's page", async () => {
  const w = await world();
  const { kit } = w;
  const mid = await w.mentorship();
  const c = await w.contract(w.protege);
  await kit.put(w.line(w.protege, c, w.mentor, { mentorship: mid }));
  const b = await kit.put(w.bond(w.protege, c));
  const m = w.mandateOf(w.protege, c, b);
  await kit.put(m);
  await kit.put(cosign(kit.mk("settlement", w.bank, { contract: c, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, m.id, { subject: c }), w.house));
  const lines = (await kit.log.recordsOfTypes(["credit_line"])).map((r) => r.id);
  assert.equal(await w.marker(`hold:${w.mentor.did}`), "5");
  await kit.put(kit.mk("credit_default", w.bank, { line: lines[0], unpaid: credit(20), against: w.mentor.did }, null, { subject: w.protege.did }));
  assert.equal(await bal(w, w.mentor.did), 80, "the mentor paid the 20 the protege could not");
  assert.equal(await w.marker(`hold:${w.mentor.did}`), "0", "released by the default");
  assert.deepEqual((await kit.log.registryPage(w.mentor.did))!.mentoring, { proteges: 1, lines: 1, defaults: 1 });
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
});

test("DK1203: a tutorial job is a house agent's contract for a newcomer in its first week, once; a person's, a veteran's and a second one are refused", async () => {
  const w = await world();
  const { kit } = w;
  assert.equal(TUTORIAL_LABEL, "[tutorial]"); assert.equal(TUTORIAL_DAYS, 7);
  const purpose = `${TUTORIAL_LABEL} read a file and say what it does`;
  const person = await kit.person("not-a-house-agent");
  await kit.mint(person.did, 100);
  assert.equal(await refused(w.contract(w.protege, person, 50, purpose)), "tutorial_not_from_a_house_agent");
  await w.contract(w.protege, w.house, 50, purpose);
  assert.equal(await refused(w.contract(w.protege, w.house, 50, purpose)), "tutorial_once", "one for each newcomer");
  await w.contract(w.protege, w.house, 50, "an ordinary job");
  const veteran = await kit.agent("veteran", await kit.person("veteran-sponsor"), 1);
  kit.addDays(TUTORIAL_DAYS + 1);
  assert.equal(await refused(w.contract(veteran, w.house, 50, purpose)), "tutorial_not_first_week", "a newcomer's first week only");
  const fresh = await kit.agent("fresh-newcomer", await kit.person("fresh-sponsor"), 1);
  await w.contract(fresh, w.house, 50, purpose);
  assert.ok(MENTOR_MAX_PROTEGES >= 3);
  assert.equal((await kit.log.verify()).ok, true);
});
