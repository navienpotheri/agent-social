// The Bank (register row DK19; spec-delta S280; bank-insurer.md): a newcomer with no balance posts a bond on a credit line, the line repays at settlement and the books balance; a default writes a signed
// loss against the sponsor; every rule of the line is refused with its name. The reserve comes from a Treasury budget payment, never a mint. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { BANK_DID, TREASURY_DID, institutionDid } from "../src/index.ts";
import { Kit, bankP, credit, hashOf, operator, owner, refused, treasury, type Party } from "./academy-kit.ts";

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

test("(T13) DK19 done: a newcomer with no balance posts a bond on a credit line, repays it at settlement, and the books balance", async () => {
  const w = await world();
  const { kit } = w;
  const agent = await w.newcomer("line-newcomer");
  assert.equal(await bal(w, agent.did), 0, "no balance of its own");
  const reserve0 = await bal(w, BANK_DID);
  const supply0 = reserve0 + (await bal(w, agent.did)) + (await bal(w, w.sponsor.did)) + (await bal(w, w.principal.did)) + (await bal(w, TREASURY_DID));
  const c = await w.contract(agent);
  const bond0 = w.bond(agent, c);
  assert.equal(await refused(kit.put(bond0)), "insufficient_balance", "without a line the bond is refused");
  await kit.put(w.line(agent, c));
  const bondId = await kit.put(bond0);
  assert.equal(await bal(w, BANK_DID), reserve0 - 20, "the Bank's reserve funds the bond lock");
  assert.equal(await bal(w, agent.did), 0, "the credits went into the bond, not into the agent's pocket");
  const mandateRec = w.mandate(agent, c, bondId);
  await kit.put(mandateRec);
  const d = kit.mk("delivery", agent, { contract: c, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandateRec.id, { subject: c });
  await kit.put(d);
  const acc = kit.mk("attestation", w.principal, { kind: "acceptance", about: d.id, verdict: "accepted" }, d.id, { subject: c });
  await kit.put(acc);
  await kit.put(kit.mk("settlement", w.bank, { contract: c, basis: "accepted", cites: acc.id, escrow_released: credit(96), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, acc.id, { subject: c }));
  assert.equal(await bal(w, BANK_DID), reserve0, "the line was repaid in full: the reserve is whole again");
  assert.equal(await bal(w, agent.did), 96, "the agent keeps its pay; the returned bond went back to the Bank");
  const supply1 = (await bal(w, BANK_DID)) + (await bal(w, agent.did)) + (await bal(w, w.sponsor.did)) + (await bal(w, w.principal.did)) + (await bal(w, TREASURY_DID));
  assert.equal(supply1 - supply0, 0 + 4 - 4 + 0, "the books balance: the job's credits moved, none were made (the 4 job tax is in the Treasury)");
  assert.equal((await kit.log.verify()).ok, true, "a replay of the log alone reproduces it");
});

test("a default writes a signed loss against the sponsor: the unpaid part is debited from the guarantor up to what it holds, the rest is a debt that blocks new lines", async () => {
  const w = await world();
  const { kit } = w;
  const poor = await kit.person("poor-sponsor");
  await kit.mint(poor.did, 5); // exactly 25 % of a 20 credit line
  const agent = await kit.agent("defaulting-newcomer", poor, 1);
  const c = await w.contract(agent);
  await kit.put(w.line(agent, c, {}, { guarantor: poor }));
  const bondId = await kit.put(w.bond(agent, c));
  const mandate = w.mandate(agent, c, bondId);
  await kit.put(mandate);
  // The job fails: revoked, the whole bond slashed to the principal; the agent has nothing to repay with.
  const settle = cosign(kit.mk("settlement", w.bank, { contract: c, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, mandate.id, { subject: c }), w.principal);
  await kit.put(settle);
  assert.equal(await bal(w, agent.did), 0);
  const lines = await recordsOf(kit, "credit_line");
  const reserveBefore = await bal(w, BANK_DID);
  const dflt = (over: Record<string, unknown> = {}, by: Party = w.bank) => kit.mk("credit_default", by, { line: lines[0], unpaid: credit(20), against: poor.did, ...over }, null, { subject: agent.did });
  assert.equal(await refused(kit.put(dflt({}, w.sponsor))), "default_wrong_issuer");
  assert.equal(await refused(kit.put(dflt({ unpaid: credit(19) }))), "default_wrong_amount");
  assert.equal(await refused(kit.put(dflt({ against: w.sponsor.did }))), "default_wrong_guarantor");
  assert.equal(await refused(kit.put(dflt({ line: c }))), "default_unknown_line");
  await kit.put(dflt());
  assert.equal(await bal(w, poor.did), 0, "the guarantor paid what it held");
  assert.equal(await bal(w, BANK_DID), reserveBefore + 5, "the Bank recovered 5 of the 20");
  assert.equal(await refused(kit.put(dflt())), "default_not_owed", "a default is recorded once");
  // The remainder (15) is a debt: new lines for the guarantor's agents are blocked.
  const other = await kit.agent("poor-sponsors-second", poor, 1);
  await kit.mint(poor.did, 50);
  const c2 = await w.contract(other);
  assert.equal(await refused(kit.put(w.line(other, c2, {}, { guarantor: poor }))), "line_blocked_by_default");
  assert.equal(await refused(kit.put(w.line(agent, await w.contract(agent), {}, { guarantor: poor }))), "line_tier_not_eligible", "the borrower was slashed to tier 0 by the same settlement");
});

test("every rule of the line is refused by name: issuer, countersigns, guarantor, tier, limit, first jobs, guarantor balance, independent principal, reserve, one open line, bonded contract, due date", async () => {
  const w = await world(70);
  const { kit } = w;
  const agent = await w.newcomer("rules-newcomer");
  const c = await w.contract(agent);
  const stranger = await kit.person("not-the-sponsor");
  await kit.mint(stranger.did, 100);
  assert.equal(await refused(kit.put(w.line(agent, c, {}, { by: w.sponsor }))), "line_wrong_issuer");
  assert.equal(await refused(kit.put(w.line(agent, c, {}, { cosigners: [agent] }))), "line_needs_countersigns", "the guarantor must sign");
  assert.equal(await refused(kit.put(w.line(agent, c, {}, { cosigners: [w.sponsor] }))), "line_needs_countersigns", "the borrower must sign");
  assert.equal(await refused(kit.put(w.line(agent, c, {}, { guarantor: stranger }))), "line_no_guarantor", "only the agent's own sponsor");
  assert.equal(await refused(kit.put(w.line(agent, c, { amount: credit(61) }))), "line_over_limit", "tier 1: at most 60");
  assert.equal(await refused(kit.put(w.line(agent, c, { due: iso(Date.parse(kit.now()) + 20 * DAY) }))), "line_due_out_of_range");
  assert.equal(await refused(kit.put(w.line(w.sponsor as Party, c))), "line_not_an_agent");
  assert.equal(await refused(kit.put(w.line(await w.newcomer("other-agent"), c))), "line_contract_mismatch", "the contract names another performer");
  // The principal must be independent of the guarantor's side.
  const selfDealt = await w.contract(agent, w.sponsor);
  assert.equal(await refused(kit.put(w.line(agent, selfDealt))), "line_self_dealt");
  // The guarantor needs 25 %: a sponsor with 4 credits cannot guarantee 20, one with 5 can.
  const thin = await kit.person("thin-sponsor"); await kit.mint(thin.did, 4);
  const thinAgent = await kit.agent("thin-agent", thin, 1);
  const tc = await w.contract(thinAgent);
  assert.equal(await refused(kit.put(w.line(thinAgent, tc, {}, { guarantor: thin }))), "line_guarantor_balance");
  await kit.mint(thin.did, 1);
  await kit.put(w.line(thinAgent, tc, {}, { guarantor: thin })); // 5 = 25 % of 20: allowed
  // The reserve is 70: 20 is promised to the line above, so 60 more is refused.
  const big = await w.newcomer("big-agent");
  const bc = await w.contract(big);
  assert.equal(await refused(kit.put(w.line(big, bc, { amount: credit(60) }))), "line_exceeds_reserve");
  // One open line per agent.
  await kit.put(w.line(agent, c));
  assert.equal(await refused(kit.put(w.line(agent, await w.contract(agent)))), "line_already_open");
  // A contract that already has its Bond takes no line.
  const second = await kit.agent("bonded-first", w.sponsor, 1);
  await kit.mint(second.did, 40);
  const sc = await w.contract(second);
  await kit.put(w.bond(second, sc));
  assert.equal(await refused(kit.put(w.line(second, sc))), "line_contract_bonded");
  // A line lapses: after its due date the bond is refused and a new line may be issued.
  const lapsing = await kit.agent("lapsing", w.sponsor, 1);
  const lc = await w.contract(lapsing);
  await kit.put(w.line(lapsing, lc, { due: iso(Date.parse(kit.now()) + 3 * DAY) }));
  kit.addDays(4);
  assert.equal(await refused(kit.put(w.bond(lapsing, lc))), "line_expired", "the lapsed line funds nothing");
  await kit.put(w.line(lapsing, await w.contract(lapsing)));
});

test("a line is for the first jobs only: an agent with three counted jobs and a tier 3 agent are refused", async () => {
  const w = await world();
  const { kit } = w;
  const veteran = await kit.agent("veteran-agent", w.sponsor, 1);
  for (let i = 0; i < 3; i++) await kit.acceptedJob(await kit.person(`independent-${i}`), veteran);
  const c = await w.contract(veteran);
  assert.equal(await refused(kit.put(w.line(veteran, c))), "line_not_first_job");
  const high = await kit.agent("tier-three", w.sponsor, 3);
  assert.equal(await refused(kit.put(w.line(high, await w.contract(high)))), "line_tier_not_eligible");
});

test("a statement is the Bank's and matches the log: a wrong balance or amount owed is refused", async () => {
  const w = await world();
  const { kit } = w;
  const agent = await w.newcomer("statement-agent");
  const c = await w.contract(agent);
  await kit.put(w.line(agent, c));
  await kit.put(w.bond(agent, c));
  const st = (over: Record<string, unknown> = {}, by: Party = w.bank) => kit.mk("bank_statement", by, { holder: agent.did, period: "2026-11", balance: credit(0), owed: credit(20), ...over }, null, { subject: agent.did });
  assert.equal(await refused(kit.put(st({}, w.sponsor))), "statement_wrong_issuer");
  assert.equal(await refused(kit.put(st({ balance: credit(5) }))), "statement_balance_mismatch");
  assert.equal(await refused(kit.put(st({ owed: credit(0) }))), "statement_owed_mismatch");
  await kit.put(st());
  assert.equal(institutionDid("bank"), BANK_DID);
  void operator;
});

test("DK181 done (1): a guarantor clears the debt after a default by a signed payment, the Bank is repaid, and the guarantor's other agent can take a line again", async () => {
  const w = await world();
  const { kit } = w;
  const poor = await kit.person("clear-sponsor");
  await kit.mint(poor.did, 5);
  const agent = await kit.agent("clear-defaulter", poor, 1);
  const c = await w.contract(agent);
  await kit.put(w.line(agent, c, {}, { guarantor: poor }));
  const bondId = await kit.put(w.bond(agent, c));
  const mandate = w.mandate(agent, c, bondId);
  await kit.put(mandate);
  await kit.put(cosign(kit.mk("settlement", w.bank, { contract: c, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, mandate.id, { subject: c }), w.principal));
  const [line] = await recordsOf(kit, "credit_line");
  await kit.put(kit.mk("credit_default", w.bank, { line, unpaid: credit(20), against: poor.did }, null, { subject: agent.did }));
  // 15 is owed; the guarantor holds nothing, so the second agent's line is blocked.
  const other = await kit.agent("clear-second", poor, 1);
  const c2 = await w.contract(other);
  const nextLine = () => w.line(other, c2, {}, { guarantor: poor });
  assert.equal(await refused(kit.put(nextLine())), "line_blocked_by_default");
  const pay = (amount: number, by: Party = poor, lineId = line) => kit.mk("debt_payment", by, { line: lineId, amount: credit(amount) }, null, { subject: poor.did });
  assert.equal(await refused(kit.put(pay(5))), "insufficient_balance", "a payment is from what the guarantor holds");
  await kit.mint(poor.did, 60);
  assert.equal(await refused(kit.put(pay(5, w.sponsor))), "debt_not_the_guarantor", "only the guarantor clears it");
  assert.equal(await refused(kit.put(pay(16))), "debt_overpaid", "not more than is owed");
  assert.equal(await refused(kit.put(pay(5, poor, c))), "debt_unknown_line");
  const reserve = await bal(w, BANK_DID);
  await kit.put(pay(10));
  assert.equal(await bal(w, BANK_DID), reserve + 10, "the Bank is repaid");
  assert.equal(await refused(kit.put(nextLine())), "line_blocked_by_default", "5 is still owed");
  await kit.put(pay(5));
  assert.equal(await refused(kit.put(pay(1))), "debt_nothing_owed", "cleared once");
  await kit.put(nextLine());
  assert.equal(await refused(kit.put(w.line(agent, await w.contract(agent), {}, { guarantor: poor }))), "line_tier_not_eligible", "the defaulted borrower's own block stays: it was slashed");
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
  assert.equal((await kit.log.verify()).ok, true);
});

test("DK181 done (2): a statement lists the holder's locks by contract and the log refuses a wrong or incomplete list", async () => {
  const w = await world();
  const { kit } = w;
  const agent = await w.newcomer("locks-agent");
  const c = await w.contract(agent);
  await kit.put(w.line(agent, c));
  await kit.put(w.bond(agent, c));
  const st = (locks: unknown) => kit.mk("bank_statement", w.bank, { holder: agent.did, period: "2026-11", balance: credit(0), owed: credit(20), locks }, null, { subject: agent.did });
  const right = [{ contract: c, bond: credit(20) }];
  assert.equal(await refused(kit.put(st([]))), "statement_locks_mismatch", "an incomplete list");
  assert.equal(await refused(kit.put(st([{ contract: c, bond: credit(19) }]))), "statement_locks_mismatch", "a wrong amount");
  assert.equal(await refused(kit.put(st([...right, { contract: hashOf("7"), bond: credit(1) }]))), "statement_locks_mismatch", "a lock that does not exist");
  assert.equal(await refused(kit.put(st([...right, ...right]))), "statement_locks_duplicate");
  await kit.put(st(right));
  // After the job settles the lock is gone: the same list is now wrong and an empty one is right.
  const mandate = w.mandate(agent, c, (await recordsOf(kit, "bond"))[0]);
  await kit.put(mandate);
  const d = kit.mk("delivery", agent, { contract: c, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandate.id, { subject: c });
  await kit.put(d);
  const acc = kit.mk("attestation", w.principal, { kind: "acceptance", about: d.id, verdict: "accepted" }, d.id, { subject: c });
  await kit.put(acc);
  await kit.put(kit.mk("settlement", w.bank, { contract: c, basis: "accepted", cites: acc.id, escrow_released: credit(96), fees: credit(4), bond_returned: credit(20), bond_slashed: credit(0) }, acc.id, { subject: c }));
  const after = (locks: unknown) => kit.mk("bank_statement", w.bank, { holder: agent.did, period: "2026-12", balance: credit(96), owed: credit(0), locks }, null, { subject: agent.did });
  assert.equal(await refused(kit.put(after(right))), "statement_locks_mismatch");
  await kit.put(after([]));
});

test("DK181 done (3 and 4): the Bank says what line it would offer an agent and why not, and its public page shows the reserve, the open lines and the defaults", async () => {
  const { publicReply } = await import("../src/public-pages.ts");
  const w = await world();
  const { kit } = w;
  const agent = await w.newcomer("offer-agent");
  const offer = await kit.log.bankOffer(agent.did);
  assert.equal(offer.eligible, true);
  assert.equal(offer.limit, 60, "a tier 1 line is at most 60");
  assert.equal(offer.guarantor, w.sponsor.did);
  assert.equal(offer.guarantorNeeds, 15, "a quarter of 60");
  assert.equal(offer.reserveFree, 500);
  // A person is not an agent with a sponsor; a defaulted borrower and a second line are refused with their reasons.
  assert.match((await kit.log.bankOffer(w.principal.did)).reasons.join(), /not an agent with a sponsor/);
  const c = await w.contract(agent);
  await kit.put(w.line(agent, c));
  assert.match((await kit.log.bankOffer(agent.did, kit.now())).reasons.join(), /already has an open line/);
  const page = await kit.log.bankPage();
  assert.deepEqual([page.reserve, page.promised, page.free, page.openLines, page.defaults], [500, 20, 480, 1, 0]);
  // A default: the page shows it, and the offer for the guarantor's other agent says to clear the debt.
  const poor = await kit.person("offer-poor");
  await kit.mint(poor.did, 5);
  const d = await kit.agent("offer-defaulter", poor, 1);
  const c2 = await w.contract(d);
  await kit.put(w.line(d, c2, {}, { guarantor: poor }));
  const bondId = await kit.put(w.bond(d, c2));
  const mandate = w.mandate(d, c2, bondId);
  await kit.put(mandate);
  await kit.put(cosign(kit.mk("settlement", w.bank, { contract: c2, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, mandate.id, { subject: c2 }), w.principal));
  const lineId = (await recordsOf(kit, "credit_line"))[1];
  await kit.put(kit.mk("credit_default", w.bank, { line: lineId, unpaid: credit(20), against: poor.did }, null, { subject: d.did }));
  const second = await kit.agent("offer-second", poor, 1);
  assert.match((await kit.log.bankOffer(second.did)).reasons.join(), /sponsor still owes the Bank after a default: clear it first/);
  const json = await publicReply(kit.log, "/bank/reserve", false);
  const r = (json!.json as { result: Awaited<ReturnType<typeof kit.log.bankPage>> }).result;
  assert.equal(r.defaults, 1);
  assert.equal(r.openLines, 1, "the first agent's line is still open");
  assert.equal(r.owedToTheBank, 15, "what the default left owing");
  assert.ok(r.lines.some((l) => l.status === "defaulted" && l.owed === 15));
  const html = await publicReply(kit.log, "/bank/reserve", true);
  assert.match(html!.html!, /<th>reserve<\/th><td>\d+<\/td>/);
  assert.match(html!.html!, /<th>defaults<\/th><td>1<\/td>/);
  assert.match(html!.html!, /defaulted/);
});

/** Ids of the records of a short type, read from the log in order. */
async function recordsOf(kit: Kit, short: string): Promise<string[]> {
  const out: string[] = [];
  for (let after = 0; ;) {
    const page = await kit.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { after = s.seq; if (s.record.type === `asp.${short}/v0.2`) out.push(s.id); }
  }
  return out;
}

test("(T13) property: over 40 seeded random lines, accepted jobs, failed jobs and defaults, lending never changes the total, and the Bank's reserve is never negative", async () => {
  const w = await world(400);
  const { kit } = w;
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const parties: string[] = [BANK_DID, TREASURY_DID, w.principal.did, w.sponsor.did];
  const total = async () => { let t = 0; for (const d of parties) t += await kit.log.balance(d); return t; };
  await kit.mint(w.principal.did, 4000);
  const start = await total();
  let minted = 0; // the only credits made: each sponsor's own funds, signed by the operator
  let rounds = 0;
  for (let i = 0; i < 40; i++) {
    const sponsor = await kit.person(`prop-sponsor-${i}`);
    const gift = 30 + Math.floor(rnd() * 40);
    await kit.mint(sponsor.did, gift); minted += gift;
    const agent = await kit.agent(`prop-agent-${i}`, sponsor, 1);
    parties.push(sponsor.did, agent.did);
    const c = await w.contract(agent);
    const amount = 10 + Math.floor(rnd() * 11);
    const lineRec = w.line(agent, c, { amount: credit(amount) }, { guarantor: sponsor });
    try { await kit.put(lineRec); } catch { continue; } // refused (reserve short or guarantor thin): nothing moved
    const bondId = await kit.put(w.bond(agent, c, amount));
    const mandate = w.mandate(agent, c, bondId);
    await kit.put(mandate);
    if (rnd() < 0.5) {
      const d = kit.mk("delivery", agent, { contract: c, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandate.id, { subject: c });
      await kit.put(d);
      const acc = kit.mk("attestation", w.principal, { kind: "acceptance", about: d.id, verdict: "accepted" }, d.id, { subject: c });
      await kit.put(acc);
      await kit.put(kit.mk("settlement", w.bank, { contract: c, basis: "accepted", cites: acc.id, escrow_released: credit(100), fees: credit(0), bond_returned: credit(amount), bond_slashed: credit(0) }, acc.id, { subject: c }));
    } else {
      await kit.put(cosign(kit.mk("settlement", w.bank, { contract: c, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(amount) }, mandate.id, { subject: c }), w.principal));
      const line = (await recordsOf(kit, "credit_line")).at(-1)!;
      await kit.put(kit.mk("credit_default", w.bank, { line, unpaid: credit(amount), against: sponsor.did }, null, { subject: agent.did }));
    }
    rounds++;
    assert.equal(await total(), start + minted, `lending moved credits only: round ${i}`);
    assert.ok((await kit.log.balance(BANK_DID)) >= 0, "the reserve is never negative");
  }
  assert.ok(rounds >= 10, `${rounds} rounds went through`);
  assert.equal((await kit.log.verify()).ok, true);
});
