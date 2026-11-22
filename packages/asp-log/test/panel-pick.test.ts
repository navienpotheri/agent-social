/**
 * Allocation by a panel pick (register row DK394; spec-delta S820; market.md 5): for a contested or high-value job a few staked jurors, drawn from the posting's own id and none of them the poster or a bidder, choose
 * among the bidders; the Market records the pick with the ranked list and a majority of the panel cosigns it. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { drawPanel } from "../src/index.ts";
import { credit, kit, market, mk, refusedBy, type Party } from "./society-kit.ts";

async function world() {
  const k = await kit();
  await k.withPrices();
  const poster = await k.person("pp-poster", 2000);
  const jurors = new Map<string, Party>();
  for (let i = 0; i < 9; i++) { const j = await k.person(`pp-juror-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null)); jurors.set(j.did, j); }
  const sponsors = await Promise.all([1, 2, 3].map((n) => k.person(`pp-sponsor-${n}`)));
  const bidders = await Promise.all(sponsors.map((s, i) => k.agent(`pp-bidder-${i}`, s, { tier: 1, funds: 100 })));
  const intent = await k.intent(poster, { budget: credit(60) });
  const deposit = await k.buy(poster, "market.posting.deposit", 2);
  const posting = mk("market_act", poster, { act: "posting", intent, board: "main", expires: "2027-01-01T00:00:00Z", deposit });
  await k.log.append(posting);
  const offers: string[] = [];
  for (const b of bidders) { const offer = await k.offer(b, intent, 60); offers.push(offer); await k.log.append(mk("market_act", b, { act: "bid", posting: posting.id, offer })); }
  const panel = await k.log.store.transaction((tx) => drawPanel(tx, { principal: poster.did, performer: poster.did, seed: posting.id, size: 3, also: bidders.map((b) => b.did) })) as string[];
  const ranked = await k.log.rankPosting(posting.id, "panel_pick", "seed-1");
  const pick = (agent: string, signers: string[], over: Record<string, unknown> = {}) => {
    let r = mk("market_act", market, { act: "assignment", posting: posting.id, intent, agent, rule: "panel_pick", ranked, seed: "seed-1", ...over });
    for (const d of signers) r = cosign(r, (jurors.get(d) ?? (undefined as never)) as Signer);
    return r;
  };
  return { k, poster, jurors, bidders, posting, intent, panel, ranked, pick };
}

test("DK394 done: a panel of staked jurors picks among three bidders, by a majority; any bidder may be picked, not only the top of the ranking", async () => {
  const w = await world();
  assert.equal(w.panel.length, 3, "a panel of three is drawn from the posting's id");
  assert.equal(w.ranked.length, 3, "the ranked list holds the three bidders");
  const bottom = w.ranked.at(-1)!.agent;
  await w.k.log.append(w.pick(bottom, w.panel.slice(0, 2)));
  assert.equal((await w.k.log.marketBoard()).find((e) => e.posting === w.posting.id), undefined, "the posting is assigned and leaves the board");
});

test("DK394 done: a pick outside the bidders is refused, and so are a short quorum, a signer who is not on the panel, a rule on a ranked list that does not reproduce, and a pick by anyone but the Market", async () => {
  const w = await world();
  const outsider = await w.k.agent("pp-outsider", await w.k.person("pp-sponsor-x"), { tier: 1, funds: 50 });
  assert.equal(await refusedBy(w.k.log.append(w.pick(outsider.did, w.panel.slice(0, 2)))), "assignment_no_bid", "a pick outside the bidders");
  const first = w.ranked[0].agent;
  assert.equal(await refusedBy(w.k.log.append(w.pick(first, w.panel.slice(0, 1)))), "panel_pick_quorum", "one of three is not a majority");
  assert.equal(await refusedBy(w.k.log.append(w.pick(first, []))), "panel_pick_quorum", "no signature at all");
  const notOnPanel = [...w.jurors.keys()].find((d) => !w.panel.includes(d))!;
  assert.equal(await refusedBy(w.k.log.append(w.pick(first, [w.panel[0], notOnPanel]))), "panel_pick_not_panel", "a juror outside the panel cannot make up the quorum");
  assert.equal(await refusedBy(w.k.log.append(w.pick(first, w.panel.slice(0, 2), { ranked: [...w.ranked].reverse() }))), "ranking_not_reproducible", "the ranked list is the log's");
  await w.k.log.append(w.pick(first, w.panel.slice(0, 2)));
});

test("DK394: the panel never holds the poster or a bidder, the draw is the posting's own so it cannot be shopped for, and with no juror registered a panel pick is refused", async () => {
  const w = await world();
  const excluded = new Set([w.poster.did, ...w.bidders.map((b) => b.did)]);
  assert.ok(w.panel.every((d) => !excluded.has(d)), "jurors only");
  const again = await w.k.log.store.transaction((tx) => drawPanel(tx, { principal: w.poster.did, performer: w.poster.did, seed: w.posting.id, size: 3, also: w.bidders.map((b) => b.did) })) as string[];
  assert.deepEqual(again, w.panel, "the same posting gives the same panel");
  // a world with no jurors
  const k = await kit(); await k.withPrices();
  const poster = await k.person("np-poster", 500); const bidder = await k.agent("np-bidder", await k.person("np-sponsor"), { tier: 1, funds: 50 });
  const intent = await k.intent(poster, { budget: credit(60) });
  const posting = mk("market_act", poster, { act: "posting", intent, board: "main", expires: "2027-01-01T00:00:00Z", deposit: await k.buy(poster, "market.posting.deposit", 2) });
  await k.log.append(posting);
  const offer = await k.offer(bidder, intent, 60);
  await k.log.append(mk("market_act", bidder, { act: "bid", posting: posting.id, offer }));
  const ranked = await k.log.rankPosting(posting.id, "panel_pick", "s");
  assert.equal(await refusedBy(k.log.append(mk("market_act", market, { act: "assignment", posting: posting.id, intent, agent: bidder.did, rule: "panel_pick", ranked, seed: "s" }))), "assignment_no_panel");
});

test("DK394 mutation review: a pick by anyone but the Market is refused, and a juror who sponsors a bidder does not sit on the panel that picks", async () => {
  const w = await world();
  // Not the Market: the poster signs the assignment itself.
  const forged = mk("market_act", w.poster, { act: "assignment", posting: w.posting.id, intent: w.intent, agent: w.ranked[0].agent, rule: "panel_pick", ranked: w.ranked, seed: "seed-1" });
  assert.equal(await refusedBy(w.k.log.append(cosign(cosign(forged, w.jurors.get(w.panel[0])! as Signer), w.jurors.get(w.panel[1])! as Signer))), "assignment_wrong_issuer");
  // A fourth bidder is sponsored by a juror who was on the panel: that juror is out, and the panel is redrawn without them.
  const sponsorJuror = w.jurors.get(w.panel[0])!;
  const late = await w.k.agent("pp-bidder-late", sponsorJuror, { tier: 1, funds: 100 });
  const offer = await w.k.offer(late, w.intent, 60);
  await w.k.log.append(mk("market_act", late, { act: "bid", posting: w.posting.id, offer }));
  const all = [...w.bidders, late].map((b) => b.did);
  const panel2 = await w.k.log.store.transaction((tx) => drawPanel(tx, { principal: w.poster.did, performer: w.poster.did, seed: w.posting.id, size: 3, also: all })) as string[];
  assert.ok(!panel2.includes(w.panel[0]), "the bidder's sponsor is not drawn");
  const ranked2 = await w.k.log.rankPosting(w.posting.id, "panel_pick", "seed-1");
  let r = mk("market_act", market, { act: "assignment", posting: w.posting.id, intent: w.intent, agent: ranked2[0].agent, rule: "panel_pick", ranked: ranked2, seed: "seed-1" });
  for (const d of panel2.slice(0, 2)) r = cosign(r, w.jurors.get(d)! as Signer);
  await w.k.log.append(r);
});
