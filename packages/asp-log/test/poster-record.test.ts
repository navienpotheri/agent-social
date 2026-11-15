/**
 * A poster's record and the deposit it scales (market.md 13.2; register row DK127, part; spec-delta none: log rules over markers). Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { depositMultiplier, EMPTY_POSTER_RECORD } from "../src/market.ts";
import { DAY, credit, kit, mk, refusedBy } from "./society-kit.ts";

const expires = () => new Date(Date.parse("2026-11-01T00:00:00Z") + 600 * DAY).toISOString().replace(".000Z", "Z");

test("the deposit multiplier is 1 until three settlements, then 1 plus three times the share of disputes lost, never above 4", () => {
  const rec = (settled: number, lost: number) => ({ ...EMPTY_POSTER_RECORD, settled, lost });
  assert.equal(depositMultiplier(rec(0, 0)), 1);
  assert.equal(depositMultiplier(rec(2, 2)), 1, "two settlements are too few to judge");
  assert.equal(depositMultiplier(rec(10, 0)), 1);
  assert.equal(depositMultiplier(rec(10, 2)), 2);
  assert.equal(depositMultiplier(rec(10, 5)), 3);
  assert.equal(depositMultiplier(rec(10, 10)), 4);
  assert.equal(depositMultiplier(rec(3, 3)), 4);
});

test("DK127: the poster's record comes from the log's own settlements, shows beside the posting on the board, and the postings withdrawn after bids are counted", async () => {
  const k = await kit();
  await k.withPrices();
  const poster = await k.person("poster", 4000);
  const worker = await k.agent("worker", await k.person("ws"), { skills: ["code"], funds: 50 });
  for (let i = 0; i < 3; i++) { const intent = await k.intent(poster, { class: "routine", budget: credit(30) }); await k.runJob(poster, worker, 30, { intent, offer: await k.offer(worker, intent, 30) }); }
  const rec = await k.log.posterRecord(poster.did);
  assert.deepEqual([rec.settled, rec.acceptedShare, rec.disputesLost, rec.depositMultiplier], [3, 1, 0, 1]);
  assert.ok(rec.medianHoursToAccept !== null && rec.medianHoursToAccept >= 0, "the time from delivery to acceptance is measured from the records");
  // A posting withdrawn after an agent bid is counted.
  const bidder = await k.agent("bidder", await k.person("bs"), { skills: ["code"], funds: 50 });
  const intent = await k.intent(poster, { class: "routine", budget: credit(30) });
  const posting = mk("market_act", poster, { act: "posting", intent, board: "main", expires: expires(), deposit: await k.buy(poster, "market.posting.deposit", 2) });
  await k.log.append(posting);
  const board = await k.log.marketBoard();
  assert.equal(board[0].posterRecord?.settled, 3, "the record is shown on the board");
  await k.log.append(mk("market_act", bidder, { act: "bid", posting: posting.id, offer: await k.offer(bidder, intent, 30) }));
  await k.log.append(mk("market_act", poster, { act: "withdraw", posting: posting.id }));
  assert.equal((await k.log.posterRecord(poster.did)).withdrawnAfterBids, 1);
});

test("DK127: a poster that lost disputes pays a larger deposit: the posting is refused until the deposit is bought in the multiple, and the record never touches standing", async () => {
  const k = await kit();
  await k.withPrices();
  const poster = await k.person("loser", 4000);
  const before = await k.log.reputationOf(poster.did);
  // Three settlements, all lost: the record the log would have derived from three rulings for the performer (the ruling path itself is DK492).
  await (k.log as unknown as { store: { transaction: <T>(f: (tx: { putMarker(k: string, v: string): Promise<void> }) => Promise<T>) => Promise<T> } }).store.transaction(async (tx) => tx.putMarker(`poster_rec:${poster.did}`, JSON.stringify({ settled: 3, accepted: 0, lost: 3, acceptHours: [], withdrawnAfterBids: 0 })));
  assert.equal((await k.log.posterRecord(poster.did)).depositMultiplier, 4);
  const intent = await k.intent(poster, { class: "routine", budget: credit(30) });
  const post = (deposit: string) => mk("market_act", poster, { act: "posting", intent, board: "main", expires: expires(), deposit });
  const base = await k.buy(poster, "market.posting.deposit", 2);
  assert.equal(await refusedBy(k.log.append(post(base))), "posting_deposit_too_small", "one times the base is not enough");
  const times4 = mk("purchase", poster, { service: "market.posting.deposit", institution: "did:web:asp.local:market", price_list: k.listId(), quantity: 4, amount: credit(8), idempotency: "four" });
  await k.log.append(times4);
  await k.log.append(post(times4.id));
  assert.deepEqual(await k.log.reputationOf(poster.did), before, "the record changes no tier, rank or standing");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
