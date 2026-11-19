// Row DK386: the standing note tells an agent what it owes the Bank, in one short line within 200 characters, and says nothing about the Bank to an agent that owes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { standingNote } from "../src/spend.ts";

const AGENT = "did:web:example.com:agents:debtor";
const world = (owed: number | undefined) => ({
  log: { log: { balance: async () => 40, reputationOf: async () => ({ tier: 1, slashCount: 0, strikes: 0 }), mandatesOf: async () => [], purchasesBy: async () => [], priceLists: async () => [], treasuryLedger: async () => ({ allowances: [{ agent: AGENT }] }), ...(owed === undefined ? {} : { bankOwedBy: async () => owed }) } },
  io: { out: () => {} }, now: () => "2026-11-12T12:00:00Z", flags: { by: AGENT }, signerFor: () => { throw new Error("no key"); },
}) as never;

test("DK386: an agent that owes the Bank is told so in its standing note; one that owes nothing, or a log that cannot say, gets no Bank line", async () => {
  const owing = await standingNote(world(20));
  assert.match(owing, /Owes the Bank 20: asp_standing\./);
  assert.ok(owing.length <= 200);
  assert.match(owing, /accounting, not money/);
  assert.doesNotMatch(await standingNote(world(0)), /Bank/);
  assert.doesNotMatch(await standingNote(world(undefined)), /Bank/);
});
