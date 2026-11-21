/**
 * Starter credits for every agent of a fleet (register row DK1356; spec-delta S1406; the owner's decision of 2026-11-21): any number of identities under one sponsor, each with its own starter credits, the pool and the
 * supply audit covering them; an unverified sponsor slowed by rate and never by total; a verified organisation not slowed; the second part of the grant released only by the agent's OWN qualifying job, never by work between
 * the members of one sponsor. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DAY, credit, jump, kit, mk, operator, refusedBy, keysOf, type Party } from "./society-kit.ts";
import { STARTER_PER_DID, STARTER_UPFRONT } from "../src/starter.ts";
import { STARTER_POOL_DID } from "../src/economy.ts";
import { SPONSOR_PASSPORTS_PER_DAY } from "../src/log.ts";
import { party } from "./society-kit.ts";

const claim = (who: Party, part: "upfront" | "rest") => mk("starter_claim", who, { part, amount: credit(part === "upfront" ? STARTER_UPFRONT : STARTER_PER_DID - STARTER_UPFRONT) }, null, { subject: who.did });

async function world(poolCredits: number) {
  const k = await kit();
  await k.mint(STARTER_POOL_DID, poolCredits);
  const org = party("did:web:example.com:orgs:enterprise-1");
  /** A verified organisation: the operator countersigns its passport once it has checked it. */
  const verifyOrg = (o: Party) => k.log.append(mk("passport", o, { did: o.did, kind: "org", keys: keysOf(o) }, null, { subject: o.did, cosigners: [operator] }));
  const plainOrg = (o: Party) => k.log.append(mk("passport", o, { did: o.did, kind: "org", keys: keysOf(o) }, null, { subject: o.did }));
  return { ...k, org, verifyOrg, plainOrg };
}

describe("every agent of a fleet gets its own starter credits", () => {
  test("a verified organisation brings thousands of agents under one sponsor: each claims its own 100, the pool pays each exactly, the supply audit balances", async () => {
    const N = Number(process.env.ASP_FLEET_AGENTS ?? 10000);
    const w = await world(N * STARTER_UPFRONT);
    await w.verifyOrg(w.org);
    const before = (await w.log.creditAudit()).minted;
    for (let i = 0; i < N; i++) {
      const a = await w.agent(`fleet-a-${i}`, w.org as Party);
      await w.log.append(claim(a, "upfront"));
      if (i === 0 || i === N - 1) assert.equal(await w.log.balance(a.did), STARTER_UPFRONT);
    }
    assert.equal(await w.log.balance(STARTER_POOL_DID), 0, "the pool paid exactly 100 to each of the agents");
    const audit = await w.log.creditAudit();
    assert.equal(audit.verdict, "balanced");
    assert.equal(audit.minted, before, "claims move credits out of the pool; they mint nothing");
    assert.equal(audit.mintedUnsigned, 0);
    const late = await w.agent("fleet-late", w.org as Party);
    assert.equal(await refusedBy(w.log.append(claim(late, "upfront"))), "starter_pool_empty", "the pool is the cap: it is refilled by a signed mint, not by a rule about the sponsor");
    await w.mint(STARTER_POOL_DID, 100);
    await w.log.append(claim(late, "upfront"));
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("an unverified sponsor is slowed by rate and never by a total: the daily limit refuses the 11th agent of the day, the next day it may open more, and a verified organisation has no daily limit", async () => {
    const w = await world(100_000);
    const sponsor = await w.person("unverified-sponsor");
    for (let i = 0; i < SPONSOR_PASSPORTS_PER_DAY; i++) { const a = await w.agent(`slow-${i}`, sponsor); await w.log.append(claim(a, "upfront")); }
    const eleventh = party("did:web:example.com:agents:slow-extra");
    const open = () => w.log.append(mk("passport", sponsor, { did: eleventh.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: keysOf(eleventh) }, null, { subject: eleventh.did }));
    assert.equal(await refusedBy(open()), "sponsor_daily_limit", "10 a day for one unverified sponsor");
    jump(DAY);
    await open();
    await w.log.append(claim(eleventh, "upfront"));
    // there is no total: day after day it can keep opening agents, each with its own starter credits
    for (let d = 0; d < 3; d++) { jump(DAY); for (let i = 0; i < SPONSOR_PASSPORTS_PER_DAY; i++) { const a = await w.agent(`slow-d${d}-${i}`, sponsor); await w.log.append(claim(a, "upfront")); } }
    const audit = await w.log.creditAudit();
    assert.equal(audit.verdict, "balanced");
    // a verified organisation opens far more than the daily limit in one day
    await w.verifyOrg(w.org);
    for (let i = 0; i < SPONSOR_PASSPORTS_PER_DAY * 3; i++) await w.agent(`org-${i}`, w.org as Party);
    // an organisation the operator has not verified is an unverified sponsor like any other
    const plain = party("did:web:example.com:orgs:unverified-org");
    await w.plainOrg(plain);
    for (let i = 0; i < SPONSOR_PASSPORTS_PER_DAY; i++) await w.agent(`plain-${i}`, plain as Party);
    const x = party("did:web:example.com:agents:plain-x");
    assert.equal(await refusedBy(w.log.append(mk("passport", plain, { did: x.did, kind: "agent", sponsor: plain.did, tier: 1, shape: {}, keys: keysOf(x) }, null, { subject: x.did }))), "sponsor_daily_limit");
  });

  test("the second part is each agent's own: work between the members of one sponsor never releases it, a job from an independent principal releases it for that agent alone", async () => {
    const w = await world(10_000);
    await w.verifyOrg(w.org);
    const a = await w.agent("own-a", w.org as Party, { funds: 300 });
    const b = await w.agent("own-b", w.org as Party, { funds: 300 });
    await w.log.append(claim(a, "upfront"));
    await w.log.append(claim(b, "upfront"));
    // a does a job for b: both are the organisation's agents, so the job settles and does not count
    await w.runJob(b, a, 60);
    assert.equal(await refusedBy(w.log.append(claim(a, "rest"))), "starter_rest_not_earned", "a job inside the sponsor's fleet does not unlock the 400");
    assert.equal(await refusedBy(w.log.append(claim(b, "rest"))), "starter_rest_not_earned");
    // a does a job for an independent person: it counts for a, and for a alone
    const client = await w.person("independent-client", 2000);
    await w.runJob(client, a, 60);
    assert.equal(await refusedBy(w.log.append(claim(b, "rest"))), "starter_rest_not_earned", "b's fleet-mate earned something; b did not: the grant is its own");
    const poolBefore = await w.log.balance(STARTER_POOL_DID);
    await w.log.append(claim(a, "rest"));
    assert.equal(await w.log.balance(STARTER_POOL_DID), poolBefore - (STARTER_PER_DID - STARTER_UPFRONT));
    assert.equal(await refusedBy(w.log.append(claim(a, "rest"))), "starter_already_claimed");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true);
  });
});
void operator;
