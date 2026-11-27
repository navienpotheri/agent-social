/**
 * Recall of an elected officer on the log (register row DK1743; spec-delta S1600; docs/institutions/elections.md 5): a petition of controllers after a seven-day grace, a seven-day vote weighted like the Town Hall's, and a
 * result the log recomputes; a tie keeps the officer; the removed officer leaves the office. Refusals by name. Fake keys only.
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


/** An election run to its result: the steward seats go to candidates a, b and c. */
async function elected() {
  const w = await world(7);
  const el = w.convene();
  await w.k.log.append(el);
  const [a, b, c] = w.candidates;
  for (const x of [a, b, c]) await w.k.log.append(w.candidacy(x, el.id));
  jump(DAY + 60_000);
  for (const v of w.voters) await w.k.log.append(w.commit(v, el.id, [a.did, b.did, c.did]));
  jump(5 * DAY);
  for (const v of w.voters) await w.k.log.append(w.reveal(v, el.id, [a.did, b.did, c.did]));
  jump(2 * DAY);
  const t = (await w.k.log.electionTally(el.id))!;
  const result = mk("election_result", operator, { election: el.id, void: t.void, elected: t.elected, approvals: t.approvals, counted: t.counted, controllers: t.controllers });
  await w.k.log.append(result);
  const petition = (by: Party, officer: string, recall?: string) => mk("recall_petition", by, { election_result: result.id, officer, reason: "it convened a vote nobody asked for", ...(recall ? { recall } : {}) }, null, { subject: by.did });
  const vote = (by: Party, recall: string, choice: string) => mk("recall_vote", by, { recall, choice }, null, { subject: by.did });
  return { ...w, result, officer: t.elected[0], petition, vote };
}

test("DK1743: a recall: a petition after the grace, a vote, a result the log recomputes, and the officer leaves the office", async () => {
  const w = await elected();
  const voters = w.voters;
  assert.equal(await refusedBy(w.k.log.append(w.petition(voters[0], w.officer))), "recall_grace", "not within seven days of the election");
  jump(7 * DAY + 60_000);
  assert.equal(await refusedBy(w.k.log.append(w.petition(voters[0], w.voters[1].did))), "recall_not_an_officer", "someone who was not elected");
  const first = w.petition(voters[0], w.officer);
  await w.k.log.append(first);
  assert.equal(await refusedBy(w.k.log.append(w.petition(voters[0], w.officer, first.id))), "recall_petition_twice", "one signature for each controller");
  assert.equal(await refusedBy(w.k.log.append(w.vote(voters[1], first.id, "remove"))), "recall_not_open", "no vote before the signatures");
  for (const p of voters.slice(1, 5)) await w.k.log.append(w.petition(p, w.officer, first.id)); // five controllers
  assert.equal(await refusedBy(w.k.log.append(w.petition(voters[5], w.officer, first.id))), "recall_open", "the recall is open");
  const picks = ["remove", "remove", "remove", "remove", "keep", "keep"];
  for (const [i, v] of voters.slice(0, 6).entries()) await w.k.log.append(w.vote(v, first.id, picks[i]));
  assert.equal(await refusedBy(w.k.log.append(w.vote(voters[0], first.id, "keep"))), "recall_vote_duplicate");
  const early = await w.k.log.recallTally(first.id);
  assert.deepEqual([early?.removed, early?.remove_milli, early?.keep_milli, early?.controllers], [true, 4000, 2000, 6]);
  assert.equal(await refusedBy(w.k.log.append(mk("recall_result", operator, { recall: first.id, ...early! }))), "recall_early", "a result waits for the vote to close");
  jump(8 * DAY);
  assert.equal(await refusedBy(w.k.log.append(w.vote(voters[6], first.id, "keep"))), "recall_closed");
  assert.equal(await refusedBy(w.k.log.append(mk("recall_result", operator, { recall: first.id, ...early!, removed: false }))), "recall_result_mismatch", "a result the votes do not make");
  assert.equal(await refusedBy(w.k.log.append(mk("recall_result", voters[0], { recall: first.id, ...early! }))), "recall_wrong_issuer");
  await w.k.log.append(mk("recall_result", operator, { recall: first.id, ...early! }));
  assert.ok(await w.k.log.removedFrom("steward", w.officer), "the officer was removed");
  assert.equal((await w.k.log.officeHolders("steward"))?.elected.includes(w.officer), false, "and is no longer in the office");
  assert.equal(await refusedBy(w.k.log.append(mk("recall_result", operator, { recall: first.id, ...early! }))), "recall_done");
  assert.equal((await w.k.log.verify()).ok, true, "a replica recomputes the recall from the records");
});

test("DK1743: a tie keeps the officer", async () => {
  const w = await elected();
  jump(7 * DAY + 60_000);
  const first = w.petition(w.voters[0], w.officer);
  await w.k.log.append(first);
  for (const p of w.voters.slice(1, 5)) await w.k.log.append(w.petition(p, w.officer, first.id));
  const picks = ["remove", "remove", "remove", "keep", "keep", "keep"];
  for (const [i, v] of w.voters.slice(0, 6).entries()) await w.k.log.append(w.vote(v, first.id, picks[i]));
  jump(8 * DAY);
  const t = (await w.k.log.recallTally(first.id))!;
  assert.deepEqual([t.removed, t.remove_milli, t.keep_milli], [false, 3000, 3000], "a tie keeps the officer");
  await w.k.log.append(mk("recall_result", operator, { recall: first.id, ...t }));
  assert.equal(await w.k.log.removedFrom("steward", w.officer), null);
  assert.equal((await w.k.log.officeHolders("steward"))?.elected.includes(w.officer), true);
});
