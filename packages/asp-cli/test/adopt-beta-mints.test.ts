// scripts/adopt-beta-mints.ps1 adopts the 4,500 unsigned credits of the hosted beta database (register row DK95): 500 for each of nine accounts, signed by the owner as operator and co-signed as owner. It is the script that
// the owner ran on 2026-11-22 (log seq 405 to 413). Held here: it names exactly the nine DIDs and 500 credits each (4,500 in all), uses the owner's one DID for both parties, calls a documented command with flags that the
// CLI knows, stops at the first failure, ends with the audit that requires signed mints, and never reads or prints a key or the token. Where PowerShell exists it is also run against a stand-in `npm` that records its calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const root = new URL("../../../", import.meta.url);
const scriptPath = decodeURIComponent(new URL("scripts/adopt-beta-mints.ps1", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const text = readFileSync(scriptPath, "utf8");
const OP = "did:web:log.thedeeptransformation.com:u:navien-agentrun";
const NINE = [
  "did:web:thedeeptransformation.com:users:navien-test-alice",
  "did:web:thedeeptransformation.com:agents:navien-test-coder",
  "did:web:log.thedeeptransformation.com:u:navien-live",
  "did:web:log.thedeeptransformation.com:a:navien-live:my-agent",
  "did:web:log.thedeeptransformation.com:court:juror-1",
  "did:web:log.thedeeptransformation.com:court:juror-2",
  "did:web:log.thedeeptransformation.com:court:juror-3",
  "did:web:log.thedeeptransformation.com:u:navien-log",
  "did:web:log.thedeeptransformation.com:a:navien-log:my-agent",
];
const FAKE_KEY = "FAKE-PRIVATE-KEY-CONTENT-DO-NOT-PRINT";
const FAKE_TOKEN = "FAKE-ADMIN-TOKEN-DO-NOT-PRINT";

test("the script names the nine DIDs once each, 500 credits for each (4,500 in all), the owner's one DID as operator and co-signer, and ends with the audit that requires signed mints", () => {
  const listed = [...text.matchAll(/^\s*"(did:web:[^"]+)",?\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(listed, NINE, "exactly the nine DIDs, in this order");
  assert.equal(new Set(listed).size, 9);
  assert.ok(text.includes(`$OP = "${OP}"`));
  assert.match(text, /credits adopt --to \$d --amount 500 --by \$OP --cosign-by \$OP --reason "adopt the unsigned mints of the beta database"/);
  assert.equal(9 * 500, 4500, "the nine adoptions are the 4,500 of the audit");
  assert.match(text, /500 credits for each of nine accounts/);
  assert.match(text, /npm run asp -- credits audit --require-signed\s*$/m);
  assert.match(text, /if \(\$LASTEXITCODE -ne 0\) \{ "STOPPED at \$d\. Nothing after it was run\."; return \}/, "it stops at the first failure");
  assert.match(text, /cannot be undone/);
});

test("it never reads or prints a key or the token: keys are looked for by file name only, and the token is only checked to be set", async () => {
  for (const bad of [/Get-Content/i, /ReadAllText/i, /\bcat\b/, /\btype\b\s+["$]/, /ConvertFrom-Json/i, /Write-Host/i, /Write-Output/i, /Out-File/i, /Set-Content/i, /\|\s*Out-String/i, /Invoke-WebRequest|Invoke-RestMethod|curl/i])
    assert.doesNotMatch(text, bad, `no ${bad}`);
  // Keys: only Test-Path and Get-ChildItem (names) on the keys folder; the only filter is a file name pattern.
  for (const l of text.split("\n").filter((x) => /keys/.test(x) && !/^\s*#/.test(x))) assert.match(l, /Test-Path|Get-ChildItem|throw|"No ASP home/, `keys line: ${l.trim().slice(0, 60)}`);
  // The token: named only in the check that it is set.
  const tokenLines = text.split("\n").filter((x) => /ASP_LOG_TOKEN/.test(x) && !/^\s*#/.test(x));
  assert.equal(tokenLines.length, 1);
  assert.match(tokenLines[0]!, /if \(-not \$env:ASP_LOG_URL -or -not \$env:ASP_LOG_TOKEN\) \{ throw /);
  assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY|AGE-SECRET-KEY|"private_key"/);
  // The command that it calls is a documented command, with flags that the CLI knows.
  const { main } = await import("../src/cli.ts");
  const out: string[] = [];
  await main(["help", "all"], { out: (l: string) => out.push(l), err() {}, env: {}, cwd: process.cwd() } as never);
  const help = out.join("\n") + "\n" + readFileSync(new URL("docs/commands.md", root), "utf8");
  for (const f of ["credits adopt", "--to", "--amount", "--by", "--cosign-by", "--reason", "credits audit", "--require-signed"]) assert.ok(help.includes(f), `${f} is in the help`);
});

const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command", "echo ok"], { encoding: "utf8" });
const HAVE_PS = ps.status === 0 && ps.stdout.trim() === "ok";
function stage(failAt = "") {
  const dir = mkdtempSync(join(tmpdir(), "asp-adopt-"));
  const bin = join(dir, "bin"), home = join(dir, "asp-home"), log = join(dir, "calls.txt");
  mkdirSync(bin); mkdirSync(join(home, "keys"), { recursive: true });
  writeFileSync(join(home, "keys", "did_web_log.thedeeptransformation.com_u_navien-agentrun.json"), JSON.stringify({ secret: FAKE_KEY }));
  writeFileSync(log, "");
  writeFileSync(join(bin, "npm.cmd"), `@echo off\r\necho %*>> "${log}"\r\nif not "${failAt}"=="" echo %* | findstr /C:"${failAt}" >nul && exit /b 1\r\nexit /b 0\r\n`);
  const run = (args: string[] = []) => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
    encoding: "utf8", timeout: 120_000, env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, ASP_LOG_URL: "http://127.0.0.1:1", ASP_LOG_TOKEN: FAKE_TOKEN, HOME: dir, USERPROFILE: dir },
  });
  return { dir, home, log, run };
}

test("run against a stand-in npm (where PowerShell exists): nine adoptions of 500 in order, then the audit; the key and the token are never printed", { skip: !HAVE_PS && "PowerShell is not available" }, () => {
  const s = stage();
  const r = s.run(["-AspHome", s.home]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const calls = readFileSync(s.log, "utf8").split(/\r?\n/).filter(Boolean);
  assert.equal(calls.length, 10, "nine adoptions and one audit");
  NINE.forEach((d, i) => assert.ok(calls[i]!.includes(`credits adopt --to ${d} --amount 500 --by ${OP} --cosign-by ${OP}`), `call ${i + 1}: ${calls[i]}`));
  assert.match(calls[9]!, /credits audit --require-signed/);
  const all = r.stdout + r.stderr;
  assert.ok(!all.includes(FAKE_KEY) && !all.includes(FAKE_TOKEN), "no key and no token in the output");
  assert.match(all, /Signing with the ASP home:/);
});

test("run against a stand-in npm that fails at the third account: it stops there, runs nothing after it and says so; with no token set it refuses; with two homes it asks for -AspHome", { skip: !HAVE_PS && "PowerShell is not available" }, () => {
  const s = stage(NINE[2]!);
  const r = s.run(["-AspHome", s.home]);
  const calls = readFileSync(s.log, "utf8").split(/\r?\n/).filter(Boolean);
  assert.equal(calls.length, 3, "the third call fails and nothing runs after it");
  assert.match(r.stdout + r.stderr, new RegExp(`STOPPED at ${NINE[2]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Nothing after it was run\\.`));
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_KEY));
  const t = stage();
  const noToken = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-AspHome", t.home], { encoding: "utf8", timeout: 60_000, env: { ...process.env, ASP_LOG_URL: "", ASP_LOG_TOKEN: "" } });
  assert.notEqual(noToken.status, 0);
  assert.match(noToken.stderr + noToken.stdout, /ASP_LOG_URL and ASP_LOG_TOKEN must be set in this window first/);
  assert.equal(readFileSync(t.log, "utf8").trim(), "", "nothing was run");
});
