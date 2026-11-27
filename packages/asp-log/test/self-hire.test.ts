// Register row DK1344, spec-delta S1300: the log refuses a self-hire contract (principal and performer the same identity) when it is appended, under the named rule `self_hire`; a contract between identities of one sponsor
// (or a sponsor and its agent, or one fleet) is labelled related-party for the board and the journey view; the qualifying rule is unchanged. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { Kit, bankP, hashOf, credit, type Party } from "./academy-kit.ts";
import { independent, relatedKind } from "../src/qualifying.ts";
import { DAY, credit as sCredit, kit, mk } from "./society-kit.ts";

const body = (principal: string, performer: string, price = 100) => ({ principal, performer, bank: bankP.did, purpose: "A job", price: credit(price), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } });
const hire = (k: Kit, principal: Party, performer: Party, cosigners: Party[] = [performer]) => {
  let r = k.mk("contract", principal, body(principal.did, performer.did), null, { subject: performer.did });
  for (const c of cosigners) r = cosign(r, c);
  return r;
};
const refusal = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e as { code?: string; detail?: string; message: string }; } };

test("a contract whose principal and performer are the same identity is refused at contract time by the rule self_hire, whoever signs it", async () => {
  const k = new Kit();
  const agent = await k.agent("selfhirer");
  const signed = await refusal(k.put(hire(k, agent, agent)));
  assert.equal(signed?.code, "GUARD_FAILED");
  assert.equal(signed?.detail, "self_hire");
  assert.match(signed!.message, /would hire itself/);
  const unsigned = await refusal(k.put(hire(k, agent, agent, [])));
  assert.equal(unsigned?.detail, "self_hire", "the rule runs before the performer's co-signature is looked at");
  const person = await k.person("selfhiring-person");
  assert.equal((await refusal(k.put(hire(k, person, person))))?.detail, "self_hire", "a person cannot hire itself either");
  assert.equal((await k.log.verify()).ok, true);
  assert.equal((await k.log.head()).seq, 3, "nothing but the passports of the two identities was written");
});

test("a contract between different identities is unchanged: accepted, with no related-party label when they are independent", async () => {
  const k = new Kit();
  const a = await k.agent("worker-a"), b = await k.agent("worker-b");
  const c = hire(k, a, b);
  await k.put(c);
  assert.equal(await k.log.relatedParty(c.id), null);
  const p = await k.person("client");
  const d = hire(k, p, a);
  await k.put(d);
  assert.equal(await k.log.relatedParty(d.id), null, "a person and an unrelated agent are independent");
});

test("a contract between identities of one sponsor, or between a sponsor and its own agent, is accepted and labelled related-party; the label grants and removes nothing", async () => {
  const k = new Kit();
  const sponsor = await k.person("one-sponsor");
  const a1 = await k.agent("fleet-a1", sponsor), a2 = await k.agent("fleet-a2", sponsor);
  const same = hire(k, a1, a2);
  await k.put(same);
  assert.equal(await k.log.relatedParty(same.id), "same_sponsor");
  const own = hire(k, sponsor, a1);
  await k.put(own);
  assert.equal(await k.log.relatedParty(own.id), "same_sponsor", "a person is its own sponsor, so it and its agent share one");
  assert.equal(await k.log.relatedParty("sha256:" + "9".repeat(64)), null, "an unknown contract has no label");
  assert.equal((await k.log.verify()).ok, true);
});

test("the qualifying rule is unchanged: a related-party job still does not count toward standing, an independent one still does, and `independent` and `relatedKind` agree on every pair", async () => {
  const f = (did: string, sponsor: string, fleet: string | null = null) => ({ did, sponsor, fleet });
  const cases = [
    [f("a", "s1"), f("b", "s2"), null],
    [f("a", "s1"), f("b", "s1"), "same_sponsor"],
    [f("a", "s1"), f("s1", "s1"), "same_sponsor"],
    [f("a", "s1"), f("s1", "sx"), "sponsor_of_the_other"],
    [f("s2", "sy"), f("b", "s2"), "sponsor_of_the_other"],
    [f("a", "s1", "fl"), f("b", "s2", "fl"), "same_fleet"],
    [f("a", "s1", "fl"), f("b", "s2", "other"), null],
    [f("a", "s1"), f("a", "s1"), "same_identity"],
  ] as const;
  for (const [x, y, want] of cases) {
    assert.equal(relatedKind(x, y), want, `${x.did} ${y.did}`);
    assert.equal(independent(x, y), want === null, "a pair is independent exactly when it is not related");
  }
  const k = new Kit();
  const sponsor = await k.person("qual-sponsor");
  const worker = await k.agent("qual-worker", sponsor);
  const other = await k.person("qual-client");
  const before = (await k.log.reputationOf(worker.did))?.qualifyingJobs ?? 0;
  await k.acceptedJob(sponsor, worker);
  assert.equal((await k.log.reputationOf(worker.did))?.qualifyingJobs ?? 0, before, "a job from its own sponsor does not count");
  await k.acceptedJob(other, worker);
  assert.equal((await k.log.reputationOf(worker.did))?.qualifyingJobs ?? 0, before + 1, "a job from an independent client counts");
});

test("the job board, read for an agent, marks a posting by a related poster and leaves an independent one unmarked", async () => {
  const w = await kit();
  await w.withPrices();
  const sponsor = await w.person("board-sponsor", 2000);
  const own = await w.agent("board-own", sponsor, { funds: 10 });
  const stranger = await w.agent("board-stranger", await w.person("board-other"), { funds: 10 });
  await w.mint(sponsor.did, 100);
  const intent = await w.intent(sponsor, { class: "skilled", budget: sCredit(80) });
  const deposit = await w.buy(sponsor, "market.posting.deposit", 2);
  await w.log.append(mk("market_act", sponsor, { act: "posting", intent, board: "main", expires: new Date(Date.parse("2026-11-01T00:00:00Z") + 60 * DAY).toISOString().replace(".000Z", "Z"), deposit }, null, { subject: intent }));
  const mine = (await w.log.marketBoard(own.did))[0];
  assert.equal(mine.forAgent!.relatedParty, "same_sponsor");
  assert.equal(mine.forAgent!.counts.counts, false, "the qualifying answer is the one it always was");
  assert.equal((await w.log.marketBoard(stranger.did))[0].forAgent!.relatedParty, undefined);
});
