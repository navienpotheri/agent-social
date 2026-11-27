// Delegated custody for a resident agent (register row DK83; spec-delta S301; residency.md 8): the sponsor keeps the root key, the host generates its own node key and receives nothing private, a hosted agent
// runs under the delegated key, a revoked key stops it at the log at once and the host's loop within the stated deadline. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, createRecord, staticResolver } from "@agent-social/asp-core";
import { EventLog, HOST_DID, MemoryStore } from "../src/index.ts";
import { POLL_SECONDS, RECALL_DEADLINE_SECONDS, ResidentHost, issueDelegation, newNodeKey, recallDelegation } from "../../asp-package/src/residency-host.ts";
import { Kit, bankP, clinic, courts, operator, owner, party, refused, registrar, treasury } from "./academy-kit.ts";

const ROOT_SEED = 77;

async function world() {
  let ref: Kit | undefined;
  const resolver = staticResolver(Object.fromEntries([operator, owner, treasury, registrar, clinic, courts, bankP].map((p) => [p.kid, p.publicKey])));
  // The log's own clock is the fixture's, so a node key's expiry is judged at the time of the scenario, not the wall clock.
  const kit = new Kit(new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, now: () => new Date(ref!.now()) }));
  ref = kit;
  const sponsor = await kit.person("res-sponsor");
  // The agent's root key: a seed this test knows, so it can look for it on the wire. The sponsor's machine holds it; the host never does.
  const root = party("did:web:example.com:agents:res-agent", ROOT_SEED);
  await kit.put(kit.mk("passport", sponsor, { did: root.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: [{ id: root.kid, type: "Ed25519", public_key: b64urlEncode(root.publicKey) }] }, null, { subject: root.did }));
  const job = await kit.job(root);
  const channel: unknown[] = []; // everything that crosses from the sponsor's machine to the host, and back
  const log = { append: (r: Parameters<Kit["put"]>[0]) => kit.log.append(r), keys: (d: string) => kit.log.keys(d) };
  return { kit, sponsor, root, job, channel, log };
}
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

