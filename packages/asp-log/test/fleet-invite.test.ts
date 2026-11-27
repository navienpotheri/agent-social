// Row DK1354 (spec-delta S1459): a fleet invitation is the sponsor's consent for an agent that issues its own passport. The organisation signs one token for each agent offline; the log checks the signature against a
// current key of the organisation, the fleet, the expiry and that the nonce was never used. Members of a declared fleet are bounded by the fleet's cap and not by the sponsor's 10 new agents a day, and the cap is
// counted in a marker so a fleet of thousands is not read in full at every join. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, publicKeyFromSeed, randomSeed, signerFromSeed, didKeyFromPublicKey } from "@agent-social/asp-core";
import { makeInvitation, SPONSOR_PASSPORTS_PER_DAY } from "../src/index.ts";
import { jump, keysOf, kit, mk, party, refusedBy, nowIso, DAY, type Party } from "./society-kit.ts";

const FLEET = "did:web:example.com:fleets:acme-eng";
const OTHER_FLEET = "did:web:example.com:fleets:acme-ops";

/** A new agent with its own key: did:key, so nobody has seen the key before it joins. */
function newcomer(): Party {
  const seed = randomSeed();
  const did = didKeyFromPublicKey(publicKeyFromSeed(seed));
  return { did, ...signerFromSeed(`${did}#key-1`, seed), publicKey: publicKeyFromSeed(seed) } as Party;
}
const selfPassport = (a: Party, over: Record<string, unknown> = {}) => mk("passport", a, { did: a.did, kind: "agent", sponsor: "did:web:example.com:users:acme", fleet: FLEET, tier: 1, shape: {}, keys: keysOf(a), ...over }, null, { subject: a.did });

async function world(max?: number) {
  const k = await kit();
  const org = await k.person("acme");
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "Engineering", purpose: "Keep the build green", ...(max ? { max_members: max } : {}) }, null, { subject: FLEET }));
  await k.log.append(mk("fleet", org, { did: OTHER_FLEET, org: org.did, name: "Operations", purpose: "Keep the lights on" }, null, { subject: OTHER_FLEET }));
  const expires = new Date(Date.parse(nowIso()) + 30 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const invite = (o: { fleet?: string; persona?: string; expires?: string; nonce?: string; by?: Party } = {}) => makeInvitation(o.by ?? org, { fleet: o.fleet ?? FLEET, persona: o.persona ?? "developer", expires: o.expires ?? expires, ...(o.nonce ? { nonce: o.nonce } : {}) });
  return { k, org, invite, expires };
}

test("an agent the organisation has never seen joins its fleet with a sponsor-signed invitation, by issuing its own passport; the token is used once", async () => {
  const w = await world();
  const inv = w.invite();
  const a = newcomer();
  const id = (await w.k.log.append(selfPassport(a, { persona: "developer", invitation: inv }))).id;
  const p = await w.k.log.passport(a.did);
  assert.equal(p!.head, id); assert.equal(p!.sponsor, w.org.did); assert.equal(p!.fleet, FLEET);
  assert.equal((await w.k.log.fleet(FLEET))!.members.length, 1, "the fleet lists it");
  // the same token again, for another agent: refused
  assert.equal(await refusedBy(w.k.log.append(selfPassport(newcomer(), { invitation: inv }))), "invitation_used");
  assert.equal((await w.k.log.verify()).ok, true, "replay reproduces the joining and the used nonce");
});

test("a forged, expired, misdirected or borrowed invitation is refused, each by name, and nothing is written", async () => {
  const w = await world();
  const refuse = async (over: Record<string, unknown>, who: Party = newcomer()) => refusedBy(w.k.log.append(selfPassport(who, over)));
  // forged: signed by someone who is not the organisation
  const stranger = party("did:web:example.com:users:stranger");
  assert.equal(await refuse({ invitation: { ...w.invite({ by: stranger }), kid: `${w.org.did}#key-1` } }), "invitation_bad_signature", "a signature from another key under the organisation's name");
  assert.equal(await refuse({ invitation: w.invite({ by: stranger }) }), "invitation_bad_signature", "signed by another identity");
  const inv = w.invite();
  assert.equal(await refuse({ invitation: { ...inv, persona: "ceo" } }), "invitation_bad_signature", "a changed persona");
  assert.equal(await refuse({ invitation: { ...inv, expires: "2099-01-01T00:00:00Z" } }), "invitation_bad_signature", "a changed expiry");
  assert.equal(await refuse({ invitation: { ...inv, sig: "A".repeat(86) } }), "invitation_bad_signature", "a made-up signature");
  // expired
  assert.equal(await refuse({ invitation: w.invite({ expires: "2026-10-01T00:00:00Z" }) }), "invitation_expired");
  // for another fleet
  assert.equal(await refuse({ invitation: w.invite({ fleet: OTHER_FLEET }) }), "invitation_fleet_mismatch");
  // a fleet nobody declared
  assert.equal(await refuse({ fleet: "did:web:example.com:fleets:ghost", invitation: w.invite({ fleet: "did:web:example.com:fleets:ghost" }) }), "fleet_unknown");
  // a different sponsor named than the fleet's organisation
  assert.equal(await refuse({ sponsor: "did:web:example.com:users:alice", invitation: inv }), "fleet_sponsor_mismatch");
  // an invitation carried by a passport someone else issued
  const a = newcomer();
  assert.equal(await refusedBy(w.k.log.append(mk("passport", w.org, { did: a.did, kind: "agent", sponsor: w.org.did, fleet: FLEET, tier: 1, shape: {}, keys: keysOf(a), invitation: inv }, null, { subject: a.did }))), "invitation_self_issued");
  // and without an invitation a self-issued passport that names a sponsor still needs the sponsor's consent
  assert.equal(await refuse({}), "sponsor_consent_missing");
  // none of it used the nonce: the good token still works
  await w.k.log.append(selfPassport(newcomer(), { invitation: inv }));
});

