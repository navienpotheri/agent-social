/**
 * The memory key on the log (register rows D12 and DK272; spec-delta S1604): an identity publishes the PUBLIC half of its X25519 memory key; only itself, raw 32 bytes, one live key, a rotation names the entry it replaces;
 * `memoryKey(did)` returns the live key. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode } from "@agent-social/asp-core";
import { kit, mk, refusedBy, type Party } from "./society-kit.ts";

const key = (n: number) => b64urlEncode(new Uint8Array(32).fill(n));

async function world() {
  const k = await kit();
  const sponsor = await k.person("mk-sponsor");
  const agent = await k.agent("mk-agent", sponsor);
  const entry = (by: Party, did: string, over: Record<string, unknown> = {}) => mk("memory_key", by, { did, name: "memory-1", public_key: key(7), at: "2026-11-22T10:00:00Z", ...over }, null, { subject: did });
  return { k, sponsor, agent, entry };
}

test("D12: an identity publishes its own raw memory key; nobody else, no unknown identity, and nothing but 32 raw bytes", async () => {
  const w = await world();
  assert.equal(await w.k.log.memoryKey(w.agent.did), undefined);
  assert.equal(await refusedBy(w.k.log.append(w.entry(w.sponsor, w.agent.did))), "memory_key_wrong_issuer", "a sponsor does not publish for its agent");
  for (const bad of [key(7) + "A", key(7).slice(0, 42), "MCowBQYDK2VuAyEA" + key(7), "-----BEGIN PRIVATE KEY-----", b64urlEncode(new Uint8Array(33).fill(1)).slice(0, 43) + "="])
    assert.equal(await refusedBy(w.k.log.append(w.entry(w.agent, w.agent.did, { public_key: bad }))), "memory_key_private_material", bad);
  await w.k.log.append(w.entry(w.agent, w.agent.did));
  assert.deepEqual((await w.k.log.memoryKey(w.agent.did))?.public_key, key(7));
});

test("D12: one live key, and a rotation names the entry it replaces; the latest un-revoked entry is the live key", async () => {
  const w = await world();
  const first = await w.k.log.append(w.entry(w.agent, w.agent.did));
  assert.equal(await refusedBy(w.k.log.append(w.entry(w.agent, w.agent.did, { name: "memory-2", public_key: key(8) }))), "memory_key_live", "a second live key");
  assert.equal(await refusedBy(w.k.log.append(w.entry(w.agent, w.agent.did, { name: "memory-2", public_key: key(8), revokes: "sha256:" + "5".repeat(64) }))), "memory_key_revokes_unknown");
  await w.k.log.append(w.entry(w.agent, w.agent.did, { name: "memory-2", public_key: key(8), revokes: first.id }));
  const live = (await w.k.log.memoryKey(w.agent.did))!;
  assert.deepEqual([live.name, live.public_key], ["memory-2", key(8)]);
  assert.equal(await refusedBy(w.k.log.append(w.entry(w.agent, w.agent.did, { name: "memory-3", public_key: key(9), revokes: first.id }))), "memory_key_revokes_unknown", "the replaced entry cannot be replaced again");
  assert.equal((await w.k.log.verify()).ok, true);
  assert.equal(await w.k.log.memoryKey(w.sponsor.did), undefined, "another identity has none");
});
