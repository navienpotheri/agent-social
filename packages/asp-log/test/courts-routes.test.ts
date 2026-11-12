/**
 * The Courts (docs/institutions/courts.md; register rows DK12 precedent, DK13 charter, small claims, appeals, caseload, conflicts; spec-delta S232).
 * Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cosign, type Signer } from "@agent-social/asp-core";
import { DEFAULT_ROUTES, closestPrecedents, priceBand, routeFor, articlesIn, type RulingEntry } from "../src/courts.ts";
import { DAY, courts, credit, jump, kit, mk, refusedBy, tick, type Party } from "./society-kit.ts";

const CODE = { version: "1.0", articles: ["4.1"] };
const charterText = readFileSync(fileURLToPath(new URL("../../../docs/court-charter.md", import.meta.url)), "utf8");
const TEXT_HASH = createHash("sha256").update(charterText).digest("hex");
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

async function world(o: { jurors?: number } = {}) {
  const k = await kit();
  await k.withPrices();
  const jurors: Party[] = [];
  for (let i = 0; i < (o.jurors ?? 9); i++) {
    const j = await k.person(`juror-${i}`, 500);
    await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null));
    jurors.push(j);
  }
  const principal = await k.person("claimant", 20_000);
  const sponsor = await k.person("agent-sponsor", 50);
  const performer = await k.agent("performer", sponsor, { funds: 2000 });
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  const dispute = async (price: number, reasons = ["the work is not good enough"], by = principal, perf = performer) => {
    const job = await k.runJob(by, perf, price, undefined, { settle: false });
    const rej = mk("attestation", by, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons }, job.delivery, { subject: job.contract });
    await k.log.append(rej);
    return { ...job, rej, price };
  };
  /** A ruling signed by enough of the drawn panel (a quorum), with any extra body fields. */
  const rule = async (d: { contract: string; rej: AspRecordLike }, verdict = "for_principal", extra: Record<string, unknown> = {}, signerCount?: number) => {
    const panel = await k.log.drawPanel(d.contract);
    const quorum = signerCount ?? Math.ceil(panel.length / 2);
    const [first, ...others] = panel.slice(0, quorum).map((x) => byDid.get(x)!);
    const fault = verdict === "for_principal" ? { [performer.did]: 1000 } : { [principal.did]: 1000 };
    let r = mk("attestation", first, defined({ kind: "ruling", about: d.contract, verdict, fault, reasons: ["decided on the record"], code: CODE, ...extra }), d.rej.id, { subject: d.contract });
    for (const s of others) r = cosign(r, s as Signer);
    return { record: r, panel };
  };
  const settleRuling = async (d: { contract: string }, rulingId: string) => k.log.append(cosign(mk("settlement", (await import("./harness.ts")).bank, { contract: d.contract, basis: "ruling", cites: rulingId, escrow_released: credit(0), fees: credit(0), bond_returned: credit(0), bond_slashed: credit(0) }, rulingId, { subject: d.contract }), principal as Signer));
  const charter = async (routes: Record<string, number> = DEFAULT_ROUTES as unknown as Record<string, number>, version = 1, by: Party = courts, effective?: string) => {
    const at = tick();
    return mk("court_act", by, { act: "charter", version, text_sha256: TEXT_HASH, routes, effective_from: effective ?? at }, null, { at });
  };
  return { ...k, jurors, principal, sponsor, performer, byDid, dispute, rule, settleRuling, charter };
}
type AspRecordLike = { id: string };

