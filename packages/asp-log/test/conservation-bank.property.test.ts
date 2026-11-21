// The conservation property test, extended to the Bank, the deposits, the Insurer and the Treasury's budget lines (docs/institutions/credit-structure.md; register row DK1451; credits.md section 9).
//
// Random sequences of credit-moving operations from a fixed seed: mints; a Treasury budget and a payment of it to the Bank or the Insurer (the right amount and one credit too much); a deposit with the Bank
// (an amount the holder has and one it has not), a withdrawal (inside the term and after it) and the Treasury's reward on a deposit (the exact amount and one credit too many); a first job on a credit line, drawn at
// the Bond and repaid at settlement or defaulted, the guarantor debited and a debt cleared; a policy bought before a job, the job failed, a claim and the Insurer's decision (the stated amount and one credit too many).
// After every operation: A1 the supply rule (balances + locks = minted, exactly), A2 no negative balance and no negative Bank or Insurer reserve, A3 a refused operation leaves every balance, lock and counter unchanged,
// A7 only a mint changes the minted total, by exactly its amount; at the end of a sequence A4 a replay of the records reproduces the log (verify). The run counts how often each kind was accepted and refused and fails if
// a kind never succeeded. To re-run one sequence: ASP_BANK_ONLY=<n>; to change the seed or the count: ASP_BANK_SEED, ASP_BANK_COUNT. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AspError, cosign, staticResolver } from "@agent-social/asp-core";
import { BANK_DID, BANK_DEPOSIT_DID, EventLog, INSURER_DID, MemoryStore, TREASURY_DID, payoutFor, premiumFor, rewardFor, type Cover } from "../src/index.ts";
import { Kit, bankP, clinic, courts, credit, hashOf, operator, owner, party, registrar, treasury, type Party } from "./academy-kit.ts";

