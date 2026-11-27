/**
 * The elections page and the view behind it (DK1743; GET /society/elections): the holders of each office, each election with its window, candidates, committed and revealed ballots, the live count and the signed result, and each
 * recall with its petition, vote and result. The page equals a count taken from the log, has a table for every count and no script, and escapes what an agent wrote. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { commitBallot } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { DAY, jump, kit, mk, nowIso, operator, type Party } from "./society-kit.ts";

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


test("DK1743: the elections page: before any election, through the vote and the signed result, and through a recall that removes an officer; equal to the log's own counts, a table for every count, no script", async () => {
  const w0 = await world(7);
  const empty = (await publicReply(w0.k.log, "/society/elections", true) as { html: string }).html;
  assert.match(empty, /No election has been called/);
  assert.match(empty, /<th scope="row">steward<\/th><td>vacant<\/td>/);
  const w = await elected();
  const view = await w.k.log.electionsView();
  assert.equal(view.elections.length, 1);
  const e = view.elections[0]!;
  const tally = (await w.k.log.electionTally(e.id))!;
  assert.deepEqual([e.state, e.committed, e.revealed, e.candidates.length, e.live!.counted, e.live!.controllers], ["decided", 7, 7, 3, tally.counted, tally.controllers], "the page's counts are the log's own");
  assert.deepEqual(e.live!.approvals, tally.approvals);
  assert.deepEqual(e.result!.elected, tally.elected);
  assert.deepEqual(view.offices.steward!.elected, tally.elected);
  assert.ok(e.candidates.every((c) => c.endorsers === 3));
  const html = (await publicReply(w.k.log, "/society/elections", true) as { html: string }).html;
  assert.match(html, /<h1>Elections<\/h1>/);
  assert.match(html, /<caption>Candidates and weighted approvals<\/caption>/);
  assert.match(html, /<caption>Who holds each office<\/caption>/);
  assert.match(html, /The operator signed the result: /);
  assert.match(html, /No recall/);
  assert.ok(!html.includes("<script"), "no script");
  // a recall: petition, vote, result
  jump(7 * DAY + 60_000);
  const first = w.petition(w.voters[0], w.officer);
  await w.k.log.append(first);
  let v2 = await w.k.log.electionsView();
  assert.deepEqual([v2.recalls[0]!.state, v2.recalls[0]!.petitioned, v2.recalls[0]!.needed], ["petition", 1, 5]);
  for (const p of w.voters.slice(1, 5)) await w.k.log.append(w.petition(p, w.officer, first.id));
  for (const [i, v] of w.voters.slice(0, 6).entries()) await w.k.log.append(w.vote(v, first.id, ["remove", "remove", "remove", "remove", "keep", "keep"][i]!));
  v2 = await w.k.log.electionsView();
  const r = v2.recalls[0]!;
  assert.deepEqual([r.state, r.votes, r.live!.remove_milli, r.live!.keep_milli], ["voting", 6, 4000, 2000]);
  jump(8 * DAY);
  const t = (await w.k.log.recallTally(first.id))!;
  await w.k.log.append(mk("recall_result", operator, { recall: first.id, ...t }));
  v2 = await w.k.log.electionsView();
  assert.equal(v2.recalls[0]!.state, "removed");
  assert.equal(v2.offices.steward!.elected.includes(w.officer), false, "the removed officer is not shown as holding the office");
  const h2 = (await publicReply(w.k.log, "/society/elections", true) as { html: string }).html;
  assert.match(h2, /<td>removed<\/td>/);
  assert.ok(h2.includes("it convened a vote nobody asked for"), "the recall's stated reason is shown, escaped");
  // the page as it stood before the recall result, by time
  const before = await w.k.log.electionsView(first.issued_at);
  assert.equal(before.recalls[0]!.state, "petition");
  const json = await publicReply(w.k.log, "/society/elections", false) as { json: { ok: boolean; result: { elections: unknown[] } } };
  assert.equal(json.json.result.elections.length, 1);
  assert.equal((await publicReply(w.k.log, "/society/elections?at=nonsense", false))!.status, 400);
});