describe("the court charter (CT-6, DK13)", () => {
  test("the charter text is published, and a charter record carries its hash, every number, and a version", async () => {
    assert.match(charterText, /small claim/i);
    assert.match(charterText, /appeal/i);
    const w = await world({ jurors: 0 });
    assert.equal(await w.log.charterRoutes(), null, "none published yet");
    const stranger = await w.person("stranger");
    assert.equal(await refusedBy(w.log.append(await w.charter(undefined, 1, stranger))), "charter_wrong_issuer");
    const partial = { ...DEFAULT_ROUTES } as Record<string, number>; delete partial.appeal_panel;
    assert.equal(await refusedBy(w.log.append(await w.charter(partial))), "charter_incomplete");
    assert.equal(await refusedBy(w.log.append(await w.charter(undefined, 2))), "charter_version");
    await w.log.append(await w.charter());
    assert.deepEqual(await w.log.charterRoutes(), DEFAULT_ROUTES);
    assert.equal((await w.log.charters())[0].text_sha256, TEXT_HASH, "the record names the published text by hash");
  });

  test("a later charter takes effect 72 hours after it is published, and not before", async () => {
    const w = await world({ jurors: 0 });
    await w.log.append(await w.charter());
    const v2 = { ...DEFAULT_ROUTES, small_claim_max_price: 80 } as Record<string, number>;
    const now = Date.now();
    void now;
    assert.equal(await refusedBy(w.log.append(await w.charter(v2, 2, courts, iso(Date.parse("2026-11-01T00:00:00Z") + 3600_000)))), "charter_notice");
    const at = tick();
    await w.log.append(mk("court_act", courts, { act: "charter", version: 2, text_sha256: TEXT_HASH, routes: v2, effective_from: iso(Date.parse(at) + 72 * 3600_000) }, null, { at }));
    assert.equal((await w.log.charterRoutes())!.small_claim_max_price, 50, "not yet");
    jump(73 * 3600_000);
    assert.equal((await w.log.charterRoutes())!.small_claim_max_price, 80, "after the notice");
  });
});

describe("routes: small claim and standard (CT-8)", () => {
  test("pure: a price of 50 or less is a small claim (one juror, a flat fee of 2); 51 is standard", () => {
    assert.deepEqual(routeFor(50, DEFAULT_ROUTES), { route: "small_claim", panel: 1, flatFee: 2 });
    assert.deepEqual(routeFor(51, DEFAULT_ROUTES), { route: "standard", panel: 3, flatFee: null });
  });

  test("with a charter in force a 50-credit dispute is heard by one juror who is paid the flat fee by the loser; 51 has a panel of three; with no charter the panel is three at any price", async () => {
    const w = await world();
    const before = await w.dispute(40);
    assert.equal((await w.log.drawPanel(before.contract)).length, 3, "no charter: the panel is three");
    await w.log.append(await w.charter());
    const small = await w.dispute(50);
    const standard = await w.dispute(51);
    assert.equal((await w.log.drawPanel(small.contract)).length, 1, "a small claim has one juror");
    assert.equal((await w.log.drawPanel(standard.contract)).length, 3);
    const docket = await w.log.courtDocket();
    assert.deepEqual(docket.filter((d) => [small.contract, standard.contract].includes(d.contract)).map((d) => [d.route, d.panelSize]).sort(), [["small_claim", 1], ["standard", 3]]);
    // The one juror rules; the loser (the performer) pays the flat 2.
    const { record, panel } = await w.rule(small);
    assert.equal(panel.length, 1);
    const balanceBefore = await w.log.balance(panel[0]);
    await w.log.append(record);
    await w.settleRuling(small, record.id);
    assert.equal(await w.log.balance(panel[0]) - balanceBefore, 2, "a flat fee of 2, not 5 % of 50");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    // a route stated on the ruling must be the one the price gives
    const { record: wrong } = await w.rule(standard, "for_principal", { route: "small_claim" });
    assert.equal(await refusedBy(w.log.append(wrong)), "route_mismatch");
    const { record: right } = await w.rule(standard, "for_principal", { route: "standard" });
    await w.log.append(right);
  });
});

describe("caseload (CT-7)", () => {
  test("a claimant has at most 3 open disputes once a charter is in force; a settlement frees one", async () => {
    const w = await world();
    await w.log.append(await w.charter());
    const open = [await w.dispute(40), await w.dispute(40), await w.dispute(40)];
    const job = await w.runJob(w.principal, w.performer, 40, undefined, { settle: false });
    const fourth = mk("attestation", w.principal, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["no"] }, job.delivery, { subject: job.contract });
    assert.equal(await refusedBy(w.log.append(fourth)), "caseload_claimant_cap");
    const { record } = await w.rule(open[0]);
    await w.log.append(record);
    await w.settleRuling(open[0], record.id);
    await w.log.append(fourth);
    // another claimant is not limited by this one's cases
    const other = await w.person("other-claimant", 5000);
    await w.dispute(40, ["x"], other);
  });
});

