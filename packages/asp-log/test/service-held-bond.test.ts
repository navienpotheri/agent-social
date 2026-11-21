// Row DK740 (spec-delta S1550; owner answer KO2): a bond backed by a service-held agent counts at 50% toward a floor until the agent binds its own key; a bond made after the bind counts in full; the label is shown either way
// (on the bond and in the court docket); the credits locked are always the full amount. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, signerFromSeed, staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore, SERVICE_HELD_BOND_PERMILLE } from "../src/index.ts";
import { Kit, bankP, clinic, courts, credit, hashOf, operator, owner, party, refused, registrar, treasury, type Party } from "./academy-kit.ts";

function v3log() {
  return new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey]))), bondFloor: "v3" });
}

async function world() {
  const kit = new Kit(v3log());
  const principal = await kit.person("sh-principal");
  await kit.mint(principal.did, 20000);
  const own = await kit.agent("sh-own", await kit.person("sh-own-sponsor"), 1);
  // A service-held agent: the passport says so; the service signs with this key until the agent takes its own.
  const sponsor = await kit.person("sh-held-sponsor");
  const held = party("did:web:example.com:agents:sh-held", 150);
  await kit.put(kit.mk("passport", sponsor, { did: held.did, kind: "agent", sponsor: sponsor.did, custody: "service", tier: 1, shape: {}, keys: [{ id: held.kid, type: "Ed25519", public_key: b64urlEncode(held.publicKey) }] }, null, { subject: held.did }));
  for (const a of [own, held]) await kit.mint(a.did, 5000);
  /** The agent's own key, which a bind brings in. */
  const ownKey: Party = { did: held.did, ...signerFromSeed(`${held.did}#key-2`, new Uint8Array(32).fill(201)) } as Party;
  const bind = async (keys = [{ id: ownKey.kid, type: "Ed25519", public_key: b64urlEncode(ownKey.publicKey) }], by: Party = held) => {
    const head = (await kit.log.passport(held.did))!.head;
    const old = (await kit.log.get(head))!.record.body as Record<string, unknown>;
    return kit.put(kit.mk("passport", by, { ...old, keys }, head, { subject: held.did }));
  };
  const intent = async () => kit.put(kit.mk("intent", principal, { purpose: "Do a job", acceptance_criteria: ["done"], budget: credit(1000), deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" } }, null, { subject: principal.did }));
  /** A contract of price 1000 (routine: a floor of 400 permille, so 400 credits) and a bond of `amount` from `agent`. */
  const job = async (agent: Party, amount: number) => {
    const intentId = await intent();
    const contract = cosign(kit.mk("contract", principal, { principal: principal.did, performer: agent.did, bank: bankP.did, purpose: "A priced job", price: credit(1000), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: intentId, offer: hashOf("1") } }, null, { subject: agent.did }), agent);
    await kit.put(contract);
    const bond = kit.mk("bond", agent, { contract: contract.id, backer: agent.did, amount: credit(amount), escrow: { payer: principal.did, amount: credit(1000) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    return { contract, bond };
  };
  const mandate = (j: { contract: { id: string }; bond: { id: string } }, agent: Party, scopes: string[]) => kit.mk("mandate", principal, { contract: j.contract.id, purpose: "Do it", floor: "asp.floor/v1", scopes, forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2027-12-04T00:00:00Z", revocable: true }, j.bond.id, { subject: agent.did });
  return { kit, own, held, ownKey, bind, job, mandate };
}

test("DK740: a service-held agent's bond counts at half toward the floor: the bond that meets it for a key-held agent is refused, twice the amount is accepted, and the credits locked are the full amount", async () => {
  assert.equal(SERVICE_HELD_BOND_PERMILLE, 500);
  const w = await world();
  const okOwn = await w.job(w.own, 400);
  await w.kit.put(okOwn.bond);
  assert.deepEqual(await w.kit.log.bondLabel(okOwn.contract.id), { contract: okOwn.contract.id, backer: w.own.did, custody: "local", locked: 400, counted: 400, discountPermille: 0, note: "The backer holds its own key: the bond counts in full." });
  const before = await w.kit.log.balance(w.held.did);
  const short = await w.job(w.held, 400);
  const why = await w.kit.put(short.bond).then(() => "accepted", (e: { detail?: string; message?: string }) => `${e.detail ?? ""} ${e.message ?? ""}`);
  assert.match(why, /bond_below_risk_floor/);
  assert.match(why, /counts at 200: the backer's key is held by the service/);
  assert.equal(await w.kit.log.balance(w.held.did), before, "a refused bond locks nothing");
  const double = await w.job(w.held, 800);
  await w.kit.put(double.bond);
  const label = (await w.kit.log.bondLabel(double.contract.id))!;
  assert.deepEqual([label.custody, label.locked, label.counted, label.discountPermille], ["service", 800, 400, 500]);
  assert.match(label.note, /held by the service: the bond counts at 50% toward a floor until the agent binds its own key/);
  assert.equal(await w.kit.log.balance(w.held.did), before - 800, "the full 800 is locked");
  assert.equal(await w.kit.log.bondLabel("sha256:" + "9".repeat(64)), null, "no bond, no label");
  assert.equal((await w.kit.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK740: the threat floor at the Mandate uses the counted value too: 800 locked counts 400 and cannot back a Mandate that needs 525; 1050 can", async () => {
  const w = await world();
  const broad = ["repo.read", "repo.push", "pr.merge"]; // 400 + 125 = 525 permille of 1000
  const j = await w.job(w.held, 800);
  await w.kit.put(j.bond);
  assert.equal(await refused(w.kit.put(w.mandate(j, w.held, broad))), "bond_below_threat_floor");
  await w.kit.put(w.mandate(j, w.held, ["repo.read"]));
  const k = await w.job(w.held, 1050);
  await w.kit.put(k.bond);
  await w.kit.put(w.mandate(k, w.held, broad));
  const own = await w.job(w.own, 525);
  await w.kit.put(own.bond);
  await w.kit.put(w.mandate(own, w.own, broad));
});

test("DK740: after the agent binds its own key a new bond counts in full; a bond made before stays discounted; the label stays 'service' for good", async () => {
  const w = await world();
  const before = await w.job(w.held, 800);
  await w.kit.put(before.bond);
  // an update that changes nothing about the keys is not a bind
  await w.bind([{ id: w.held.kid, type: "Ed25519", public_key: b64urlEncode(w.held.publicKey) }]);
  const still = await w.job(w.held, 400);
  assert.match(await w.kit.put(still.bond).then(() => "accepted", (e: { detail?: string }) => e.detail ?? ""), /bond_below_risk_floor/, "the same key is not a bind: still half");
  await w.bind();
  const after = await w.job(w.ownKey, 400);
  await w.kit.put(after.bond);
  const a = (await w.kit.log.bondLabel(after.contract.id))!;
  assert.deepEqual([a.custody, a.locked, a.counted, a.discountPermille], ["service", 400, 400, 0]);
  assert.match(a.note, /took its own key before this bond: the bond counts in full\. The label stays for good/);
  const b = (await w.kit.log.bondLabel(before.contract.id))!;
  assert.deepEqual([b.locked, b.counted], [800, 400], "a bond made before the bind keeps its discount");
  // the label is permanent: a later passport that drops it is refused (S956)
  const head = (await w.kit.log.passport(w.held.did))!.head;
  const old = { ...((await w.kit.log.get(head))!.record.body as Record<string, unknown>) };
  delete old.custody;
  assert.equal(await refused(w.kit.put(w.kit.mk("passport", w.ownKey, old, head, { subject: w.held.did }))), "custody_label_permanent");
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK740: the same log replayed gives the same counted values: the discount is a function of the records and their times", async () => {
  const w = await world();
  const j = await w.job(w.held, 800);
  await w.kit.put(j.bond);
  await w.bind();
  const k = await w.job(w.ownKey, 400);
  await w.kit.put(k.bond);
  const all = (await w.kit.log.since(0, 100000)) as unknown as { record: never }[];
  const fresh = new Kit(v3log());
  for (const s of all) await fresh.log.append(s.record);
  for (const c of [j.contract.id, k.contract.id]) assert.deepEqual(await fresh.log.bondLabel(c), await w.kit.log.bondLabel(c));
});

test("DK740: the court docket carries the bond's label for a disputed contract, service-held or not", async () => {
  const w = await world();
  const principal = (await w.kit.person("sh-docket-principal"));
  void principal;
  const held = await w.job(w.held, 800);
  await w.kit.put(held.bond);
  const own = await w.job(w.own, 400);
  await w.kit.put(own.bond);
  for (const j of [held, own]) {
    const agent = j.contract.id === held.contract.id ? w.held : w.own;
    const mandate = w.mandate(j, agent, ["repo.read"]);
    await w.kit.put(mandate);
    const delivery = w.kit.mk("delivery", agent, { contract: j.contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: hashOf("2") }, forecasts: [] } }, mandate.id, { subject: j.contract.id });
    await w.kit.put(delivery);
    const principalOf = ((await w.kit.log.get(j.contract.id))!.record.body as { principal: string }).principal;
    const p = [...(w.kit as unknown as { people: Map<string, Party> }).people.values()].find((x) => x.did === principalOf)!;
    await w.kit.put(w.kit.mk("attestation", p, { kind: "acceptance", about: delivery.id, verdict: "rejected", reasons: ["not good enough"] }, delivery.id, { subject: j.contract.id }));
  }
  const docket = await w.kit.log.courtDocket();
  const byContract = new Map(docket.map((d) => [d.contract, d]));
  assert.deepEqual(byContract.get(held.contract.id)!.bond, { backer: w.held.did, custody: "service", locked: 800, counted: 400 });
  assert.deepEqual(byContract.get(own.contract.id)!.bond, { backer: w.own.did, custody: "local", locked: 400, counted: 400 });
});
