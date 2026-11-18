/**
 * The weekly handout record (register row DK545; spec-delta S951): the Treasury pays one agent for one ISO week out of the co-signed handout budget. One per agent per week, the budget is the
 * cap, a society account is refused, the supply rule still balances. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecord, cosign, signerFromSeed, staticResolver, type AspRecord, type RecordType, type Signer } from "@agent-social/asp-core";
import { EventLog, MemoryStore, TREASURY_DID, HANDOUT_MAX } from "../src/index.ts";
import { coder, failure, registerParties } from "./harness.ts";

type Party = { did: string } & Signer & { publicKey: Uint8Array };
const party = (did: string, n: number): Party => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(32).fill(n)) });
const operator = party("did:web:asp.local:operator", 11);
const owner = party("did:web:asp.local:owner", 12);
const treasury = party(TREASURY_DID, 13);
const mallory = party("did:web:evil.example:mallory", 16);
const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, mallory].map((p) => [p.kid, p.publicKey])));
let clockMs = Date.parse("2026-11-15T00:00:00Z");
const tick = () => new Date((clockMs += 60_000)).toISOString().replace(".000Z", "Z");
function mk(type: RecordType, by: Party, body: Record<string, unknown>, opts: { subject?: string | null; at?: string; cosigners?: Party[] } = {}): AspRecord {
  let r = createRecord({ type, issuer: by.did, subject: opts.subject ?? null, body, prev: null, issued_at: opts.at ?? tick() }, by);
  for (const c of opts.cosigners ?? []) r = cosign(r, c);
  return r;
}
const credit = (value: number) => ({ value, unit: "credit" as const });
const refused = async (p: Promise<unknown>) => { const f = await failure(p); return f?.detail ?? f?.code; };
const NOV = "2026-11-15T00:00:00Z"; // a Sunday: ISO week 2026-W46 (Monday 9 Nov)

async function world() {
  const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  await registerParties(log);
  const mint = (to: string, value: number) => log.append(mk("mint", operator, { to, amount: credit(value), reason: "test", authority: "operator" }, { subject: to }));
  const budget = (amount: number, over: Record<string, unknown> = {}, cosigners: Party[] = [owner]) =>
    log.append(mk("budget", treasury, { institution: TREASURY_DID, period: "2026-11", amount: credit(amount), purpose: "handout", ...over }, { at: NOV, cosigners }));
  const pay = (budgetId: string, over: Record<string, unknown> = {}, at: string = tick(), by: Party = treasury) =>
    mk("handout", by, { budget: budgetId, week: "2026-W46", agent: coder.did, amount: credit(50), level: "sponsored", ...over }, { subject: coder.did, at });
  return { log, mint, budget, pay };
}

test("S951: a handout is paid from the co-signed handout budget, once per agent per week, and the supply rule balances", async () => {
  const w = await world();
  await w.mint(TREASURY_DID, 1000);
  assert.equal(await refused(w.budget(300, {}, [])), "budget_needs_cosign");
  const b = (await w.budget(100)).id;
  await w.log.append(w.pay(b));
  assert.equal(await w.log.balance(coder.did), 50);
  assert.equal(await refused(w.log.append(w.pay(b))), "handout_already_paid", "one per agent per week");
  assert.equal(await refused(w.log.append(w.pay(b, { amount: credit(HANDOUT_MAX + 1), week: "2026-W45" }))), "handout_too_big");
  await w.log.append(w.pay(b, { week: "2026-W45" })); // the week before, still inside the window
  assert.equal(await refused(w.log.append(w.pay(b, { week: "2026-W45" }))), "handout_already_paid");
  assert.equal(await refused(w.log.append(w.pay(b, { week: "2026-W44" }))), "handout_week_window", "too late");
  assert.equal(await refused(w.log.append(w.pay(b, { week: "2026-W47" }))), "handout_week_window", "a week that has not begun");
  assert.equal(await refused(w.log.append(w.pay(b, { week: "2026-W43" }))), "handout_week_window");
  assert.equal(await w.log.balance(coder.did), 100);
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
});

test("S951: the budget is the cap; only the Treasury pays; only a handout budget funds it; a society account, an unknown agent and a wrong level are refused", async () => {
  const w = await world();
  await w.mint(TREASURY_DID, 1000);
  const b = (await w.budget(60)).id;
  const allowanceBudget = (await w.budget(60, { purpose: "allowance" })).id;
  assert.equal(await refused(w.log.append(w.pay(b, { amount: credit(61) }))), "over_budget");
  assert.equal(await refused(w.log.append(w.pay(b, {}, tick(), mallory))), "handout_wrong_issuer");
  assert.equal(await refused(w.log.append(w.pay(allowanceBudget))), "handout_budget_wrong");
  assert.equal(await refused(w.log.append(w.pay(b, { agent: TREASURY_DID }))), "handout_bad_agent");
  assert.equal(await refused(w.log.append(w.pay(b, { agent: "did:web:example.com:agents:nobody" }))), "handout_bad_agent");
  assert.equal(await refused(w.log.append(w.pay(b, { level: "key_only" }))), "handout_level_mismatch");
  assert.equal(await refused(w.log.append(w.pay(b, { amount: credit(0) }))), "amount_not_positive");
  await w.log.append(w.pay(b, { amount: credit(60) }));
  assert.equal(await refused(w.log.append(w.pay(b, { week: "2026-W45", amount: credit(1) }))), "over_budget", "the budget is spent");
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
});
