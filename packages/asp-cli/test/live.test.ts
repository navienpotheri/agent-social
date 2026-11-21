// Live-run readiness: `asp live preflight` (a green/amber/red table that never prints the key, and proves asp stop --all) and `asp live report` (what a session proved, from its hash-checked run log).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RunRecorder } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { buildReport } from "../src/live-cmd.ts";
import { makeFixture } from "./fixture.ts";

const SECRET = "sk-ant-api03-" + "Z".repeat(40);
async function asp(aspHome: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: aspHome, ...env }, cwd: aspHome };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("preflight: red without a key, a budget cap and identities; the key is never printed; asp stop --all is proved on a throwaway home", async () => {
  const f = makeFixture(); mkdirSync(f.aspHome, { recursive: true });
  const bad = await asp(f.aspHome, ["live", "preflight"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /RED\s+key in ANTHROPIC_API_KEY\s+ANTHROPIC_API_KEY is not set/);
  assert.match(bad.out, /RED\s+the budget cap\s+no --budget-usd/);
  assert.match(bad.out, /RED\s+identities/);
  assert.match(bad.out, /GREEN\s+Node/);
  assert.match(bad.out, /GREEN\s+the gateway\s+started on 127\.0\.0\.1:\d+ and answered/);
  assert.match(bad.out, /GREEN\s+asp stop --all\s+wrote a stop file/);
  assert.match(bad.out, /NOT READY: \d+ red/);
  // with a key and a cap: the key line is green and says how long it is, never what it is
  writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ identities: { me: "did:web:x:u:a", agent: "did:web:x:a:a:b", bank: "did:web:x:u:a:bank" } }));
  const ok = await asp(f.aspHome, ["live", "preflight", "--model", "claude-haiku-5-5", "--budget-usd", "5"], { ANTHROPIC_API_KEY: SECRET, ASP_CLAUDE_BIN: process.execPath });
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /GREEN\s+key in ANTHROPIC_API_KEY\s+set \(53 characters; not shown\)/);
  assert.ok(!ok.out.includes(SECRET) && !ok.err.includes(SECRET), "the key is never printed");
  assert.match(ok.out, /GREEN\s+the budget cap\s+\$5 hard cap; priced at \$1\.5 in and \$7\.5 out/);
  assert.match(ok.out, /AMBER\s+the log service\s+no service is configured/);
  assert.match(ok.out, /READY/);
  // an unknown model is priced high and says so; a bad cap is red; the real home gets no stop file
  const unk = await asp(f.aspHome, ["live", "preflight", "--model", "brand-new", "--budget-usd", "5"], { ANTHROPIC_API_KEY: SECRET, ASP_CLAUDE_BIN: process.execPath });
  assert.match(unk.out, /AMBER\s+the budget cap.*not in the price table/);
  assert.equal((await asp(f.aspHome, ["live", "preflight", "--budget-usd", "0"], { ANTHROPIC_API_KEY: SECRET, ASP_CLAUDE_BIN: process.execPath })).code, 1);
  const j = JSON.parse((await asp(f.aspHome, ["live", "preflight", "--json", "--budget-usd", "5", "--model", "claude-haiku-5-5"], { ANTHROPIC_API_KEY: SECRET, ASP_CLAUDE_BIN: process.execPath })).out);
  assert.equal(j.ready, true);
});

test("preflight: the runtime asp run will start is checked, with its version; a missing one is red and says what to do", async () => {
  const f = makeFixture(); mkdirSync(f.aspHome, { recursive: true });
  const good = await asp(f.aspHome, ["live", "preflight", "--budget-usd", "5"], { ANTHROPIC_API_KEY: SECRET, ASP_CLAUDE_BIN: process.execPath });
  assert.match(good.out, /GREEN\s+runtime claude-code\s+.*v\d+\.\d+\.\d+ \(the default runtime/);
  const bad = await asp(f.aspHome, ["live", "preflight", "--budget-usd", "5"], { ANTHROPIC_API_KEY: SECRET, ASP_CLAUDE_BIN: "definitely-not-installed-claude" });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /RED\s+runtime claude-code\s+definitely-not-installed-claude was not found/);
  assert.match((await asp(f.aspHome, ["live", "preflight", "--runtime", "nope", "--budget-usd", "5"], { ANTHROPIC_API_KEY: SECRET })).out, /RED\s+runtime nope\s+asp run does not start nope/);
  assert.match(good.out, /GREEN\s+the ASP home\s+.* is writable/);
});

