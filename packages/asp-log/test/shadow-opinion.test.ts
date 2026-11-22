/**
 * The observer phase of a community juror (register row DK122; spec-delta S1705; courts.md CT-14): a registered juror who is not a party signs how it would decide a disputed case before any ruling, once; after the
 * ruling `observerRecord` compares it with the verdict, counts only cases ruled without the observer on the panel, and the phase is complete at five. The opinion moves no credits. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OBSERVER_CASES } from "../src/index.ts";
import { credit, kit, mk, refusedBy, type Party } from "./society-kit.ts";

const CODE = { version: "1.0", articles: ["4.1"] };

async function world() {
  const k = await kit();
  const principal = await k.person("so-claimant", 50_000);
  const performer = await k.agent("so-performer", await k.person("so-sponsor", 50), { funds: 5000 });
  const judge = await k.person("so-judge", 500);
  const observer = await k.person("so-observer", 500);
  const outsider = await k.person("so-outsider", 500);
  const stake = async (p: Party, value: number) => { const cur = await k.log.store.getJuror(p.did); await k.log.append(mk("juror", p, { did: p.did, stake: credit(value) }, cur?.head ?? null)); };
  await stake(observer, 100); await stake(judge, 100);
  // an observer is not on the bench while it observes: it withdraws its stake to be drawn out of the panel, and takes it up again to sit
  const bench = async (observing: boolean) => { await stake(observer, observing ? 0 : 100); await stake(judge, observing ? 100 : 0); };
  const dispute = async () => {
    const j = await k.runJob(principal, performer, 80, undefined, { settle: false });
    const rej = mk("attestation", principal, { kind: "acceptance", about: j.delivery, verdict: "rejected", reasons: ["not what I asked for"] }, j.delivery, { subject: j.contract });
    await k.log.append(rej);
    return { ...j, rej };
  };
  const rule = async (d: { contract: string; rej: { id: string } }, verdict: "for_principal" | "for_performer", by: Party = judge) => {
    const r = mk("attestation", by, { kind: "ruling", about: d.contract, verdict, fault: { [verdict === "for_principal" ? performer.did : principal.did]: 1000 }, reasons: ["decided on the record"], code: CODE }, d.rej.id, { subject: d.contract });
    await k.log.append(r);
    return r;
  };
  const opine = (by: Party, contract: string, verdict = "for_principal") => mk("shadow_opinion", by, { contract, verdict, reasons: "the delivery does not meet the criteria as written" }, null, { subject: contract });
  return { k, principal, performer, judge, observer, outsider, dispute, rule, opine, bench };
}

test("DK122: a shadow opinion is refused for a party, a non-juror, a case not in dispute, a case already ruled and a second opinion; each rule is named", async () => {
  assert.equal(OBSERVER_CASES, 5);
  const w = await world();
  const open = await w.k.runJob(w.principal, w.performer, 80, undefined, { settle: false });
  assert.equal(await refusedBy(w.k.log.append(w.opine(w.observer, open.contract))), "shadow_no_dispute", "a delivered job nobody has rejected is not in dispute");
  const settled = await w.k.runJob(w.principal, w.performer, 80);
  assert.equal(await refusedBy(w.k.log.append(w.opine(w.observer, settled.contract))), "shadow_after_ruling", "a settled job is past any ruling");
  const d = await w.dispute();
  assert.equal(await refusedBy(w.k.log.append(w.opine(w.principal, d.contract))), "shadow_party");
  assert.equal(await refusedBy(w.k.log.append(w.opine(w.performer, d.contract))), "shadow_party");
  assert.equal(await refusedBy(w.k.log.append(w.opine(w.outsider, d.contract))), "shadow_unknown_juror", "an observer is a registered juror");
  assert.equal(await refusedBy(w.k.log.append(w.opine(w.observer, "sha256:" + "9".repeat(64)))), "shadow_unknown_contract");
  const before = await w.k.log.balance(w.observer.did);
  await w.k.log.append(w.opine(w.observer, d.contract));
  assert.equal(await refusedBy(w.k.log.append(w.opine(w.observer, d.contract, "split"))), "shadow_known", "once for a case");
  assert.equal(await w.k.log.balance(w.observer.did), before, "an opinion moves no credits");
  await w.bench(true);
  await w.rule(d, "for_principal");
  const d2 = await w.dispute();
  await w.rule(d2, "for_performer");
  assert.equal(await refusedBy(w.k.log.append(w.opine(w.observer, d2.contract))), "shadow_after_ruling", "after the ruling an opinion proves nothing");
});

test("DK122: the observer record counts only ruled cases, compares each opinion with the ruling's verdict, leaves out a case where the observer sat on the panel, and completes the phase at five", async () => {
  const w = await world();
  const rec0 = await w.k.log.observerRecord(w.observer.did);
  assert.deepEqual([rec0.opinions, rec0.closed, rec0.agreementPermille, rec0.phaseComplete], [0, 0, null, false]);
  const cases = [];
  for (let i = 0; i < 6; i++) { const d = await w.dispute(); await w.k.log.append(w.opine(w.observer, d.contract, i % 3 === 2 ? "for_performer" : "for_principal")); cases.push(d); }
  const unruled = await w.k.log.observerRecord(w.observer.did);
  assert.deepEqual([unruled.opinions, unruled.closed, unruled.phaseComplete], [6, 0, false], "an unruled case does not count");
  await w.bench(true);
  for (let i = 0; i < 4; i++) await w.rule(cases[i], "for_principal"); // opinions 0,1 agree; 2 (for_performer) and 3 (for_principal): 0,1,3 agree
  const four = await w.k.log.observerRecord(w.observer.did);
  assert.deepEqual([four.closed, four.agreed, four.agreementPermille, four.phaseComplete], [4, 3, 750, false], "four closed is not five");
  await w.rule(cases[4], "for_performer"); // opinion 4 was for_principal: disagrees
  const five = await w.k.log.observerRecord(w.observer.did);
  assert.deepEqual([five.closed, five.agreed, five.agreementPermille, five.phaseComplete], [5, 3, 600, true], "five closed completes the phase; disagreement does not stop it");
  await w.bench(false);
  await w.rule(cases[5], "for_principal", w.observer); // the observer itself signs the ruling: it sat on the panel
  const sat = await w.k.log.observerRecord(w.observer.did);
  assert.equal(sat.closed, 5, "a case where the observer sat on the panel is not counted");
  assert.equal((await w.k.log.observerRecord(w.outsider.did)).opinions, 0);
});
