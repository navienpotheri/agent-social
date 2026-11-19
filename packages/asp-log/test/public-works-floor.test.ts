// DK395 (S997): the seed jobs are funded by a public-works budget the owner co-signs, paid only to a house agent; and the unemployment floor tops up a newcomer that has found no accepted job after 30 days, once, from the
// allowance budget. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecord, cosign, b64urlEncode, signerFromSeed, staticResolver, type AspRecord, type RecordType, type Signer } from "@agent-social/asp-core";
import { EventLog, MemoryStore, TREASURY_DID, ALLOWANCE_AMOUNT, institutionDid } from "../src/index.ts";
import { failure, registerParties } from "./harness.ts";

type Party = { did: string } & Signer & { publicKey: Uint8Array };
const party = (did: string, n: number): Party => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(32).fill(n)) });
const operator = party("did:web:asp.local:operator", 11), owner = party("did:web:asp.local:owner", 12), treasury = party(TREASURY_DID, 13);
const mallory = party("did:web:evil.example:mallory", 16), sponsor = party("did:web:example.com:users:pw-sponsor", 21);
const house = party("did:web:example.com:agents:house-seeder", 22), newbie = party("did:web:example.com:agents:floor-newbie", 23), second = party("did:web:example.com:agents:floor-second", 24);
const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, mallory, sponsor, house, newbie, second].map((p) => [p.kid, p.publicKey])));
const credit = (value: number) => ({ value, unit: "credit" as const });
const refused = async (p: Promise<unknown>) => { const f = await failure(p); return f?.detail ?? f?.code; };
function mk(type: RecordType, by: Party, body: Record<string, unknown>, opts: { subject?: string | null; at?: string; cosigners?: Party[] } = {}): AspRecord {
  let r = createRecord({ type, issuer: by.did, subject: opts.subject ?? null, body, prev: null, issued_at: opts.at ?? "2026-11-02T00:00:00Z" }, by);
  for (const c of opts.cosigners ?? []) r = cosign(r, c);
  return r;
}
const keys = (p: Party) => [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }];

async function world() {
  const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  await registerParties(log);
  await log.append(mk("passport", sponsor, { did: sponsor.did, kind: "human", keys: keys(sponsor) }, { subject: sponsor.did, at: "2026-10-01T00:00:00Z" }));
  await log.append(mk("passport", operator, { did: house.did, kind: "agent", sponsor: operator.did, house: true, tier: 1, shape: {}, keys: keys(house) }, { subject: house.did, at: "2026-10-01T00:00:00Z" }));
  for (const [p, at] of [[newbie, "2026-11-01T00:00:00Z"], [second, "2026-12-01T00:00:00Z"]] as const) await log.append(mk("passport", sponsor, { did: p.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: keys(p) }, { subject: p.did, at }));
  await log.append(mk("mint", operator, { to: TREASURY_DID, amount: credit(1000), reason: "test", authority: "operator" }, { subject: TREASURY_DID }));
  const budget = (purpose: string, amount: number, at = "2026-11-10T00:00:00Z", period = at.slice(0, 7), cosigners: Party[] = [owner]) => log.append(mk("budget", treasury, { institution: TREASURY_DID, period, amount: credit(amount), purpose }, { at, cosigners }));
  const pay = (budgetId: string, to: string, amount: number, at = "2026-11-10T00:00:00Z") => mk("treasury_payment", treasury, { budget: budgetId, to, amount: credit(amount) }, { at });
  const claim = (by: Party, budgetId: string, at: string, over: Record<string, unknown> = {}) => mk("allowance", by, { amount: credit(ALLOWANCE_AMOUNT), trigger: "no_job_30d", budget: budgetId, ...over }, { subject: by.did, at });
  return { log, budget, pay, claim };
}

test("S997: a public-works budget pays a house agent that escrows the seed jobs, and nobody else; the owner co-signs it and it is never passed", async () => {
  const w = await world();
  assert.equal(await refused(w.budget("public_works", 300, "2026-11-10T00:00:00Z", "2026-11", [])), "budget_needs_cosign", "the first public-works budget needs the owner");
  const works = (await w.budget("public_works", 300)).id;
  const before = await w.log.balance(house.did);
  assert.equal(await refused(w.log.append(w.pay(works, newbie.did, 50))), "public_works_house_agent_only", "an ordinary agent is not paid by public works");
  assert.equal(await refused(w.log.append(w.pay(works, institutionDid("market"), 50))), "public_works_house_agent_only", "nor an institution");
  assert.equal(await refused(w.log.append(w.pay(works, house.did, 301))), "over_budget");
  await w.log.append(w.pay(works, house.did, 120));
  assert.equal(await w.log.balance(house.did), before + 120, "the house agent holds what pays the seed escrow");
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
});

test("S997: the unemployment floor tops up a newcomer with no accepted job after 30 days, once, from the allowance budget; before 30 days, a second time, or from another budget it is refused", async () => {
  const w = await world();
  const allowance = (await w.budget("allowance", 200, "2026-12-01T00:00:00Z")).id;
  const works = (await w.budget("public_works", 100, "2026-12-01T00:00:00Z")).id;
  assert.equal(await refused(w.log.append(w.claim(second, allowance, "2026-12-06T00:00:00Z"))), "allowance_floor_too_soon", "only 5 days old");
  assert.equal(await refused(w.log.append(w.claim(newbie, works, "2026-12-05T00:00:00Z"))), "allowance_budget_wrong", "from the allowance line only");
  const before = await w.log.balance(newbie.did);
  await w.log.append(w.claim(newbie, allowance, "2026-12-05T00:00:00Z"));
  assert.equal(await w.log.balance(newbie.did), before + ALLOWANCE_AMOUNT, "topped up by the allowance");
  assert.equal(await refused(w.log.append(w.claim(newbie, allowance, "2026-12-06T00:00:00Z", { trigger: "first_course" }))), "allowance_already_paid", "once for each identity");
  assert.equal(await refused(w.log.append(w.claim(second, allowance, "2026-12-31T00:00:00Z"))), "allowance_already_paid", "once for each sponsor");
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.log.verify()).ok, true);
});
