// Rows DK1341, T1, T2, U1, U9, O2, T12 (spec-delta S1458; owner instruction of 2026-11-21): one script for each live check that needs no real model agent, and a checklist the owner can follow in order
// (docs/live-check-cli.md). The scripts exist and parse, the checklist names each of them and each row it settles, and the scripts that can run on one machine really run: the clean-machine check, the gateway with a
// stand-in agent and the whole monitor drill (service stopped and started, one alert each way) pass here, with the real command line. The ones that need the owner's Google account or the server are checked for shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const doc = readFileSync(join(root, "docs/live-check-cli.md"), "utf8").replace(/\r\n/g, "\n");
const SCRIPTS = ["01-clean-machine.mjs", "02-signup-join.mjs", "03-gateway-stand-in.mjs", "05-production-flags.mjs", "06-monitor-status.mjs"];

test("each live-check script exists, parses, and is named in the checklist with the rows it settles", () => {
  for (const f of SCRIPTS) {
    const p = join(root, "scripts/live", f);
    assert.ok(existsSync(p), `${f} exists`);
    const r = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
    assert.equal(r.status, 0, `${f} parses: ${r.stderr}`);
    assert.ok(doc.includes(f.replace(/\.mjs$/, "").replace(/^\d+-/, "")) || doc.includes(f), `${f} is in the checklist`);
  }
  assert.ok(existsSync(join(root, "scripts/live/lib.mjs")));
  assert.ok(existsSync(join(root, "docs/deploy/restore-drill.sh")), "the restore drill is the script of check 4");
  for (const needle of ["## 1. Clean machine (T1, T2, U16)", "## 2. Sign-up, join, recovery, export, close (U1, U9, E9)", "## 3. The gateway with a stand-in agent", "## 4. Restore drill (GV6, DK293)", "## 5. Production flags and limits (O2, T12)", "## 6. Monitor, alerts and the status page (DK1341)", "DRILL PASSED", "no real model agent", "Credits are accounting entries, not money"]) assert.ok(doc.includes(needle), `the checklist has "${needle}"`);
});

test("every command line in the checklist's code blocks names a script that exists, or an asp command in the catalogue", () => {
  const catalogue = (JSON.parse(readFileSync(join(root, "docs/commands.json"), "utf8")).groups as { commands: { command: string }[] }[]).flatMap((g) => g.commands.map((c) => c.command));
  for (const m of doc.matchAll(/node (scripts\/live\/[\w.-]+\.mjs)/g)) assert.ok(existsSync(join(root, m[1])), `${m[1]} exists`);
  for (const m of doc.matchAll(/(?:^|\s)(?:node packages\/asp-cli\/bin\/asp\.mjs|asp)\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/gm)) {
    const entry = catalogue.filter((c) => c.startsWith(`asp ${m[1]}`));
    if (["is", "was", "and", "says", "alone", "node"].includes(m[1])) continue;
    assert.ok(entry.length, `asp ${m[1]} is in the catalogue`);
  }
});

function runScript(file: string, extra: string[]) {
  const cwd = mkdtempSync(join(tmpdir(), "asp-live-run-"));
  const r = spawnSync(process.execPath, [join(root, "scripts/live", file), ...extra], { cwd, encoding: "utf8", timeout: 240_000 });
  return { ...r, cwd, out: `${r.stdout}${r.stderr}` };
}

test("the clean-machine check passes here (the steps for a person are skipped with --yes and the report says so)", () => {
  const r = runScript("01-clean-machine.mjs", ["--yes"]);
  assert.equal(r.status, 0, r.out.slice(-1500));
  assert.match(r.out, /PASSED: 8 of 10 steps passed \(2 human step\(s\) skipped with --yes\)/);
  assert.ok(readdirSync(r.cwd).some((f) => /^live-check-clean-machine-\d{4}-\d{2}-\d{2}\.log$/.test(f)), "the report file is written");
  assert.match(readFileSync(join(r.cwd, readdirSync(r.cwd).find((f) => f.startsWith("live-check-clean-machine"))!), "utf8"), /Paste into docs\/live-run-checklist\.md/);
});

test("the gateway-with-a-stand-in check passes: an allowed call through, an out-of-Mandate call removed, the fake key masked in the run log, the log verifies, repeated violations end the session", () => {
  const r = runScript("03-gateway-stand-in.mjs", ["--yes", "--kill"]);
  assert.equal(r.status, 0, r.out.slice(-1800));
  assert.match(r.out, /PASSED: 8 of 9 steps passed/);
  assert.doesNotMatch(r.out, /sk-live-check-FAKE-0000000000000000/, "the fake key is not even in the script's own report");
});

test("the monitor drill passes with the real command line: one DOWN alert after two failed checks, the page up while the service is down, one RECOVERED alert", () => {
  const r = runScript("06-monitor-status.mjs", ["--local"]);
  assert.equal(r.status, 0, r.out.slice(-1800));
  assert.match(r.out, /PASSED: 11 of 11 steps passed/);
  assert.match(r.out, /PASS\s+4\. second failed check: exactly one DOWN alert reaches the webhook/);
  assert.match(r.out, /PASS\s+9\. the first check after the restart is not an outage and sends one RECOVERED alert/);
});

test("the report removes anything that looks like a token or key before it is written", async () => {
  const { redact } = await import(new URL("../../../scripts/live/lib.mjs", import.meta.url).href);
  assert.equal(redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"), "Authorization: Bearer [token]");
  assert.match(redact("key sk-live-abcdef0123456789abcdef"), /\[key\]/);
  assert.match(redact("a ".concat("A".repeat(43))), /\[redacted\]/);
  assert.equal(redact("sha256:" + "a".repeat(64)), "sha256:" + "a".repeat(64), "a record id is not a secret");
  assert.equal(redact("did:web:example.com:users:alice"), "did:web:example.com:users:alice");
});
