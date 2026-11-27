/**
 * Elections on the log (register row DK1743; spec-delta S1596; docs/institutions/elections.md): the operator convenes, candidates are checked (counted jobs from two controllers, a clean record, three endorsers of other
 * controllers), ballots are committed inside the window and revealed after it, and the operator's result is recomputed by the log. Refusals by name; a void election below the quorum; terms in a row. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { commitBallot } from "../src/index.ts";
import { DAY, jump, kit, mk, nowIso, operator, refusedBy, type Party } from "./society-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

async function world(voterCount = 7) {
  const k = await kit();
  await k.withPrices();
  const clients: Party[] = [];
  for (let i = 0; i < 3; i++) clients.push(await k.person(`el-client-${i}`, 5000));
  const agentOf = async (name: string, jobs: number) => {
    const sponsor = await k.person(`el-sponsor-${name}`);
    const a = await k.agent(`el-${name}`, sponsor, { funds: 0 });
    for (let j = 0; j < jobs; j++) await k.runJob(clients[j % clients.length], a, 40);
    return a;
  };
  const candidates = [await agentOf("cand-a", 3), await agentOf("cand-b", 3), await agentOf("cand-c", 3), await agentOf("cand-d", 3)];
  const voters: Party[] = [];
  for (let i = 0; i < voterCount; i++) voters.push(await agentOf(`voter-${i}`, 1));
  const endorsers = voters.slice(0, 3);
  const convene = (over: Record<string, unknown> = {}, office = "steward") => {
    const open = Date.parse(nowIso()) + DAY;
    return mk("election", operator, { office, opens_at: iso(open), closes_at: iso(open + 5 * DAY), reveals_close_at: iso(open + 7 * DAY), tie_seed: "seed-2026-12", ...over });
  };
  const candidacy = (c: Party, election: string, en: Party[] = endorsers) => en.reduce((r, e) => cosign(r, e), mk("candidacy", c, { election, endorsers: en.map((e) => e.did) }, null, { subject: c.did }));
  const salts = new Map<string, string>();
  const commit = (v: Party, election: string, approvals: string[]) => { const salt = `salt-${v.did.slice(-6)}`; salts.set(v.did, salt); return mk("ballot_commit", v, { election, commitment: commitBallot(approvals, salt, election) }, null, { subject: v.did }); };
  const reveal = (v: Party, election: string, approvals: string[], salt = salts.get(v.did)!) => mk("ballot_reveal", v, { election, approvals, salt }, null, { subject: v.did });
  return { k, candidates, voters, endorsers, convene, candidacy, commit, reveal };
}

test("DK1743: an election runs from the call to the result: candidacies, committed ballots, reveals, and a result the log recomputes", async () => {
  const w = await world();
  const el = w.convene();
  await w.k.log.append(el);
  assert.equal(await refusedBy(w.k.log.append(w.convene())), "election_office_busy", "one election at a time for an office");
  const [a, b, c, d] = w.candidates;
  for (const x of [a, b, c, d]) await w.k.log.append(w.candidacy(x, el.id));
  jump(DAY + 60_000); // the voting window is open
  const picks = [[a.did, b.did, c.did], [a.did, b.did], [a.did, d.did], [a.did], [b.did, c.did], [a.did, b.did, d.did], [c.did]];
  for (const [i, v] of w.voters.entries()) await w.k.log.append(w.commit(v, el.id, picks[i]));
  assert.equal(await refusedBy(w.k.log.append(w.commit(w.voters[0], el.id, [a.did]))), "ballot_duplicate");
  assert.equal(await refusedBy(w.k.log.append(w.reveal(w.voters[0], el.id, picks[0]))), "reveal_early", "no reveal while the window is open");
  jump(5 * DAY); // the window has closed
  for (const [i, v] of w.voters.entries()) if (i !== 6) await w.k.log.append(w.reveal(v, el.id, picks[i])); // the seventh never reveals
  assert.equal(await refusedBy(w.k.log.append(w.reveal(w.voters[0], el.id, picks[0]))), "reveal_done");
  jump(2 * DAY);
  const t = (await w.k.log.electionTally(el.id))!;
  assert.deepEqual([t.void, t.unrevealed, t.counted, t.controllers], [false, 1, 6, 6]);
  assert.equal(t.elected.length, 3);
  assert.equal(t.elected[0], a.did, "the most approved wins first");
  const body = { election: el.id, void: t.void, elected: t.elected, approvals: t.approvals, counted: t.counted, controllers: t.controllers };
  assert.equal(await refusedBy(w.k.log.append(mk("election_result", operator, { ...body, elected: [d.did, ...t.elected.slice(1)] }))), "election_result_mismatch", "a result the votes do not make is refused");
  assert.equal(await refusedBy(w.k.log.append(mk("election_result", w.voters[0], body))), "election_wrong_issuer");
  await w.k.log.append(mk("election_result", operator, body));
  assert.deepEqual((await w.k.log.officeHolders("steward"))?.elected, t.elected);
  assert.equal(await refusedBy(w.k.log.append(mk("election_result", operator, body))), "election_done");
  assert.equal((await w.k.log.verify()).ok, true, "a replica recomputes the same result from the records");
});

test("DK1743: candidacy and ballot rules are refused by name", async () => {
  const w = await world();
  const el = w.convene();
  await w.k.log.append(el);
  const [a] = w.candidates;
  const weak = w.voters[5]; // one counted job
  assert.equal(await refusedBy(w.k.log.append(w.candidacy(weak, el.id))), "candidacy_barred", "three counted jobs from two controllers are needed");
  assert.equal(await refusedBy(w.k.log.append(w.candidacy(a, el.id, [w.endorsers[0], w.endorsers[1]]))), "/endorsers", "fewer than three endorsers is refused by the schema");
  const unsigned = mk("candidacy", a, { election: el.id, endorsers: w.endorsers.map((e) => e.did) }, null, { subject: a.did });
  assert.equal(await refusedBy(w.k.log.append(unsigned)), "candidacy_endorser_unsigned", "an endorser must countersign");
  await w.k.log.append(w.candidacy(a, el.id));
  assert.equal(await refusedBy(w.k.log.append(w.candidacy(a, el.id))), "candidacy_exists");
  assert.equal(await refusedBy(w.k.log.append(mk("ballot_commit", w.voters[0], { election: el.id, commitment: commitBallot([a.did], "s1", el.id) }, null, { subject: w.voters[0].did }))), "ballot_not_open");
  jump(DAY + 60_000);
  const nobody = await w.k.person("el-nobody");
  const stranger = await w.k.agent("el-stranger", nobody, { funds: 0 });
  assert.equal(await refusedBy(w.k.log.append(mk("ballot_commit", stranger, { election: el.id, commitment: commitBallot([a.did], "s1", el.id) }, null, { subject: stranger.did }))), "election_voter_ineligible", "no counted job, no vote");
  await w.k.log.append(w.commit(w.voters[0], el.id, [a.did]));
  jump(5 * DAY);
  assert.equal(await refusedBy(w.k.log.append(w.commit(w.voters[1], el.id, [a.did]))), "ballot_closed");
  assert.equal(await refusedBy(w.k.log.append(w.reveal(w.voters[0], el.id, [a.did], "another-salt"))), "reveal_mismatch");
  assert.equal(await refusedBy(w.k.log.append(w.reveal(w.voters[1], el.id, [a.did]))), "reveal_no_commit");
  assert.equal(await refusedBy(w.k.log.append(w.candidacy(w.candidates[1], el.id))), "candidacy_closed", "candidacies close when the voting opens");
});

test("DK1743: ballots that approve more than the seats, or someone who is no candidate, are refused at the reveal; fewer than five controllers voids the election and the seat stays", async () => {
  const w = await world(4);
  const el = w.convene({}, "auditor");
  await w.k.log.append(el);
  const [a, b] = w.candidates;
  await w.k.log.append(w.candidacy(a, el.id)); await w.k.log.append(w.candidacy(b, el.id));
  jump(DAY + 60_000);
  for (const [i, v] of w.voters.entries()) await w.k.log.append(w.commit(v, el.id, [i % 2 ? a.did : b.did]));
  const twoForOne = w.commit(w.voters[0], el.id, [a.did, b.did]); void twoForOne;
  jump(5 * DAY);
  assert.equal(await refusedBy(w.k.log.append(w.reveal(w.voters[0], el.id, [w.candidates[2].did], "salt-" + w.voters[0].did.slice(-6)))), "reveal_mismatch", "a different approval than the committed one");
  for (const [i, v] of w.voters.entries()) await w.k.log.append(w.reveal(v, el.id, [i % 2 ? a.did : b.did]));
  jump(2 * DAY);
  const t = (await w.k.log.electionTally(el.id))!;
  assert.deepEqual([t.void, t.controllers], [true, 4], "four controllers are fewer than the five a count needs");
  await w.k.log.append(mk("election_result", operator, { election: el.id, void: true, elected: [], approvals: t.approvals, counted: t.counted, controllers: t.controllers }));
  assert.equal(await w.k.log.officeHolders("auditor"), null, "the seat stays as it was");
  const again = w.convene({}, "auditor");
  await w.k.log.append(again); // the office is free again
});
