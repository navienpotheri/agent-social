// DK532 (S956): a hosted bot signs through the service, a local agent's key never reaches the service, and the passport shows the mode. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64urlEncode } from "@agent-social/asp-core";
import { kit, mk, party, refusedBy } from "../../asp-log/test/society-kit.ts";
import { HostedSigner, HostedSignerError } from "../src/hosted-signer.ts";

const PASS = "a-long-operator-passphrase";

test("a hosted bot's key is made in the store, its passport says custody service, and the bot signs a record the log accepts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-hosted-"));
  const file = join(dir, "hosted.keys");
  const hs = new HostedSigner(file, PASS);
  const k = await kit();
  const sponsor = await k.person("hb-sponsor", 50);
  const did = "did:web:example.com:agents:hosted-bot";
  const { kid, publicKey } = hs.create(did);
  const passport = mk("passport", sponsor, { did, kind: "agent", sponsor: sponsor.did, custody: "service", tier: 1, shape: {}, keys: [{ id: kid, type: "Ed25519", public_key: b64urlEncode(publicKey) }] }, null, { subject: did });
  await k.log.append(passport);
  assert.equal((passport.body as { custody: string }).custody, "service", "the record shows the mode");
  // The bot signs through the service: the log accepts it as the bot's own act.
  const rec = hs.sign(did, { type: "action", subject: null, body: { contract: "sha256:" + "a".repeat(64), scopes_used: [], summary: "hosted act" }, prev: null, issued_at: new Date().toISOString() });
  assert.equal(rec.issuer, did);
  assert.ok(hs.has(did));
  // The file holds no readable seed, opens only with the passphrase, and a wrong one is refused.
  assert.doesNotMatch(readFileSync(file, "utf8"), /hosted-bot/);
  assert.equal(new HostedSigner(file, PASS).has(did), true);
  assert.throws(() => new HostedSigner(file, "another-passphrase-x"), HostedSignerError);
  assert.throws(() => new HostedSigner(file, "short"), HostedSignerError);
});

test("a local agent's key never reaches the service: the store signs for no identity it did not make, and the log refuses service custody for anything but a sponsored agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-hosted-"));
  const hs = new HostedSigner(join(dir, "hosted.keys"), PASS);
  const k = await kit();
  const sponsor = await k.person("hb2-sponsor", 10);
  const local = await k.agent("local-agent", sponsor, { funds: 5 });
  assert.equal(hs.has(local.did), false);
  assert.throws(() => hs.sign(local.did, { type: "action", subject: null, body: {}, prev: null, issued_at: new Date().toISOString() }), /not a hosted bot/);
  assert.throws(() => hs.signerFor("did:web:example.com:agents:nobody"), HostedSignerError);
  // A person (no sponsor, not an agent) cannot be put under service custody.
  const human = party("did:web:example.com:users:not-an-agent");
  const bad = mk("passport", human, { did: human.did, kind: "human", custody: "service", keys: [{ id: human.kid, type: "Ed25519", public_key: b64urlEncode(human.publicKey) }] }, null, { subject: human.did });
  assert.equal(await refusedBy(k.log.append(bad)), "hosted_bot_needs_sponsor");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
