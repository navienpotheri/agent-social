/**
 * The Insurer's price drivers applied by the log (register row DK491; spec-delta S1567; bank-insurer.md 14.1): from the time the log's option `insurerDriversFrom`, a policy is sold at the table's premium times the experience,
 * credit-cycle and holiday factors; before it the table is the rule. A quote and a sale agree, a premium that is not the driven one is refused with the factors named, and the supply audit balances. Fake keys only.
 * Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, INSURER_DID, TREASURY_DID, premiumFor } from "../src/index.ts";
import { Kit, bankP, clinic, courts, credit, hashOf, operator, owner, refused, registrar, treasury, party, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const insurerParty = party(INSURER_DID, 56);

async function world(reserve: number, driversFrom?: string) {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, insurerParty].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, ...(driversFrom ? { insurerDriversFrom: driversFrom } : {}) }));
  await kit.mint(TREASURY_DID, 50_000);
  const at = kit.tick();
  const budget = await kit.put(kit.mk("budget", treasury, { institution: INSURER_DID, period: "2026-11", amount: credit(reserve), purpose: "charter" }, null, { at, cosigners: [owner] }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget, to: INSURER_DID, amount: credit(reserve) }, null, { at: kit.tick() }));
  const sponsor = await kit.person("drv-sponsor");
  const principal = await kit.person("drv-principal");
  await kit.mint(sponsor.did, 500); await kit.mint(principal.did, 60_000);
  let n = 0;
  async function job(price: number) {
    const agent = await kit.agent(`drv-agent-${++n}`, sponsor, 1);
    await kit.mint(agent.did, 100);
    const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `job ${n}`, price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    return { agent, contract: c.id };
  }
  const policy = (j: { agent: Party; contract: string }, premium: number, insured = 20) =>
    kit.mk("policy", insurerParty, { holder: j.agent.did, contract: j.contract, cover: "bond_slash", insured_amount: credit(insured), premium: credit(premium), valid_from: kit.now(), valid_to: iso(Date.parse(kit.now()) + 60 * DAY) }, null, { subject: j.agent.did, cosigners: [j.agent] });
  return { kit, job, policy, bal: (d: string) => kit.log.balance(d) };
}

test("DK491: before the drivers' time the table's premium is the rule, even with the option set", async () => {
  const w = await world(560, "2030-01-01T00:00:00Z");
  const j = await w.job(100);
  const q = await w.kit.log.insurerQuote({ contract: j.contract, cover: "bond_slash", holder: j.agent.did, insured: 20 });
  assert.deepEqual([q.premium, q.table, q.driven], [2, 2, false]);
  await w.kit.put(w.policy(j, 2));
});

test("DK491: with the drivers on and a tight reserve (under 1.2 times the floor) cover costs a quarter more; the table's premium is refused with the factors named; the quote and the sale agree; the audit balances", async () => {
  const w = await world(560, "2026-01-01T00:00:00Z");
  const j = await w.job(100);
  const q = await w.kit.log.insurerQuote({ contract: j.contract, cover: "bond_slash", holder: j.agent.did, insured: 20 });
  assert.deepEqual([q.premium, q.table, q.driven], [3, 2, true], "2 x 1.25 rounds up to 3");
  assert.match(q.why ?? "", /cycle 1\.25 \(reserve 560, floor 500\)/);
  assert.equal(await refused(w.kit.put(w.policy(j, 2))), "premium_mismatch", "the table's premium is no longer the price");
  const reserve0 = await w.bal(INSURER_DID);
  await w.kit.put(w.policy(j, 3));
  assert.equal(await w.bal(INSURER_DID) - reserve0, 3, "the premium reaches the reserve by the published split");
  const a = await w.kit.log.creditAudit();
  assert.equal(a.verdict, "balanced");
  assert.equal((await w.kit.log.verify()).ok, true, "a replica replays the driven premium to the same books");
});

test("DK491: a plentiful reserve (over 3 times the floor) makes cover cheaper", async () => {
  const w = await world(6500, "2026-01-01T00:00:00Z");
  const j = await w.job(200);
  const table = premiumFor("bond_slash", 200, 200, 0, 0);
  const q = await w.kit.log.insurerQuote({ contract: j.contract, cover: "bond_slash", holder: j.agent.did, insured: 200 });
  assert.equal(q.table, table);
  assert.ok(q.premium < table, `${q.premium} is under the table's ${table}`);
  assert.match(q.why ?? "", /cycle 0\.9/);
  await w.kit.put(w.policy(j, q.premium, 200));
});
