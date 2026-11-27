// A Court orders the Registry (register row DK120; spec-delta S466; courts.md 3, registry.md 5): a holder appeals a takedown to a panel, which restores the name with the price returned less the burn; a Court
// extends a suspension that would lapse without it; and the Registry refuses an order that no ruling names. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { REGISTRAR_DID, drawPanel } from "../src/index.ts";
import { NAME_TERM_MS } from "../src/registry.ts";
import { DAY, credit, jump, kit, mk, nowIso, refusedBy, registrar, tick, type Party } from "./society-kit.ts";

const CODE = { version: "1.0", articles: ["4.1"] };
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

async function world() {
  const k = await kit();
  await k.withPrices();
  const jurors: Party[] = [];
  for (let i = 0; i < 9; i++) { const j = await k.person(`co-juror-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null)); jurors.push(j); }
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  const sponsorA = await k.person("co-sponsor-a", 500), sponsorB = await k.person("co-sponsor-b", 500);
  const a = await k.agent("co-agent-a", sponsorA, { funds: 100 }), b = await k.agent("co-agent-b", sponsorB, { funds: 100 });
  const ma = await k.openMandate(a), mb = await k.openMandate(b);
  const claimAt = async (holder: Party, name: string, mandate: string) => {
    const paid = await k.buy(holder, "registry.name.claim", 10, { mandate });
    const at = tick();
    const rec = mk("registry_act", holder, { act: "name_claim", name, holder: holder.did, class: "agent", paid, valid_until: iso(Date.parse(at) + NAME_TERM_MS) }, null, { at });
    await k.log.append(rec);
    return { paid, id: rec.id };
  };
  /** A case's panel signs an institutional ruling: `n` of the drawn jurors. */
  const rule = async (caseId: string, holder: string, order: string, extra: Record<string, unknown> = {}, n = 2, by?: Party[]) => {
    const panel = await drawPanel(k.log.store as never, { principal: holder, performer: REGISTRAR_DID, seed: caseId, size: 3 });
    const signers = by ?? panel.slice(0, n).map((d) => byDid.get(d)!);
    const [first, ...rest] = signers;
    let r = mk("court_act", first, { act: "institutional_ruling", case: caseId, order, reasons: ["decided on the record"], code: CODE, ...extra }, null);
    for (const s of rest) r = cosign(r, s as Signer);
    return { record: r, panel };
  };
  const caseOf = async (holder: Party, subject: string, over: Record<string, unknown> = {}) => {
    const fee = await k.buy(holder, "courts.appeal.small", 5);
    return mk("court_act", holder, { act: "case", subject, grounds: "error_of_law", statement: "the name is a nickname and was not taken to be the genuine agent's", fee_paid: fee, ...over });
  };
  return { ...k, byDid, sponsorA, sponsorB, a, b, ma, mb, claimAt, rule, caseOf };
}

test("DK120 done (1): a holder appeals a takedown, a scripted panel restores the name, and the price comes back less the burn", async () => {
  const w = await world();
  await w.claimAt(w.a, "scout-7", w.ma);
  const claim = await w.claimAt(w.b, "scout-7-official", w.mb);
  const report = mk("registry_act", w.a, { act: "impersonation_report", target: "scout-7-official", genuine: w.a.did, grounds: "name_confusable", evidence: ["asp://profile/scout-7-official"] });
  await w.log.append(report);
  await w.log.append(mk("registry_act", w.b, { act: "name_reply", report: report.id, statement: "a nickname, not a copy" }));
  const tdAt = tick();
  const td = mk("registry_act", registrar, { act: "name_takedown", name: "scout-7-official", holder: w.b.did, report: report.id, reason: "the name contains scout-7 and presents itself as the same", code: CODE, effect: "name_removed", appealable_until: iso(Date.parse(tdAt) + 14 * DAY) }, null, { at: tdAt });
  await w.log.append(td);
  assert.equal(await w.log.registryPage("scout-7-official"), null, "the name is gone");

  // The case: only the holder, inside the window, with the fee paid, about a takedown, once.
  assert.equal(await refusedBy(w.log.append(await w.caseOf(w.a, td.id))), "case_not_the_holder");
  assert.equal(await refusedBy(w.log.append(await w.caseOf(w.b, report.id))), "case_subject", "a report is not a takedown");
  const stolen = await w.caseOf(w.b, td.id, { fee_paid: await w.buy(w.a, "courts.appeal.small", 5, { mandate: w.ma }) });
  assert.equal(await refusedBy(w.log.append(stolen)), "case_fee_unpaid", "another's purchase does not pay");
  const theCase = await w.caseOf(w.b, td.id);
  await w.log.append(theCase);
  assert.equal(await refusedBy(w.log.append(await w.caseOf(w.b, td.id))), "case_once");

  // The panel: jurors who are neither the holder nor the Registrar, a quorum of the drawn three; the wrong order for the case is refused.
  assert.equal(await refusedBy(w.log.append((await w.rule(theCase.id, w.b.did, "extend_suspension", { until: iso(Date.now() + 40 * DAY) })).record)), "order_not_for_this_case");
  assert.equal(await refusedBy(w.log.append((await w.rule(theCase.id, w.b.did, "restore_name", {}, 1)).record)), "panel_quorum", "one of the three is not a quorum");
  assert.equal(await refusedBy(w.log.append((await w.rule(theCase.id, w.b.did, "restore_name", {}, 2, [w.b])).record)), "case_panel_conflict", "the holder does not sit");
  // The Registry refuses to restore before any ruling names the order.
  const restore = (ruling: string, over: Record<string, unknown> = {}) => mk("registry_act", registrar, { act: "name_restore", name: "scout-7-official", holder: w.b.did, takedown: td.id, ruling, ...over });
  assert.equal(await refusedBy(w.log.append(restore(td.id))), "order_no_ruling", "an order that no ruling names");
  assert.equal(await refusedBy(w.log.append(restore("sha256:" + "5".repeat(64)))), "order_no_ruling");
  // The price is not returned for the asking: a refund before the name is restored is refused.
  const refund = (amount: number) => mk("receipt", registrar, { purchase: claim.paid, status: "refunded", refund_amount: credit(amount) }, claim.paid);
  assert.equal(await refusedBy(w.log.append(refund(9))), "refund_name_not_restored");

  const ruling = await w.rule(theCase.id, w.b.did, "restore_name");
  await w.log.append(ruling.record);
  assert.equal(await refusedBy(w.log.append((await w.rule(theCase.id, w.b.did, "uphold")).record)), "case_decided", "ruled once");
  assert.equal(await refusedBy(w.log.append(restore(ruling.record.id, { name: "scout-7" }))), "order_not_this_name");
  assert.equal(await refusedBy(w.log.append(restore(ruling.record.id, { holder: w.a.did }))), "order_not_this_takedown");
  assert.equal(await refusedBy(w.log.append(mk("registry_act", w.b, { act: "name_restore", name: "scout-7-official", holder: w.b.did, takedown: td.id, ruling: ruling.record.id }))), "registry_wrong_issuer", "the holder cannot restore its own name: the Registry acts");
  await w.log.append(restore(ruling.record.id));
  assert.equal((await w.log.registryPage(w.b.did))?.names.join(), "scout-7-official", "the name is back on the holder's page");
  assert.equal(await refusedBy(w.log.append(restore(ruling.record.id))), "order_used", "carried out once");

  // The price comes back less the burn (a name claim burns 100 permille: 1 of 10), and the case fee comes back too.
  const before = await w.log.balance(w.b.did);
  assert.equal(await refusedBy(w.log.append(refund(10))), "refund_exceeds_price_less_burn");
  await w.log.append(refund(9));
  assert.equal(await w.log.balance(w.b.did), before + 9, "the price less the burn is returned");
  const caseFee = (theCase.body as { fee_paid: string }).fee_paid;
  await w.log.append(mk("receipt", (await import("./society-kit.ts")).courts, { purchase: caseFee, status: "refunded", refund_amount: credit(5) }, caseFee));
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.log.verify()).ok, true, "a replay reproduces the log, including the order");
});

test("DK120 done (2): a Court ruling extends a suspension that lapses without one", async () => {
  const w = await world();
  const sus = mk("registry_act", registrar, { act: "identity_suspension", holder: w.a.did, reason: "credible harm to a third party was reported", code: CODE, until: iso(Date.parse(nowIso()) + 7 * DAY) });
  await w.log.append(sus);
  const purchase = () => w.buy(w.a, "registry.name.claim", 10, { mandate: w.ma });
  assert.equal(await refusedBy(purchase()), "identity_suspended", "a suspended identity buys nothing");
  const theCase = await w.caseOf(w.a, sus.id, { grounds: "procedure", statement: "the harm reported was not shown to be this agent's" });
  await w.log.append(theCase);
  const until = iso(Date.parse(nowIso()) + 30 * DAY);
  assert.equal(await refusedBy(w.log.append((await w.rule(theCase.id, w.a.did, "extend_suspension", { until: iso(Date.parse(nowIso()) + 3 * DAY) })).record)), "extension_not_later");
  assert.equal(await refusedBy(w.log.append((await w.rule(theCase.id, w.a.did, "extend_suspension", { until: iso(Date.now() + 200 * DAY) })).record)), "extension_too_long");
  assert.equal(await refusedBy(w.log.append((await w.rule(theCase.id, w.a.did, "restore_name")).record)), "order_not_for_this_case");
  const ruling = await w.rule(theCase.id, w.a.did, "extend_suspension", { until });
  await w.log.append(ruling.record);
  const extend = (ruling_: string, over: Record<string, unknown> = {}) => mk("registry_act", registrar, { act: "suspension_extend", suspension: sus.id, ruling: ruling_, until, ...over });
  assert.equal(await refusedBy(w.log.append(extend(sus.id))), "order_no_ruling", "no ruling names this order");
  assert.equal(await refusedBy(w.log.append(extend(ruling.record.id, { until: iso(Date.parse(until) + DAY) }))), "extension_until_mismatch", "the ruling's date, not another");
  assert.equal(await refusedBy(w.log.append(mk("registry_act", w.a, { act: "suspension_extend", suspension: sus.id, ruling: ruling.record.id, until }))), "registry_wrong_issuer");
  await w.log.append(extend(ruling.record.id));
  assert.equal(await refusedBy(w.log.append(extend(ruling.record.id))), "order_used");

  // Eight days on, the Registrar's own 7 days have lapsed; the Court's extension holds.
  jump(8 * DAY);
  assert.equal(await refusedBy(purchase()), "identity_suspended", "still suspended: the Court extended it");
  assert.equal((await w.log.registryPage(w.a.did, nowIso()))?.suspended?.until, until, "the page shows the extended end");
  jump(25 * DAY);
  await purchase(); // after the extension ends it lapses on its own
  // The control: the same suspension with no case lapses at 7 days.
  const w2 = await world();
  const s2 = mk("registry_act", registrar, { act: "identity_suspension", holder: w2.a.did, reason: "credible harm to a third party was reported", code: CODE, until: iso(Date.parse(nowIso()) + 7 * DAY) });
  await w2.log.append(s2);
  jump(8 * DAY);
  await w2.buy(w2.a, "registry.name.claim", 10, { mandate: w2.ma });
  assert.equal((await w.log.verify()).ok, true);
});
