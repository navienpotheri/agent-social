// DK1716: the outbound scan finds a key, a card number and an email address in the content that leaves, reports a kind and a hash and never the value, and leaves harmless strings of the same shape alone.
// The false-positive rate is stated over a fixed corpus; this is a reduction of accidents, not a promise that nothing leaks. All values are made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactDeep, scanText } from "../src/gateway/outbound-scan.ts";

// Built from parts so that no real-looking key sits in the source file.
const KEY = "sk-ant-" + "api03-" + "A".repeat(10) + "b".repeat(10) + "9".repeat(8);
const GH = "ghp_" + "a1B2".repeat(9);
const AWS = "AKIA" + "ABCDEFGHIJKLMNOP";
const CARD = "4532 0151 1283 0366";                   // Luhn-valid, not a published test number

const MUST_HIT: [string, string][] = [
  [`use this key ${KEY} for the call`, "secret"], [`token: ${GH}`, "secret"], [`aws ${AWS}`, "secret"], ["-----BEGIN RSA PRIVATE KEY-----\nabc", "secret"],
  [`password = "hunter2hunter2"`, "secret"], [`Authorization: Bearer ${"Zx9".repeat(10)}`, "secret"],
  [`card ${CARD}`, "card number"], ["pay with 4532015112830366", "card number"], ["5425-2334-3010-9903", "card number"],
  ["write to jane.doe@acme-corp.com about it", "email address"], ["cc: Pat <pat+billing@company.io>", "email address"],
];

const HARMLESS = [
  "version 1.2.3", "v22.18.0", "node 24.0.1", "released 2026-11-21T10:00:00Z", "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "550e8400-e29b-41d4-a716-446655440000",
  "src/gateway/outbound-scan.ts line 42", "const maxRetries = 5", "camelCaseIdentifierWithoutDigitsOrSpread", "order 1234567890123", "phone +91 98765 43210", "invoice 4532 0151 1283 0367",
  "test card 4242 4242 4242 4242", "visa test 4111111111111111", "mastercard test 5555 5555 5555 4444", "amex test 378282246310005", "0000 0000 0000 0000",
  "contact someone@example.com", "mail test@example.org", "noreply@github.com", "user@localhost", "admin@service.test", "git@github.com:org/repo.git".replace("git@", "git "),
  "sha256:" + "0123456789abcdef".repeat(4), "the secret is love", "password policy: at least 12 characters", "the token budget is 5000", "sk-learn is a library", "an API key is a secret you should not paste",
  "see https://example.com/docs?page=2", "2026-11-21", "1,234,567.89 credits", "ISBN 978-3-16-148410-0", "id 12345678901234567890", "A".repeat(40), "lorem ipsum dolor sit amet",
];

test("everything planted is found, by kind", () => {
  for (const [text, kind] of MUST_HIT) assert.ok(scanText(text).some((h) => h.kind === kind), `${kind} in: ${text.slice(0, 50)}`);
});

test("a harmless string of the same shape is left alone: false positives over the fixed corpus", () => {
  const wrong = HARMLESS.filter((t) => scanText(t).length > 0);
  console.log(`false positives: ${wrong.length} of ${HARMLESS.length} harmless strings${wrong.length ? ` (${wrong.join(" | ")})` : ""}`);
  assert.deepEqual(wrong, [], "the stated false-positive rate is 0 of the corpus; a miss here is a change to the corpus or the rule, said in the row");
});

test("a hit is a kind and a hash and never the value; the same value has the same hash; redaction masks every hit", () => {
  const hits = scanText(`key ${KEY} and ${CARD} and jane.doe@acme-corp.com`);
  assert.deepEqual(hits.map((h) => h.kind).sort(), ["card number", "email address", "secret"]);
  for (const h of hits) { assert.match(h.hash, /^sha256:[0-9a-f]{32}$/); assert.ok(!JSON.stringify({ kind: h.kind, detail: h.detail, hash: h.hash }).includes(h.match), "the reported fields hold no value"); }
  assert.equal(scanText(KEY)[0].hash, scanText(`again ${KEY}`)[0].hash);
  const r = redactDeep({ messages: [{ role: "user", content: `key ${KEY}, card ${CARD}, mail jane.doe@acme-corp.com, version 1.2.3` }] });
  const text = JSON.stringify(r.value);
  assert.ok(!text.includes(KEY) && !text.includes("4532 0151") && !text.includes("jane.doe@"));
  assert.match(text, /\[redacted: secret\].*\[redacted: card number\].*\[redacted: email address\].*version 1\.2\.3/);
  assert.equal(r.hits.length, 3);
});

