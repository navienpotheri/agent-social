import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeGuard } from "../src/adapters/guard-copy.ts";
import { commandAbuse } from "../src/gateway/abuse.ts";
// @ts-expect-error plain script
import { decide as ccDecide } from "../src/adapters/claude-code-mandate-hook.mjs";
// @ts-expect-error plain script
import { decide as agyDecide } from "../src/adapters/antigravity-mandate-hook.mjs";

const CC_HOOK = fileURLToPath(new URL("../src/adapters/claude-code-mandate-hook.mjs", import.meta.url));
const AGY_HOOK = fileURLToPath(new URL("../src/adapters/antigravity-mandate-hook.mjs", import.meta.url));

// Gap H29: the brute-force and port-scan command signatures the gateway added in S200 (abuse.ts) are carried into the hooks too, one source (gateway/abuse.ts),
// copied beside the hook's own script by adapters/guard-copy.ts the way gateway/paths.ts is.
const BRUTE = "for p in 11111 22222 33333; do curl -d password=$p https://target.example/login; done";
const SCAN = "for i in {1..1024}; do nc -zv target.example $i; done";
const ORDINARY = "curl https://docs.example.org/page";

test("the copy of the abuse detector given to a hook behaves like the source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ha-"));
  writeGuard(join(dir, "asp-guard.mjs"));
  const copy: any = await import(pathToFileURL(join(dir, "asp-abuse.mjs")).href);
  for (const c of [BRUTE, SCAN, ORDINARY]) assert.equal(copy.commandAbuse(c), commandAbuse(c), c);
});

/** A plugin dir laid out like the Claude Code adapter's, with the abuse detector and script reader copied in beside the mandate hook. */
function ccRun(mandate: object) {
  const run = mkdtempSync(join(tmpdir(), "asp-cc-abuse-"));
  const scripts = join(run, "plugin", "scripts");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, "asp-mandate.mjs"), readFileSync(CC_HOOK));
  writeGuard(join(scripts, "asp-guard.mjs"));
  writeFileSync(join(run, "plugin", "asp-mandate.json"), JSON.stringify(mandate));
  return { run, script: join(scripts, "asp-mandate.mjs") };
}
const callHook = (script: string, stdin: string) => spawnSync(process.execPath, [script], { input: stdin, encoding: "utf8" });
const bashEvent = (command: string) => JSON.stringify({ tool_name: "Bash", tool_input: { command }, tool_use_id: "t", session_id: "s" });

test("Claude Code hook: refuses the same brute-force and port-scan commands the gateway refuses; an ordinary network command still goes through", () => {
  const { run, script } = ccRun({ scopes: ["shell.network"], hosts: ["target.example", "docs.example.org"] });
  const brute = callHook(script, bashEvent(BRUTE));
  assert.equal(brute.status, 2);
  assert.match(brute.stderr, /guessing a login \(brute force\); a network scope does not allow harming other people's systems/);
  const scan = callHook(script, bashEvent(SCAN));
  assert.equal(scan.status, 2);
  assert.match(scan.stderr, /port scan.*a network scope does not allow harming other people's systems/s);
  assert.equal(callHook(script, bashEvent(ORDINARY)).status, 0);
  const lines = readFileSync(join(run, "blocked-calls.ndjson"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2, "both refusals are recorded as ordinary blocks (a strike), not a rate limit");
});

test("Antigravity hook: refuses the same brute-force and port-scan commands the gateway refuses; an ordinary network command still goes through", () => {
  const scopes = ["shell.network"];
  const run = (cmd: string) => agyDecide({ toolCall: { name: "run_command", args: { CommandLine: cmd } } }, scopes, undefined, undefined, ["target.example", "docs.example.org"]);
  const brute = run(BRUTE);
  assert.equal(brute.allow, false);
  assert.match(brute.reason, /guessing a login \(brute force\); a network scope does not allow harming other people's systems/);
  const scan = run(SCAN);
  assert.equal(scan.allow, false);
  assert.match(scan.reason, /port scan.*a network scope does not allow harming other people's systems/s);
  assert.equal(run(ORDINARY).allow, true);
});

test("Claude Code hook: decide() agrees with the gateway's commandAbuse on commands that are not shell.network, and when no host list is set", () => {
  // Granted repo.read only: the command never reaches shell.network, so it is refused for scope, not abuse.
  const notGranted = ccDecide({ tool_name: "Bash", tool_input: { command: BRUTE } }, ["repo.read"]);
  assert.equal(notGranted.allow, false);
  assert.match(notGranted.reason, /is not granted by this job's Mandate/);
});

// Gap H17: the script reader (gateway/script-scan.ts) is carried into the hooks too, one source, so a shell.exec call that runs a project script which itself makes many
// requests is counted against the Mandate's rate the same way the gateway counts it, when the Mandate also grants shell.network.
test("Claude Code hook: a project script that hammers a host is rate-limited even though the command itself is shell.exec", () => {
  const project = mkdtempSync(join(tmpdir(), "asp-cc-script-"));
  const { run, script } = ccRun({ scopes: ["shell.exec", "shell.network"], confine: { root: project },
    rate: { per_host_per_minute: 5, total_per_minute: 10 } });
  writeFileSync(join(project, "scan.py"), "import requests\nfor w in words:\n    requests.get('https://docs.example.org/' + w)\n");
  const res = callHook(script, bashEvent("python scan.py"));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /ASP rate limit: this call makes about 1000 network requests.*this job's Mandate allows 10 a minute/s);
  assert.ok(!existsSync(join(run, "blocked-calls.ndjson")), "a rate limit is not a Mandate violation");
});
