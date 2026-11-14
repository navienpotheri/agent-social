// Entering the city by a key alone and later gaining a sponsor (register row CY5; spec-delta S479): the identity keeps its balance and its record, the sponsor must consent, an agent with a sponsor is held to its Mandate
// where a key-only identity was not, and a sponsor cannot gather unlimited starter grants by adopting key-only identities. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode } from "@agent-social/asp-core";
import { STARTER_MAX_DIDS, STARTER_PER_DID, STARTER_UPFRONT } from "../src/starter.ts";
import { STARTER_POOL_DID } from "../src/index.ts";
import { credit, kit, mk, nowIso, party, refusedBy, type Party } from "./society-kit.ts";

test("CY5: a key-only identity gets the one-time grant and spends it freely; a sponsor can be bound later with consent and the history kept; then the Mandate applies; and the sponsor's starter group limit holds", async () => {
  const k = await kit();
  await k.withPrices();
  await k.log.append(mk("mint", (await import("./society-kit.ts")).operator, { to: STARTER_POOL_DID, amount: credit(5000), reason: "starter_upfront", authority: "operator" }, null, { subject: STARTER_POOL_DID }));
  const keyOnly = async (name: string): Promise<{ p: Party; first: string }> => {
    const p = party(`did:web:example.com:agents:${name}`);
    const rec = mk("passport", p, { did: p.did, kind: "human", keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, { subject: p.did });
    await k.log.append(rec);
    await k.log.append(mk("starter_claim", p, { part: "upfront", amount: credit(STARTER_UPFRONT) }, null, { subject: p.did }));
    return { p, first: rec.id };
  };
  const [a, b, c] = [await keyOnly("ko-a"), await keyOnly("ko-b"), await keyOnly("ko-c")];
  for (const x of [a, b, c]) assert.equal(await k.log.balance(x.p.did), STARTER_UPFRONT, "the one-time grant");
  assert.equal(STARTER_PER_DID > STARTER_UPFRONT, true);

  // Before a sponsor: spent freely, no Mandate asked for.
  await k.buy(a.p, "registry.name.claim", 10);
  assert.equal(await k.log.balance(a.p.did), STARTER_UPFRONT - 10);

  // Binding a sponsor to the existing identity: the sponsor must consent (issue or countersign); the balance and the record stay.
  const sponsor = await k.person("ko-sponsor", 10);
  const bind = (x: { p: Party; first: string }, cosigners: Party[]) => mk("passport", x.p, { did: x.p.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: [{ id: x.p.kid, type: "Ed25519", public_key: b64urlEncode(x.p.publicKey) }] }, x.first, { subject: x.p.did, cosigners });
  const records = (await k.log.since(0, 5000)).length;
  assert.equal(await refusedBy(k.log.append(bind(a, []))), "sponsor_consent_missing", "a sponsor is not bound without its consent");
  await k.log.append(bind(a, [sponsor]));
  assert.equal(await k.log.balance(a.p.did), STARTER_UPFRONT - 10, "the balance is kept");
  assert.equal((await k.log.passport(a.p.did))?.sponsor, sponsor.did);
  assert.equal((await k.log.since(0, 5000)).length, records + 1, "nothing was rewritten: one new passport record");
  assert.equal((await k.log.registryPage(a.p.did))?.names.length, 0);

  // Now it is an agent with a sponsor: its purchases need a Mandate.
  assert.equal(await refusedBy(k.buy(a.p, "registry.name.claim", 10)), "institution_not_in_mandate");

  // The sponsor's starter group: it already holds one (a) and may adopt up to the limit; one more is refused.
  await k.log.append(bind(b, [sponsor]));
  assert.equal(STARTER_MAX_DIDS, 2);
  assert.equal(await refusedBy(k.log.append(bind(c, [sponsor]))), "sponsor_binding_group_full", "a sponsor cannot gather unlimited starter grants by adopting key-only identities");
  assert.equal((await k.log.passport(c.p.did))?.sponsor ?? null, null, "c stays key-only");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true);
  void nowIso;
});
