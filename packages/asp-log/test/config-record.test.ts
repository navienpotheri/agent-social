// DK312 (S972): the bond floor cutover is a signed configuration record in the log: only the operator, with the owner, once, not in the past; a log opened without the deployment option reads the same value, and a replay agrees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecord, cosign, signerFromSeed, staticResolver, type AspRecord, type Signer } from "@agent-social/asp-core";
import { EventLog, MemoryStore } from "../src/index.ts";
import { failure, registerParties } from "./harness.ts";

type Party = { did: string } & Signer & { publicKey: Uint8Array };
const party = (did: string, n: number): Party => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(32).fill(n)) });
const operator = party("did:web:asp.local:operator", 11), owner = party("did:web:asp.local:owner", 12), mallory = party("did:web:evil.example:mallory", 16);
const resolver = staticResolver(Object.fromEntries([operator, owner, mallory].map((p) => [p.kid, p.publicKey])));
const refused = async (p: Promise<unknown>) => { const f = await failure(p); return f?.detail ?? f?.code; };
const cfg = (by: Party, value: string, at: string, cosigners: Party[] = [owner]): AspRecord => { let r = createRecord({ type: "config", issuer: by.did, subject: null, prev: null, body: { key: "bond_floor_from", value }, issued_at: at }, by); for (const c of cosigners) r = cosign(r, c); return r; };

test("S972: the cutover is written once by the operator with the owner, at or after its own time, and travels with the log", async () => {
  const store = new MemoryStore();
  const mk = (extra: Record<string, unknown> = {}) => new EventLog(store, { operator: operator.did, owner: owner.did, fallbackResolver: resolver, bondFloor: "v3", ...extra });
  const log = mk();
  await registerParties(log);
  const at = "2026-11-10T00:00:00Z", cut = "2026-12-01T00:00:00Z";
  assert.equal(await log.bondFloorCutover(), undefined);
  assert.equal(await refused(log.append(cfg(mallory, cut, at))), "config_unauthorised");
  assert.equal(await refused(log.append(cfg(operator, cut, at, []))), "config_needs_cosign");
  assert.equal(await refused(log.append(cfg(operator, "2026-11-01T00:00:00Z", at))), "config_cutover_past");
  await log.append(cfg(operator, cut, at));
  assert.equal(await log.bondFloorCutover(), cut);
  assert.equal(await refused(log.append(cfg(operator, "2027-01-01T00:00:00Z", "2026-11-11T00:00:00Z"))), "config_already_set", "set once, never changed");

  // A log opened on the same records without the deployment option reads the value from the log; one whose option disagrees is refused at its first record.
  const reopened = mk();
  assert.equal(await reopened.bondFloorCutover(), cut);
  assert.equal(await reopened.verify().then((v) => v.ok), true, "a replay reproduces every verdict");
  const clash = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, bondFloor: "v3", bondFloorFrom: "2026-12-15T00:00:00Z" });
  await registerParties(clash);
  assert.equal(await refused(clash.append(cfg(operator, cut, at))), "config_conflicts_option");
});
