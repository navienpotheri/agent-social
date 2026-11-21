/**
 * The 72-hour hold on a ruling's settlement and what an appeal does to money (spec-delta S1400; register row DK121; courts.md 5, CT-10, CT-11, CT-13).
 * Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cosign, type Signer } from "@agent-social/asp-core";
import { DEFAULT_ROUTES } from "../src/courts.ts";
import { APPEAL_FREEZE_MAX_MS, APPEAL_HOLD_MS, JUROR_PENALTY_PERMILLE, drawPanel } from "../src/index.ts";
import { DAY, TREASURY_DID, courts, credit, jump, kit, mk, refusedBy, tick, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";

const CODE = { version: "1.0", articles: ["4.1"] };
const TEXT_HASH = createHash("sha256").update(readFileSync(fileURLToPath(new URL("../../../docs/court-charter.md", import.meta.url)), "utf8")).digest("hex");
const HOUR = 3600_000;
const COURTS = courts.did;

async function world(o: { charter?: boolean; principalFunds?: number } = {}) {
  const k = await kit();
  await k.withPrices();
  const jurors: Party[] = [];
  for (let i = 0; i < 12; i++) {
    const j = await k.person(`juror-${i}`, 500);
    await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null));
    jurors.push(j);
  }
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  const principal = await k.person("claimant", o.principalFunds ?? 20_000);
  const sponsor = await k.person("agent-sponsor", 50);
  const performer = await k.agent("performer", sponsor, { funds: 2000 });
  if (o.charter !== false) {
    const at = tick();
    await k.log.append(mk("court_act", courts, { act: "charter", version: 1, text_sha256: TEXT_HASH, routes: DEFAULT_ROUTES, effective_from: at }, null, { at }));
  }
  /** A disputed contract, ruled by a quorum of the drawn panel, at the time of the ruling record. */
  const ruled = async (price = 80, fault?: Record<string, number>) => {
    const job = await k.runJob(principal, performer, price, undefined, { settle: false });
    const rej = mk("attestation", principal, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["the work is not good enough"] }, job.delivery, { subject: job.contract });
    await k.log.append(rej);
    const panel = await k.log.drawPanel(job.contract);
    const signing = panel.slice(0, Math.ceil(panel.length / 2)).map((x) => byDid.get(x)!);
    const [first, ...others] = signing;
    let r = mk("attestation", first, { kind: "ruling", about: job.contract, verdict: "for_principal", fault: fault ?? { [performer.did]: 1000 }, reasons: ["decided on the record"], code: CODE }, rej.id, { subject: job.contract });
    for (const s of others) r = cosign(r, s as Signer);
    await k.log.append(r);
    return { ...job, price, ruling: r, firstPanel: signing.map((s) => s.did) };
  };
  /** A settlement on the ruling at `at`, with the amounts the fault map gives; `waiver` cosigns it by both parties. */
  const settle = (j: { contract: string; ruling: { id: string } }, at: string, amounts = { released: 0, fees: 0, slashed: 0 }, waiver: Party[] = []) => {
    let s = mk("settlement", bank, { contract: j.contract, basis: "ruling", cites: j.ruling.id, escrow_released: credit(amounts.released), fees: credit(amounts.fees), bond_returned: credit(0), bond_slashed: credit(amounts.slashed) }, j.ruling.id, { subject: j.contract, at });
    for (const w of waiver) s = cosign(s, w as Signer);
    return s;
  };
  const at = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
  const appeal = async (by: Party, ruling: { id: string; issued_at: string }, afterMs: number, service = "courts.appeal.small", fee = 5) => {
    const paid = await k.buy(by, service, fee);
    const rec = mk("court_act", by, { act: "appeal", ruling: ruling.id, grounds: "error_of_law", statement: "Article 4.1 was misapplied", fee_paid: paid }, null, { at: at(Date.parse(ruling.issued_at) + afterMs) });
    return rec;
  };
  const appealRuling = (appealRec: { id: string }, panel: string[], outcome: string, fault?: Record<string, number>, signers = 3) => {
    const [f, ...rest] = panel.slice(0, signers).map((x) => byDid.get(x)!);
    let r = mk("court_act", f, { act: "appeal_ruling", appeal: appealRec.id, outcome, ...(fault ? { fault } : {}), reasons: ["decided on appeal"], code: CODE }, null);
    for (const s of rest) r = cosign(r, s as Signer);
    return r;
  };
  const appealPanel = (j: { ruling: { sig: { kid: string }; cosigs?: { kid: string }[] } }, appealId: string) =>
    drawPanel(k.log.store as never, { principal: principal.did, performer: performer.did, seed: appealId, size: DEFAULT_ROUTES.appeal_panel, exclude: [j.ruling.sig.kid, ...(j.ruling.cosigs ?? []).map((c) => c.kid)].map((x) => x.split("#")[0]) });
  return { ...k, jurors, byDid, principal, sponsor, performer, ruled, settle, at, appeal, appealRuling, appealPanel };
}
const stake = async (w: Awaited<ReturnType<typeof world>>, did: string) => (await w.log.store.getJuror(did))?.staked ?? 0;

