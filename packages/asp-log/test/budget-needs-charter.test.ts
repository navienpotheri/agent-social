// Register row DK231 (treasury.md TRL-16): from a cutover the Treasury sets no budget for an institution with no published charter in force. A charter that is published but not yet in force (a first version has no
// wait; a later version waits 72 hours) does not leave the institution without one while an earlier version stands. Before the cutover, and for the Treasury's own lines, nothing changes. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TREASURY_DID, institutionDid } from "../src/index.ts";
import { credit, kit, mk, operator, owner, refusedBy, treasury } from "./society-kit.ts";

const hash = (c: string) => "sha256:" + c.repeat(64);
const courts = institutionDid("courts"), registry = institutionDid("registry");

async function world(cutover?: string) {
  const k = await kit({ ...(cutover ? { charterRequiredFrom: cutover } : {}) });
  await k.log.append(mk("mint", operator, { to: TREASURY_DID, amount: credit(2000), reason: "treasury_issuance", authority: "operator" }, null, { subject: TREASURY_DID, cosigners: [owner] }));
  const budget = (inst: string, period = "2026-11", at?: string) => mk("budget", treasury, { institution: inst, period, amount: credit(100), purpose: `${inst} ${period}` }, null, { subject: null, cosigners: [owner], ...(at ? { at } : {}) });
  const charter = (inst: string, version: number, effectiveFrom: string, at?: string) => mk("institution_charter", operator, { institution: inst, version, kind: "sovereign", status: "active", text_sha256: hash(String(version)), effective_from: effectiveFrom, officers: [operator.did], funding: "budget" }, null, { subject: inst, cosigners: [owner], ...(at ? { at } : {}) });
  return { k, budget, charter };
}

test("DK231: from the cutover a budget for an institution with no charter is refused, a chartered one is accepted, and the Treasury's own lines need none", async () => {
  const w = await world("2026-11-01T00:00:00Z");
  assert.equal(await refusedBy(w.k.log.append(w.budget(courts))), "budget_no_charter");
  await w.k.log.append(w.charter(courts, 1, "2026-11-01T00:00:00Z"));
  await w.k.log.append(w.budget(courts));
  assert.equal(await refusedBy(w.k.log.append(w.budget(registry))), "budget_no_charter", "a charter of one institution does not cover another");
  // The Treasury's own allowance line is not an institution and needs no charter.
  await w.k.log.append(mk("budget", treasury, { institution: TREASURY_DID, period: "2026-11", amount: credit(50), purpose: "allowance" }, null, { subject: null, cosigners: [owner] }));
});

test("DK231: before the cutover the same budget is accepted with no charter, and a charter that waits its notice does not remove the earlier one", async () => {
  const early = await world("2027-01-01T00:00:00Z");
  await early.k.log.append(early.budget(courts));
  // A first version is in force at once; a second waits 72 hours, and the first still stands meanwhile.
  const w = await world("2026-11-01T00:00:00Z");
  await w.k.log.append(w.charter(courts, 1, "2026-11-01T00:00:00Z"));
  const published = Date.parse("2026-11-01T01:00:00Z");
  void published;
  await w.k.log.append(w.charter(courts, 2, new Date(Date.parse("2026-11-01T00:00:00Z") + 5 * 86_400_000).toISOString().replace(".000Z", "Z")));
  await w.k.log.append(w.budget(courts, "2026-11"));
});
