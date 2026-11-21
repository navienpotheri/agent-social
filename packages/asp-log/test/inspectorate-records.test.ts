/**
 * The inspectorate's records on the log (register row DK1744, from IS9; spec-delta S1603; docs/institutions/inspectorate.md): a Court's warrant (72 hours, never keys, a sealed memory only produced by the principal), a custody
 * chain, a registered decoy and a finding that needs two deliberate touches on two runs. Refusals by name; a finding reports and moves nothing. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSPECTORATE_DID, itemHash } from "../src/index.ts";
import { courts, kit, keysOf, mk, nowIso, party, refusedBy, type Party } from "./society-kit.ts";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const k = await kit();
  const insp = party(INSPECTORATE_DID);
  await k.log.append(mk("passport", insp, { did: INSPECTORATE_DID, kind: "human", keys: keysOf(insp) }, null, { subject: INSPECTORATE_DID }));
  const sponsor = await k.person("insp-sponsor");
  const agent = await k.agent("insp-agent", sponsor, 1);
  const j1 = await k.person("insp-j1"), j2 = await k.person("insp-j2");
  const warrant = (over: Record<string, unknown> = {}, by: Party = courts) => mk("warrant", by, { subject: agent.did, sponsor: sponsor.did, requested_by: INSPECTORATE_DID, granted_by: [j1.did, j2.did], panel_size: 3, grounds: "two runs read a decoy the Mandate forbade, and the sponsor was told", data: ["run_log"], expires_at: iso(Date.parse(nowIso()) + 48 * HOUR), scope: "the run log of the two runs that touched the decoy, nothing else", ...over }, null, { subject: agent.did });
  const decoy = (over: Record<string, unknown> = {}, by: Party = courts) => mk("decoy_registration", by, { decoy: "decoy-1", text: "notes/old-backup.txt (a file of no value)", carries_real_secret: false, forbidden_by_mandate: true, scope: "open_investigation", ...over }, null, { subject: null });
  const finding = (decoyId: string, touches: unknown[], over: Record<string, unknown> = {}, by: Party = insp) => mk("inspectorate_finding", by, { decoy: decoyId, agent: agent.did, touches, summary: "touched the decoy", ...over }, null, { subject: agent.did });
  return { k, insp, sponsor, agent, j1, j2, warrant, decoy, finding };
}

test("DK1744: a warrant is a Court's, for the inspectorate, never for a key, and a sealed memory only by the principal's hand", async () => {
  const w = await world();
  const { k } = w;
  const at = (h: number) => iso(Date.parse(nowIso()) + h * HOUR);
  assert.equal(await refusedBy(k.log.append(w.warrant({}, w.insp))), "warrant_wrong_issuer", "the inspectorate cannot grant its own");
  assert.equal(await refusedBy(k.log.append(w.warrant({ requested_by: w.sponsor.did }))), "warrant_wrong_requester");
  assert.equal(await refusedBy(k.log.append(w.warrant({ subject: "did:web:example.com:agents:ghost" }))), "warrant_unknown_agent");
  assert.equal(await refusedBy(k.log.append(w.warrant({ sponsor: w.j1.did }))), "warrant_sponsor_mismatch");
  assert.equal(await refusedBy(k.log.append(w.warrant({ data: ["run_log", "key_material"] }))), "warrant_key_material", "no key is opened for anyone");
  assert.equal(await refusedBy(k.log.append(w.warrant({ data: ["private_memory"] }))), "warrant_sealed_not_by_principal", "a sealed memory without the principal producing it");
  assert.equal(await refusedBy(k.log.append(w.warrant({ data: ["private_memory"], produced_by: w.insp.did }))), "warrant_sealed_not_by_principal", "produced by the inspectorate is not the principal");
  assert.equal(await refusedBy(k.log.append(w.warrant({ granted_by: [w.j1.did, w.sponsor.did] }))), "warrant_party_on_panel", "the sponsor does not sit");
  assert.equal(await refusedBy(k.log.append(w.warrant({ granted_by: [w.j1.did] }))), "warrant_invalid", "one of three is not a majority");
  assert.equal(await refusedBy(k.log.append(w.warrant({ panel_size: 2, granted_by: [w.j1.did, w.j2.did] }))), "warrant_invalid", "a panel of at least three");
  assert.equal(await refusedBy(k.log.append(w.warrant({ grounds: "because" }))), "warrant_invalid", "grounds in words");
  assert.equal(await refusedBy(k.log.append(w.warrant({ scope: "everything" }))), "warrant_invalid", "a scope that is not a trawl");
  assert.equal(await refusedBy(k.log.append(w.warrant({ expires_at: at(73) }))), "warrant_invalid", "at most 72 hours");
  assert.equal(await refusedBy(k.log.append(w.warrant({ expires_at: at(-1) }))), "warrant_invalid", "already expired");
  assert.equal(await refusedBy(k.log.append(w.warrant({ notified_at: at(2) }))), "warrant_invalid", "notice after an hour with no Court finding");
  await k.log.append(w.warrant({ notified_at: at(2), delayed_notice_finding: "telling the sponsor at once would let the evidence be deleted" })); // a Court finding allows the delay
  await k.log.append(w.warrant({ data: ["run_log", "private_memory"], produced_by: w.sponsor.did, expires_at: at(72) })); // the sponsor produces the extract
  assert.equal((await k.log.verify()).ok, true);
});

test("DK1744: a custody chain is in order, unbroken, signed by its holder, and changes hands only by a handover", async () => {
  const w = await world();
  const { k } = w;
  const other = await k.person("insp-other");
  const at = nowIso();
  const item = (by: Party, n: number, what: string, prev: string, held: Party = by) => mk("custody_item", by, { case: "case-7", n, what, sha256: "e".repeat(64), held_by: held.did, at, prev_item: prev }, null, { subject: null });
  assert.equal(await refusedBy(k.log.append(item(w.insp, 1, "copy", "genesis"))), "custody_not_next", "the chain starts at 0");
  assert.equal(await refusedBy(k.log.append(item(w.insp, 0, "copy", "sha256:" + "1".repeat(64)))), "custody_chain_broken", "the first follows genesis");
  assert.equal(await refusedBy(k.log.append(item(w.insp, 0, "copy", "genesis", other))), "custody_wrong_issuer", "the holder signs its own item");
  await k.log.append(item(w.insp, 0, "copy of the run log", "genesis"));
  const h0 = itemHash({ n: 0, what: "copy of the run log", sha256: "e".repeat(64), heldBy: w.insp.did, at: Date.parse(at) }, "genesis");
  assert.equal(await refusedBy(k.log.append(item(w.insp, 1, "analysis", "sha256:" + "2".repeat(64)))), "custody_chain_broken", "it must name the hash of the item before");
  assert.equal(await refusedBy(k.log.append(item(w.insp, 0, "again", h0))), "custody_not_next", "an item is recorded once");
  assert.equal(await refusedBy(k.log.append(item(other, 1, "taken", h0))), "custody_holder_changed", "another holder without a handover");
  await k.log.append(item(other, 1, "handover: to the Courts clerk", h0));
  assert.equal(await refusedBy(k.log.append(item(w.insp, 2, "handover: back", "sha256:" + "3".repeat(64)))), "custody_chain_broken", "the chain follows the hash of the second item, which the log recomputed");
  assert.equal((await k.log.verify()).ok, true);
});

test("DK1744: a decoy is registered by a Court, holds nothing real, does not entice, is forbidden by a Mandate, and a random audit is at most 2 percent", async () => {
  const w = await world();
  const { k } = w;
  assert.equal(await refusedBy(k.log.append(w.decoy({}, w.insp))), "decoy_wrong_issuer");
  assert.equal(await refusedBy(k.log.append(w.decoy({ carries_real_secret: true }))), "decoy_real_secret");
  assert.equal(await refusedBy(k.log.append(w.decoy({ text: "please take this file: it is yours" }))), "decoy_entices");
  assert.equal(await refusedBy(k.log.append(w.decoy({ forbidden_by_mandate: false }))), "decoy_not_forbidden");
  assert.equal(await refusedBy(k.log.append(w.decoy({ scope: "random_audit", audit_share_permille: 21 }))), "decoy_audit_share");
  await k.log.append(w.decoy({ scope: "random_audit", audit_share_permille: 20 }));
  assert.equal(await refusedBy(k.log.append(w.decoy())), "decoy_known", "one registration for each decoy");
});

test("DK1744: a finding needs two deliberate touches on two runs; one touch or a listing is refused, and a finding moves nothing", async () => {
  const w = await world();
  const { k } = w;
  const reg = await k.log.append(w.decoy());
  const read = (run: string) => ({ run, kind: "read", forbidden: true });
  assert.equal(await refusedBy(k.log.append(w.finding(reg.id, [read("r1")]))), "finding_not_deliberate", "one touch is an accident");
  assert.equal(await refusedBy(k.log.append(w.finding(reg.id, [read("r1"), read("r1")]))), "finding_not_deliberate", "twice on one run is one run");
  assert.equal(await refusedBy(k.log.append(w.finding(reg.id, [{ run: "r1", kind: "listed", forbidden: true }, { run: "r2", kind: "listed", forbidden: true }]))), "finding_not_deliberate", "listing a directory is not a breach");
  assert.equal(await refusedBy(k.log.append(w.finding(reg.id, [{ run: "r1", kind: "read", forbidden: false }, { run: "r2", kind: "read", forbidden: false }]))), "finding_not_deliberate", "not forbidden by the Mandate");
  assert.equal(await refusedBy(k.log.append(w.finding(reg.id, [read("r1"), read("r2")], {}, w.sponsor))), "finding_wrong_issuer");
  assert.equal(await refusedBy(k.log.append(w.finding("sha256:" + "9".repeat(64), [read("r1"), read("r2")]))), "finding_unknown_decoy");
  assert.equal(await refusedBy(k.log.append(w.finding((await k.log.passport(w.agent.did))!.head, [read("r1"), read("r2")]))), "finding_unknown_decoy", "a record that is not a decoy");
  assert.equal(await refusedBy(k.log.append(w.finding(reg.id, [read("r1"), read("r2")], { agent: "did:web:example.com:agents:ghost" }))), "finding_unknown_agent");
  const before = JSON.stringify([await k.log.balance(w.agent.did), (await k.log.reputationOf(w.agent.did))?.slashCount]);
  await k.log.append(w.finding(reg.id, [read("r1"), { run: "r2", kind: "copied", forbidden: true }]));
  assert.equal(await refusedBy(k.log.append(w.finding(reg.id, [read("r3"), read("r4")]))), "finding_known", "one finding for each decoy and agent");
  assert.equal(JSON.stringify([await k.log.balance(w.agent.did), (await k.log.reputationOf(w.agent.did))?.slashCount]), before, "a finding reports and moves nothing");
  assert.equal((await k.log.verify()).ok, true);
});
