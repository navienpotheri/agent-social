// Founding a market institution (register row DK397; spec-delta S505): a proposal under an entry stake held in escrow, a panel review, probation, a yearly renewal, a merge as a closing with a successor, and
// the charter of DK382 signed by the founder. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { ENTRY_STAKE, FOUNDING_STAKE_DID, FOUNDER_LIMIT, GRACE_DAYS, PROBATION_DAYS, TERM_DAYS, drawPanel } from "../src/index.ts";
import { DAY, credit, jump, kit, mk, nowIso, party, refusedBy, registrar, type Party } from "./society-kit.ts";

const M = (name: string) => `did:web:asp.local:market:${name}`;
const later = (days: number) => new Date(Date.parse(nowIso()) + days * DAY).toISOString().replace(".000Z", "Z");
const HASH = "sha256:" + "7".repeat(64);

async function world() {
  const k = await kit();
  const jurors: Party[] = [];
  for (let i = 0; i < 9; i++) { const j = await k.person(`fd-juror-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null)); jurors.push(j); }
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  const founder = await k.person("fd-founder", 2000);
  const other = await k.person("fd-other", 2000);
  const propose = (by: Party, name: string, over: Record<string, unknown> = {}) =>
    mk("founding_act", by, { act: "propose", institution: M(name), name: `The ${name}`, purpose: "Sells reviewed tasks to agents, under a charter", stake: credit(ENTRY_STAKE), ...over }, null);
  const review = async (proposalId: string, founderDid: string, decision: "approve" | "reject", n = 2, by?: Party[]) => {
    const panel = await drawPanel(k.log.store as never, { principal: founderDid, performer: founderDid, seed: proposalId, size: 3 });
    const signers = by ?? panel.slice(0, n).map((d) => byDid.get(d)!);
    const [first, ...rest] = signers;
    let r = mk("founding_act", first, { act: "review", proposal: proposalId, decision, reasons: ["decided on the record"] }, null);
    for (const s of rest) r = cosign(r, s as Signer);
    return r;
  };
  const found = async (by: Party, name: string) => { const p = propose(by, name); await k.log.append(p); await k.log.append(await review(p.id, by.did, "approve")); return p; };
  const charter = (by: Signer & { did: string }, name: string, over: Record<string, unknown> = {}) =>
    mk("institution_charter", by, { institution: M(name), version: 1, kind: "market", status: "active", text_sha256: HASH, effective_from: nowIso(), officers: [founder.did], funding: "none", ...over }, null);
  return { k, jurors, founder, other, propose, review, found, charter };
}

test("a proposal locks the entry stake in escrow; a stranger, a bad name, the wrong stake, a taken name and a third institution are refused", async () => {
  const w = await world();
  const log = w.k.log;
  const stranger = party("did:web:example.com:users:stranger");
  assert.ok(await refusedBy(log.append(w.propose(stranger, "none"))), "a stranger with no key or passport here is refused");
  assert.equal(await refusedBy(log.append(w.propose(w.founder, "x", { institution: "did:web:asp.local:market:" }))), "founding_name");
  assert.equal(await refusedBy(log.append(w.propose(w.founder, "x", { institution: "did:web:example.com:market:x" }))), "founding_name");
  assert.equal(await refusedBy(log.append(w.propose(w.founder, "x", { stake: credit(ENTRY_STAKE - 1) }))), "founding_stake");

  const before = await log.balance(w.founder.did);
  const p = w.propose(w.founder, "bakery");
  await log.append(p);
  assert.equal(await log.balance(w.founder.did), before - ENTRY_STAKE);
  assert.equal(await log.balance(FOUNDING_STAKE_DID), ENTRY_STAKE);
  assert.equal((await log.creditAudit()).verdict, "balanced", "a stake is a lock, not a mint or a burn");
  assert.equal((await log.marketInstitution(M("bakery")))!.status, "proposed");
  assert.equal(await refusedBy(log.append(w.propose(w.other, "bakery"))), "founding_taken");
  await log.append(w.propose(w.founder, "mill"));
  assert.equal(FOUNDER_LIMIT, 2);
  assert.equal(await refusedBy(log.append(w.propose(w.founder, "third"))), "founding_limit");
});

test("a panel quorum reviews: a rejection returns the stake whole and frees the founder; an approval starts probation; the founder and the Registrar do not sit", async () => {
  const w = await world();
  const log = w.k.log;
  const p = w.propose(w.founder, "bakery");
  await log.append(p);
  assert.equal(await refusedBy(log.append(await w.review(p.id, w.founder.did, "approve", 1))), "panel_quorum");
  assert.equal(await refusedBy(log.append(await w.review(p.id, w.founder.did, "approve", 2, [w.founder]))), "founding_panel_conflict");
  assert.equal(await refusedBy(log.append(await w.review(p.id, w.founder.did, "approve", 2, [registrar as Party]))), "founding_panel_conflict");
  assert.equal(await refusedBy(log.append(await w.review("sha256:" + "3".repeat(64), w.founder.did, "approve"))), "founding_review_unknown");

  const before = await log.balance(w.founder.did);
  await log.append(await w.review(p.id, w.founder.did, "reject"));
  assert.equal(await log.balance(w.founder.did), before + ENTRY_STAKE);
  assert.equal(await log.balance(FOUNDING_STAKE_DID), 0);
  assert.equal((await log.marketInstitution(M("bakery")))!.status, "rejected");
  assert.equal(await refusedBy(log.append(await w.review(p.id, w.founder.did, "approve"))), "founding_review_unknown", "reviewed once");
  // The rejection freed a place: two more can be proposed.
  await log.append(w.propose(w.founder, "mill"));
  await log.append(w.propose(w.founder, "forge"));

  await w.found(w.other, "granary");
  const st = (await log.marketInstitution(M("granary")))!;
  assert.equal(st.status, "probation");
  assert.equal(Date.parse(st.probationUntil!) - Date.parse(st.approvedAt!), PROBATION_DAYS * DAY);
  assert.equal(Date.parse(st.validUntil!) - Date.parse(st.approvedAt!), TERM_DAYS * DAY);
});

test("the charter of a market institution is the founder's: after approval only, no funding line on probation, and a closing returns the stake", async () => {
  const w = await world();
  const log = w.k.log;
  assert.equal(await refusedBy(log.append(w.charter(w.founder, "bakery"))), "charter_market_not_founded", "no founding yet");
  await w.found(w.founder, "bakery");
  assert.equal(await refusedBy(log.append(w.charter(w.other, "bakery"))), "charter_market_not_the_founder");
  assert.equal(await refusedBy(log.append(w.charter(w.founder, "bakery", { funding: "the-treasury-line" }))), "charter_market_probation");
  assert.equal(await refusedBy(log.append(w.charter(w.founder, "bakery", { officers: [w.other.did] }))), "charter_market_officers");
  await log.append(w.charter(w.founder, "bakery"));
  assert.equal((await log.marketInstitution(M("bakery")))!.status, "probation");

  // A closing: the next version, 72 hours on, with a reason; the stake comes back whole.
  const before = await log.balance(w.founder.did);
  jump(DAY);
  await log.append(w.charter(w.founder, "bakery", { version: 2, status: "closed", reason: "no demand for it", effective_from: later(4) }));
  assert.equal(await log.balance(w.founder.did), before + ENTRY_STAKE);
  assert.equal(await log.balance(FOUNDING_STAKE_DID), 0);
  assert.equal((await log.marketInstitution(M("bakery")))!.status, "closed");
  assert.equal((await log.creditAudit()).verdict, "balanced");
  assert.equal(await refusedBy(log.append(w.charter(w.founder, "bakery", { version: 3, effective_from: later(8) }))), "charter_market_not_founded", "a closed institution is not amended");
});

test("probation ends at day 90; a renewal is made in the last 60 days of a term, never in probation or too early; after the grace the institution has lapsed", async () => {
  const w = await world();
  const log = w.k.log;
  await w.found(w.founder, "bakery");
  const renew = (by: Party, name = "bakery") => mk("founding_act", by, { act: "renew", institution: M(name) }, null);
  assert.equal(await refusedBy(log.append(renew(w.founder))), "renew_in_probation");
  jump((PROBATION_DAYS + 1) * DAY);
  assert.equal((await log.marketInstitution(M("bakery")))!.status, "active");
  assert.equal(await refusedBy(log.append(renew(w.founder))), "renew_too_early");
  jump((TERM_DAYS - 60 - PROBATION_DAYS - 1 + 1) * DAY);
  assert.equal(await refusedBy(log.append(renew(w.other))), "renew_not_the_founder");
  const term1 = (await log.marketInstitution(M("bakery")))!.validUntil!;
  await log.append(renew(w.founder));
  const term2 = (await log.marketInstitution(M("bakery")))!.validUntil!;
  assert.equal(Date.parse(term2) - Date.parse(term1), TERM_DAYS * DAY, "a renewal adds a year");

  // Let a second institution run out: past its term and the grace, it has lapsed, and neither a renewal nor a charter amendment is taken.
  const w2 = await world();
  await w2.found(w2.founder, "mill");
  jump((TERM_DAYS + GRACE_DAYS + 1) * DAY);
  assert.equal((await w2.k.log.marketInstitution(M("mill")))!.status, "lapsed");
  assert.equal(await refusedBy(w2.k.log.append(mk("founding_act", w2.founder, { act: "renew", institution: M("mill") }, null))), "institution_lapsed");
  assert.equal(await refusedBy(w2.k.log.append(w2.charter(w2.founder, "mill", { effective_from: later(4) }))), "institution_lapsed");
});

test("a merge is a closing with a successor: both founders sign, both institutions are past probation and in term, and the closed founder's stake returns whole", async () => {
  const w = await world();
  const log = w.k.log;
  await w.found(w.founder, "bakery");
  await w.found(w.other, "mill");
  const merge = (signers: Party[], a = "bakery", b = "mill") => { const [first, ...rest] = signers; let r = mk("founding_act", first, { act: "merge", institution: M(a), successor: M(b) }, null); for (const s of rest) r = cosign(r, s as Signer); return r; };
  assert.equal(await refusedBy(log.append(merge([w.founder, w.other]))), "merge_not_active", "both are on probation");
  jump((PROBATION_DAYS + 1) * DAY);
  assert.equal(await refusedBy(log.append(merge([w.founder]))), "merge_needs_both");
  assert.equal(await refusedBy(log.append(merge([w.founder, w.other], "bakery", "bakery"))), "merge_self");
  assert.equal(await refusedBy(log.append(merge([w.founder, w.other], "bakery", "nothing"))), "merge_successor");

  const before = { f: await log.balance(w.founder.did), o: await log.balance(w.other.did) };
  await log.append(merge([w.founder, w.other]));
  assert.equal(await log.balance(w.founder.did), before.f + ENTRY_STAKE, "the closed institution's founder gets its stake back");
  assert.equal(await log.balance(w.other.did), before.o, "the successor keeps its own stake in escrow");
  assert.equal(await log.balance(FOUNDING_STAKE_DID), ENTRY_STAKE);
  const a = (await log.marketInstitution(M("bakery")))!;
  assert.deepEqual([a.status, a.mergedInto], ["merged", M("mill")]);
  assert.equal((await log.marketInstitution(M("mill")))!.status, "active");
  assert.equal(await refusedBy(log.append(merge([w.founder, w.other]))), "merge_not_founded", "a merged institution is not merged again");
  assert.equal((await log.creditAudit()).verdict, "balanced");
  assert.equal((await log.verify()).ok, true, "replay reproduces the foundings, the stakes and the merge");
});
