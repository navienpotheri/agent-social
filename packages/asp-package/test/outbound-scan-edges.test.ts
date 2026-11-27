// The outbound scan's edges (register row DK1716; found loose by a mutation check): a thirteen-digit card is the shortest one, a phone number of one repeated digit is not one, and a twelve-digit run with no separators is not an Aadhaar
// number even when its check digit is right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText } from "../src/gateway/outbound-scan.ts";

const luhn = (d: string) => { let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; };

test("a card number of thirteen digits is found, and so is one of nineteen; twelve is too short", () => {
  let thirteen = "";
  for (let i = 0; i < 100000 && !thirteen; i++) { const d = "4" + String(1000000 + i * 7919).padStart(12, "0").slice(0, 12); if (d.length === 13 && luhn(d) && !/^(\d)\1+$/.test(d)) thirteen = d; }
  assert.ok(thirteen);
  assert.equal(scanText(`card ${thirteen} end`, ["card number"]).length, 1, "thirteen digits");
  let twelve = "";
  for (let i = 0; i < 100000 && !twelve; i++) { const d = String(400000000000 + i * 7919); if (d.length === 12 && luhn(d)) twelve = d; }
  assert.equal(scanText(`id ${twelve} end`, ["card number"]).length, 0, "twelve digits are not a card");
});

test("a phone number of one repeated digit is not a phone number", () => {
  assert.equal(scanText("call +1 111 111 1111 now", ["phone number"]).length, 0);
  assert.equal(scanText("call +44 7911 123456 now", ["phone number"]).length, 1, "a real shape is");
});

test("an Aadhaar number needs its separators: a bare run of twelve digits is more often an id", () => {
  let spaced = "", bare = "";
  for (let i = 0; i < 200000 && !spaced; i++) {
    const n = String(234567890123 + i * 7919);
    if (n.length !== 12) continue;
    const s = `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;
    if (scanText(s, ["national id"]).length === 1) { spaced = s; bare = n; }
  }
  assert.ok(spaced, "a check-digit-valid number exists in the range");
  assert.equal(scanText(`aadhaar ${spaced} end`, ["national id"]).length, 1);
  assert.equal(scanText(`order ${bare} end`, ["national id"]).length, 0, "the same digits with no separators are not taken for one");
});
