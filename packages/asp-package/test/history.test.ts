import { test } from "node:test";
import assert from "node:assert/strict";
import { randomSeed, signerFromSeed, publicKeyFromSeed } from "@agent-social/asp-core";
import { buildHistory, historyText, signHistory, verifyHistory } from "../src/history.ts";

// The verified history context (DK59): the agent's record read from the log, signed with its own key; a tampered, forged or stale summary is refused.
const DID = "did:web:example.com:agents:learner";
const seed = randomSeed();
const signer = signerFromSeed(`${DID}#key-1`, seed);
const pub = publicKeyFromSeed(seed);

function fakeLog(over: { tier?: number; slashCount?: number; strikes?: number; seq?: number; certs?: unknown[] } = {}) {
  const state = { tier: 2, slashCount: 1, strikes: 3, seq: 40, certs: [{ id: "c1", body: { skill: "foundations", level: 1, expires: "2027-05-01T00:00:00Z" } }], ...over };
  return {
    state,
    head: async () => ({ seq: state.seq, logHash: `hash-${state.seq}` }),
    reputationOf: async (did: string) => (did === DID ? { tier: state.tier, slashCount: state.slashCount, strikes: state.strikes, acceptedJobs: 5, qualifyingJobs: 4 } : null),
    certificatesOf: async () => state.certs,
  } as any;
}

test("the summary carries the agent's own record from the log and reads as a compact context", async () => {
  const s = (await buildHistory(fakeLog(), DID))!;
  assert.deepEqual([s.tier, s.slashCount, s.strikes, s.qualifyingJobs, s.acceptedJobs, s.head.seq], [2, 1, 3, 4, 5, 40]);
  assert.deepEqual(s.certificates, [{ id: "c1", skill: "foundations", level: 1, expires: "2027-05-01T00:00:00Z" }]);
  const text = historyText(s);
  assert.match(text, /tier 2; slashed 1 time\(s\); 3 recent blocked attempt\(s\); 4 qualifying job\(s\) of 5 accepted/);
  assert.match(text, /certificates: foundations level 1 \(to 2027-05-01\)/);
  assert.match(text, /Credits never change your tier/);
  assert.equal(await buildHistory(fakeLog(), "did:web:example.com:users:a-person"), undefined, "a person has no tier");
});

test("a genuine, current summary is accepted; a tampered one, a stale one, one signed by someone else and one with forged figures are each refused with the reason", async () => {
  const log = fakeLog();
  const good = signHistory((await buildHistory(log, DID))!, signer);
  assert.deepEqual(await verifyHistory(good, pub, log), { ok: true });

  // Changed after it was signed: a better tier.
  const tampered = { ...good, summary: { ...good.summary, tier: 3 } };
  const t = await verifyHistory(tampered, pub, log);
  assert.equal(t.ok, false);
  assert.match((t as { reason: string }).reason, /changed after it was signed/);

  // Signed by another key (a runtime or another agent claiming to be this one).
  const other = signerFromSeed(`${DID}#key-1`, randomSeed());
  const forgedBy = await verifyHistory(signHistory(good.summary, other), pub, log);
  assert.match((forgedBy as { reason: string }).reason, /changed after it was signed/);
  const wrongDid = await verifyHistory(signHistory(good.summary, signerFromSeed("did:web:example.com:agents:other#key-1", randomSeed())), pub, log);
  assert.match((wrongDid as { reason: string }).reason, /signed by did:web:example.com:agents:other, not by/);

  // Genuinely signed by the agent but false: the agent signs a tier the log does not give it.
  const lie = signHistory({ ...good.summary, tier: 3 }, signer);
  assert.match(((await verifyHistory(lie, pub, log)) as { reason: string }).reason, /figures do not match what the log says now/);

  // Stale: the log moved on since it was read.
  log.state.seq = 41;
  assert.match(((await verifyHistory(good, pub, log)) as { reason: string }).reason, /stale: it was read at log seq 40 and the log is at 41/);

  assert.match(((await verifyHistory({ nonsense: true } as any, pub, log)) as { reason: string }).reason, /not a history summary/);
});