describe("the 72-hour hold on a ruling's settlement (S1400, DK121)", () => {
  test("with a charter in force the settlement waits 72 hours: 71 hours is refused, exactly 72 and 73 are accepted", async () => {
    const w = await world();
    const j = await w.ruled();
    const t0 = Date.parse(j.ruling.issued_at);
    assert.equal(APPEAL_HOLD_MS, 72 * HOUR);
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(t0 + 71 * HOUR)))), "settlement_in_appeal_hold");
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(t0 + 72 * HOUR - 1000)))), "settlement_in_appeal_hold", "one second short");
    await w.log.append(w.settle(j, w.at(t0 + 72 * HOUR)));
    assert.equal((await w.log.verify()).ok, true);
    const j2 = await w.ruled();
    await w.log.append(w.settle(j2, w.at(Date.parse(j2.ruling.issued_at) + 73 * HOUR)));
  });

  test("both parties cosigning the settlement waives the hold; one party, or someone else, does not", async () => {
    const w = await world();
    const j = await w.ruled();
    const t = Date.parse(j.ruling.issued_at) + HOUR;
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(t), undefined, [w.principal]))), "settlement_in_appeal_hold");
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(t), undefined, [w.performer]))), "settlement_in_appeal_hold");
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(t), undefined, [w.jurors[0]]))), "settlement_in_appeal_hold");
    await w.log.append(w.settle(j, w.at(t), undefined, [w.principal, w.performer]));
    assert.equal((await w.log.verify()).ok, true);
  });

  test("with no charter in force and no hold on the contract a ruling settles at once, as before", async () => {
    const w = await world({ charter: false });
    const j = await w.ruled();
    await w.log.append(w.settle(j, w.at(Date.parse(j.ruling.issued_at) + 60_000)));
    assert.equal((await w.log.verify()).ok, true);
  });
});