const SEED = Number(process.env.ASP_BANK_SEED ?? 20261121);
const SEQUENCES = Number(process.env.ASP_BANK_COUNT ?? 40);
const ONLY = process.env.ASP_BANK_ONLY === undefined ? undefined : Number(process.env.ASP_BANK_ONLY);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const insurerParty = party(INSURER_DID, 56);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Everything the supply rule reads, not the head (a refused record can still leave the head's record behind). */
const stateOf = async (log: EventLog) => { const { head: _h, ...rows } = await (log as unknown as { store: { ledgerRows(): Promise<{ head: unknown }> } }).store.ledgerRows(); return rows; };
const refusedOnly = async (p: Promise<unknown>): Promise<boolean> => { try { await p; return false; } catch (e) { if (e instanceof AspError) { if (process.env.ASP_BANK_DEBUG) console.log("refused:", e.detail ?? e.code, e.message.slice(0, 160)); return true; } throw e; } };

const coverage = new Map<string, { ok: number; refused: number }>();
const count = (kind: string, refused: boolean) => { const c = coverage.get(kind) ?? { ok: 0, refused: 0 }; if (refused) c.refused++; else c.ok++; coverage.set(kind, c); };

async function sequence(seed: number): Promise<EventLog> {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, insurerParty].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  const log = kit.log;
  await kit.mint(TREASURY_DID, 20_000);
  // The Bank and the Insurer open with the reserves the Treasury pays them by a co-signed budget (never a mint): the Bank lends from 700, the Insurer sells above its 500 floor with 900.
  for (const [to, amount] of [[BANK_DID, 700], [INSURER_DID, 900]] as const) {
    const b = await kit.put(kit.mk("budget", treasury, { institution: to, period: kit.now().slice(0, 7), amount: credit(amount), purpose: "charter" }, null, { cosigners: [owner] }));
    await kit.put(kit.mk("treasury_payment", treasury, { budget: b, to, amount: credit(amount) }, null));
  }
  const principal = await kit.person("bp-principal");
  await kit.mint(principal.did, 100_000);
  const holders = [await kit.person("bp-holder-0"), await kit.person("bp-holder-1")];
  for (const h of holders) await kit.mint(h.did, 600);
  let side = 0; // credits a set-up step minted (a new sponsor's funds), added to the operation's own mint
  const sponsors: Party[] = [];
  const sponsorFor = async (k: number) => { const g = Math.floor(k / 8); while (sponsors.length <= g) { const s = await kit.person(`bp-sponsor-${sponsors.length}`); await kit.mint(s.did, 400); side += 400; sponsors.push(s); } return sponsors[g]; };
  const deposits: { id: string; holder: Party; open: boolean }[] = [];
  let agents = 0, jobs = 0;
  const month = () => kit.now().slice(0, 7);
  const budgetFor = async (institution: string, purpose: string, amount: number, period = month()): Promise<string | undefined> => {
    try { return await kit.put(kit.mk("budget", treasury, { institution, period, amount: credit(amount), purpose }, null, { cosigners: [owner] })); } catch (e) { if (e instanceof AspError) return undefined; throw e; }
  };
  const rewardBudgets = new Map<string, string>();
  const total = int(10, 30);

  for (let step = 0; step < total; step++) {
    let before = await stateOf(log);
    const mintedBefore = (await log.creditAudit()).minted;
    let minted = 0, refused = false, kind = "", skipA3 = false;
    const r = rnd();
    try {
      if (r < 0.1) {
        kind = "mint"; const to = pick([principal, ...holders]), amount = int(1, 80); minted = amount; await kit.mint(to.did, amount);
      } else if (r < 0.22) {
        kind = "fund bank or insurer";
        const to = pick([BANK_DID, INSURER_DID]), amount = int(50, 400);
        if (rnd() < 0.7) kit.addDays(32); // a budget is drawn in its own month: a later month, or the same one (then a second budget is refused)
        const b = await budgetFor(to, "charter", amount);
        if (!b) { refused = true; skipA3 = true; kind = "fund (budget refused)"; } else {
          before = await stateOf(log); // the budget stands: it moves nothing; the payment is what may be refused
          refused = await refusedOnly(kit.put(kit.mk("treasury_payment", treasury, { budget: b, to, amount: credit(pick([amount, amount, amount + 1])) }, null)));
        }
      } else if (r < 0.36) {
        kind = "deposit";
        const holder = pick(holders), have = await log.balance(holder.did), amount = pick([int(100, Math.max(100, Math.min(have, 250))), int(100, Math.max(100, Math.min(have, 250))), int(1, Math.max(1, Math.min(have, 300))), have + 1]);
        const rec = kit.mk("deposit_act" as never, holder, { act: "deposit", holder: holder.did, amount: credit(amount) }, null, { subject: holder.did, cosigners: [bankP] });
        refused = await refusedOnly(kit.put(rec));
        if (!refused) deposits.push({ id: rec.id, holder, open: true });
      } else if (r < 0.46) {
        kind = "withdraw";
        const d = pick(deposits.filter((x) => x.open));
        if (!d) kind = "withdraw (no deposit)"; else {
          const early = rnd() < 0.4;
          if (!early) kit.addDays(31);
          before = await stateOf(log);
          refused = await refusedOnly(kit.put(kit.mk("deposit_act" as never, d.holder, { act: "withdraw", deposit: d.id }, null, { subject: d.holder.did })));
          if (!refused) d.open = false;
        }
      } else if (r < 0.54) {
        kind = "reward";
        const d = pick(deposits.filter((x) => x.open));
        if (!d) kind = "reward (no deposit)"; else {
          kit.addDays(30.5);
          let budget = rewardBudgets.get(month());
          if (!budget) { budget = await budgetFor(TREASURY_DID, "deposit_reward", 200); if (budget) rewardBudgets.set(month(), budget); }
          before = await stateOf(log);
          if (!budget) { refused = true; kind = "reward (no budget)"; } else {
            const dep = (await log.store.transaction((tx) => tx.getMarker(`deposit:${d.id}`))) ?? "{}";
            const amount = rewardFor((JSON.parse(dep) as { amount?: number }).amount ?? 0);
            refused = await refusedOnly(kit.put(kit.mk("deposit_act" as never, treasury, { act: "reward", deposit: d.id, budget, amount: credit(pick([amount, amount, amount + 1])) }, null, { subject: d.holder.did })));
          }
        }
      } else if (r < 0.78) {
        kind = "credit line job";
        const sponsor = await sponsorFor(agents), agent = await kit.agent(`bp-newcomer-${agents++}`, sponsor, 1);
        const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `a first job ${agents}`, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
        await kit.put(c);
        before = await stateOf(log);
        const amount = pick([20, 20, 20, 60, 61]);
        const line = kit.mk("credit_line", bankP, { borrower: agent.did, guarantor: sponsor.did, contract: c.id, amount: credit(amount), fee: 0, due: iso(Date.parse(kit.now()) + 7 * DAY) }, null, { subject: agent.did, cosigners: [agent, sponsor] });
        if (await refusedOnly(kit.put(line))) { refused = true; } else {
          const bond = kit.mk("bond", agent, { contract: c.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c.id, { subject: c.id });
          await kit.put(bond);
          const mandate = kit.mk("mandate", principal, { contract: c.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
          await kit.put(mandate);
          before = await stateOf(log); // the line, its draw and the job's start stand
          if (rnd() < 0.6) {
            const d = kit.mk("delivery", agent, { contract: c.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandate.id, { subject: c.id });
            await kit.put(d);
            const acc = kit.mk("attestation", principal, { kind: "acceptance", about: d.id, verdict: "accepted" }, d.id, { subject: c.id });
            await kit.put(acc);
            before = await stateOf(log);
            refused = await refusedOnly(kit.put(kit.mk("settlement", bankP, { contract: c.id, basis: "accepted", cites: acc.id, escrow_released: credit(pick([96, 96, 97])), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, acc.id, { subject: c.id })));
          } else {
            kind = "credit line default";
            await kit.put(cosign(kit.mk("settlement", bankP, { contract: c.id, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, mandate.id, { subject: c.id }), principal));
            before = await stateOf(log);
            const lineId = line.id;
            refused = await refusedOnly(kit.put(kit.mk("credit_default", bankP, { line: lineId, unpaid: credit(pick([20, 20, 19])), against: sponsor.did }, null, { subject: agent.did })));
            if (!refused && rnd() < 0.7) {
              before = await stateOf(log);
              const owed = (await log.store.transaction((tx) => tx.getMarker(`line:${lineId}`))) ?? "{}";
              const debt = (JSON.parse(owed) as { owed?: number }).owed ?? 0;
              if (debt > 0) { kind = "credit line debt payment"; refused = await refusedOnly(kit.put(kit.mk("debt_payment", sponsor, { line: lineId, amount: credit(pick([debt, debt + 1, 1])) }, null, { subject: sponsor.did }))); }
            }
          }
        }
      } else {
        kind = "policy and claim";
        const sponsor = await sponsorFor(agents), agent = await kit.agent(`bp-insured-${agents++}`, sponsor, 1);
        await kit.mint(agent.did, 100); minted += 100; // the agent can pay the premium and the bond
        const cover: Cover = pick(["bond_slash", "failed_job"]);
        const holder = cover === "failed_job" ? principal : agent;
        const price = 100, insured = cover === "failed_job" ? 50 : 20;
        const c = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: `insured job ${++jobs}`, price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: agent.did }), agent);
        await kit.put(c);
        before = await stateOf(log);
        const premium = premiumFor(cover, insured, price, 0, 0);
        const policy = kit.mk("policy", insurerParty, { holder: holder.did, contract: c.id, cover, insured_amount: credit(insured), premium: credit(pick([premium, premium, premium + 1])), valid_from: kit.now(), valid_to: iso(Date.parse(kit.now()) + 60 * DAY) }, null, { subject: holder.did, cosigners: [holder] });
        if (await refusedOnly(kit.put(policy))) { refused = true; } else {
          const bond = kit.mk("bond", agent, { contract: c.id, backer: agent.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(price) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, c.id, { subject: c.id });
          await kit.put(bond);
          const mandate = kit.mk("mandate", principal, { contract: c.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true }, bond.id, { subject: agent.did });
          await kit.put(mandate);
          const slashed = pick([0, 5, 10, 20]);
          const s = await kit.put(cosign(kit.mk("settlement", bankP, { contract: c.id, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(20 - slashed), bond_slashed: credit(slashed) }, mandate.id, { subject: c.id }), principal));
          const claim = kit.mk("claim", holder, { policy: policy.id, event: s, amount_claimed: credit(1) }, null, { subject: holder.did });
          if (await refusedOnly(kit.put(claim))) { refused = true; skipA3 = true; kind = "policy and claim (claim refused)"; } else {
            before = await stateOf(log);
            const fault = slashed > 0 ? Math.ceil((slashed * 1000) / 20) : 0;
            const terms = payoutFor(cover, insured, price, slashed, fault);
            const reserve = await log.balance(INSURER_DID);
            const due = Math.min(terms.amount, reserve);
            const decisionKind = terms.amount === 0 ? "denied" : due === terms.amount ? "paid" : "reduced";
            const amount = decisionKind === "denied" ? 0 : due + (rnd() < 0.25 ? 1 : 0);
            refused = await refusedOnly(kit.put(kit.mk("claim_decision", insurerParty, { claim: claim.id, decision: decisionKind, amount: credit(amount), reason: terms.amount === 0 ? (terms.reason ?? "no_slash") : "covered" }, null, { subject: null })));
          }
        }
      }
    } catch (e) { if (!(e instanceof AspError)) throw e; if (process.env.ASP_BANK_DEBUG) console.log("set-up refused:", kind, e.detail ?? e.code, e.message.slice(0, 160)); refused = true; skipA3 = true; kind = `${kind} (set-up refused)`; }
    minted += side; side = 0;
    count(kind, refused);
    const audit = await log.creditAudit();
    const where = `sequence seed ${seed}, step ${step}: ${kind}`;
    assert.equal(audit.verdict, "balanced", `A1 supply rule broken at ${where}: ${audit.problems.join("; ")}`);
    assert.deepEqual(audit.negativeAccounts, [], `A2 negative balance at ${where}`);
    for (const did of [BANK_DID, INSURER_DID, BANK_DEPOSIT_DID, TREASURY_DID]) assert.ok((await log.balance(did)) >= 0, `A2 ${did} went negative at ${where}`);
    if (refused && !skipA3) assert.deepEqual(await stateOf(log), before, `A3 a refused operation changed the ledger at ${where}`);
    assert.equal(audit.minted, mintedBefore + minted, `A7 minted total moved by other than the mint at ${where}`);
  }
  return log;
}

test(`DK1451: ${SEQUENCES} random sequences from seed ${SEED} over Treasury budgets and payments, deposits and rewards, credit lines with their draw, repayment, default and debt, and policies with claims: the supply rule holds after every operation and a refusal changes nothing`, { timeout: 900_000 }, async () => {
  let replayed = 0;
  for (let n = 0; n < SEQUENCES; n++) {
    if (ONLY !== undefined && n !== ONLY) continue;
    const log = await sequence((SEED + n * 7919) >>> 0);
    if (n % 5 === 0) { const rep = await log.verify(); assert.equal(rep.ok, true, `A4 replay failed for sequence ${n}: ${JSON.stringify(rep.error)}`); replayed++; }
  }
  console.log(`  accepted/refused by kind: ${[...coverage].sort().map(([k, c]) => `${k} ${c.ok}/${c.refused}`).join(", ")}; ${replayed} replays verified`);
  if (ONLY === undefined) {
    for (const kind of ["mint", "fund bank or insurer", "deposit", "withdraw", "reward", "credit line job", "credit line default", "policy and claim"]) {
      assert.ok((coverage.get(kind)?.ok ?? 0) > 0, `${kind} was accepted at least once`);
    }
    for (const kind of ["fund bank or insurer", "deposit", "withdraw", "reward", "credit line job", "policy and claim"]) {
      assert.ok((coverage.get(kind)?.refused ?? 0) > 0, `${kind} was refused at least once`);
    }
  }
});
