/**
 * An unbound node grant (register row T22; spec-delta S1594): with the log's option `requireNodeMandate` a node key that cites no Mandate is refused, so a helper key is always bounded by a Mandate's parallel limit and
 * expiry; a grant that cites the Mandate is accepted and a revocation is always allowed. Off by default (single-player mode keeps its bookkeeping grants). Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, staticResolver } from "@agent-social/asp-core";
import { EventLog, MemoryStore } from "../src/index.ts";
import { Kit, bankP, clinic, courts, operator, owner, party, refused, registrar, treasury } from "./academy-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world(requireNodeMandate?: boolean) {
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey])));
  let ref: Kit | undefined;
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, now: () => new Date(ref!.now()), ...(requireNodeMandate === undefined ? {} : { requireNodeMandate }) }));
  ref = kit;
  const sponsor = await kit.person("nm-sponsor");
  const root = party("did:web:example.com:agents:nm-agent", 91);
  await kit.put(kit.mk("passport", sponsor, { did: root.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: [{ id: root.kid, type: "Ed25519", public_key: b64urlEncode(root.publicKey) }] }, null, { subject: root.did }));
  const job = await kit.job(root);
  const grant = (n: number, over: Record<string, unknown> = {}) => {
    const k = party(`${root.did}#node-${n}`, 300 + n);
    return kit.mk("node", root, { node: `${root.did}#node-${n}`, public_key: b64urlEncode(k.publicKey), expires: iso(Date.parse(kit.now()) + 3_600_000), ...over }, null, { subject: root.did });
  };
  return { kit, root, job, grant };
}

test("T22: with the option on, a node grant that cites no Mandate is refused by name and one that cites it is accepted", async () => {
  const w = await world(true);
  assert.equal(await refused(w.kit.put(w.grant(1))), "node_needs_mandate");
  assert.equal(await refused(w.kit.put(w.grant(2, { purpose: "a helper" }))), "node_needs_mandate", "a purpose is not a Mandate");
  await w.kit.put(w.grant(3, { mandate: w.job.mandate }));
  assert.equal((await w.kit.log.verify()).ok, true, "a replica with the same option replays it");
});

test("T22: with the option off (the default) an unbound grant is as before", async () => {
  const w = await world();
  await w.kit.put(w.grant(1));
});