describe("an appeal filed in the hold freezes the settlement and can move the money (S1400, DK121)", () => {
  test("an open appeal holds the settlement past the 72 hours; the appeal ruling frees it, and a reversal moves the money", async () => {
    const w = await world();
    const j = await w.ruled(80, { [w.performer.did]: 1000 });
    const t0 = Date.parse(j.ruling.issued_at);
    const ap = await w.appeal(w.performer, j.ruling, 10 * HOUR);
    await w.log.append(ap);
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(t0 + 73 * HOUR)))), "settlement_appeal_pending", "the hold has passed, the appeal has not been decided");
    const panel = await w.appealPanel(j, ap.id);
    assert.equal(panel.length, DEFAULT_ROUTES.appeal_panel);
    // the appeal panel varies the ruling: the fault is split in half
    await w.log.append(w.appealRuling(ap, panel, "varied", { [w.performer.did]: 500, [w.principal.did]: 500 }));
    assert.deepEqual(await w.log.effectiveFault(j.ruling.id), { [w.performer.did]: 500, [w.principal.did]: 500 });
    // the first ruling's amounts (nothing released) no longer match: the corrected map is the formula
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(t0 + 74 * HOUR)))), "settlement_mismatches_ruling");
    const before = await w.log.balance(w.performer.did);
    const escrow = (await w.log.escrow(j.contract))!;
    const released = Math.floor((escrow.escrowLocked * 500) / 1000);
    const fees = Math.floor((released * 20) / 1000);
    await w.log.append(w.settle(j, w.at(t0 + 74 * HOUR), { released, fees, slashed: 0 }));
    assert.ok((await w.log.balance(w.performer.did)) - before >= released - 5, "the performer was paid by the corrected map: the appeal moved the money");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true);
  });

  test("a full reversal pays the performer the price: the settlement the log states for the corrected map is accepted, under the job tax", async () => {
    const w = await world();
    const j = await w.ruled(80, { [w.performer.did]: 1000 });
    const t0 = Date.parse(j.ruling.issued_at);
    const ap = await w.appeal(w.performer, j.ruling, HOUR);
    await w.log.append(ap);
    const panel = await w.appealPanel(j, ap.id);
    await w.log.append(w.appealRuling(ap, panel, "reversed", { [w.principal.did]: 1000 }));
    const stated = await w.log.rulingSettlement(j.contract, j.ruling.id, w.at(t0 + 80 * HOUR));
    assert.deepEqual(stated, { escrow_released: 80, fees: 1, bond_slashed: 0 });
    const before = await w.log.balance(w.performer.did);
    await w.log.append(w.settle(j, w.at(t0 + 80 * HOUR), { released: stated!.escrow_released, fees: stated!.fees, slashed: 0 }));
    assert.equal((await w.log.balance(w.performer.did)) - before, 80, "the performer, found without fault on appeal, is paid the price");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true);
  });

  test("an appeal that nobody decides stops holding the money after 7 days: the ruling stands", async () => {
    const w = await world();
    const j = await w.ruled();
    const t0 = Date.parse(j.ruling.issued_at);
    const ap = await w.appeal(w.performer, j.ruling, 2 * HOUR);
    await w.log.append(ap);
    assert.equal(APPEAL_FREEZE_MAX_MS, 7 * DAY);
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(t0 + 2 * HOUR + 7 * DAY - 60_000)))), "settlement_appeal_pending");
    await w.log.append(w.settle(j, w.at(t0 + 2 * HOUR + 7 * DAY)));
    assert.equal((await w.log.verify()).ok, true);
  });

  test("a waiver by both parties does not release an open appeal", async () => {
    const w = await world();
    const j = await w.ruled();
    await w.log.append(await w.appeal(w.principal, j.ruling, HOUR));
    assert.equal(await refusedBy(w.log.append(w.settle(j, w.at(Date.parse(j.ruling.issued_at) + 2 * HOUR), undefined, [w.principal, w.performer]))), "settlement_appeal_pending");
  });
});

