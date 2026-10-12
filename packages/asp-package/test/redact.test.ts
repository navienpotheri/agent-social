import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../src/index.ts";

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
