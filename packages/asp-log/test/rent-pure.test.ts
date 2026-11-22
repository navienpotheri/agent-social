// The plot rent and decor functions at their edges (register rows DK681 and DK1710; found loose by a mutation check: six of eight mutants survived the end-to-end rent tests): rent is paid while a holding is live and its end is
// the first moment it is not, a holding that begins later does not count yet, a refunded purchase (any status but delivered) is no rent, a rent that was paid and has run out is lapsed, and decor follows the same dates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RENT_SERVICE, decorAt, rentAt } from "../src/housing.ts";

const AGENT = "did:web:example.com:agents:renter";
let n = 0;
const day = (d: number) => new Date(Date.parse("2026-11-01T00:00:00Z") + d * 86_400_000).toISOString();
const holding = (item: string, from: number, until: number, purchase = `p${++n}`, holder = AGENT) => ({ id: `h${++n}`, type: "asp.housing_act/v0.2", issuer: "did:web:asp.local:housing", issued_at: day(from), body: { act: "holding", holder, item, purchase, from: day(from), until: day(until), effect: { value: "x" } } }) as never;
const receipt = (purchase: string, status: string) => ({ id: `r${++n}`, type: "asp.receipt/v0.2", issuer: "did:web:asp.local:housing", issued_at: day(1), body: { purchase, status } }) as never;

test("rentAt: none before any rent, paid while a week is live (its end is the first moment it is not), lapsed after, and a week not begun yet is not rent", () => {
  const week = holding(RENT_SERVICE, 0, 7);
  assert.equal(rentAt([], AGENT, day(1)), "none");
  assert.equal(rentAt([week], AGENT, day(3)), "paid");
  assert.equal(rentAt([week], AGENT, day(7)), "lapsed", "at the end of the week it has run out");
  assert.equal(rentAt([week], AGENT, day(6.9)), "paid");
  assert.equal(rentAt([holding(RENT_SERVICE, 5, 12)], AGENT, day(3)), "none", "a week that begins later is not paid rent yet, and nothing was paid before");
  assert.equal(rentAt([week, holding(RENT_SERVICE, 7, 14)], AGENT, day(8)), "paid", "a later week renews it");
  assert.equal(rentAt([week], "did:web:example.com:agents:other", day(3)), "none", "another agent's rent is not mine");
  assert.equal(rentAt([holding("housing.decor.theme", 0, 7)], AGENT, day(3)), "none", "decor is not rent");
});

test("a refunded rent is no rent: a receipt that is not delivered undoes the purchase, a delivered one does not", () => {
  const week = holding(RENT_SERVICE, 0, 7, "pay-1");
  assert.equal(rentAt([week, receipt("pay-1", "refunded")], AGENT, day(3)), "none");
  assert.equal(rentAt([week, receipt("pay-1", "failed")], AGENT, day(3)), "none", "a failed delivery is refunded too");
  assert.equal(rentAt([week, receipt("pay-1", "delivered")], AGENT, day(3)), "paid");
  const paidThenRefundedLater = [holding(RENT_SERVICE, 0, 7, "a"), holding(RENT_SERVICE, 7, 14, "b"), receipt("b", "refunded")];
  assert.equal(rentAt(paidThenRefundedLater, AGENT, day(9)), "lapsed", "the second week was refunded, so the first has run out");
});

test("decorAt: a holding is live from its start to its end (the end is not live), not before it begins, and not once refunded", () => {
  const d = holding("housing.decor.theme", 2, 9, "d1");
  assert.equal(decorAt([d], AGENT, day(1)).length, 0, "not begun");
  assert.equal(decorAt([d], AGENT, day(2)).length, 1, "live from its start");
  assert.equal(decorAt([d], AGENT, day(8.9)).length, 1);
  assert.equal(decorAt([d], AGENT, day(9)).length, 0, "the end is the first moment it is not live");
  assert.equal(decorAt([d, receipt("d1", "refunded")], AGENT, day(3)).length, 0);
  assert.equal(decorAt([d, receipt("d1", "delivered")], AGENT, day(3)).length, 1);
  assert.equal(decorAt([d], "did:web:example.com:agents:other", day(3)).length, 0);
});
