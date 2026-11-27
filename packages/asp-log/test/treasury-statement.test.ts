// Row DK381 (spec-delta S960): the Treasury signs a statement for a month: only the Treasury, its balance must be the log's own, one for each month. Fake keys only; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TREASURY_DID } from "../src/index.ts";
import { credit, kit, mk, treasury, refusedBy } from "./society-kit.ts";

const HASH = "sha256:" + "5".repeat(64);
const body = (period: string, balance: number, extra: Record<string, unknown> = {}) => ({ period, balance: credit(balance), reconciles: true, unexplained: 0, statement_sha256: HASH, ...extra });

test("DK381: the Treasury signs a statement that matches its ledger; a wrong balance, another issuer and a second statement for the month are refused", async () => {
  const k = await kit();
  await k.mint(TREASURY_DID, 1000);
  const other = await k.person("not-the-treasury");
  const balance = await k.log.balance(TREASURY_DID);
  assert.equal(balance, 1000);
  const ok = await k.log.append(mk("treasury_statement", treasury, body("2026-11", balance), null, { subject: null }));
  assert.ok(ok.id);
  assert.equal(await refusedBy(k.log.append(mk("treasury_statement", treasury, body("2026-11", balance), null, { subject: null }))), "treasury_statement_period_taken");
  assert.equal(await refusedBy(k.log.append(mk("treasury_statement", treasury, body("2026-12", balance + 1), null, { subject: null }))), "treasury_statement_balance_mismatch");
  assert.equal(await refusedBy(k.log.append(mk("treasury_statement", other, body("2026-12", balance), null, { subject: null }))), "treasury_statement_wrong_issuer");
  assert.ok((await k.log.append(mk("treasury_statement", treasury, body("2026-12", balance), null, { subject: null }))).id, "the next month is its own statement");
  assert.equal((await k.log.recordsOfTypes(["treasury_statement"])).length, 2);
  assert.equal((await k.log.creditAudit()).verdict, "balanced", "a statement moves no credit");
  assert.equal((await k.log.verify()).ok, true);
});
