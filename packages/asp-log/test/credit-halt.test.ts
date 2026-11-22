// Register row DK1229 (spec-delta S1653): the Treasury's circuit breaker on the Bank's withdrawals and the Insurer's claim payments, tested on the real log with a scripted crowd. With no halt a crowd of ten depositors
// that all ask at once drains the Bank's free reserve first come first served and the last ones are paid nothing; with a halt signed by the Treasury the same crowd is queued, the reserve is kept, and when the halt is
// lifted everyone owed is paid the same share. Supply is unchanged either way (the audit is balanced), the halt is a signed record, and the rules of the halt itself are each a named refusal. Fake keys only.
// Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { staticResolver } from "@agent-social/asp-core";
import { BANK_DID, EventLog, INSURER_DID, MemoryStore, TREASURY_DID } from "../src/index.ts";
import { Kit, bankP, clinic, courts, credit, operator, owner, party, refused, registrar, treasury, type Party } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

async function crowdWorld() {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 5000);
  const holders: Party[] = [];
  for (let i = 0; i < 10; i++) { const p = await kit.person(`ch-${i}`); await kit.mint(p.did, 500); holders.push(p); }
  const bank = (by: Party, body: Record<string, unknown>, at?: string) => kit.mk("bank_act" as never, by, body, null, { subject: null, ...(at ? { at } : {}) });
  const halt = (body: Record<string, unknown>) => kit.mk("credit_halt" as never, treasury, body, null, { subject: null });
  // Ten holders deposit 100 each: the Bank holds 1000. The Treasury borrows 500 (the most it may), so 500 is free to pay withdrawals.
  for (const h of holders) await kit.put(bank(h, { act: "deposit", holder: h.did, amount: credit(100) }));
  await kit.put(bank(treasury, { act: "borrow", amount: credit(500) }));
  const audit = async (why: string) => { const a = await kit.log.creditAudit(); assert.equal(a.verdict, "balanced", `${why}: ${a.problems.join("; ")}`); };
  const owed = async () => Promise.all(holders.map(async (h) => (await kit.log.store.transaction((tx) => tx.getMarker(`bankdep:${h.did}`))) ?? "0").map((p) => p.then(Number)));
  return { kit, holders, bank, halt, audit, owed };
}

test("DK1229: with no halt the crowd drains the free reserve first come first served and the last holders are paid nothing", async () => {
  const w = await crowdWorld();
  const before = await w.kit.log.balance(BANK_DID);
  assert.equal(before, 500, "the Bank holds 1000 and has lent 500: 500 is free");
  for (const h of w.holders) await w.kit.put(w.bank(h, { act: "withdraw", holder: h.did, amount: credit(100) }));
  assert.equal(await w.kit.log.balance(BANK_DID), 0, "the free reserve is exhausted");
  const held = await w.owed();
  assert.equal(held.filter((d) => d === 0).length, 5, "the first five were paid in full");
  assert.equal(held.filter((d) => d === 100).length, 5, "the last five are paid nothing yet: they still hold their whole deposit and wait");
  await w.audit("no halt");
});

test("DK1229: with a halt the same crowd is queued, the reserve is kept, and on the lift everyone owed is paid the same share; the halt and the lift are signed records and supply is unchanged", async () => {
  const w = await crowdWorld();
  const t0 = Date.parse(w.kit.now());
  const stop = await w.kit.put(w.halt({ act: "halt", institution: "bank", reason: "a run on withdrawals after a rumour", until: iso(t0 + 3 * DAY) }));
  for (const h of w.holders) await w.kit.put(w.bank(h, { act: "withdraw", holder: h.did, amount: credit(100) }));
  assert.equal(await w.kit.log.balance(BANK_DID), 500, "nothing was paid during the halt: the reserve is whole");
  for (const h of w.holders) assert.equal(await w.kit.log.balance(h.did), 400, "no one was paid ahead of another");
  assert.equal(await refused(w.kit.put(w.bank(treasury, { act: "borrow", amount: credit(1) }))), "bank_halted", "the Bank lends nothing during a halt");
  // A deposit is still taken during a halt.
  const extra = await w.kit.person("ch-extra"); await w.kit.mint(extra.did, 50);
  await w.kit.put(w.bank(extra, { act: "deposit", holder: extra.did, amount: credit(50) }));
  // The lift pays the queue in proportion: 550 free (500 + the new deposit) against 1000 asked, so 55 percent each.
  await w.kit.put(w.halt({ act: "lift", institution: "bank", reason: "the rumour is answered", halt: stop }));
  const paid = await Promise.all(w.holders.map((h) => w.kit.log.balance(h.did)));
  assert.deepEqual(paid, Array(10).fill(400 + 55), "each holder received the same share, 55 of the 100 asked");
  assert.equal(await w.kit.log.balance(BANK_DID), 0, "the whole free reserve was shared out");
  const hist = await w.kit.log.creditHaltHistory();
  assert.deepEqual(hist.map((h) => [h.act, h.institution]), [["halt", "bank"], ["lift", "bank"]], "the halt and its lift are public records");
  await w.audit("halt then lift");
  assert.equal((await w.kit.log.verify()).ok, true, "the replay rebuilds the halt and the proportional payment");
});

