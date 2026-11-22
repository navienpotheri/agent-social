// Row E4 (mutation check, launch-bar-2, 2026-11-22): every kind of secret that the scanner names is found by its own pattern, and every shape that the command patterns mask is masked by its own pattern. Removing
// the pattern for thirteen kinds went undetected (OpenRouter, Stripe, Hugging Face, npm, GitLab, DigitalOcean, JSON web token, Azure storage key, OpenAI-style key, Slack, Google API key, the long token and the
// high-entropy token), because the older tests used a few kinds and the patterns overlap. Each example below is invented, built from pieces so that no complete key sits in the source, and matches only its own kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../src/index.ts";
import { secretKindsIn } from "../src/secrets.ts";

const A = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6";
const HEX = "0123456789abcdef";

const EXAMPLES: [string, string][] = [
  ["private key", "-----BEGIN " + "RSA PRIVATE KEY-----"],
  ["Anthropic API key", "sk-" + "ant-" + A.slice(0, 30)],
  ["OpenRouter API key", "sk-" + "or-v1-" + A.slice(0, 36)],
  ["Stripe key", "sk" + "_test_" + A.slice(0, 20)],
  ["Hugging Face token", "hf" + "_" + A.slice(0, 34)],
  ["npm token", "npm" + "_" + A.slice(0, 36)],
  ["GitLab token", "glpat" + "-" + A.slice(0, 24)],
  ["Google OAuth token", "ya29" + "." + A.slice(0, 28)],
  ["SendGrid key", "SG" + "." + A.slice(0, 20) + "." + A.slice(20, 40)],
  ["DigitalOcean token", "dop" + "_v1_" + (HEX + HEX + HEX + HEX)],
  ["JSON web token", "eyJ" + "abcdefghij" + "." + "eyJ" + "abcdefghij" + "." + "abcdefghij"],
  ["Azure storage key", "Account" + "Key=" + A.slice(0, 30) + "=="],
  ["OpenAI-style API key", "sk-" + "proj-" + A.slice(0, 30)],
  ["GitHub token", "gh" + "p_" + A.slice(0, 36)],
  ["Slack token", "xox" + "b-" + "1234567890-abcdefghij"],
  ["AWS access key id", "AK" + "IA" + "ABCDEFGHIJKLMNOP"],
  ["Google API key", "AI" + "za" + A.slice(0, 35)],
  ["bearer token", "Bearer " + A.slice(0, 30)],
  ["password assignment", 'pass' + 'word = "correct-horse-battery"'],
];

test("each kind of secret is found by its own pattern, and the text is masked", () => {
  const missed: string[] = [];
  for (const [kind, text] of EXAMPLES) {
    if (!secretKindsIn(`x ${text} y`).some((k) => k.kind === kind)) missed.push(`${kind}: not found as that kind`);
    if (redactSecrets(`x ${text} y`).redacted < 1) missed.push(`${kind}: not masked`);
  }
  assert.deepEqual(missed, []);
});

test("a plain sentence and a hex hash are not secrets", () => {
  for (const t of ["the quick brown fox jumps over the lazy dog", "commit " + HEX + HEX + HEX.slice(0, 8), "token budget for the run"]) assert.equal(redactSecrets(t).redacted, 0, t);
});

test("the shapes of a command are masked by their own patterns: a long token with hyphens, and a base64 run with a plus and a slash", () => {
  // Only the long-token pattern can match this one: its run is cut by hyphens into pieces shorter than the high-entropy pattern needs.
  const hyphenated = "run xy1-xy1-xy1-xy1-xy1-xy1-xy1-xy1-xy1 now";
  assert.ok(redactSecrets(hyphenated).text.includes("[redacted]"), "long token");
  // Only the high-entropy pattern can match this one: a plus and a slash break the long-token pattern's run.
  const b64 = "aB3+dE5/fG7=hJ9kL1mN3pQ5rS7tU9vW2xY";
  assert.ok(redactSecrets(`x ${b64} y`).text.includes("[redacted]"), "high-entropy token");
});