describe("conflicts: who may not sit (CT-4)", () => {
  test("a juror who is the sponsor of the performer, shares its sponsor, or is in its fleet is never drawn", async () => {
    const w = await world({ jurors: 6 });
    // the performer's sponsor registers as a juror, and so does another agent of the same sponsor
    await w.mint(w.sponsor.did, 300);
    await w.log.append(mk("juror", w.sponsor, { did: w.sponsor.did, stake: credit(100) }, null));
    const sibling = await w.agent("sibling", w.sponsor, { funds: 300 });
    await w.log.append(mk("juror", sibling, { did: sibling.did, stake: credit(100) }, null));
    const d = await w.dispute(60);
    for (let size = 1; size <= 8; size++) {
      const panel = await w.log.drawPanel(d.contract, size);
      assert.ok(!panel.includes(w.sponsor.did) && !panel.includes(sibling.did), `size ${size}: ${panel.join(", ")}`);
    }
    assert.equal((await w.log.drawPanel(d.contract, 8)).length, 6, "the six unconflicted jurors are all that is left");
  });
});

describe("precedent (DK12, CT-1, CT-2)", () => {
  test("pure: the score is +3 per shared Article, +2 the same verdict, +1 the price band, +1 the route, and only scores above 3 are shown", () => {
    const e = (id: string, o: Partial<RulingEntry>): RulingEntry => ({ id, contract: "c" + id, verdict: "for_principal", route: "standard", band: "60_to_199", articles: ["4.1"], at: "2026-11-01T00:00:00Z", signers: [], principal: "p", performer: "f", reasons: [], precedents: [], ...o });
    const rulings = [e("a", {}), e("b", { articles: ["8.3"], verdict: "for_performer", band: "under_20", route: "small_claim" }), e("c", { articles: ["4.1", "8.3"], at: "2026-11-02T00:00:00Z" })];
    const hits = closestPrecedents({ articles: ["4.1", "8.3"], verdict: "for_principal", band: "60_to_199", route: "standard" }, rulings);
    assert.deepEqual(hits.map((h) => [h.ruling.id, h.score]), [["c", 10], ["a", 7]], "c shares two Articles; b shares one and nothing else (3), which is not above 3");
    assert.match(hits[0].why.join(" "), /Article 4.1, 8.3 \(\+6\)/);
    assert.deepEqual([19, 20, 59, 60, 199, 200].map(priceBand), ["under_20", "20_to_59", "20_to_59", "60_to_199", "60_to_199", "200_plus"]);
    assert.deepEqual(articlesIn(["breaches Article 4.1 and clause 8.3", "see Articles 12"]), ["4.1", "8.3", "12"]);
  });

  test("the panel is shown the closest precedents for a dispute, and a ruling can cite one; unknown, uncoded and unexplained citations are refused", async () => {
    const w = await world();
    // Two earlier rulings under Article 4.1 and one under 8.3.
    const old = [];
    for (const arts of [["4.1"], ["4.1"], ["8.3"]]) {
      const d = await w.dispute(120);
      const { record } = await w.rule(d, "for_principal", { code: { version: "1.0", articles: arts } });
      await w.log.append(record);
      old.push(record.id);
    }
    assert.equal((await w.log.precedentIndex()).length, 3);
    assert.deepEqual((await w.log.precedentSearch({ article: "4.1" })).map((r) => r.id).sort(), [old[0], old[1]].sort());
    assert.deepEqual((await w.log.precedentSearch({ article: "8.3" })).map((r) => r.id), [old[2]]);
    assert.equal((await w.log.precedentSearch({ route: "small_claim" })).length, 0);

    // A new dispute whose rejection cites Article 4.1: the panel's view lists the 4.1 rulings, not the 8.3 one.
    const d = await w.dispute(110, ["the delivery breaches Article 4.1"]);
    const shown = await w.log.precedentsFor(d.contract);
    assert.deepEqual(shown.query, { articles: ["4.1"], band: "60_to_199", route: "standard" });
    assert.deepEqual(shown.hits.map((h) => h.ruling.id).sort(), [old[0], old[1]].sort());
    assert.ok(shown.hits.every((h) => h.score === 5 && /Article 4.1/.test(h.why.join(" "))));
    // The ruling cites one of them and says it follows it.
    const { record: citing } = await w.rule(d, "for_principal", { precedents: [shown.hits[0].ruling.id], reasons: ["follows the earlier ruling under Article 4.1"] });
    await w.log.append(citing);
    assert.deepEqual((await w.log.precedentIndex()).find((r) => r.id === citing.id)!.precedents, [shown.hits[0].ruling.id], "the ruling cites a precedent and the index shows it");

    const d2 = await w.dispute(110);
    const bad = async (extra: Record<string, unknown>) => refusedBy(w.log.append((await w.rule(d2, "for_principal", extra)).record));
    assert.equal(await bad({ precedents: ["sha256:" + "4".repeat(64)] }), "precedent_unknown");
    assert.equal(await bad({ precedents: [old[0]], code: undefined }), "precedent_needs_code");
    assert.equal(await bad({ departs_from: [old[0]], reasons: undefined }), "departs_needs_reasons");
    await w.log.append((await w.rule(d2, "for_principal", { departs_from: [old[1]], reasons: ["the facts differ: the delivery here was partial"] })).record);
  });

  test("staged disputes between linked accounts do not enter the precedent store", async () => {
    const w = await world();
    const sibling = await w.agent("sibling-client", w.sponsor, { funds: 5000 });
    const staged = await w.dispute(120, ["x"], sibling as Party, w.performer); // the principal and the performer share one sponsor
    const { record } = await w.rule(staged);
    await w.log.append(record);
    assert.equal((await w.log.precedentIndex()).length, 0);
    const real = await w.dispute(120);
    await w.log.append((await w.rule(real)).record);
    assert.equal((await w.log.precedentIndex()).length, 1);
  });
});

