import { test } from "node:test";
import assert from "node:assert/strict";
import { entropyOf, redactSecrets } from "../src/index.ts";

const GHP = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const AWS = "AKIAIOSFODNN7EXAMPLE";
const OPENAI = "sk-" + "proj".padEnd(4, "x") + "Abcdefghijklmnopqrstuvwxyz0123456789";

test("secrets in a command are masked; the rest of the command is kept", () => {
  const cases: [string, string[]][] = [
    [`git push https://alice:hunter2pass@github.com/acme/repo.git main`, ["hunter2pass"]],
    [`curl -H "Authorization: Bearer abcdefghijklmnop0123456789" https://api.example.com`, ["abcdefghijklmnop0123456789"]],
    [`curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA==" https://api.example.com`, ["dXNlcjpwYXNzd29yZA=="]],
    [`API_TOKEN=hunter2hunter2 ./deploy.sh`, ["hunter2hunter2"]],
    [`export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCY"; ./run.sh`, ["wJalrXUtnFEMI"]],
    [`mysql --password=s3cr3t-value-123 -u root`, ["s3cr3t-value-123"]],
    [`mysql --password 's3cr3t value' -u root`, ["s3cr3t value"]],
    [`./login.sh -token ${GHP}`, [GHP]],
    [`echo ${AWS} > key.txt`, [AWS]],
    [`./call.sh ${OPENAI}`, [OPENAI]],
    [`deploy --key 9fQ2xLmN8pR4tVwY6zAb1CdE3fGh5JkLmNpQ`, ["9fQ2xLmN8pR4tVwY6zAb1CdE3fGh5JkLmNpQ"]],
  ];
  for (const [cmd, secrets] of cases) {
    const out = redactSecrets(cmd);
    for (const s of secrets) assert.ok(!out.text.includes(s), `${s} survived in: ${out.text}`);
    assert.ok(out.redacted > 0, cmd);
    assert.match(out.text, /\[redacted\]/);
  }
  assert.match(redactSecrets(`git push https://alice:hunter2pass@github.com/acme/repo.git main`).text, /^git push https:\/\/\[redacted\]@github\.com\/acme\/repo\.git main$/);
  assert.match(redactSecrets("API_TOKEN=hunter2hunter2 ./deploy.sh").text, /^API_TOKEN=\[redacted\] \.\/deploy\.sh$/);
});

test("ordinary commands, paths and plain hashes are left alone", () => {
  const plain = [
    "git push origin main", "npm test", "echo hello > out.txt", "ls -la /usr/local/bin", "rm -rf build/",
    "git checkout 3f786850e387550fdab836ed7e6dc881de23001b", `cat sha256:${"ab".repeat(32)}`,
    "python scripts/very_long_but_plain_snake_case_script_name_without_digits.py", "cd C:/Users/Navie/AppData/Local/Temp/project-folder/src",
    "echo token", "grep -r password docs/",
  ];
  for (const cmd of plain) assert.deepEqual(redactSecrets(cmd), { text: cmd, redacted: 0 }, cmd);
});

// Gap E4: more shapes, and a spread check for what looks random. The values are built from pieces so that no scanner takes this file for a leak.
const HEX = "0123456789abcdef";
const B64 = "kP9x" + "Qz3LmN7" + "vB2dR8tY" + "w5GhJ1cF" + "s4UaE6oI+" + "T0yX/eZq";
test("the provider keys and token shapes people paste are masked, and so is a secret written as name: value or left looking random", () => {
  const cases: [string, string][] = [
    [`export OPENROUTER_KEY_FILE=x; curl -H "x-api-key: ${"sk-or-" + "v1-" + HEX.repeat(4)}" https://openrouter.ai/api`, HEX.repeat(4)],
    [`stripe listen --api-key ${"sk_" + "live_" + "A1b2C3d4E5f6G7h8I9j0K1l2"}`, "A1b2C3d4E5f6G7h8I9j0K1l2"],
    [`HF=${"hf" + "_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"} python run.py`, "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
    [`echo "//registry.npmjs.org/:_authToken=${"npm" + "_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}"`, "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"],
    [`git remote add o https://oauth2:${"glpat" + "-" + "A1b2C3d4E5f6G7h8I9j0"}@gitlab.com/x/y.git`, "A1b2C3d4E5f6G7h8I9j0"],
    [`curl -H 'Authorization: ${"ya29" + "." + "A0ARrdaM-abcdefghijklmnopqrstuv"}'`, "A0ARrdaM-abcdefghijklmnopqrstuv"],
    [`SENDGRID=${"SG" + "." + "abcdefghijklmnop12" + "." + "qrstuvwxyz34567890"}`, "qrstuvwxyz34567890"],
    [`token was ${"eyJ" + "hbGciOiJIUzI1NiJ9" + "." + "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + "." + "dBjftJeZ4CVPmB92K27uhbUJU1p1r"}`, "dBjftJeZ4CVPmB92K27uhbUJU1p1r"],
    [`DefaultEndpointsProtocol=https;AccountName=x;AccountKey=${B64}==;EndpointSuffix=core.windows.net`, B64],
    [`api_key: ${B64.slice(0, 20)}`, B64.slice(0, 20)],
    [`{"client_secret": "wJalrXUtnFEMI/K7MDENG", "region": "us-east-1"}`, "wJalrXUtnFEMI/K7MDENG"],
    [`curl https://x.example/ -d value=${B64}`, B64],   // nothing names it: it looks random
  ];
  for (const [input, secret] of cases) {
    const r = redactSecrets(input);
    assert.ok(!r.text.includes(secret), `not masked: ${input.slice(0, 70)} -> ${r.text.slice(0, 90)}`);
    assert.ok(r.redacted >= 1);
  }
  // What is around a masked secret stays.
  assert.match(redactSecrets(`{"client_secret": "wJalrXUtnFEMI/K7MDENG", "region": "us-east-1"}`).text, /"region": "us-east-1"/);
});

test("names, paths, hashes and ordinary words are not taken for secrets", () => {
  const same = [
    "git checkout 3b18e512dba79e4c8300dd08aeb37f8e728b8dad",
    "cat 123e4567-e89b-12d3-a456-426614174000.json",
    `sha256sum -c sha256:${HEX.repeat(4)}`,
    "node --test packages/asp-package/test/getUserAccountBalanceV2FromDb1.test.ts",   // 30 characters with a digit: spread too small to look random (identifiers of 32 or more with a digit are still masked by the older long-token rule)
    "ls /usr/local/lib/node_modules/typescript/lib/tsc.js",
    "const getUserAccountBalanceV2FromDb1 = require('./x')",
    "token: string",
    "password: ${PASSWORD}",
    "secret: 'short'",
    "npm run test -- --grep 'a very long test name that has spaces in it, so no secret'",
  ];
  for (const input of same) assert.equal(redactSecrets(input).text, input, `masked by mistake: ${input}`);
  assert.ok(entropyOf(B64) > 4.3 && entropyOf("getUserAccountBalanceV2FromDb1") < 4.3, "a random run spreads over more characters than a name does (a name with very many distinct letters can still be masked: the rule favours too much over too little)");
});
