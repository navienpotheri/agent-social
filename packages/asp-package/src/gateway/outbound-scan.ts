/**
 * The outbound scan (register row DK1716): what leaves the machine through the gateway is read for a key or token (the shapes in secrets.ts), a card number (an issuer's prefix and length, and the
 * Luhn check) and an email address, in the arguments of every tool call and in every outgoing model request. A hit is named by its kind and a short hash and never by its value. The scan reduces
 * accidents; it is not a promise that nothing leaks: a secret in an odd shape, split across two calls or encoded passes it.
 *
 * Modes: `guard` (the default) blocks a tool call that carries a key or a card, redacts them from a model request and only records an email address; `block` refuses anything found, in either place;
 * `redact` masks what it finds in a model request (a tool call cannot be edited on its way, so it is refused); `record` only writes the hit to the run log; `off` does nothing.
 */
import { createHash } from "node:crypto";
import { COMMAND_SECRET_PATTERNS, SECRET_PATTERNS } from "../secrets.ts";

export type OutboundMode = "off" | "record" | "guard" | "redact" | "block";
export const OUTBOUND_MODES: readonly OutboundMode[] = ["off", "record", "guard", "redact", "block"];
export type OutboundClass = "secret" | "card" | "email";
export interface OutboundHit { kind: string; class: OutboundClass; hash: string; value: string }

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Published test card numbers: a payment provider's own examples are not a customer's card. */
const TEST_CARDS = new Set(["4242424242424242", "4111111111111111", "5555555555554444", "5105105105105100", "378282246310005", "371449635398431", "6011111111111117", "6011000990139424", "3056930009020004", "3566002020360505", "4000056655665556", "2223003122003222"]);
const TEST_EMAIL_DOMAIN = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|localhost|invalid|test)$/i;

function luhn(d: string): boolean {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
function issuerOk(d: string): boolean {
  const n = d.length, p2 = Number(d.slice(0, 2)), p4 = Number(d.slice(0, 4));
  if (d[0] === "4") return n === 13 || n === 16 || n === 19;
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return n === 16;
  if (p2 === 34 || p2 === 37) return n === 15;
  if (d.startsWith("6011") || p2 === 65 || p2 === 62) return n >= 16 && n <= 19;
  if (p2 === 35) return n >= 16 && n <= 19;
  if (p2 === 30 || p2 === 36 || p2 === 38) return n === 14 || n === 16;
  return false;
}

/** Every hit in one string, each once. A card number written next to the word "test" is not counted. */
export function scanText(text: string): OutboundHit[] {
  const out = new Map<string, OutboundHit>();
  const add = (kind: string, cls: OutboundClass, value: string) => { const h = sha(value); out.set(`${kind}:${h}`, { kind, class: cls, hash: h, value }); };
  for (const [kind, re] of SECRET_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) add(kind, "secret", m[0]);
  }
  for (const [kind, re] of COMMAND_SECRET_PATTERNS) {
    if (kind !== "URL credentials" && kind !== "Authorization header") continue;
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) add(kind, "secret", m[0]);
  }
  for (const m of text.matchAll(/(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (!issuerOk(digits) || !luhn(digits) || TEST_CARDS.has(digits)) continue;
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (/test|example|sample|dummy/i.test(before)) continue;
    add("card number", "card", digits);
  }
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
    if (TEST_EMAIL_DOMAIN.test(m[0]) || /^(noreply|no-reply|git)@/i.test(m[0])) continue; // git@host is an ssh remote, not a person
    add("email address", "email", m[0].toLowerCase());
  }
  return [...out.values()];
}

/** The hits in every string of a value (a tool call's arguments, a request body), keys included. */
export function scanValue(value: unknown): OutboundHit[] {
  const out = new Map<string, OutboundHit>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 12) return;
    if (typeof v === "string") { for (const h of scanText(v)) out.set(`${h.kind}:${h.hash}`, h); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { walk(k, depth + 1); walk(x, depth + 1); }
  };
  walk(value, 0);
  return [...out.values()];
}

/** A copy of `value` with each hit replaced by `[redacted <kind>]`. A card number is matched as written, with its spaces or dashes, so the digits are replaced as typed. */
export function redactValue<T>(value: T, hits: OutboundHit[]): T {
  const fix = (s: string) => {
    let t = s;
    for (const h of hits) {
      if (h.class === "card") t = t.replace(/(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g, (m) => (m.replace(/[ -]/g, "") === h.value ? `[redacted ${h.kind}]` : m));
      else t = t.split(h.value).join(`[redacted ${h.kind}]`);
    }
    return t;
  };
  const walk = (v: unknown): unknown => typeof v === "string" ? fix(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [fix(k), walk(x)])) : v;
  return walk(value) as T;
}

/** What the mode does with a hit of this class where it was found: block the call or the request, redact it and go on, or only record it. */
export function outboundAction(mode: OutboundMode, cls: OutboundClass, where: "tool_call" | "model_request"): "block" | "redact" | "record" {
  if (mode === "off" || mode === "record") return "record";
  if (mode === "block") return "block";
  if (mode === "redact") return where === "tool_call" ? "block" : "redact";
  return cls === "email" ? "record" : where === "tool_call" ? "block" : "redact";
}
