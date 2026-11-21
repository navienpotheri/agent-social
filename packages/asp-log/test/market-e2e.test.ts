/**
 * The Market completeness audit's end-to-end chain (register row DK1728; docs/institutions/market-completeness-audit.md): one seeded run over a real log of the credit flows a job goes through (a newcomer with no balance lends from the Bank, bonds,
 * escrows the price, delivers, is accepted and settled, the line repays, the job tax reaches the Treasury), with the supply audit asked after EVERY step and required to balance, and the total of the accounts unchanged but for what the
 * rules move. The posting, bid, assignment, appeal, insurance and deposit steps have their own tests with audits (see the audit table); they are not in this chain, which the row states. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { BANK_DID, TREASURY_DID } from "../src/index.ts";
import { Kit, bankP, credit, hashOf, owner, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world(reserve = 500) {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 2000);
  const at = kit.tick();
  const budget = await kit.put(kit.mk("budget", treasury, { institution: BANK_DID, period: "2026-11", amount: credit(reserve), purpose: "charter" }, null, { at, cosigners: [owner] }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget, to: BANK_DID, amount: credit(reserve) }, null, { at: kit.tick() }));
  const sponsor = await kit.person("bank-sponsor");
  const principal = await kit.person("bank-principal");
  await kit.mint(sponsor.did, 100); await kit.mint(principal.did, 1000);
  const bank = bankP as Party;
  const newcomer = async (name: string) => kit.agent(name, sponsor, 1);
  const contract = async (agent: Party, who: Party = principal, price = 100) => {
    const c = cosign(kit.mk("contract", who, { principal: who.did, performer: agent.did, bank: bank.did, purpose: "a first job", price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(c);
    return c.id;
  };
  const line = (agent: Party, contractId: string, over: Record<string, unknown> = {}, opts: { by?: Party; guarantor?: Party; cosigners?: Party[] } = {}) => {
    const g = opts.guarantor ?? sponsor;
    return kit.mk("credit_line", opts.by ?? bank, { borrower: agent.did, guarantor: g.did, contract: contractId, amount: credit(20), fee: 0, due: iso(Date.parse(kit.now()) + 7 * DAY), ...over }, null, { subject: agent.did, cosigners: opts.cosigners ?? [agent, g] });
  };
  const bond = (agent: Party, contractId: string, amount = 20) => kit.mk("bond", agent, { contract: contractId, backer: agent.did, amount: credit(amount), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contractId, { subject: contractId });
  const mandate = (agent: Party, contractId: string, bondId: string) => kit.mk("mandate", principal, { contract: contractId, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bondId, { subject: agent.did });
  return { kit, sponsor, principal, bank, newcomer, contract, line, bond, mandate, balance: (d: string) => kit.log.balance(d) };
}
const bal = async (w: Awaited<ReturnType<typeof world>>, did: string) => w.balance(did);

test("DK1728: a job's whole credit chain over a real log, the supply audit balanced after every step", async () => {
  const w = await world();
  const { kit } = w;
  const audits: string[] = [];
  const check = async (step: string) => {
    const a = await kit.log.creditAudit();
    audits.push(`${step}: ${a.verdict}`);
    assert.equal(a.verdict, "balanced", `after ${step}: ${JSON.stringify(a)}`);
  };
  await check("start (mints, the Treasury budget and the Bank's reserve)");
  const agent = await w.newcomer("e2e-newcomer");
  await check("a newcomer is registered with no balance");
  const reserve0 = await w.balance(BANK_DID);
  const c = await w.contract(agent);
  await check("a contract is made and the principal's escrow is named");
  await kit.put(w.line(agent, c));
  await check("the Bank lends a credit line against the job");
  const bondId = await kit.put(w.bond(agent, c));
  assert.equal(await w.balance(BANK_DID), reserve0 - 20, "the reserve funds the bond lock");
  await check("the bond is locked from the line");
  const m = w.mandate(agent, c, bondId);
  await kit.put(m);
  await check("the Mandate is signed");
  const d = kit.mk("delivery", agent, { contract: c, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, m.id, { subject: c });
  await kit.put(d);
  await check("the work is delivered");
  const acc = kit.mk("attestation", w.principal, { kind: "acceptance", about: d.id, verdict: "accepted" }, d.id, { subject: c });
  await kit.put(acc);
  await check("the principal accepts");
  const treasury0 = await w.balance(TREASURY_DID);
  await kit.put(kit.mk("settlement", w.bank, { contract: c, basis: "accepted", cites: acc.id, escrow_released: credit(96), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, acc.id, { subject: c }));
  await check("the job settles: pay, job tax, bond returned, the line repaid");
  assert.equal(await w.balance(BANK_DID), reserve0, "the Bank's reserve is whole again after the repayment");
  assert.equal(await w.balance(agent.did), 96, "the agent keeps its pay");
  assert.equal(await w.balance(TREASURY_DID) - treasury0, 4, "the job tax reached the Treasury");
  assert.equal((await kit.log.verify()).ok, true, "a replica replays the whole chain to the same books");
  console.log("\nDK1728 end-to-end chain, audit after each step:\n  " + audits.join("\n  "));
});
