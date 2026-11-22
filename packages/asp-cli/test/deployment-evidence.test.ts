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
const BS = String.fromCharCode(92);
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

test("the outside monitor was set up first (DK1503 partial), and the checklist records the alert test and the findings; the later evidence closes it (see the test below)", () => {
  const row = rowOf("DK1503")[0]!;
  assert.equal(status(row), "closed");
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

test("steps 5, 6, 8 and the end of step 4 (as relayed): DK95 and DK1503 are closed on their Done lines, DK1802 and DK1803 advance and stay partial, DK9, DK546, DK650 advance only, and DK52 is not advanced", () => {
  const cell = (id: string, n: number) => rowOf(id).find((r) => r.split("|").length === 9)!.split("|")[n]!.trim();
  assert.equal(cell("DK95", 7), "closed");
  assert.match(cell("DK95", 4), /Closed 2026-11-22/);
  assert.match(cell("DK95", 4), /4500 minted, 4500 signed, 0 unsigned/);
  assert.match(cell("DK95", 4), /log seq 405 to 413/);
  assert.equal(cell("DK1503", 7), "closed");
  assert.match(cell("DK1503", 4), /14:30:30 UTC/);
  assert.match(cell("DK1503", 4), /The Up mails are to be confirmed by the owner/);
  assert.equal(cell("DK1802", 7), "closed", "DK1802 closed later the same evening, when its Done line was met (see the test on the two live runs)");
  assert.match(cell("DK1802", 4), /Still to run, and so not closed/);
  assert.equal(cell("DK1803", 7), "partial");
  assert.match(cell("DK1803", 4), /Not yet shown/);
  for (const id of ["DK9", "DK650"]) { assert.equal(cell(id, 7), "partial", `${id} stays partial`); assert.match(cell(id, 4), /Advanced 2026-11-22/); }
  assert.equal(cell("DK546", 7), "closed", "DK546 closed later the same evening");
  assert.match(cell("DK52", 4), /Seen 2026-11-22/);
  assert.match(cell("DK52", 4), /this row is not advanced/);
  const dk1805 = rowOf("DK1805")[0]!;
  assert.match(dk1805, /Partly degraded/);
  assert.match(dk1805, /The society is quiet; every service is up\./);
  assert.equal(status(dk1805), "open");
});

test("the checklist records steps 5, 6, 8 and the end of step 4 with their figures, says that not all smoke lines were 200, and states the risk of the admin token shown on screen", () => {
  const sec = read("docs/live-run-checklist.md");
  const part = sec.slice(sec.indexOf("continued (steps 5, 6, 8"));
  for (const frag of ["bbfa5afa", "ce353a1", "bbfa5af", "build block with schema fingerprints", "no \"closed on this service\" line", "4500 minted, 0 signed, 4500 unsigned", "--require-signed` FAILED", "log seq 405 to 413", "4500 minted, 4500 signed, 0 unsigned", "log seq 413", "23 of 24 pages answered ok 200", "/watch/findings", "--watch-interval", "not all lines were 200", "Balanced:", "/etc/cron.d/asp-status-copy", "https://storage.googleapis.com/agent-social-511217-asp-status/status.html", "14:30:30 UTC", "14:33:21Z", "14:34:52 UTC", "14:35:21Z", "8:03 and 8:04 PM IST", "the Up mails are to be confirmed", "Partly degraded", "DK1805", "The risk, plainly", "until the token is replaced"]) assert.ok(part.includes(frag), frag);
});

test("the guides say it as it was: the token goes to a file, the key may be in the default home, the adoption script, the smoke result of 23 of 24, and what happened in step 5", () => {
  for (const p of ["docs/deployment-plan.md", "docs/deployment-walkthrough.md"]) {
    const d = read(p);
    for (const frag of ["The admin token goes to a file, never to the screen.", "sudo tee /root/asp-admin-token.txt >/dev/null", "(Get-Content ." + BS + "asp-admin-token.txt -Raw).Trim(); Remove-Item ." + BS + "asp-admin-token.txt", "sudo shred -u /root/asp-admin-token.txt", "the default home is `~/.asp`", "." + BS + "scripts" + BS + "adopt-beta-mints.ps1", "log seq 405 to 413", "23 of 24 pages answered `ok 200`", "never claim that all lines were 200", "deployed-commit` went from ce353a1 to bbfa5af", "DK1802 stays partial until"]) assert.ok(d.includes(frag), `${p}: ${frag}`);
    assert.doesNotMatch(d, /Every line of the smoke check says `ok 200`;/, `${p}: the old all-200 claim is gone`);
  }
});

test("the evening's evidence (step 7) closes nothing new: each row that it touches advances and keeps its status, says what is missing, and the overnight table agrees with the register", () => {
  const touched: Record<string, RegExp> = {
    U1: /Advanced 2026-11-22 \(deployment step 7[\s\S]*Still left, so the row stays partial/,
    U9: /Advanced 2026-11-22 \(step 7[\s\S]*Still left, so the row stays partial:\*\* a page behind Google sign-in/,
    O19: /sign-up with a real Google account on the hosted service worked[\s\S]*so the row stays partial/,
    E9: /The end-of-job mail from a real settled job is NOT proven[\s\S]*so the row stays partial/,
    E8: /mail now sends through Resend[\s\S]*so the row stays partial/,
    KO2: /this row is not advanced/,
    O18: /Not shown:\*\* the suspend, resume, block and unblock run[\s\S]*so the row stays partial/,
    T4: /It was not on a clean machine, so the row stays partial/,
    DK1802: /Evening of 2026-11-22 \(step 7\)[\s\S]*are still to be run, so the row stays partial/,   // the note of the first evening; the row closed later (the test below)
  };
  for (const [id, re] of Object.entries(touched)) {
    const row = rowOf(id).sort((a, b) => b.length - a.length)[0]!;
    assert.match(row, re, `${id}: the note and what is missing`);
    assert.equal(status(row), id === "DK1802" ? "closed" : "partial", `${id} keeps its status (a row closes only on its Done line; DK1802 closed later the same evening)`);
    assert.doesNotMatch(row.split("|").slice(-2)[0]!, /\*\*/, `${id}: the status cell holds one word`);
  }
  // The overnight table: every row id is a row of the register and the 'after' status is the register's.
  const log = read("docs/overnight-log.md");
  const table = log.slice(log.indexOf("## 2026-11-22 evening (launch-bar-2)"), log.indexOf("## 2026-11-22 later evening (launch-bar-2)"));
  const lines = table.split("\n").filter((l) => /^\| [A-Z]+\d+ \| /.test(l));
  assert.ok(lines.length >= 20, `${lines.length} rows in the table`);
  const closed: string[] = [];
  for (const l of lines) {
    const c = l.split("|").map((x) => x.trim());
    const rows = rowOf(c[1]!);
    assert.ok(rows.length >= 1, `${c[1]} is a row of the register`);
    const reg = rows.map((r) => r.split("|").slice(-2)[0]!.trim()).find((st) => /^(open|partial|closed|designed)/.test(st)) ?? "";
    const later = ["DK1802", "DK546"].includes(c[1]!) && reg.startsWith("closed");   // closed later the same evening (the second table)
    assert.ok(reg.startsWith(c[3]!) || later, `${c[1]}: the table says ${c[3]} and the register says ${reg.slice(0, 12)}`);
    if (c[3] === "closed") closed.push(c[1]!);
  }
  assert.deepEqual(closed.sort(), ["DK1411", "DK1503", "DK95"], "exactly the three rows that closed on the Done line");
  assert.match(table, /DK1204 \| partial \| partial \| Waits for step 10/);
  const sec = read("docs/live-run-checklist.md");
  const part = sec.slice(sec.indexOf("evening: step 7"));
  for (const frag of ["resend._domainkey", "8:24 PM IST", "8:25 PM", "15:05:14 UTC", "/mail/webhook/resend", "email.bounced and email.complained", "a screenshot seen by the lead", "ASP mail test", "8:45 PM IST", "is **not** an end-of-job mail", "2026-11-22T15-11-54Z", "kept for 12 months", "Nothing new closes"]) assert.ok(part.includes(frag), frag);
  assert.doesNotMatch(part, /re_[A-Za-z0-9]{20,}|whsec_|sk-[A-Za-z0-9]{20,}/, "no API key or webhook secret");
});

test("the two live runs through the hosted service (as relayed): DK1802 and DK546 close on their Done lines and E9 stays partial; P21, E5, DK650, DK1602, E8 and KO2 advance and keep their status; DK1806 is opened; question 53 is a proposed default and not a decision", () => {
  const cell = (id: string, n: number) => rowOf(id).sort((a, b) => b.length - a.length)[0]!.split("|").slice(-6).map((x) => x.trim())[n]!;
  const row = (id: string) => rowOf(id).sort((a, b) => b.length - a.length)[0]!;
  for (const id of ["DK1802", "DK546"]) { assert.equal(status(row(id)), "closed", `${id} closed`); assert.match(row(id), /Closed 2026-11-22/); assert.match(row(id), /deployment-evidence\.test\.ts/, `${id} cites its test`); }
  assert.match(row("DK1802"), /session 8aa76014\) and a sponsored `asp run claude-code` \(session 660d3959\) both worked/);
  // E9 stays partial: the sending side is proven (a direct test mail, seen by the lead) and the end-of-job mail is not.
  assert.equal(status(row("E9")), "partial");
  for (const frag of ["ASP mail test", "8:45 PM IST", "The sending side is proven", "is **not** an end-of-job mail", "The end-of-job mail from a real settled job is NOT proven", "outbox is empty", "buildMandateMail", "Settled", "13 alerts", "new row DK1807", "so the row stays partial"]) assert.ok(row("E9").includes(frag), `E9: ${frag}`);
  assert.doesNotMatch(row("E9"), /Closed 2026-11-22/, "E9 is not closed");
  const dk1807 = row("DK1807");
  assert.equal(status(dk1807), "open");
  assert.match(dk1807, /creates a standing job but no settled contract/);
  assert.match(dk1807, /Done: a governed run's end is mailed to the principal's verified address \(or held with the reason\), shown in a live run with the mail text pasted/);
  assert.match(dk1807, /lane-protocol-3 \(mail\) with lane-cli-3/);
  assert.equal(dk1807.split("|").slice(-3)[0]!.trim(), "A");
  assert.equal(status(row("E10")), "closed", "E10 is not reopened");
  assert.match(row("E10"), /Evidence 2026-11-22 \(does not reopen the row; see DK1807\)/);
  assert.match(row("E8"), /did not arrive, see E9 and DK1807/);
  const stays: Record<string, [string, RegExp]> = {
    P21: ["partial", /Goose, Antigravity and OpenHands from this command/],
    E5: ["partial", /Antigravity and OpenHands/],
    DK650: ["partial", /abuse counters read afterwards/],
    DK1602: ["open", /not compared with the gateway's run log/],
    E8: ["partial", /dashboard does not exist, so the row stays partial/],
    KO2: ["partial", /owner question 53: the proposed default is pull plus the operator's notes only, \*\*not yet answered\*\*/],
  };
  for (const [id, [st, re]] of Object.entries(stays)) { assert.equal(status(row(id)), st, `${id} keeps ${st}`); assert.match(row(id), re, `${id}: what is missing`); }
  const dk1806 = rowOf("DK1806")[0]!;
  assert.match(dk1806, /npm\.ps1/);
  assert.match(dk1806, /Set-ExecutionPolicy -Scope Process Bypass/);
  assert.equal(status(dk1806), "open");
  for (const p of ["docs/deployment-walkthrough.md", "docs/deployment-plan.md", "docs/tonight.md"]) { const d = read(p); assert.match(d, /DK1806/, p); assert.match(d, /Set-ExecutionPolicy -Scope Process Bypass/, p); assert.match(d, /changes nothing for the machine/, p); }
  const all = read("docs/owner-questions-all.md").split("## Answered, no action")[0]!;
  const q54 = all.split("\n").find((l) => l.startsWith("53. **KO2:**"))!;
  assert.match(q54, /Proposed default, not yet answered by you/);
  assert.match(q54, /\[docs\/key-only-audit\.md\]$/);
  assert.doesNotMatch(read("docs/owner-decisions.md"), /pull plus the operator's notes only/, "it is not recorded as decided");
  const log = read("docs/overnight-log.md");
  const table = log.slice(log.indexOf("## 2026-11-22 later evening (launch-bar-2)"));
  const lines = table.split("\n").filter((l) => /^\| [A-Z]+\d+ \| /.test(l));
  assert.equal(lines.length, 12);
  const closed: string[] = [];
  for (const l of lines) { const c = l.split("|").map((x) => x.trim()); if (c[1] !== "DK1806" && c[1] !== "DK1807") { const reg = status(row(c[1]!)); assert.equal(reg, c[3], `${c[1]}: the table's after is the register's`); } if (c[3] === "closed") closed.push(c[1]!); }
  assert.deepEqual(closed.filter((x) => x !== "E10").sort(), ["DK1802", "DK546"], "only DK1802 and DK546 close in the second table (E10 is closed already and is listed as evidence only)");
  const res = read("docs/live-run-results-2026-11-22.md");
  const part = res.slice(res.indexOf("## 7. The two runs through the hosted service"));
  for (const frag of ["8aa76014", "660d3959", "20-bit proof of work", "live-keyonly-1", "4116 in, 707 out", "USD 0.6278 of the USD 5 cap", "11 events, the hash chain verifies", "3 records on the job and 2 signed Action reports", "2901 tokens", "a budget WARNING", "no end-of-job mail arrived", "seen by the lead in a screenshot", "the owner ran it and the lead has not seen the output", "not** `--local` runs", "register row DK1806", "No key, token or recovery code appears here"]) assert.ok(part.includes(frag), frag);
  assert.doesNotMatch(part, /sk-[A-Za-z0-9]{20,}|AGE-SECRET-KEY|recovery code is [A-Za-z0-9]{8,}/);
  const ck = read("docs/live-run-checklist.md");
  const ckPart = ck.slice(ck.indexOf("The owner's two live runs through the hosted service, 2026-11-22 evening"));
  for (const frag of ["No end-of-job mail arrived for the sponsored run", "the owner ran it and the lead has not seen the output", "DK1807", "E9 stays partial"]) assert.ok(ckPart.includes(frag), `checklist: ${frag}`);
});