describe("appeals (CT-10 to CT-12, DK13)", () => {
  async function ruled(w: Awaited<ReturnType<typeof world>>, price = 80) {
    const d = await w.dispute(price);
    const { record, panel } = await w.rule(d, "for_principal", {}, 2);
    await w.log.append(record);
    return { d, ruling: record, firstPanel: panel };
  }
  const appealRec = async (w: Awaited<ReturnType<typeof world>>, by: Party, ruling: string, service = "courts.appeal.small", over: Record<string, unknown> = {}) => {
    const fee = await w.buy(by, service, service === "courts.appeal.small" ? 5 : 20);
    return mk("court_act", by, { act: "appeal", ruling, grounds: "error_of_law", statement: "Article 4.1 was misapplied to this delivery", fee_paid: fee, ...over });
  };

  test("a party appeals once, inside 14 days, with the fee paid; others, a second appeal, a late one and a wrong fee are refused", async () => {
    const w = await world();
    const { ruling } = await ruled(w, 80);
    const outsider = await w.person("outsider", 100);
    assert.equal(await refusedBy(w.log.append(await appealRec(w, outsider, ruling.id))), "appeal_not_a_party");
    assert.equal(await refusedBy(w.log.append(await appealRec(w, w.performer, ruling.id, "courts.appeal.standard"))), "appeal_fee_unpaid", "80 is a small appeal (5), not the standard fee");
    const stolen = await appealRec(w, w.performer, ruling.id, "courts.appeal.small", { fee_paid: await w.buy(outsider, "courts.appeal.small", 5) });
    assert.equal(await refusedBy(w.log.append(stolen)), "appeal_fee_unpaid", "another's purchase does not pay");
    const first = await appealRec(w, w.performer, ruling.id);
    await w.log.append(first);
    assert.equal(await refusedBy(w.log.append(await appealRec(w, w.principal, ruling.id))), "appeal_once");
    // the window: exactly 14 days after the ruling is inside, one minute later is not
    const w2 = await world();
    const r2 = await ruled(w2, 80);
    const at = (extra: number) => iso(Date.parse(r2.ruling.issued_at) + 14 * DAY + extra);
    const late = mk("court_act", w2.performer, { act: "appeal", ruling: r2.ruling.id, grounds: "procedure", statement: "late", fee_paid: await w2.buy(w2.performer, "courts.appeal.small", 5) }, null, { at: at(60_000) });
    assert.equal(await refusedBy(w2.log.append(late)), "appeal_window_closed");
    const onTime = mk("court_act", w2.performer, { act: "appeal", ruling: r2.ruling.id, grounds: "procedure", statement: "on the last day", fee_paid: (late.body as { fee_paid: string }).fee_paid }, null, { at: at(0) });
    await w2.log.append(onTime);
    assert.equal(await refusedBy(w.log.append(mk("court_act", w.performer, { act: "appeal", ruling: first.id, grounds: "procedure", statement: "again", fee_paid: first.body && (first.body as { fee_paid: string }).fee_paid }))), "appeal_not_a_ruling", "an appeal is not a ruling");
  });

  test("the appeal is heard by a panel of five that excludes the first panel; a first-panel juror, a party or a short quorum is refused", async () => {
    const w = await world();
    const { d, ruling, firstPanel } = await ruled(w, 80);
    const appeal = await appealRec(w, w.performer, ruling.id);
    await w.log.append(appeal);
    // the draw for the appeal: five from the nine jurors, none of whom signed the first ruling
    const signers1 = [ruling.sig.kid, ...(ruling.cosigs ?? []).map((c) => c.kid)].map((k) => k.split("#")[0]);
    const { drawPanel } = await import("../src/index.ts");
    const panel = await drawPanel(w.log.store as never, { principal: w.principal.did, performer: w.performer.did, seed: appeal.id, size: DEFAULT_ROUTES.appeal_panel, exclude: signers1 });
    assert.equal(panel.length, 5);
    assert.ok(panel.every((p) => !signers1.includes(p)));
    const body = (over: Record<string, unknown> = {}) => defined({ act: "appeal_ruling", appeal: appeal.id, outcome: "reversed", fault: { [w.principal.did]: 1000 }, reasons: ["Article 4.1 does not reach this delivery"], code: CODE, ...over });
    const sign = (dids: string[], b: Record<string, unknown> = body()) => { const [f, ...rest] = dids.map((x) => w.byDid.get(x)!); let r = mk("court_act", f, b, null); for (const s of rest) r = cosign(r, s as Signer); return r; };
    const firstJuror = firstPanel.find((x) => signers1.includes(x))!;
    assert.equal(await refusedBy(w.log.append(sign([firstJuror, ...panel.slice(0, 2)]))), "appeal_panel_conflict");
    assert.equal(await refusedBy(w.log.append(sign(panel.slice(0, 2)))), "panel_quorum", "two of five is short of three");
    assert.equal(await refusedBy(w.log.append(sign(panel.slice(0, 3), body({ fault: undefined })))), "appeal_ruling_needs_fault");
    assert.equal(await refusedBy(w.log.append(sign(panel.slice(0, 3), body({ precedents: ["sha256:" + "4".repeat(64)] })))), "precedent_unknown");
    const decided = sign(panel.slice(0, 3));
    await w.log.append(decided);
    assert.equal(await refusedBy(w.log.append(sign(panel.slice(0, 3), body({ reasons: ["again"] })))), "appeal_decided");
    assert.equal(d.price, 80);
    assert.equal((await w.log.precedentIndex())[0].appeal?.outcome, "reversed", "the precedent store shows that the ruling was reversed on appeal");
  });

  test("the fee is returned when the appeal reverses or varies the ruling, and not when it is affirmed", async () => {
    const w = await world();
    const run = async (outcome: string) => {
      const { ruling } = await ruled(w, 80);
      const appeal = await appealRec(w, w.performer, ruling.id);
      await w.log.append(appeal);
      const signers1 = [ruling.sig.kid, ...(ruling.cosigs ?? []).map((c) => c.kid)].map((k) => k.split("#")[0]);
      const { drawPanel } = await import("../src/index.ts");
      const panel = await drawPanel(w.log.store as never, { principal: w.principal.did, performer: w.performer.did, seed: appeal.id, size: 5, exclude: signers1 });
      const [f, ...rest] = panel.slice(0, 3).map((x) => w.byDid.get(x)!);
      let r = mk("court_act", f, { act: "appeal_ruling", appeal: appeal.id, outcome, ...(outcome === "affirmed" ? {} : { fault: { [w.principal.did]: 1000 } }), reasons: ["decided"], code: CODE }, null);
      for (const s of rest) r = cosign(r, s as Signer);
      await w.log.append(r);
      return (appeal.body as { fee_paid: string }).fee_paid;
    };
    const kept = await run("affirmed");
    const refund = (purchase: string) => mk("receipt", courts, { purchase, status: "refunded", refund_amount: credit(5) }, purchase);
    assert.equal(await refusedBy(w.log.append(refund(kept))), "refund_appeal_not_reversed");
    const returned = await run("reversed");
    const before = await w.log.balance(w.performer.did);
    await w.log.append(refund(returned));
    assert.equal(await w.log.balance(w.performer.did) - before, 5, "the whole fee comes back (an essential item burns nothing)");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true, "a replica replays every route");
  });
});
