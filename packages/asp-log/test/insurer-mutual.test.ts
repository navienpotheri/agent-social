/**
 * Fleet mutual cover (register rows DK185 and BI-14; spec-delta S1568; bank-insurer.md 13.2): a fleet's organisation opens a pool that no one owns, members buy cover into it, the premium reaches the pool, a claim is paid
 * from the pool first and then from the Insurer's reserve above its floor, the pool is rated by the fleet's own record, and its surplus goes back to the members pro rata only when no live policy could still need it. Every
 * rule is refused by name and the supply audit balances after every step. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, b64urlEncode, staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, INSURER_DID, TREASURY_DID, fleetFactorPermille, mutualPoolDid, premiumFor } from "../src/index.ts";
import { Kit, bankP, clinic, courts, credit, hashOf, operator, owner, party, refused, registrar, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const insurerParty = party(INSURER_DID, 56);
const FLEET = "did:web:example.com:orgs:acme-mutual:fleets:coders";
const POOL = mutualPoolDid(FLEET);

async function world() {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, insurerParty].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  await kit.mint(TREASURY_DID, 50_000);
  const at = kit.tick();
  const budget = await kit.put(kit.mk("budget", treasury, { institution: INSURER_DID, period: "2026-11", amount: credit(1000), purpose: "charter" }, null, { at, cosigners: [owner] }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget, to: INSURER_DID, amount: credit(1000) }, null, { at: kit.tick() }));
  // a verified organisation, its fleet and three members; and an agent that is not in the fleet
  const org = party("did:web:example.com:orgs:acme-mutual", 77);
  await kit.put(kit.mk("passport", org, { did: org.did, kind: "org", keys: [{ id: org.kid, type: "Ed25519", public_key: b64urlEncode(org.publicKey) }] }, null, { subject: org.did, cosigners: [operator] }));
  await kit.put(kit.mk("fleet", org, { did: FLEET, org: org.did, name: "Coders", purpose: "Acme's coding agents" }, null, { subject: FLEET }));
  const member = async (name: string) => {
    const p = party(`did:web:example.com:agents:${name}`, 200 + Math.floor(Math.random() * 1000));
    await kit.put(kit.mk("passport", org, { did: p.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }], fleet: FLEET }, null, { subject: p.did }));
    await kit.mint(p.did, 200);
    return p;
  };
  const principal = await kit.person("mu-principal");
  await kit.mint(principal.did, 60_000);
  const outsider = await kit.agent("mu-outsider", await kit.person("mu-outsider-sponsor"), 1);
  await kit.mint(outsider.did, 200);
  const audit = async (why: string) => { const a = await kit.log.creditAudit(); assert.equal(a.verdict, "balanced", `${why}: ${a.problems.join("; ")}`); };
  const bal = (d: string) => kit.log.balance(d);
  let n = 0;
  async function job(agent: Party, price = 100) {
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `job ${++n}`, price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    return c.id;
  }
  const act = (kind: string, by: Party = org, over: Record<string, unknown> = {}) => kit.mk("mutual_act", by, { act: kind, fleet: FLEET, ...over });
  const policy = (agent: Party, contract: string, premium: number, over: Record<string, unknown> = {}) =>
    kit.mk("policy", agent, { holder: agent.did, contract, cover: "bond_slash", insured_amount: credit(20), premium: credit(premium), valid_from: kit.now(), valid_to: iso(Date.parse(kit.now()) + 60 * DAY), mutual: FLEET, ...over }, null, { subject: agent.did });
  return { kit, org, member, outsider, job, act, policy, audit, bal, principal };
}

test("DK185: a pool is opened by the fleet's organisation only, once; a member buys cover into it, a non-member cannot, and the premium reaches the pool, not the reserve", async () => {
  const w = await world();
  const a = await w.member("mu-a");
  const c1 = await w.job(a);
  assert.equal(await refused(w.kit.put(w.policy(a, c1, 2))), "mutual_not_open", "no pool yet");
  assert.equal(await refused(w.kit.put(w.act("open", a))), "mutual_wrong_issuer", "a member does not open its fleet's pool");
  await w.kit.put(w.act("open"));
  assert.equal(await refused(w.kit.put(w.act("open"))), "mutual_exists");
  const co = await w.job(w.outsider);
  assert.equal(await refused(w.kit.put(w.policy(w.outsider, co, 2))), "mutual_not_member");
  const reserve0 = await w.bal(INSURER_DID);
  await w.kit.put(w.policy(a, c1, premiumFor("bond_slash", 20, 100, 0, 0)));
  assert.equal(await w.bal(INSURER_DID), reserve0, "the Insurer's reserve did not take the premium");
  assert.equal(await w.bal(POOL), 2, "the pool holds the Insurer's share of the premium");
  await w.audit("after the pooled sale");
});

test("DK185: a claim on a pooled policy is paid from the pool first, then from the reserve above its floor; the audit balances", async () => {
  const w = await world();
  const a = await w.member("mu-claim");
  await w.kit.put(w.act("open"));
  const c = await w.job(a);
  const pol = await w.kit.put(w.policy(a, c, 2));
  const bond = w.kit.mk("bond", a, { contract: c, backer: a.did, amount: credit(20), escrow: { payer: w.principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c, { subject: c });
  await w.kit.put(bond);
  const mandate = w.kit.mk("mandate", w.principal, { contract: c, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: a.did });
  await w.kit.put(mandate);
  const settlement = await w.kit.put(cosign(w.kit.mk("settlement", bankP, { contract: c, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(10), bond_slashed: credit(10) }, mandate.id, { subject: c }), w.principal));
  const claim = await w.kit.put(w.kit.mk("claim", a, { policy: pol, event: settlement, amount_claimed: credit(1) }, null, { subject: a.did }));
  const reserve0 = await w.bal(INSURER_DID), held0 = await w.bal(a.did);
  await w.kit.put(w.kit.mk("claim_decision", insurerParty, { claim, decision: "paid", amount: credit(4), reason: "covered" }, null, { subject: null }));
  assert.equal(await w.bal(a.did) - held0, 4, "the terms pay 4");
  assert.equal(await w.bal(POOL), 0, "the pool paid what it held (2)");
  assert.equal(reserve0 - (await w.bal(INSURER_DID)), 2, "the reserve paid the rest, from above its floor");
  await w.audit("after the pooled claim");
  assert.equal((await w.kit.log.verify()).ok, true, "a replica replays the pool to the same books");
});

test("DK185: the surplus goes back to the members pro rata only when no live policy could still need it; a pool closes when none is live", async () => {
  const w = await world();
  const [a, b] = [await w.member("mu-r-a"), await w.member("mu-r-b")];
  await w.kit.put(w.act("open"));
  await w.kit.put(w.policy(a, await w.job(a), 2));
  await w.kit.put(w.policy(b, await w.job(b, 200), 8, { insured_amount: credit(100) }));
  const held = await w.bal(POOL);
  assert.ok(held > 0);
  assert.equal(await refused(w.kit.put(w.act("return"))), "mutual_no_surplus", "two live policies could still pay more than the pool holds");
  assert.equal(await refused(w.kit.put(w.act("close"))), "mutual_live_policies");
  assert.equal(await refused(w.kit.put(w.act("return", a))), "mutual_wrong_issuer");
  w.kit.addDays(70); // both policies have ended
  const [a0, b0] = [await w.bal(a.did), await w.bal(b.did)];
  await w.kit.put(w.act("return"));
  assert.equal(await w.bal(POOL), 0, "every credit left the pool");
  const [ga, gb] = [(await w.bal(a.did)) - a0, (await w.bal(b.did)) - b0];
  assert.equal(ga + gb, held, "nothing was created or lost");
  assert.ok(gb > ga, "the member that paid the larger premium gets the larger share");
  await w.audit("after the return");
  await w.kit.put(w.act("close"));
  assert.equal(await refused(w.kit.put(w.act("return"))), "mutual_closed");
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK185: the fleet factor lowers the premium with the fleet's clean runs (up to 40 percent), raises it with strikes and claims, and never passes 1.5 times", () => {
  assert.equal(fleetFactorPermille({ cleanRuns90: 0, strikes30: 0, claims90: 0 }), 1000);
  assert.equal(fleetFactorPermille({ cleanRuns90: 20, strikes30: 0, claims90: 0 }), 800);
  assert.equal(fleetFactorPermille({ cleanRuns90: 500, strikes30: 0, claims90: 0 }), 600, "40 percent off at most");
  assert.equal(fleetFactorPermille({ cleanRuns90: 0, strikes30: 2, claims90: 1 }), 1400);
  assert.equal(fleetFactorPermille({ cleanRuns90: 0, strikes30: 20, claims90: 9 }), 1500, "1.5 times at most");
});