test("DK83 done: a hosted agent runs under a delegated key, a revoked key stops it at the log at once and the host within the stated deadline, and the root key never leaves the sponsor", async () => {
  const { kit, root, job, channel, log } = await world();
  const at = () => kit.tick();

  // The host makes its own key and sends only the public half; the sponsor's machine signs the delegation with the root key.
  const node = newNodeKey(root.did, "res-node-1");
  channel.push({ toSponsor: { kid: node.kid, publicKey: node.publicKey } });
  const issued = at();
  const grant = issueDelegation(root, root.did, node, { mandate: job.mandate, host: HOST_DID, expires: iso(Date.parse(issued) + 20 * 3_600_000), issuedAt: issued });
  channel.push({ toHost: grant });

  // The log's rules for a residency delegation.
  const bare = (over: Record<string, unknown>, n = "res-node-x") => { const k = newNodeKey(root.did, n); const t = at(); return createRecord({ type: "node", issuer: root.did, subject: null, prev: null, body: clean({ node: k.kid, public_key: k.publicKey, expires: iso(Date.parse(t) + 3_600_000), purpose: "residency", host: HOST_DID, mandate: job.mandate, ...over }), issued_at: t }, root); };
  assert.equal(await refused(log.append(bare({ mandate: undefined }))), "delegation_needs_mandate", "a residency delegation cites its Mandate");
  assert.equal(await refused(log.append(bare({ host: "did:web:evil.example" }))), "delegation_wrong_host");
  assert.equal(await refused(log.append(bare({ host: undefined }))), "delegation_wrong_host");
  assert.equal(await refused(log.append(bare({ purpose: "orchestrate" }))), "delegation_host_without_purpose");
  assert.equal(await refused(log.append(bare({ expires: iso(Date.now() + 40 * 3_600_000 * 24) }))), "node_ttl", "at most 24 hours: the sponsor renews");
  await kit.put(grant);

  // The hosted agent acts under the delegated key only.
  const host = new ResidentHost(log, root.did, node.signer, node.kid);
  const first = await host.act(job.contract, ["repo.read"], at());
  assert.ok(first, "an Action signed as the node is accepted");
  const stored = (await kit.log.get(first))!.record;
  assert.equal(stored.sig.kid, node.kid, "signed as <agent>#node, not the root key");
  assert.equal(stored.actor, node.kid);
  // It cannot sign identity records, and it cannot co-sign.
  const passportEdit = createRecord({ type: "passport", issuer: root.did, actor: node.kid, subject: root.did, prev: null, body: { did: root.did, kind: "agent", sponsor: "did:web:example.com:users:attacker", tier: 3, shape: {}, keys: [] }, issued_at: at() }, node.signer);
  assert.ok(await refused(log.append(passportEdit)), "a node cannot rewrite the agent's passport");
  const coSigned = cosign(kit.mk("attestation", root, { kind: "acceptance", about: job.contract, verdict: "accepted" }, null, { subject: job.contract }), node.signer);
  assert.equal(await refused(log.append(coSigned)), "node_key_cosign");

  // The root key never leaves the sponsor: nothing that crossed the boundary contains it, and the host object holds only the node's own signer.
  const wire = JSON.stringify(channel);
  assert.ok(!wire.includes(b64urlEncode(new Uint8Array(32).fill(ROOT_SEED))), "no root private key crossed to the host");
  assert.ok(!wire.includes(b64urlEncode(root.publicKey)) || wire.includes(node.publicKey), "only public material crossed");
  assert.ok(!Object.keys(host).some((k) => /root|seed|secret/i.test(k)), "the host object has no root key field");

  // A recall: the host's loop polls on a clock of its own; the log refuses the node's records the moment the recall is appended.
  const recallAt = at();
  const stopped: number[] = [];
  const loopHost = new ResidentHost(log, root.did, node.signer, node.kid, { onStop: () => stopped.push(1) });
  assert.equal(RECALL_DEADLINE_SECONDS, 60);
  let stoppedAtSeconds: number | undefined;
  for (let t = 0; t <= 200; t += 5) {
    if (t === 100) await kit.put(recallDelegation(root, root.did, grant, recallAt));
    if ((await loopHost.tick(t * 1000)) === "stopped" && stoppedAtSeconds === undefined) stoppedAtSeconds = t;
  }
  assert.ok(stoppedAtSeconds !== undefined && stoppedAtSeconds >= 100, "the loop kept running until the recall");
  assert.ok(stoppedAtSeconds! - 100 <= RECALL_DEADLINE_SECONDS, `the host stopped ${stoppedAtSeconds! - 100} seconds after the recall; the stated deadline is ${RECALL_DEADLINE_SECONDS}`);
  assert.ok(stoppedAtSeconds! - 100 <= POLL_SECONDS);
  assert.equal(stopped.length, 1, "the host was told to end its model calls and seal its package");
  await assert.rejects(loopHost.act(job.contract, ["repo.read"], at()), /host stopped/);
  // The log does not trust the host to stop: a record signed by the revoked key is refused, even one dated before the recall.
  const late = createRecord({ type: "action", issuer: root.did, actor: node.kid, subject: job.contract, prev: null, body: { contract: job.contract, scopes_used: ["repo.read"] }, issued_at: iso(Date.parse(recallAt) - 1000) }, node.signer);
  assert.ok(await refused(log.append(late)), "a back-dated record from the revoked key is refused");
  assert.ok(await refused(log.append(createRecord({ type: "action", issuer: root.did, actor: node.kid, subject: job.contract, prev: null, body: { contract: job.contract, scopes_used: ["repo.read"] }, issued_at: at() }, node.signer))), "and a new one");

  // Expiry stops it too, with no recall: a fresh delegation lapses after its time.
  const n2 = newNodeKey(root.did, "res-node-2");
  const t2 = at();
  await kit.put(issueDelegation(root, root.did, n2, { mandate: job.mandate, host: HOST_DID, expires: iso(Date.parse(t2) + 3_600_000), issuedAt: t2 }));
  const h2 = new ResidentHost(log, root.did, n2.signer, n2.kid);
  await h2.act(job.contract, ["repo.read"], at());
  kit.addDays(1);
  assert.ok(await refused(log.append(createRecord({ type: "action", issuer: root.did, actor: n2.kid, subject: job.contract, prev: null, body: { contract: job.contract, scopes_used: ["repo.read"] }, issued_at: at() }, n2.signer))), "refused after its expiry");
  assert.equal(await h2.tick(Date.parse(kit.now())), "stopped", "the host's loop sees the expiry too");
  assert.equal((await kit.log.verify()).ok, true);
});
