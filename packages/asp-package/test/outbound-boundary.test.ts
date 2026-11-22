// Boundary cases of the outbound scan (mutation review, 2026-11-22): the length limits of a card number (13 to 19 digits), a phone number (9 to 15 digits) and an IBAN (15 to 34 characters), exactly on and one beyond
// each limit. A test that only uses typical values cannot tell `<` from `<=`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText } from "../src/gateway/outbound-scan.ts";

/** A number of the given length that passes the Luhn check and is not a run of one digit. */
function luhnNumber(len: number): string {
  const body = Array.from({ length: len - 1 }, (_v, i) => String((i * 7 + 3) % 10));
  for (let check = 0; check < 10; check++) {
    const digits = [...body, String(check)];
    let sum = 0, alt = false;
    for (let i = digits.length - 1; i >= 0; i--) { let n = Number(digits[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
    if (sum % 10 === 0) return digits.join("");
  }
  throw new Error("unreachable");
}
const cardHit = (s: string) => scanText(s, ["card number"]).some((h) => h.kind === "card number");

test("a card number is found at 13 and 19 digits, and not at 12 or 20", () => {
  for (const n of [13, 16, 19]) assert.ok(cardHit(`pay with ${luhnNumber(n)} now`), `${n} digits`);
  for (const n of [12, 20]) assert.ok(!cardHit(`pay with ${luhnNumber(n)} now`), `${n} digits`);
});

test("a phone number is found at 9 and 15 digits, and not at 8 or 16", () => {
  const phone = (n: number) => "+" + "123456789012345678".slice(0, n);
  const hit = (s: string) => scanText(`call ${s} today`, ["phone number"]).some((h) => h.kind === "phone number");
  for (const n of [9, 12, 15]) assert.ok(hit(phone(n)), `${n} digits`);
  for (const n of [8, 16]) assert.ok(!hit(phone(n)), `${n} digits`);
});

/** A DE-prefixed IBAN-shaped string of the given total length with correct check digits (mod 97). */
function iban(total: number): string {
  const bban = Array.from({ length: total - 4 }, (_v, i) => String((i * 3 + 1) % 10)).join("");
  const rearranged = bban + "131400"; // D=13 E=14, check digits 00
  let n = 0; for (const d of rearranged) n = (n * 10 + Number(d)) % 97;
  const check = String(98 - n).padStart(2, "0");
  return "DE" + check + bban;
}
test("an IBAN is found at 15 and 34 characters, and not at 14 or 35", () => {
  const hit = (s: string) => scanText(`account ${s} end`, ["iban"]).some((h) => h.kind === "iban");
  for (const n of [15, 22, 34]) assert.ok(hit(iban(n)), `${n} characters`);
  for (const n of [14, 35]) assert.ok(!hit(iban(n)), `${n} characters`);
});
