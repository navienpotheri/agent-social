import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { b64urlEncode, didKeyFromPublicKey, publicKeyFromSeed, signerFromSeed } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { codeOf, memory, pgUrl, postgres, rec, type Harness } from "./harness.ts";

type Who = { did: string; publicKey: Uint8Array; kid: string; seed: Uint8Array };

function identity(): Who {
  const seed = new Uint8Array(randomBytes(32));
  const publicKey = publicKeyFromSeed(seed);
  const did = didKeyFromPublicKey(publicKey);
  return { ...signerFromSeed(`${did}#key-1`, seed), did, publicKey, seed };
}

/** Someone who does not hold the DID's key, signing a passport for it with their own key under that DID's key id. */
function impersonator(victim: Who): Who {
  const seed = new Uint8Array(randomBytes(32));
  return { ...signerFromSeed(`${victim.did}#key-1`, seed), did: victim.did, publicKey: publicKeyFromSeed(seed) };
}

const passportFor = (owner: Who, keyOf: Who, prev: string | null = null) => rec("passport", owner, {
  did: owner.did, kind: "human",
  keys: [{ id: `${owner.did}#key-1`, type: "Ed25519", public_key: b64urlEncode(keyOf.publicKey) }],
}, prev, owner.did);

for (const h of [memory, postgres] as Harness[]) {
  describe(`did:key passports on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("a did:key passport carrying the key the DID encodes is accepted", async () => {
      const log = new EventLog(await h.make());
      const me = identity();
      assert.equal(await codeOf(log.append(passportFor(me, me))), undefined);
    });

    test("a did:key passport with a different key is refused (the DID is the key)", async () => {
      const log = new EventLog(await h.make());
      const me = identity();
      const attacker = impersonator(me);
      // Validly signed by the attacker's own declared key, claiming the victim's did:key.
      await assert.rejects(log.append(passportFor(attacker, attacker)), /must include the key the DID encodes/);
    });

    test("an update cannot drop the DID's own key either", async () => {
      const log = new EventLog(await h.make());
      const me = identity();
      const first = await log.append(passportFor(me, me));
      const other = impersonator(me);
      await assert.rejects(log.append(passportFor(other, other, first.id)), /BAD_SIG|signature|must include the key the DID encodes/i);
    });
  });
}