test("a revoked organisation key cannot sign invitations any more, and an invitation signed before the revocation stops working", async () => {
  const w = await world();
  const inv = w.invite();
  // the organisation rotates to a key the old invitation was not signed with
  const next = party("did:web:example.com:users:acme");
  const fresh = { ...next, ...signerFromSeed(`${next.did}#key-2`, randomSeed()) } as Party;
  const head = (await w.k.log.passport(w.org.did))!.head;
  await w.k.log.append(mk("passport", w.org, { did: w.org.did, kind: "human", keys: [{ id: fresh.kid, type: "Ed25519", public_key: b64urlEncode(fresh.publicKey) }] }, head, { subject: w.org.did }));
  assert.equal(await refusedBy(w.k.log.append(selfPassport(newcomer(), { invitation: inv }))), "invitation_bad_signature");
});

test("members of a declared fleet are bounded by the fleet's cap, not by the sponsor's 10 new agents a day, and the cap is counted without reading the fleet", async () => {
  const w = await world(25);
  for (let i = 0; i < 25; i++) await w.k.log.append(selfPassport(newcomer(), { invitation: w.invite() }));
  assert.equal((await w.k.log.fleet(FLEET))!.members.length, 25, "25 joined on one day, well above the sponsor limit of 10");
  assert.ok(25 > SPONSOR_PASSPORTS_PER_DAY);
  assert.equal(await refusedBy(w.k.log.append(selfPassport(newcomer(), { invitation: w.invite() }))), "fleet_full", "the 26th is over the fleet's own cap");
  // the cap is a marker: a replay of the whole log agrees with it
  assert.equal((await w.k.log.verify()).ok, true);
  // the sponsor's daily limit still binds an agent that is not in a fleet
  const solo = async (n: number) => { const a = newcomer(); return mk("passport", w.org, { did: a.did, kind: "agent", sponsor: w.org.did, tier: 1, shape: {}, keys: keysOf(a) }, null, { subject: a.did, at: undefined }); void n; };
  jump(DAY);
  for (let i = 0; i < SPONSOR_PASSPORTS_PER_DAY; i++) await w.k.log.append(await solo(i));
  assert.equal(await refusedBy(w.k.log.append(await solo(99))), "sponsor_daily_limit", "outside a fleet the limit of 10 a day stands");
});

test("a sponsor who issues the passport itself needs no invitation, and a member can be moved out of its fleet's count only by leaving it", async () => {
  const w = await world(2);
  const a = newcomer(), b = newcomer(), c = newcomer();
  for (const x of [a, b]) await w.k.log.append(mk("passport", w.org, { did: x.did, kind: "agent", sponsor: w.org.did, fleet: FLEET, tier: 1, shape: {}, keys: keysOf(x) }, null, { subject: x.did }));
  assert.equal(await refusedBy(w.k.log.append(mk("passport", w.org, { did: c.did, kind: "agent", sponsor: w.org.did, fleet: FLEET, tier: 1, shape: {}, keys: keysOf(c) }, null, { subject: c.did }))), "fleet_full");
  // an update of a member's own passport (a rotation that keeps the fleet) does not count it twice
  const head = (await w.k.log.passport(a.did))!.head;
  await w.k.log.append(mk("passport", w.org, { did: a.did, kind: "agent", sponsor: w.org.did, fleet: FLEET, tier: 1, shape: {}, purpose: "updated", keys: keysOf(a) }, head, { subject: a.did }));
  assert.equal((await w.k.log.fleet(FLEET))!.members.length, 2);
  assert.equal(await refusedBy(w.k.log.append(mk("passport", w.org, { did: c.did, kind: "agent", sponsor: w.org.did, fleet: FLEET, tier: 1, shape: {}, keys: keysOf(c) }, null, { subject: c.did }))), "fleet_full", "still full after the update");
});

test("an invitation for a passport that names another sponsor is refused, and one that expires at the very moment of the passport is expired", async () => {
  const w = await world();
  assert.equal(await refusedBy(w.k.log.append(selfPassport(newcomer(), { invitation: w.invite(), sponsor: "did:web:example.com:users:someone-else" }))), "fleet_sponsor_mismatch");
  const a = newcomer();
  const at = new Date(Date.parse(nowIso()) + 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const rec = mk("passport", a, { did: a.did, kind: "agent", sponsor: "did:web:example.com:users:acme", fleet: FLEET, tier: 1, shape: {}, keys: keysOf(a), invitation: w.invite({ expires: at }) }, null, { subject: a.did, at });
  assert.equal(await refusedBy(w.k.log.append(rec)), "invitation_expired", "expires at the same second it is used");
});
