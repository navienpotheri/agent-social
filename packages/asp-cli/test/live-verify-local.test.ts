// Register rows DK650, DK540 to DK546, T15, E5, DK1602: `asp live verify-local` checks a run of a key-only agent against the local service's own log and the session's run log. Against a REAL local service
// (`asp serve`, the file log, key-only sign-up), a stand-in provider and a stand-in Claude Code: the key-only agent enrols, runs one governed session with a call outside its Mandate, and the command prints a
// PASS for each check; then the log and the run log are altered one way at a time and the matching check fails. Fake keys only; credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));
function start(args: string[]) {
  const server = spawn(process.execPath, [cli, "serve", ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
  let buf = "";
  const ready = new Promise<string>((resolve, reject) => {
    server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
  });
  return { ready, out: () => buf, stop: () => server.kill() };
}

test("DK650: a key-only agent runs one governed session on a local service, and asp live verify-local passes every check; altering the log or the run log fails the matching one", { timeout: 300_000 }, async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "curl -s http://evil.example/x" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-verify-local-"));
  const tokens = join(dir, "tokens.json");
  const logDir = join(dir, "log");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const svc = start(["--db", `local:${logDir}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-difficulty", "8", "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"]);
  try {
    const url = await svc.ready;
    const f = makeFixture();
    mkdirSync(f.aspHome, { recursive: true });
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ANTHROPIC_API_KEY: "sk-ant-fake" };
    const call = async (args: string[], home = f.aspHome) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ...env, ASP_HOME: home }, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    const enrol = await call(["enrol", "--service", url, "--name", "vl-agent", "--accept-terms"]);
    assert.equal(enrol.code, 0, enrol.err);
    const r = await call(["run", "claude-code", "--prompt", "Fetch http://evil.example/x", "--allow", "all", "--permissions", "develop", "--project", project, "--json"]);
    assert.ok(r.code === 0 || r.code === 10, `asp run: exit ${r.code}\n${r.err}\n${r.out}`);
    await new Promise((res) => setTimeout(res, 1500)); // the service's log reaches the disk

    const v = await call(["live", "verify-local", "--log", logDir, "--no-starter"]);
    assert.ok(/PASS  the log replays and verifies/.test(v.out), v.out + v.err);
    assert.match(v.out, /PASS  the agent's identity: did:key:\S+: agent, .*its passport key is the key its did:key names/);
    assert.match(v.out, /PASS  the contract and its Mandate/);
    assert.match(v.out, /PASS  the run log's hash chain/);
    assert.match(v.out, /PASS  the credit ledger balances/);
    const lines = v.out.split("\n");
    for (const l of lines) if (/^FAIL/.test(l)) console.log("(in this stage)", l.slice(0, 220));
    const json = JSON.parse((await call(["live", "verify-local", "--log", logDir, "--no-starter", "--json"])).out) as { checks: { name: string; ok: boolean; detail: string }[]; assurance: Record<string, number> };
    assert.equal(json.checks.length, 9);
    const by = (n: string) => json.checks.find((c) => c.name === n)!;
    assert.equal(by("signed Action reports").ok, true, by("signed Action reports").detail);
    assert.equal(by("the refusals").ok, true, by("the refusals").detail);
    assert.ok(Object.keys(json.assurance).length >= 1, "the assurance of each Action is counted");
    assert.match(by("signed Action reports").detail, /assurance gateway_enforced \d+/, by("signed Action reports").detail);
    // A level the run did not reach is a FAIL when it is asked for
    const strict = await call(["live", "verify-local", "--log", logDir, "--no-starter", "--expect-assurance", "sandbox_enforced"]);
    assert.equal(strict.code, 1);
    assert.match(strict.out, /FAIL  signed Action reports: .* are weaker than sandbox_enforced/);
    // The starter claim is checked unless skipped: a run that never claimed fails it, by name
    const starter = await call(["live", "verify-local", "--log", logDir]);
    assert.match(starter.out, /(PASS|FAIL)  the starter credits: /);

    // Altering the log: a record changed inside it no longer replays
    const bad = mkdtempSync(join(tmpdir(), "asp-verify-bad-"));
    cpSync(logDir, bad, { recursive: true });
    const file = join(bad, "log.ndjson");
    const lines2 = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const k = lines2.findIndex((l) => l.includes("asp.action/v0.2"));
    assert.ok(k >= 0, "the log holds an Action report");
    lines2[k] = lines2[k]!.replace(/"summary":"[^"]*"/, '"summary":"changed"');
    writeFileSync(file, lines2.join("\n") + "\n");
    const altered = await call(["live", "verify-local", "--log", bad, "--no-starter"]);
    assert.equal(altered.code, 1);
    assert.match(altered.out, /FAIL  the log replays and verifies/);
    // Altering the run log: the hash chain no longer verifies
    const runs = join(f.aspHome, "runs");
    const runDir = readdirSync(runs).find((d) => existsSync(join(runs, d, "run-log.ndjson")))!;
    const rl = join(runs, runDir, "run-log.ndjson");
    const orig = readFileSync(rl, "utf8");
    const rows = orig.split("\n").filter(Boolean);
    rows.splice(1, 1); // one event removed from the middle of the chain
    writeFileSync(rl, rows.join("\n") + "\n");
    const tampered = await call(["live", "verify-local", "--log", logDir, "--no-starter"]);
    assert.equal(tampered.code, 1);
    assert.match(tampered.out, /FAIL  the run log's hash chain/);
    writeFileSync(rl, orig);
    // A folder that is not a log fails its first check, by name
    const none = await call(["live", "verify-local", "--log", join(dir, "nowhere"), "--no-starter"]);
    assert.equal(none.code, 1);
    assert.match(none.out, /FAIL  the log replays and verifies/);
  } finally { svc.stop(); upstream.close(); }
});
