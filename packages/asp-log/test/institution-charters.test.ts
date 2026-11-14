// Institution charters as signed records (register rows IS1 and DK382; spec-delta S480): founding, versions, notice, the owner's co-signature, closing, and no budget for a closed institution. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARTERED, TREASURY_DID, institutionDid } from "../src/index.ts";
import { credit, Kit, hashOf, operator, owner, refused, treasury } from "./academy-kit.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const courts = institutionDid("courts");

function charter(k: Kit, over: Record<string, unknown> = {}, cos = true, by = operator) {
  const at = k.now();
  return k.mk("institution_charter", by, { institution: courts, version: 1, kind: "sovereign", status: "active", text_sha256: hashOf("a"), effective_from: at, officers: [operator.did], funding: "courts", ...over }, null, { subject: String(over.institution ?? courts), cosigners: cos ? [owner] : [], at });
}

test("IS1: an institution is founded by a charter the operator signs and the owner co-signs, then changed by versions with notice, and closed by a version that says why", async () => {
  const k = new Kit();
  assert.equal(CHARTERED.length, 13, "eleven institutions, the Treasury and the Forum");
  // Founding: the operator signs, the owner co-signs, an institution of the society, version 1, active.
  assert.equal(await refused(k.log.append(charter(k, {}, false))), "charter_needs_owner", "the founding needs the owner");
  assert.equal(await refused(k.log.append(charter(k, {}, true, k.log ? (await k.person("not-operator")) as never : operator))), "charter_wrong_issuer", "only the operator signs a charter");
  assert.equal(await refused(k.log.append(charter(k, { institution: "did:web:example.com:agents:made-up" }))), "charter_unknown_institution");
  assert.equal(await refused(k.log.append(charter(k, { version: 2 }))), "charter_version", "the first is version 1");
  assert.equal(await refused(k.log.append(charter(k, { status: "closed" }))), "charter_found_active");
  const v1 = await k.put(charter(k));
  assert.equal((await k.log.charterOf(courts, k.now())).inForce?.version, 1);

  // A later version: the next number, 72 hours' notice, never retroactive; the owner when officers or funding change.
  const at = k.now();
  assert.equal(await refused(k.log.append(charter(k, { version: 2, effective_from: at, text_sha256: hashOf("b") }))), "charter_notice", "not retroactive, not at once");
  assert.equal(await refused(k.log.append(charter(k, { version: 2, effective_from: iso(Date.parse(at) + 4 * DAY), officers: [operator.did, owner.did] }, false))), "charter_needs_owner", "a change of officers");
  assert.equal(await refused(k.log.append(charter(k, { version: 2, effective_from: iso(Date.parse(at) + 4 * DAY), funding: "none" }, false))), "charter_needs_owner", "a change of funding");
  assert.equal(await refused(k.log.append(charter(k, { version: 2, kind: "market", effective_from: iso(Date.parse(at) + 4 * DAY) }))), "charter_kind_fixed");
  await k.put(charter(k, { version: 2, effective_from: iso(Date.parse(at) + 4 * DAY), text_sha256: hashOf("b") }, false)); // a text-only change needs no owner
  const mid = await k.log.charterOf(courts, k.now());
  assert.equal(mid.versions.length, 2);
  assert.equal(mid.inForce?.version, 1, "version 2 is not in force until its date");
  assert.equal((await k.log.charterOf(courts, iso(Date.parse(at) + 5 * DAY))).inForce?.version, 2);
  assert.equal(mid.versions[0].record, v1);

  // Closing: the owner and a reason; after it no budget and no amendment.
  const closeAt = k.now();
  const closing = (over: Record<string, unknown> = {}, cos = true) => charter(k, { version: 3, status: "closed", effective_from: iso(Date.parse(closeAt) + 4 * DAY), ...over }, cos);
  assert.equal(await refused(k.log.append(closing({ reason: "no longer needed" }, false))), "charter_needs_owner");
  assert.equal(await refused(k.log.append(closing())), "charter_closing_reason");
  await k.put(closing({ reason: "the Courts are folded into the Registry's panel" }));
  assert.equal(await refused(k.log.append(charter(k, { version: 4, effective_from: iso(Date.parse(closeAt) + 9 * DAY) }))), "charter_closed");
  await k.mint(TREASURY_DID, 1000);
  const budget = (inst: string) => k.mk("budget", treasury, { institution: inst, period: "2026-11", amount: credit(100), purpose: "charter" }, null, { cosigners: [owner] });
  assert.equal(await refused(k.log.append(budget(courts))), "budget_institution_closed", "no budget for a closed institution");
  await k.put(budget(institutionDid("registry")));
  assert.equal((await k.log.verify()).ok, true, "a replay reproduces the charters");
});

test("IS1: the index shows which institutions have a charter in force, its funding and its officers", async () => {
  const k = new Kit();
  await k.put(charter(k));
  await k.put(charter(k, { institution: institutionDid("registry"), funding: "none", text_sha256: hashOf("c") }));
  const idx = await k.log.charterIndex(k.now());
  assert.equal(idx.length, 13);
  assert.equal(idx.filter((i) => i.version !== null).length, 2);
  const reg = idx.find((i) => i.institution === institutionDid("registry"))!;
  assert.deepEqual([reg.version, reg.status, reg.funding, reg.kind], [1, "active", "none", "sovereign"]);
  assert.deepEqual(reg.officers, [operator.did]);
  assert.equal(idx.find((i) => i.institution === institutionDid("bank"))!.version, null);
});
