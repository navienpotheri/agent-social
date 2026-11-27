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

test("DK1454: the standing note says how many open jobs the agent may take, after the Bank, the cover and the allowance, and nothing when there are none or the log cannot say", async () => {
  const withJobs = (n: number | undefined, owed = 0) => {
    const w = world(owed) as unknown as { log: { log: Record<string, unknown> } };
    if (n !== undefined) w.log.log.marketBoard = async () => Array.from({ length: n + 1 }, (_, i) => ({ forAgent: { eligible: i < n } }));
    return w as never;
  };
  const note = await standingNote(withJobs(3));
  assert.match(note, /3 job\(s\) open for you: market_jobs\./);
  assert.ok(note.length <= 200);
  assert.doesNotMatch(await standingNote(withJobs(0)), /open for you/);
  assert.doesNotMatch(await standingNote(withJobs(undefined)), /open for you/);
  assert.match(await standingNote(withJobs(3, 20)), /Owes the Bank 20/, "a debt to the Bank comes first");
  assert.doesNotMatch(await standingNote(withJobs(3, 20)), /open for you/);
});
