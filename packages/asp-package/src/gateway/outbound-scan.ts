/**
 * The outbound scan (DK1716): the content of a tool call or a model request is looked at, as it leaves, for a key or token (the patterns the run log uses), a card number (Luhn-checked, a published test
 * card is not one) and an email address (an example or reserved domain is not one). A hit is reported as a kind and a hash of the value, never the value. It reduces accidents; it is not a promise that
 * nothing leaks: a secret split across two calls, encoded or spelled out is not found.
 */
import { createHash } from "node:crypto";
import { secretKindsIn } from "../secrets.ts";

export type OutboundKind = "secret" | "card number" | "email address";
export interface OutboundHit { kind: OutboundKind; detail: string; hash: string }
export type OutboundMode = "block" | "redact";

/** Published test card numbers (processors' documentation): not a person's card. */
const TEST_CARDS = new Set(["4242424242424242", "4111111111111111", "5555555555554444", "378282246310005", "6011111111111117", "30569309025904", "3530111333300000", "4012888888881881", "5105105105105100", "4000056655665556"]);
const RESERVED = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost|local)$/i;

const luhn = (digits: string): boolean => { let sum = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };
const hash = (v: string) => "sha256:" + createHash("sha256").update(v).digest("hex").slice(0, 32);

export function scanText(text: string, kinds: readonly OutboundKind[] = ["secret", "card number", "email address"]): (OutboundHit & { match: string })[] {
  const hits: (OutboundHit & { match: string })[] = [];
  if (kinds.includes("secret")) for (const s of secretKindsIn(text)) hits.push({ kind: "secret", detail: s.kind, hash: hash(s.match), match: s.match });
  if (kinds.includes("card number")) {
    for (const m of text.matchAll(/(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g)) {
      const digits = m[0].replace(/[ -]/g, "");
      if (digits.length < 13 || digits.length > 19 || TEST_CARDS.has(digits) || !luhn(digits)) continue;
      if (/^(\d)\1+$/.test(digits)) continue;                                   // 0000000000000000
      hits.push({ kind: "card number", detail: `${digits.length} digits`, hash: hash(digits), match: m[0] });
    }
  }
  if (kinds.includes("email address")) {
    for (const m of text.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g)) {
      if (RESERVED.test(m[1])) continue;
      if (/^(noreply|no-reply|git|users\.noreply)/i.test(m[0])) continue;
      hits.push({ kind: "email address", detail: "email", hash: hash(m[0].toLowerCase()), match: m[0] });
    }
  }
  return hits;
}

/** Every string value in a JSON-like value. */
export function stringsOf(v: unknown, out: string[] = []): string[] { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out)); else if (v && typeof v === "object") Object.values(v).forEach((x) => stringsOf(x, out)); return out; }

/** The same value with each hit replaced by `[redacted: kind]`. */
export function redactDeep<T>(v: T, kinds?: readonly OutboundKind[]): { value: T; hits: OutboundHit[] } {
  const hits: OutboundHit[] = [];
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") { let t = x; for (const h of scanText(x, kinds)) { hits.push({ kind: h.kind, detail: h.detail, hash: h.hash }); t = t.split(h.match).join(`[redacted: ${h.kind}]`); } return t; }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return { value: walk(v) as T, hits };
}