test("DK1229: a halt that ends by its sunset is paid out by the next act in proportion, and what is not paid still waits", async () => {
  const w = await crowdWorld();
  const t0 = Date.parse(w.kit.now());
  await w.kit.put(w.halt({ act: "halt", institution: "bank", reason: "a run", until: iso(t0 + 2 * 3_600_000) }));
  for (const h of w.holders.slice(0, 4)) await w.kit.put(w.bank(h, { act: "withdraw", holder: h.did, amount: credit(100) }));
  assert.equal(await w.kit.log.balance(BANK_DID), 500);
  w.kit.addDays(1); // past the sunset
  // The next act, here one more withdrawal, finds the halt over and pays the queue: 500 free covers the 400 asked, all paid in full.
  await w.kit.put(w.bank(w.holders[4], { act: "withdraw", holder: w.holders[4].did, amount: credit(100) }));
  const got = await Promise.all(w.holders.slice(0, 5).map((h) => w.kit.log.balance(h.did)));
  assert.deepEqual(got, Array(5).fill(500), "after the sunset the queue is paid and the new withdrawal too");
  await w.audit("sunset");
});

test("DK1229: only the Treasury halts, a halt has a sunset of at most seven days, one is live at a time, a lift names the live halt, and a lift ends it", async () => {
  const w = await crowdWorld();
  const t0 = Date.parse(w.kit.now());
  const bad = w.kit.mk("credit_halt" as never, w.holders[0], { act: "halt", institution: "bank", reason: "x", until: iso(t0 + DAY) }, null, { subject: null });
  assert.equal(await refused(w.kit.put(bad)), "credit_halt_wrong_issuer");
  assert.equal(await refused(w.kit.put(w.halt({ act: "halt", institution: "bank", reason: "x", until: iso(t0 - DAY) }))), "credit_halt_until_past");
  assert.equal(await refused(w.kit.put(w.halt({ act: "halt", institution: "bank", reason: "x", until: iso(t0 + 8 * DAY) }))), "credit_halt_too_long");
  await w.kit.put(w.halt({ act: "halt", institution: "bank", reason: "x", until: iso(t0 + 7 * DAY - 3_600_000) }));
  assert.equal(await refused(w.kit.put(w.halt({ act: "halt", institution: "bank", reason: "again", until: iso(t0 + DAY) }))), "credit_halt_already_live");
  assert.equal(await refused(w.kit.put(w.halt({ act: "lift", institution: "bank", reason: "x", halt: "sha256:" + "1".repeat(64) }))), "credit_halt_not_live");
  // A halt on the Insurer is its own: it does not stop the Bank's queue, and the Bank's is still live.
  await w.kit.put(w.halt({ act: "halt", institution: "insurer", reason: "claims above the reserve", until: iso(t0 + DAY) }));
});


test("DK1229: during a halt on the Insurer a claim decision that pays is refused and a denial is not held; with no halt the same paying decision reaches the claim rules", async () => {
  const insurerParty = party(INSURER_DID, 56);
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP, insurerParty].map((p) => [p.kid, p.publicKey])));
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver }));
  const decision = (d: string, amount: number) => kit.mk("claim_decision" as never, insurerParty, { claim: "sha256:" + "4".repeat(64), decision: d, amount: credit(amount), reason: "scripted" }, null, { subject: null });
  assert.equal(await refused(kit.put(decision("paid", 10))), "decision_unknown_claim", "with no halt the decision reaches the claim rules");
  const t0 = Date.parse(kit.now());
  await kit.put(kit.mk("credit_halt" as never, treasury, { act: "halt", institution: "insurer", reason: "claims above the reserve", until: iso(t0 + DAY) }, null, { subject: null }));
  assert.equal(await refused(kit.put(decision("paid", 10))), "insurer_halted", "a payment waits");
  assert.equal(await refused(kit.put(decision("reduced", 5))), "insurer_halted", "so does a reduced payment");
  assert.equal(await refused(kit.put(decision("denied", 0))), "decision_unknown_claim", "a denial is not held by the halt");
  kit.addDays(2);
  assert.equal(await refused(kit.put(decision("paid", 10))), "decision_unknown_claim", "after the sunset the halt no longer holds a payment");
});
