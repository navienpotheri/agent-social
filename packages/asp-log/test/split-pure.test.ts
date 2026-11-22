// The price split and its reversal (register rows DK3 and DK1710; credits.md 3 and 4.3; written because the money's arithmetic was reached only through whole-ledger tests): the parts of any amount always add up to it, the burn is
// never returned, a refund comes back pro rata with the rounding to the first payee, and the split's bounds are exact. Pure; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TREASURY_DID, institutionDid, refundParts, splitParts, splitProblem, type Split } from "../src/economy.ts";

const A = institutionDid("academy"), B = institutionDid("shops");
const split = (t: number, burn: number, payees: [string, number][]): Split => ({ treasury_permille: t, burn_permille: burn, payees: payees.map(([account, permille]) => ({ account, permille })) });
const sum = (p: ReturnType<typeof splitParts>) => p.treasury + p.burn + p.payees.reduce((n, x) => n + x.amount, 0);

test("the parts of an amount always add up to it, and the rounding goes to the first payee", () => {
  const s = split(150, 50, [[A, 500], [B, 300]]);
  for (let amount = 0; amount <= 400; amount++) assert.equal(sum(splitParts(amount, s)), amount, `amount ${amount}`);
  const p = splitParts(100, s);
  assert.deepEqual([p.treasury, p.burn], [15, 5], "floor of 15 percent and 5 percent");
  assert.deepEqual(p.payees.map((x) => x.amount), [50, 30], "provider share 80 split 5 to 3");
  const odd = splitParts(7, split(200, 100, [[A, 350], [B, 350]]));
  assert.equal(sum(odd), 7);
  assert.ok(odd.payees[0].amount >= odd.payees[1].amount, "a leftover credit goes to the first payee");
  assert.deepEqual([splitParts(10, s).burn, splitParts(10, s).treasury, splitParts(19, s).burn], [0, 1, 0], "the burn and the Treasury are cut down (floor), never rounded up: the provider gets the remainder");
  assert.equal(splitParts(1, s).payees[0].amount, 1, "one credit goes entirely to the first payee, not lost to rounding");
});

test("a refund is taken back pro rata, never the burned part, and at most what is refundable; the rounding goes to the first payee", () => {
  const parts = splitParts(100, split(150, 50, [[A, 500], [B, 300]]));
  const full = refundParts(95, parts)!;
  assert.deepEqual([full.treasury, full.burn, full.payees.map((x) => x.amount)], [15, 0, [50, 30]], "all but the burn comes back");
  assert.equal(refundParts(96, parts), null, "more than the refundable amount is refused");
  assert.equal(refundParts(-1, parts), null);
  for (let refund = 0; refund <= 95; refund++) { const r = refundParts(refund, parts)!; assert.equal(r.treasury + r.payees.reduce((n, x) => n + x.amount, 0), refund, `refund ${refund} is exactly taken back`); assert.equal(r.burn, 0); }
  const half = refundParts(47, parts)!;
  assert.ok(half.treasury <= 8 && half.treasury >= 7, "about a sixth of it from the Treasury");
  const none = refundParts(0, splitParts(0, split(150, 50, [[A, 800]])));
  assert.deepEqual(none, { treasury: 0, burn: 0, payees: [{ account: A, amount: 0 }] }, "nothing refundable: nothing taken back");
});

test("the split's bounds are exact: the total is 1000, the provider 550 to 900, the Treasury 50 to 300, the burn floor 50 for a standard item and none for an essential one; payees are listed once and known", () => {
  const rule = (s: Split, cls: "standard" | "essential" | "remedial" = "standard") => splitProblem(s, cls)?.rule ?? null;
  assert.equal(rule(split(150, 50, [[A, 800]])), null);
  assert.equal(rule(split(150, 50, [[A, 799]])), "price_list_split_invalid", "999 permille");
  assert.equal(rule(split(150, 50, [[A, 801]])), "price_list_split_invalid", "1001 permille");
  assert.equal(rule(split(300, 50, [[A, 650]])), null, "the Treasury at 300");
  assert.equal(rule(split(301, 50, [[A, 649]])), "price_list_split_invalid", "301");
  assert.equal(rule(split(50, 50, [[A, 900]])), null, "the Treasury at 50 and the provider at 900");
  assert.equal(rule(split(49, 50, [[A, 901]])), "price_list_split_invalid", "the Treasury at 49");
  assert.equal(rule(split(300, 150, [[A, 550]])), null, "the provider at 550 and the burn at 150");
  assert.equal(rule(split(300, 151, [[A, 549]])), "price_list_split_invalid", "the burn at 151");
  assert.equal(rule(split(150, 49, [[A, 801]])), "price_list_split_invalid", "a standard item burns at least 50");
  assert.equal(rule(split(150, 0, [[A, 850]]), "essential"), null, "an essential item may burn nothing");
  assert.equal(rule(split(150, 0, [[A, 850]]), "remedial"), null);
  assert.equal(rule(split(150, 50, [[A, 400], [A, 400]])), "price_list_split_invalid", "a payee twice");
  assert.equal(rule(split(150, 50, [["did:web:nobody", 800]])), "price_list_unknown_payee");
  assert.equal(rule(split(150, 50, [[TREASURY_DID, 800]])), null, "the Treasury is a known payee");
});