describe("the appeal jurors are paid by the loser, and a reversed first-panel juror is penalised (S1400, DK121)", () => {
  test("affirmed: the appellant lost, so the Courts pay the five jurors from the fee the appellant paid; nobody is penalised", async () => {
    const w = await world();
    const j = await w.ruled();
    const ap = await w.appeal(w.performer, j.ruling, HOUR);
    await w.log.append(ap);
    const panel = await w.appealPanel(j, ap.id);
    const signing = panel.slice(0, 3);
    const before = { courts: await w.log.balance(COURTS), jurors: await Promise.all(signing.map((d) => w.log.balance(d))), firstStake: await Promise.all(j.firstPanel.map((d) => stake(w, d))), treasury: await w.log.balance(TREASURY_DID) };
    const decided = w.appealRuling(ap, panel, "affirmed");
    await w.log.append(decided);
    const paid = (await Promise.all(signing.map((d) => w.log.balance(d)))).reduce((n, b, i) => n + (b - before.jurors[i]), 0);
    assert.ok(paid > 0, "the signing jurors were paid");
    assert.equal(before.courts - (await w.log.balance(COURTS)), paid, "from the Courts' account: what the appellant paid");
    assert.equal(before.treasury, await w.log.balance(TREASURY_DID), "no penalty when the ruling stands");
    assert.deepEqual(await Promise.all(j.firstPanel.map((d) => stake(w, d))), before.firstStake);
    const m = JSON.parse((await w.log.store.transaction((tx) => tx.getMarker(`appeal_money:${decided.id}`))) ?? "null");
    assert.deepEqual(m.penalised, [], "the record says nobody was penalised");
    assert.equal(m.paid, paid);
    assert.equal(m.shortfall, 0);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true);
  });

  test("reversed: the other party pays the five jurors, each first-panel juror loses 20% of its stake to the Treasury, and the audit still balances", async () => {
    const w = await world();
    const j = await w.ruled(80, { [w.performer.did]: 1000 });
    const ap = await w.appeal(w.performer, j.ruling, HOUR);
    await w.log.append(ap);
    const panel = await w.appealPanel(j, ap.id);
    const signing = panel.slice(0, 3);
    const before = { principal: await w.log.balance(w.principal.did), performer: await w.log.balance(w.performer.did), jurors: await Promise.all(signing.map((d) => w.log.balance(d))), treasury: await w.log.balance(TREASURY_DID), courts: await w.log.balance(COURTS) };
    const supply = (await w.log.creditAudit()).verdict;
    assert.equal(supply, "balanced");
    const rec = w.appealRuling(ap, panel, "reversed", { [w.principal.did]: 1000 });
    await w.log.append(rec);
    const paid = (await Promise.all(signing.map((d) => w.log.balance(d)))).reduce((n, b, i) => n + (b - before.jurors[i]), 0);
    assert.ok(paid > 0, "the jurors were paid");
    assert.equal(before.principal - (await w.log.balance(w.principal.did)), paid, "by the loser of the appeal: the principal, whose fault the reversal found");
    assert.equal(await w.log.balance(COURTS), before.courts, "the Courts kept the fee for the refund");
    assert.equal(JUROR_PENALTY_PERMILLE, 200);
    for (const d of j.firstPanel) assert.equal(await stake(w, d), 80, `${d} lost 20 of its 100 stake`);
    assert.equal((await w.log.balance(TREASURY_DID)) - before.treasury, 20 * j.firstPanel.length, "the penalties went to the Treasury, not to a party");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true, "a replica replays the penalty and the payment the same way");
  });

  test("varied: the loser by the corrected map pays the jurors; a variation costs the first panel nothing", async () => {
    const w = await world();
    const j = await w.ruled(80, { [w.performer.did]: 1000 });
    const ap = await w.appeal(w.principal, j.ruling, HOUR);
    await w.log.append(ap);
    const panel = await w.appealPanel(j, ap.id);
    const stakes = await Promise.all(j.firstPanel.map((d) => stake(w, d)));
    const performerBefore = await w.log.balance(w.performer.did);
    await w.log.append(w.appealRuling(ap, panel, "varied", { [w.performer.did]: 700, [w.principal.did]: 300 }));
    assert.deepEqual(await Promise.all(j.firstPanel.map((d) => stake(w, d))), stakes, "no penalty on a variation");
    assert.ok(performerBefore - (await w.log.balance(w.performer.did)) > 0, "the performer carries more of the fault, so it pays the jurors");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });

  test("a loser who cannot pay the whole fee pays what it has: the shortfall is on the record, the jurors get that much, and nothing is created", async () => {
    const w = await world({ principalFunds: 84 });
    const j = await w.ruled(80, { [w.performer.did]: 1000 });
    const ap = await w.appeal(w.performer, j.ruling, HOUR);
    await w.log.append(ap);
    const panel = await w.appealPanel(j, ap.id);
    // the principal had 84 credits, 81 are locked in the escrow of this job and a little is spent: what is free is less than the jurors' share of the fee (4)
    const free = await w.log.balance(w.principal.did);
    assert.ok(free >= 1 && free < 4, `free balance ${free}`);
    const supplyBefore = await w.log.creditAudit();
    const decided = w.appealRuling(ap, panel, "reversed", { [w.principal.did]: 1000 });
    await w.log.append(decided);
    const m = JSON.parse((await w.log.store.transaction((tx) => tx.getMarker(`appeal_money:${decided.id}`))) ?? "null");
    assert.equal(m.owed, 4, "the Courts' share of a 5-credit appeal fee");
    assert.equal(m.paid, free, "what the principal had");
    assert.equal(m.shortfall, 4 - free);
    assert.equal(await w.log.balance(w.principal.did), 0);
    const after = await w.log.creditAudit();
    assert.equal(after.verdict, "balanced");
    assert.equal(after.minted, supplyBefore.minted, "no credit was minted by the ruling");
  });
});

