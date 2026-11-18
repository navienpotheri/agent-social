// Rows DK541 and DK542 at the log: a key-only agent gets the same starter grant as a sponsored one (100 at once, 400 after a first accepted job), draws on the same pool and its cap, and is held by its own bond;
// repeat slashes are counted from the signed records and end in a ban by key and address. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, didKeyFromPublicKey } from "@agent-social/asp-core";
import { STARTER_PER_DID, STARTER_UPFRONT } from "../src/starter.ts";
import { STARTER_POOL_DID, KeyOnlyBans, reviewKeyOnly, slashesOf, KEY_ONLY_BAN_AT, KEY_ONLY_QUARANTINE_AT, type Tenant } from "../src/index.ts";
import { credit, kit, mk, operator, party, refusedBy, clinic, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";

const keyOnlyAgent = async (k: Awaited<ReturnType<typeof kit>>, seedName: string): Promise<Party> => {
  const base = party(`did:web:example.com:agents:${seedName}`);
  const did = didKeyFromPublicKey(base.publicKey);
  const p = { ...base, did, kid: `${did}#key-1` } as Party;
  await k.log.append(mk("passport", p, { did, kind: "agent", sponsor: did, tier: 1, shape: {}, keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, { subject: did }));
  return p;
};
const claim = (p: Party, part: "upfront" | "rest") => mk("starter_claim", p, { part, amount: credit(part === "upfront" ? STARTER_UPFRONT : STARTER_PER_DID - STARTER_UPFRONT) }, null, { subject: p.did });
const fundPool = (k: Awaited<ReturnType<typeof kit>>, n: number) => k.log.append(mk("mint", operator, { to: STARTER_POOL_DID, amount: credit(n), reason: "starter_upfront", authority: "operator" }, null, { subject: STARTER_POOL_DID }));

test("DK541: a key-only agent claims 100 at once; the other 400 wait for a first accepted job; the pool cap and the supply rule hold", async () => {
  const k = await kit();
  await k.withPrices();
  await fundPool(k, 600);
  const a = await keyOnlyAgent(k, "ko-one");
  await k.log.append(claim(a, "upfront"));
  assert.equal(await k.log.balance(a.did), STARTER_UPFRONT);
  assert.equal(await refusedBy(k.log.append(claim(a, "upfront"))), "starter_already_claimed");
  assert.equal(await refusedBy(k.log.append(claim(a, "rest"))), "starter_rest_not_earned", "the second part is earned, not given");
  // A first accepted job (the principal is another person), then the rest is released: 500 in all, as for a sponsored agent.
  const principal = await k.person("ko-principal", 400);
  const basis = { intent: await k.intent(principal), offer: "" };
  basis.offer = await k.offer(a, basis.intent, 60);
  await k.runJob(principal, a, 60, basis);
  const rest = await refusedBy(k.log.append(claim(a, "rest")));
  assert.equal(rest, undefined, "after a qualifying job the rest is released");
  assert.equal((await k.log.balance(a.did)) >= STARTER_PER_DID, true);
  // The same pool: it holds 600: 500 went to the first agent, 100 to the second, so the pool is what bounds key-only claims too.
  const b = await keyOnlyAgent(k, "ko-two");
  await k.log.append(claim(b, "upfront"));
  const c = await keyOnlyAgent(k, "ko-three");
  assert.equal(await refusedBy(k.log.append(claim(c, "upfront"))), "starter_pool_empty", "the pool cap holds for key-only claims");
  const pool = await k.log.starterPoolState();
  assert.equal(pool.consistent, true);
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});

test("DK542: a breach slashes the key-only agent's own bond; repeat slashes quarantine it and then ban its key and its address; no credit reaches an outside party", async () => {
  const k = await kit();
  await k.withPrices();
  const a = await keyOnlyAgent(k, "ko-breach");
  const outsider = await k.person("ko-outsider", 7);
  const tenant: Tenant = { name: "ko-breach", role: "tenant", tokenSha256: "0".repeat(64), signup: { at: "2026-11-01T00:00:00Z", addressHash: "addr-hash-1", termsVersion: "v1", keyOnly: { publicKey: b64urlEncode(a.publicKey), did: a.did } } };
  const bans = new KeyOnlyBans();
  const suspended: string[] = [], quarantined: string[] = [];
  const review = () => reviewKeyOnly({ log: k.log as never, tenants: () => [tenant], bans, suspend: (t) => suspended.push(t), quarantine: (d) => { quarantined.push(d); }, now: () => "2026-11-02T00:00:00Z" });
  assert.deepEqual((await review())[0].action, "none");

  // A real slash: the key-only agent backs a bond, the job is revoked, the bond is slashed to the principal (the party to the contract; no outside party is paid).
  const principal = await k.person("ko-victim-principal", 5000);
  await k.mint(a.did, 300);
  const bankP = bank;
  const contract = cosign(mk("contract", principal, { principal: principal.did, performer: a.did, bank: bankP.did, purpose: "a job that goes wrong", price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: a.did }), a);
  await k.log.append(contract);
  const bond = mk("bond", a, { contract: contract.id, backer: a.did, amount: credit(20), escrow: { payer: principal.did, amount: credit(100) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await k.log.append(bond);
  const m0 = mk("mandate", principal, { contract: contract.id, purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2027-12-03T18:00:00Z", revocable: true }, bond.id, { subject: a.did });
  await k.log.append(m0);
  const before = await k.log.balance(a.did);
  await k.log.append(cosign(mk("settlement", bankP, { contract: contract.id, basis: "revoked", pro_rata_permille: 0, escrow_released: credit(0), bond_returned: credit(0), bond_slashed: credit(20) }, m0.id, { subject: contract.id }), principal));
  assert.equal(await k.log.balance(a.did), before, "the bond was locked at the bond record; the slash takes it from the agent's own credits");
  assert.equal(await slashesOf(k.log as never, a.did), 1, "the slash is counted from the signed records");
  assert.equal((await review())[0].action, "bond_slashed");
  // The slash itself is the log's own rule and is tested in the Clinic suites; here the policy over the count is tested with the count read from signed records.
  const fake = (n: number) => ({ recordsOfTypes: async () => [
    { type: "asp.bond/v0.2", id: "b", body: { contract: "c1", backer: a.did } },
    ...Array.from({ length: n }, (_, i) => ({ type: "asp.settlement/v0.2", id: `s${i}`, body: { contract: "c1", bond_slashed: { value: 20 } } })),
  ] });
  assert.equal(await slashesOf(fake(2), a.did), 2);
  const run = (n: number) => reviewKeyOnly({ log: fake(n), tenants: () => [tenant], bans, suspend: (t) => suspended.push(t), quarantine: (d) => { quarantined.push(d); }, now: () => "2026-11-02T00:00:00Z" });
  assert.equal((await run(1))[0].action, "bond_slashed");
  assert.equal((await run(KEY_ONLY_QUARANTINE_AT))[0].action, "quarantine");
  assert.deepEqual(quarantined, [a.did], "the Clinic is asked to quarantine it");
  assert.equal(bans.list().length, 0);
  assert.equal((await run(KEY_ONLY_BAN_AT))[0].action, "ban");
  assert.equal(bans.keyBanned(b64urlEncode(a.publicKey)), true);
  assert.equal(bans.addressBanned("addr-hash-1"), true);
  assert.deepEqual(suspended, ["ko-breach"]);
  // Nothing moved to the outside party: the review only reads and bans; it signs and mints nothing.
  assert.equal(await k.log.balance(outsider.did), 7);
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  void clinic; void refusedBy;
});
