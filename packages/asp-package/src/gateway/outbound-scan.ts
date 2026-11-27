/**
 * The outbound scan (DK1716): the content of a tool call or a model request is looked at, as it leaves, for a key or token (the patterns the run log uses), a card number (Luhn-checked, a published test
 * card is not one) and an email address (an example or reserved domain is not one). A hit is reported as a kind and a hash of the value, never the value. It reduces accidents; it is not a promise that
 * nothing leaks: a secret split across two calls, encoded or spelled out is not found.
 */
import { createHash } from "node:crypto";
import { secretKindsIn } from "../secrets.ts";

export type OutboundKind = "secret" | "card number" | "email address" | "phone number" | "national id" | "iban";
/** Every kind the scanner knows. Stored text is scrubbed of all of them (DK79); the gateway's default policy for what leaves a run is the first two (DEFAULT_OUTBOUND), because an email address or a phone number is often what the task is about. */
export const ALL_OUTBOUND_KINDS: readonly OutboundKind[] = ["secret", "card number", "email address", "phone number", "national id", "iban"];
/** The default policy of a gateway run with no choice made (DK1716): keys and card numbers are never sent; a tool call that carries one is refused, a model request has it masked. A Mandate or a flag may choose block or redact and add kinds. */
export const DEFAULT_OUTBOUND: { mode: OutboundMode; kinds: OutboundKind[] } = { mode: "redact", kinds: ["secret", "card number"] };
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
  // A key written as base64 (and as UTF-16 base64) is still a key: each long base64 run is decoded and the decoded text is looked at for secrets; the hit masks the whole run.
  if (kinds.includes("secret")) for (const m of text.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    let decoded = "";
    try { decoded = Buffer.from(m[0], "base64").toString("latin1"); } catch { continue; }
    if (!/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) { try { decoded = Buffer.from(m[0], "base64").toString("utf16le"); } catch { continue; } if (!/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) continue; }
    for (const sk of secretKindsIn(decoded)) hits.push({ kind: "secret", detail: `${sk.kind} (base64)`, hash: hash(sk.match), match: m[0] });
  }
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
  if (kinds.includes("phone number")) {
    // Only the international form (+ and a country code): a bare run of digits is far more often a timestamp, an id or a version.
    for (const m of text.matchAll(/(?<![\w+])\+[1-9]\d{0,2}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?![\d])/g)) {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15 || new Set(digits).size === 1) continue;
      hits.push({ kind: "phone number", detail: `${digits.length} digits`, hash: hash(digits), match: m[0] });
    }
  }
  if (kinds.includes("national id")) {
    // A US social security number in its written form (invalid ranges are not one) and an Aadhaar number (twelve digits in groups of four, Verhoeff-checked).
    for (const m of text.matchAll(/(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g)) {
      if (m[1] === "000" || m[1] === "666" || m[1][0] === "9" || m[2] === "00" || m[3] === "0000") continue;
      hits.push({ kind: "national id", detail: "social security number", hash: hash(m[0]), match: m[0] });
    }
    for (const m of text.matchAll(/(?<![\d-])([2-9]\d{3})[ -]?(\d{4})[ -]?(\d{4})(?![\d-])/g)) {
      const digits = m[1] + m[2] + m[3];
      if (!(m[0].includes(" ") || m[0].includes("-")) || !verhoeff(digits)) continue;
      hits.push({ kind: "national id", detail: "aadhaar number", hash: hash(digits), match: m[0] });
    }
  }
  if (kinds.includes("iban")) {
    for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g)) {
      const v = m[0].replace(/ /g, "");
      if (v.length < 15 || v.length > 34 || !ibanOk(v)) continue;
      hits.push({ kind: "iban", detail: v.slice(0, 2), hash: hash(v), match: m[0] });
    }
  }
  return hits;
}

const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const verhoeff = (digits: string): boolean => { let c = 0; const r = [...digits].reverse(); for (let i = 0; i < r.length; i++) c = D[c][P[i % 8][r[i].charCodeAt(0) - 48]]; return c === 0; };
const ibanOk = (v: string): boolean => { const r = v.slice(4) + v.slice(0, 4); let n = 0; for (const ch of r) { const x = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); for (const d of x) n = (n * 10 + (d.charCodeAt(0) - 48)) % 97; } return n === 1; };

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

/**
 * The outbound policy of a run (DK1716). The Mandate's `outbound_scan` is the sponsor's standing choice and a flag may only add to it: `block` wins over `redact`, kinds are joined. With neither, the default
 * policy applies (DEFAULT_OUTBOUND). `--outbound-scan off` switches the scan off only when the Mandate states none (a Mandate that asks for a scan cannot be argued out of it at the command line).
 */
export function resolveOutbound(o: { flagMode?: string; flagKinds?: string; mandate?: { mode?: OutboundMode; kinds?: OutboundKind[] } }): { mode: OutboundMode; kinds: OutboundKind[] } | undefined {
  const m = o.mandate;
  if (o.flagMode === "off" && !m) return undefined;
  const flagKinds = (o.flagKinds ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const bad = flagKinds.filter((k) => !ALL_OUTBOUND_KINDS.includes(k as OutboundKind));
  if (bad.length) throw new Error(`unknown outbound kind ${bad.join(", ")}: one of ${ALL_OUTBOUND_KINDS.join(", ")}`);
  const flagMode = o.flagMode === "block" || o.flagMode === "redact" ? o.flagMode : undefined;
  const mode: OutboundMode = flagMode === "block" || m?.mode === "block" ? "block" : flagMode ?? m?.mode ?? DEFAULT_OUTBOUND.mode;
  const kinds = [...new Set<OutboundKind>([...(m?.kinds ?? DEFAULT_OUTBOUND.kinds), ...(flagKinds as OutboundKind[])])];
  return { mode, kinds };
}
