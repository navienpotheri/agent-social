// Row DK1505 (spec-delta S1706): the organisation that signed a fleet invitation takes it back before it is used. The log refuses a passport that carries a revoked invitation, refuses a revocation from anyone but the
// organisation, for an unknown fleet, for a used invitation and a second time, and leaves every other invitation of the fleet alone. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicKeyFromSeed, randomSeed, signerFromSeed, didKeyFromPublicKey } from "@agent-social/asp-core";
import { makeInvitation } from "../src/index.ts";
import { DAY, keysOf, kit, mk, nowIso, refusedBy, type Party } from "./society-kit.ts";

const FLEET = "did:web:example.com:fleets:acme-eng";
const OTHER_FLEET = "did:web:example.com:fleets:acme-ops";

function newcomer(): Party {
  const seed = randomSeed();
  const did = didKeyFromPublicKey(publicKeyFromSeed(seed));
  return { did, ...signerFromSeed(`${did}#key-1`, seed), publicKey: publicKeyFromSeed(seed) } as Party;
}
const selfPassport = (a: Party, over: Record<string, unknown> = {}) => mk("passport", a, { did: a.did, kind: "agent", sponsor: "did:web:example.com:users:acme", fleet: FLEET, tier: 1, shape: {}, keys: keysOf(a), ...over }, null, { subject: a.did });

async function world() {
  const k = await kit();
  const org = await k.person("acme");
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "Engineering", purpose: "Keep the build green" }, null, { subject: FLEET }));
  await k.log.append(mk("fleet", org, { did: OTHER_FLEET, org: org.did, name: "Operations", purpose: "Keep the lights on" }, null, { subject: OTHER_FLEET }));
  const expires = new Date(Date.parse(nowIso()) + 30 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const invite = (nonce?: string, fleet = FLEET) => makeInvitation(org, { fleet, persona: "developer", expires, ...(nonce ? { nonce } : {}) });
  const revoke = (by: Party, nonce: string, over: Record<string, unknown> = {}) => mk("invitation_revocation", by, { fleet: FLEET, nonce, ...over }, null, { subject: FLEET });
  return { k, org, invite, revoke };
}

test("DK1505: a revoked invitation is refused and the others of the fleet are not", async () => {
  const w = await world();
  const bad = w.invite(), good = w.invite(), other = w.invite(undefined, OTHER_FLEET);
  await w.k.log.append(w.revoke(w.org, bad.nonce, { reason: "the file of invitations was shared by mistake" }));
  assert.equal(await refusedBy(w.k.log.append(selfPassport(newcomer(), { invitation: bad }))), "invitation_revoked");
  const a = newcomer();
  assert.ok(await w.k.log.append(selfPassport(a, { invitation: good })), "another invitation of the same fleet still joins");
  assert.equal((await w.k.log.fleet(FLEET))!.members.length, 1);
  const b = newcomer();
  assert.ok(await w.k.log.append(selfPassport(b, { fleet: OTHER_FLEET, invitation: other })), "an invitation of another fleet is not touched");
});

test("DK1505: only the organisation of a declared fleet revokes, an invitation not yet used, once; each refusal is named", async () => {
  const w = await world();
  const inv = w.invite();
  const stranger = await w.k.person("stranger");
  assert.equal(await refusedBy(w.k.log.append(w.revoke(stranger, inv.nonce))), "invitation_revocation_not_the_org", "an invitation is taken back by the organisation, not by a stranger");
  assert.equal(await refusedBy(w.k.log.append(mk("invitation_revocation", w.org, { fleet: "did:web:example.com:fleets:nowhere", nonce: inv.nonce }, null, { subject: FLEET }))), "invitation_revocation_unknown_fleet");
  await w.k.log.append(w.revoke(w.org, inv.nonce));
  assert.equal(await refusedBy(w.k.log.append(w.revoke(w.org, inv.nonce))), "invitation_revocation_known", "once");
  const used = w.invite();
  await w.k.log.append(selfPassport(newcomer(), { invitation: used }));
  assert.equal(await refusedBy(w.k.log.append(w.revoke(w.org, used.nonce))), "invitation_revocation_already_used", "the agent has joined: there is nothing to take back");
  // a revocation names the invitation as the fleet's own: the same nonce under another fleet is a different invitation
  const sameNonce = w.invite(inv.nonce + "x");
  await w.k.log.append(mk("invitation_revocation", w.org, { fleet: OTHER_FLEET, nonce: sameNonce.nonce }, null, { subject: OTHER_FLEET }));
  assert.ok(await w.k.log.append(selfPassport(newcomer(), { invitation: sameNonce })), "a revocation under the other fleet does not stop this fleet's invitation");
});
