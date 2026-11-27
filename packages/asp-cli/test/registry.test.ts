import { test } from "node:test";
import assert from "node:assert/strict";
import { signerFromSeed, randomSeed } from "@agent-social/asp-core";
import { registryCmd, RegistryUsage } from "../src/registry.ts";

// `asp registry` reads views and signs records; the log's own tests (registry-civil.test.ts) check every rule. Here the log is a fake and the output and the records signed are checked.
const A = "did:web:example.com:agents:a", REG = "did:web:asp.local:registry";
const NOW = "2026-12-05T00:00:00Z";
const page = { did: A, names: ["scout-7"], kind: "agent", sponsor: "did:web:example.com:users:s", fleet: null, lineage: [], purpose: null, temperament: null, tier: 1, slashCount: 0, strikes: 0, acceptedJobs: 2, qualifyingJobs: 1, certificates: [], renewal: { due: "2027-01-01T00:00:00Z", lapsed: false }, suspended: null, retired: false, takedowns: [], seq: 9, recompute: "x" };

function run(sub: string, rest: string[], flags: Record<string, unknown> = {}, appended: any[] = [], over: Record<string, unknown> = {}) {
  const out: string[] = [];
  const signers = new Map<string, any>();
  const log = { log: { registryPage: async () => page, registrySearch: async () => [{ did: A, names: ["scout-7"] }], registryVerify: async (h: any) => (h.tier === 1 ? [] : ["tier: forged"]), recordsOfTypes: async () => [], passport: async () => ({ head: "sha256:" + "1".repeat(64), sponsor: "did:web:example.com:users:s" }), keys: async () => [{ kid: "k1", revokedAt: null }], ...over }, append: async (r: unknown) => { appended.push(r); return { id: "rec-1", seq: 7 }; } } as any;
  return registryCmd(sub, rest, { log, io: { out: (l) => out.push(l) }, now: () => NOW, flags, signerFor: (d) => { if (!signers.has(d)) signers.set(d, { did: d, ...signerFromSeed(d + "#key-1", randomSeed()) }); return signers.get(d); }, readJson: () => ({ ...page, tier: 3 }) }).then((code) => ({ code, text: out.join("\n") }));
}

test("lookup shows the page with the log seq and how to recompute it; search lists names; verify compares a held page", async () => {
  const l = await run("lookup", [A]);
  assert.match(l.text, /scout-7/); assert.match(l.text, /computed from the log at record 9/);
  assert.match((await run("search", ["scout"])).text, /scout-7/);
  assert.match((await run("verify", [A])).text, /matches the log/);
  const bad = await run("verify", [A], { page: "held.json" });
  assert.equal(bad.code, 1); assert.match(bad.text, /DIFFERS tier/);
});

test("claim signs a 365-day name claim; renew names the current passport and cosigns with the sponsor; the Registrar's acts are signed by the Registrar", async () => {
  const appended: any[] = [];
  await run("claim", ["scout-7"], { by: A, paid: "sha256:" + "2".repeat(64) }, appended);
  assert.deepEqual([appended[0].type, appended[0].body.act, appended[0].body.valid_until, appended[0].issuer], ["asp.registry_act/v0.2", "name_claim", "2027-12-05T00:00:00Z", A]);
  await run("renew", [], { by: A }, appended);
  assert.deepEqual([appended[1].body.act, appended[1].body.keys_confirmed, appended[1].cosigs?.length], ["identity_renewal", ["k1"], 1]);
  await run("suspend", [], { did: A, reason: "harm", days: "30" }, appended);
  assert.equal(appended[2].issuer, REG);
  assert.equal(appended[2].body.until, "2026-12-12T00:00:00Z", "capped at 7 days");
  await assert.rejects(() => run("claim", [], { by: A }), RegistryUsage);
  await assert.rejects(() => run("nope", []), RegistryUsage);
});