test("preflight: a log service that cannot be reached is red", async () => {
  const f = makeFixture(); mkdirSync(f.aspHome, { recursive: true });
  const r = await asp(f.aspHome, ["live", "preflight", "--budget-usd", "5"], { ANTHROPIC_API_KEY: SECRET, ASP_CLAUDE_BIN: process.execPath, ASP_LOG_URL: "http://127.0.0.1:9" });
  assert.match(r.out, /RED\s+the log service\s+127\.0\.0\.1:9 was not reachable/);
});

function runLog(path: string, spend: boolean): void {
  const r = new RunRecorder(path);
  r.event("run_start", { contract: "sha256:" + "1".repeat(64), agent: "did:web:x:a:a:b", scopes: ["repo.read"] });
  r.event("model_request", { api: "messages", model: "claude-haiku-5-5", prompt: "do it" });
  r.event("model_reply", { tokens_in: 1200, tokens_out: 300, ms: 900, text: "ok" });
  r.event("tool_call", { tool: "Read", scope: "repo.read", allowed: true });
  r.event("tool_call", { tool: "Bash", scope: "shell.network", allowed: false, reason: "the scope shell.network is not granted by this job's Mandate. Article 1 (No access)" });
  r.event("outbound_scan", { where: "model_request", kind: "secret", hash: "sha256:ab", action: "redacted" });
  r.event("budget_stop", { usd: 4.99, cap_usd: 5, worst_case_usd: 0.3 });
  r.event("run_end", { exit_code: 0, requests: 1, ...(spend ? { spend_usd: 4.99, cap_usd: 5 } : {}) });
}

test("report: what a session proved, from its own run log; a tampered log is called out and exits 1", async () => {
  const f = makeFixture(); mkdirSync(f.aspHome, { recursive: true });
  const rl = join(f.aspHome, "runs", "s1", "run-log.ndjson");
  runLog(rl, true);
  const contract = "sha256:" + "1".repeat(64);
  appendFileSync(join(f.aspHome, "runs.ndjson"), JSON.stringify({ t: "start", pid: 1, sid: "live-1", contract, at: "2026-11-23T18:00:00Z", runtime: "claude-code", agent: "did:web:x:a:a:b", me: "did:web:x:u:a", bank: "did:web:x:u:a:bank", purpose: "rehearsal", scopes: ["repo.read"], hosts: [] }) + "\n" + JSON.stringify({ t: "end", sid: "live-1", contract, at: "2026-11-23T18:05:00Z", state: "ended", calls: 2, refused: ["Bash"], tokens: 1500, exitCode: 0, runLog: rl }) + "\n");
  const rep = await asp(f.aspHome, ["live", "report"]);
  assert.equal(rep.code, 0, rep.err + rep.out);
  assert.match(rep.out, /live run live-1: ended \(exit 0\)/);
  assert.match(rep.out, /calls\s+2 judged: 1 allowed, 1 refused/);
  assert.match(rep.out, /refused\s+Bash -> shell\.network: the scope shell\.network is not granted/);
  assert.match(rep.out, /1 request\(s\), 1200 in \/ 300 out tokens; estimated spend \$4\.99 of a \$5 cap \(stopped at the cap\)/);
  assert.match(rep.out, /outbound scan 1/);
  assert.match(rep.out, /hash chain verifies/);
  assert.match(rep.out, /identities\s+sponsor did:web:x:u:a; agent did:web:x:a:a:b; bank/);
  const j = JSON.parse((await asp(f.aspHome, ["live", "report", "--session", "live", "--json"])).out);
  assert.equal(j.calls.refused, 1);
  assert.equal(j.model.capUsd, 5);
  // a changed line breaks the chain
  const { readFileSync } = await import("node:fs");
  writeFileSync(rl, readFileSync(rl, "utf8").replace('"allowed":true', '"allowed":false'));
  const bad = await asp(f.aspHome, ["live", "report"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /DOES NOT VERIFY/);
});

test("report: a run without --budget-usd says no spend was recorded, and a session with no run log says where the numbers come from", () => {
  const f = makeFixture(); mkdirSync(f.aspHome, { recursive: true });
  const rl = join(f.aspHome, "runs", "s2", "run-log.ndjson");
  runLog(rl, false);
  const base = { session: { sid: "s", runtime: "codex", agent: "a", me: "m", bank: "b", at: "t", purpose: "p", scopes: [], hosts: [], contract: "c" } };
  assert.ok(buildReport({ ...base, runLogPath: rl }).notes.some((n) => /no spend was recorded/.test(n)));
  const none = buildReport({ ...base, end: { at: "t", state: "ended", calls: 3, refused: ["x"], tokens: 1, exitCode: 0 } });
  assert.ok(none.notes.some((n) => /no run log was found/.test(n)));
  assert.equal(none.calls.judged, 3);
});