test("kinds can be chosen: with only secrets, a card and an email pass", () => {
  assert.equal(scanText(`${CARD} jane.doe@acme-corp.com`, ["secret"]).length, 0);
  assert.equal(scanText(`${CARD} jane.doe@acme-corp.com`, ["card number"]).length, 1);
});

// DK1716 finishing: personal-data detectors (international phone number, national id, IBAN) and the policy the gateway applies by default.
import { ALL_OUTBOUND_KINDS, DEFAULT_OUTBOUND, resolveOutbound } from "../src/gateway/outbound-scan.ts";
const SSN = "123-45-" + "6789", AADHAAR = "2345 6789 0124", IBAN = "GB82 WEST 1234 5698 7654 32", PHONE = "+44 20 7946 0958";
const PERSONAL_HARMLESS = ["version 1.2.3 build 20261121", "timestamp 1700000000000", "order 123-45-678", "ssn-like 000-12-3456 and 666-12-3456 and 923-45-6789", "aadhaar-shaped 2345 6789 0125", "iban-shaped GB82 WEST 1234 5698 7654 33", "call 020 7946 0958", "+000000000000", "SHA ABCD1234EFGH5678IJKL", "1234-5678-9012", "tel: 98765 43210", "pid 4242 1337 0001"];

test("DK1716: a phone number, a national id and an IBAN are found, by kind, and only when asked for", () => {
  for (const [t, k] of [[PHONE, "phone number"], [SSN, "national id"], [AADHAAR, "national id"], [IBAN, "iban"]] as const) {
    assert.ok(scanText(`see ${t} here`, ALL_OUTBOUND_KINDS).some((h) => h.kind === k), `${k}: ${t}`);
    assert.equal(scanText(`see ${t} here`).length, 0, "not in the default kinds of scanText");
  }
});

test("DK1716: harmless strings of the same shape are not hits (0 of the corpus)", () => {
  const wrong = PERSONAL_HARMLESS.filter((t) => scanText(t, ALL_OUTBOUND_KINDS).length > 0);
  assert.deepEqual(wrong, []);
});

test("DK1716: the personal data is masked and the record holds a hash, never the value", () => {
  const r = redactDeep({ m: `${PHONE}, ${SSN}, ${IBAN}, ${AADHAAR}` }, ALL_OUTBOUND_KINDS);
  const text = JSON.stringify(r.value);
  for (const v of [PHONE, SSN, IBAN, AADHAAR]) assert.ok(!text.includes(v));
  assert.equal(r.hits.length, 4);
  for (const h of r.hits) assert.ok(!JSON.stringify(h).includes("7946") && /^sha256:/.test(h.hash));
});

test("DK1716: the default policy, the Mandate's choice and the flags", () => {
  assert.deepEqual(resolveOutbound({}), DEFAULT_OUTBOUND);
  assert.equal(resolveOutbound({ flagMode: "off" }), undefined);
  assert.deepEqual(resolveOutbound({ flagMode: "block" }), { mode: "block", kinds: ["secret", "card number"] });
  // a Mandate that asks for a scan cannot be switched off by a flag, and a flag cannot weaken it
  assert.deepEqual(resolveOutbound({ flagMode: "off", mandate: { mode: "block", kinds: ["secret", "email address"] } }), { mode: "block", kinds: ["secret", "email address"] });
  assert.equal(resolveOutbound({ flagMode: "redact", mandate: { mode: "block" } })!.mode, "block");
  assert.deepEqual(resolveOutbound({ flagKinds: "iban,phone number", mandate: { mode: "redact", kinds: ["secret"] } }), { mode: "redact", kinds: ["secret", "iban", "phone number"] });
  assert.throws(() => resolveOutbound({ flagKinds: "passport" }), /unknown outbound kind/);
});
