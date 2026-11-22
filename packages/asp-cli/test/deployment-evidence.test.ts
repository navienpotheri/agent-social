// The owner's deployment evidence of 2026-11-22 (steps 2 to 4), as relayed: the encryption check closes DK1411 with its evidence file and the questionnaire answer; the restore drills give gate 13 its evidence and GV6 its
// database restore clause only (the row stays partial); the outside monitor makes DK1503 partial and not closed; the live-run checklist records each fact; the guides carry the findings (a keyword monitor because the
// free plan forces HEAD and the old server answers HEAD with 401; the supply monitor and the status copy after step 5); and no key text appears anywhere in them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const register = read("docs/gaps-register.md");
const rowOf = (id: string) => register.split("\n").filter((l) => l.startsWith(`| ${id} |`));
const status = (row: string) => { const c = row.split("|").map((x) => x.trim()); return c[c.length - 2]; };
const HEAD = "sha256:503a57fe9540ba2c5b6d9e7d2e48e3652dfa4dde5989b353c51bd0bc870094fc";
const FILES = ["docs/live-run-checklist.md", "docs/procurement/encryption-evidence.md", "docs/procurement/security-questionnaire.md", "docs/owner-setup-operations.md", "docs/deployment-plan.md", "docs/deployment-walkthrough.md"];

test("DK1411 is closed with its evidence file, and answer 29 of the questionnaire reads Yes with it and says what is not claimed", () => {
  const rows = rowOf("DK1411");
  assert.equal(rows.length, 1);
  assert.equal(status(rows[0]!), "closed");
  assert.match(rows[0]!, /\*\*Closed 2026-11-22:\*\*/);
  assert.match(rows[0]!, /docs\/procurement\/encryption-evidence\.md/);
  const ev = read("docs/procurement/encryption-evidence.md");
  for (const frag of ["asp-log", "agent-social-511217", "asia-south1-a", "Google-managed", "snapshot", "one boot disk", "not separately checked", "Not claimed", "nothing here was run or checked by a worker"]) assert.ok(ev.includes(frag), frag);
  const q = read("docs/procurement/security-questionnaire.md");
  const a29 = q.split("\n").find((l) => l.startsWith("29. **Encryption at rest?**"))!;
  assert.match(a29, /^29\. \*\*Encryption at rest\?\*\* Yes\./);
  assert.match(a29, /docs\/procurement\/encryption-evidence\.md/);
  assert.match(a29, /not the customer's/, "the key is the provider's");
  assert.match(a29, /nobody outside has reviewed it/);
});

test("the restore drills close nothing that they do not cover: GV6 stays partial with the database clause, and the head and the record count agree with the checklist", () => {
  const gv6 = rowOf("GV6").find((r) => r.split("|").length === 12)!;
  assert.ok(gv6.split("|")[7]!.trim().startsWith("partial"), "GV6 stays partial (its status cell begins with the word partial)");
  assert.ok(gv6.includes(HEAD));
  assert.match(gv6, /404 records/);
  assert.match(gv6, /whole-city restore/);
  const list = read("docs/live-run-checklist.md");
  const sec = list.slice(list.indexOf("## The owner's deployment evidence of 2026-11-22"));
  assert.ok(sec.includes(HEAD) && /404 records/.test(sec));
  for (const frag of ["first run copied 4 files, the second copied 0 and found 4 already there", "hooked as the last line of `/usr/local/bin/asp-backup`", "private line had been shown on screen", "the six old objects were deleted", "only the age public key", "permission denied for schema public", "5848af56", "DRILL PASSED", "decrypted by the owner with the private key from his password manager", "Launch gate 13", "for the database only", "GV6 stays partial"]) assert.ok(sec.includes(frag), frag);
});

test("the outside monitor makes DK1503 partial and not closed, and the checklist records the alert test and the findings", () => {
  const row = rowOf("DK1503")[0]!;
  assert.equal(status(row), "partial");
  assert.match(row, /13:40:34 UTC, started 13:43:19 UTC/);
  assert.match(row, /wait for step 5/);
  const sec = read("docs/live-run-checklist.md");
  for (const frag of ["UptimeRobot", "keyword monitor", "forces the HEAD method", "answers HEAD with 401", "/economy/supply", "13:40:34 UTC", "13:43:19 UTC", "Down mail and the Up mail", "gs://agent-social-511217-asp-status", "objectAdmin", "/etc/asp-status", "overwrite test passed", "DK1503 stays partial"]) assert.ok(sec.includes(frag), frag);
});

test("the guides carry the findings: a keyword monitor and not a plain check, the supply monitor and the status copy after step 5, and the status host as ready and not yet working", () => {
  for (const p of ["docs/deployment-plan.md", "docs/deployment-walkthrough.md"]) {
    const d = read(p);
    for (const frag of ["keyword monitor", "answers HEAD with 401", "after step 5", "gs://agent-social-511217-asp-status", "**After this step (it is not part of this step's check):**", "That settles DK1503."]) assert.ok(d.includes(frag), `${p}: ${frag}`);
    assert.doesNotMatch(d, /two checks on `\$SITE\/health`/, `${p}: the old two-check instruction is gone`);
  }
  const ops = read("docs/owner-setup-operations.md");
  assert.match(ops, /Do not use a plain HTTP check on the free plan/);
  assert.match(ops, /Status \(updated 2026-11-22\)/);
  assert.match(ops, /after step 5 of the deployment plan/);
  assert.match(read("docs/owner-questions-all.md"), /DK1411 \(encryption at rest\): the owner verified/);
});

test("no key text appears in the evidence: no private key, no age public key, no service-account key, no token", () => {
  for (const p of FILES) {
    const d = read(p);
    assert.doesNotMatch(d, /AGE-SECRET-KEY-1[0-9A-Z]{10,}/, `${p}: no age private key`);
    assert.doesNotMatch(d, /\bage1[0-9a-z]{40,}\b/, `${p}: no age public key text`);
    assert.doesNotMatch(d, /BEGIN [A-Z ]*PRIVATE KEY|"private_key"|sk-[A-Za-z0-9]{20,}/, `${p}: no key material`);
  }
});
