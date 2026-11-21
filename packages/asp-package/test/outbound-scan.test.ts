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
