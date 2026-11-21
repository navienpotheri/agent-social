/**
 * Tripwires in the pre-call hooks (register row DK432; LW2): the Claude Code and Antigravity hooks read the tripwire list from the Mandate file the adapter writes and refuse a touch whatever the Mandate grants,
 * with the gateway's reason, counted as a blocked attempt; and the hooks' copy of the matcher agrees with the gateway's `trippedBy` over a table. Fake targets only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { judge, trippedBy } from "../src/gateway/judge.ts";
// @ts-expect-error: plain .mjs without type declarations
import * as claude from "../src/adapters/claude-code-mandate-hook.mjs";
// @ts-expect-error: plain .mjs without type declarations
import * as agy from "../src/adapters/antigravity-mandate-hook.mjs";

const CLAUDE_HOOK = fileURLToPath(new URL("../src/adapters/claude-code-mandate-hook.mjs", import.meta.url));
const AGY_HOOK = fileURLToPath(new URL("../src/adapters/antigravity-mandate-hook.mjs", import.meta.url));
const WIRES = ["host:honeypot.internal", "path:.env.production", "cmd:nmap", "secret-ledger"];

const table: [string, Record<string, unknown>][] = [
  ["WebFetch", { url: "https://honeypot.internal/login" }],
  ["WebFetch", { url: "https://docs.example.org/page" }],
  ["Read", { file_path: ".env.production" }],
  ["Read", { file_path: "./.env.production" }],
  ["Read", { file_path: "src/app.ts" }],
  ["Read", { file_path: "notes/secret-ledger.md" }],
  ["Bash", { command: "curl -s http://honeypot.internal/x" }],
  ["Bash", { command: "nmap -p 22 host.example" }],
  ["Bash", { command: "ls -la" }],
  ["Bash", { command: "cat .env.production" }],
  ["Edit", { file_path: "README.md", old_string: "a", new_string: "b" }],
];

test("the hook's matcher agrees with the gateway's trippedBy over a table of calls, and names the same tripwire", () => {
  for (const [tool, input] of table) {
    const mine = claude.tripwireHit({ tool_name: tool, tool_input: input }, WIRES);
    const theirs = trippedBy({ name: tool.toLowerCase(), args: input } as never, WIRES);
    assert.equal(mine, theirs, `${tool} ${JSON.stringify(input)}`);
  }
  assert.equal(claude.tripwireHit({ tool_input: { url: "https://honeypot.internal" } }, []), undefined, "no list, no tripwire");
  assert.equal(agy.tripwireHit({ tool_input: { Url: "https://honeypot.internal/x" } }, WIRES), "host:honeypot.internal", "Antigravity's capitalised argument names are read too");
});

test("decide refuses a tripwire whatever the Mandate grants, with the gateway's wording, and leaves other calls alone (both hooks)", () => {
  const scopes = ["repo.read", "web.read", "shell.exec", "shell.network"];
  const refused = claude.decide({ tool_name: "Read", tool_input: { file_path: ".env.production" } }, scopes, undefined, undefined, undefined, undefined, { tripwires: WIRES });
  assert.equal(refused.allow, false);
  assert.match(refused.reason, /ASP Mandate: path:\.env\.production is a tripwire: a target no job is given, so touching it is an attempt at unauthorised access/);
  const gate = judge({ name: "read_file", args: { path: ".env.production" } } as never, scopes, [], undefined, undefined, undefined, undefined, WIRES);
  assert.match(gate.reason ?? "", /path:\.env\.production is a tripwire: a target no job is given, so touching it is an attempt at unauthorised access/, "the same words as the gateway");
  assert.equal(claude.decide({ tool_name: "Read", tool_input: { file_path: "src/app.ts" } }, scopes, undefined, undefined, undefined, undefined, { tripwires: WIRES }).allow, true);
  assert.equal(claude.decide({ tool_name: "Read", tool_input: { file_path: ".env.production" } }, scopes).allow, true, "without a list nothing is a tripwire");
  const call = (name: string, args: Record<string, unknown>) => ({ toolCall: { name, args }, stepIdx: 1 });
  const agyRefused = agy.decide(call("read_url_content", { Url: "https://honeypot.internal/x" }), ["web.read"], undefined, undefined, undefined, { tripwires: WIRES });
  assert.equal(agyRefused.allow, false);
  assert.match(agyRefused.reason, /host:honeypot\.internal is a tripwire/);
  assert.equal(agy.decide(call("view_file", { AbsolutePath: "src/app.ts" }), ["repo.read"], undefined, undefined, undefined, { tripwires: WIRES }).allow, true);
});

test("as the Claude Code hook runs: a tripwire host is refused with exit 2, the reason names it, the call is a blocked attempt on record, and an ordinary fetch passes", () => {
  const run = mkdtempSync(join(tmpdir(), "asp-tw-"));
  const plugin = join(run, "plugin");
  mkdirSync(join(plugin, "scripts"), { recursive: true });
  writeFileSync(join(plugin, "scripts", "asp-mandate.mjs"), readFileSync(CLAUDE_HOOK));
  writeFileSync(join(plugin, "asp-mandate.json"), JSON.stringify({ scopes: ["web.read", "repo.read"], tripwires: WIRES }));
  const script = join(plugin, "scripts", "asp-mandate.mjs");
  const fire = (tool_name: string, tool_input: unknown) => spawnSync(process.execPath, [script], { input: JSON.stringify({ tool_name, tool_input, tool_use_id: "t", session_id: "s" }), encoding: "utf8" });
  assert.equal(fire("WebFetch", { url: "https://docs.example.org/page" }).status, 0);
  const hit = fire("WebFetch", { url: "https://honeypot.internal/login" });
  assert.equal(hit.status, 2);
  assert.match(hit.stderr, /ASP Mandate: host:honeypot\.internal is a tripwire/);
  const lines = readFileSync(join(run, "blocked-calls.ndjson"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1, "one blocked attempt, counted like any refusal");
  assert.equal(fire("Read", { file_path: ".env.production" }).status, 2);
  assert.equal(readFileSync(join(run, "blocked-calls.ndjson"), "utf8").trim().split("\n").length, 2);
  assert.equal(fire("Read", { file_path: "src/app.ts" }).status, 0);
});

test("as the Antigravity hook runs: the same, read from the Mandate file beside the script", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-tw-"));
  mkdirSync(join(dir, "asp-hook"));
  writeFileSync(join(dir, "asp-hook", "asp-mandate-hook.mjs"), readFileSync(AGY_HOOK));
  writeFileSync(join(dir, "asp-hook", "asp-mandate.json"), JSON.stringify({ scopes: ["web.read", "repo.read"], tripwires: WIRES }));
  const run = (event: unknown) => { const r = spawnSync(process.execPath, [join(dir, "asp-hook", "asp-mandate-hook.mjs"), "pre"], { input: JSON.stringify(event), encoding: "utf8" }); return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : undefined }; };
  const ok = run({ toolCall: { name: "read_url_content", args: { Url: "https://docs.example.org/page" } }, stepIdx: 1 });
  assert.equal(ok.out?.decision, "allow");
  const bad = run({ toolCall: { name: "read_url_content", args: { Url: "https://honeypot.internal/x" } }, stepIdx: 2 });
  assert.equal(bad.out?.decision, "deny");
  assert.match(bad.out?.reason, /host:honeypot\.internal is a tripwire/);
  assert.ok(existsSync(join(dir, "blocked-calls.ndjson")), "recorded as a blocked call");
});
