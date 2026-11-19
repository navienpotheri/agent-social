// Row DK387: the standing note says how many live policies the agent holds, within 200 characters; none, and it says nothing about cover.
import { test } from "node:test";
import assert from "node:assert/strict";
import { standingNote } from "../src/spend.ts";

const AGENT = "did:web:example.com:agents:insured";
const world = (policies: unknown[]) => ({
  log: { log: { balance: async () => 40, reputationOf: async () => ({ tier: 1, slashCount: 0, strikes: 0 }), mandatesOf: async () => [], purchasesBy: async () => [], priceLists: async () => [], treasuryLedger: async () => ({ allowances: [{ agent: AGENT }] }), recordsOfTypes: async () => policies } },
  io: { out: () => {} }, now: () => "2026-11-12T12:00:00Z", flags: { by: AGENT }, signerFor: () => { throw new Error("no key"); },
}) as never;

test("DK387: the standing note names the cover an agent holds, counts only live policies of its own, and is silent without any", async () => {
  const note = await standingNote(world([{ body: { holder: AGENT, valid_to: "2027-01-01T00:00:00Z" } }, { body: { holder: AGENT, valid_to: "2026-10-01T00:00:00Z" } }, { body: { holder: "did:other", valid_to: "2027-01-01T00:00:00Z" } }]));
  assert.match(note, /Cover held on 1 job\(s\)/);
  assert.ok(note.length <= 200);
  assert.doesNotMatch(await standingNote(world([])), /Cover held/);
});
