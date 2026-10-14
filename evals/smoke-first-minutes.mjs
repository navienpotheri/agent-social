// The first minutes, on whatever machine this runs on, with no account, no model and no network (UC-226, UC-227, UC-02): help, a question in words, a governed local session whose network
// call is refused with how to allow it, and the history. A stand-in model server and a stand-in Claude Code are used, so it can run on any CI machine (Linux, macOS, Windows).
//   node evals/smoke-first-minutes.mjs              the first-minutes checks
//   node evals/smoke-first-minutes.mjs --old-node   on a Node older than 22.18: asp must say so in one clear sentence (UC-02)
// It does not test the Google sign-in or a real agent; those are tried by hand (docs/live-run-clean-install.md). Plain JavaScript on purpose: it has to load on an old Node too.
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ASP = resolve(here, "../packages/asp-cli/bin/asp.mjs");
const FAKE_CLAUDE = resolve(here, "../packages/asp-cli/test/fake-claude-gateway.mjs");
const oldNode = process.argv.includes("--old-node");

const run = (args, env = {}) => new Promise((done) => {
  execFile(process.execPath, [...(oldNode ? [] : ["--experimental-strip-types"]), ASP, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000, windowsHide: true },
    (err, stdout, stderr) => done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout ?? "", err: stderr ?? "" }));
});

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${String(detail).split("\n").slice(0, 12).join("\n      ")}`}`); if (!ok) failed++; };

if (oldNode) {
  const r = await run(["help"]);
  const text = r.out + r.err;
  check(`Node ${process.versions.node}: asp stops with a clear message, not a stack trace`, r.code === 1 && /asp needs Node 22\.18 or newer/.test(text) && /nodejs\.org/.test(text) && !/Unknown file extension/.test(text), text);
  process.exit(failed ? 1 : 0);
}

const home = mkdtempSync(join(tmpdir(), "asp-smoke-"));
const project = join(home, "project");
mkdirSync(project, { recursive: true });
const env = { ASP_HOME: home, ASP_NO_FOCUS: "1" };

const help = await run(["help"], env);
check("asp help prints the everyday commands and the topics", help.code === 0 && /Agent Social help/.test(help.out) && /asp join/.test(help.out) && /asp run claude-code/.test(help.out), help.out + help.err);

const ask = await run(["ask", "how do I stop a session"], env);
check("asp ask answers a question in words, with the command, and does not run it", ask.code === 0 && /asp stop/.test(ask.out), ask.out + ask.err);

// The stand-in model answers every request with one tool call: a network fetch, which the session's Mandate does not allow.
const upstream = createServer(async (req, res) => {
  for await (const _ of req) { /* not inspected */ }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Fetching." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "curl -s https://example.com" } }] }));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upUrl = `http://127.0.0.1:${upstream.address().port}`;
try {
  const session = await run(["run", "claude-code", "--local", "--prompt", "Fetch it", "--project", project], { ...env, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: FAKE_CLAUDE, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl });
  const text = session.out + "\n" + session.err;
  check("a local session runs and finishes (no account, no service)", session.code === 0 && /Session summary[\s\S]*finished/.test(text), text);
  check("the network call is refused before the agent sees it", /refused\s+Bash -> shell\.network/.test(text) && !/tool_use:Bash/.test(text), text);
  check("the refusal says how to allow it, with the host", /to allow\s+this session has no network/.test(text) && /--allow-network example\.com/.test(text), text);
  const runs = await run(["runs"], { ...env, ASP_HOME: join(home, "local") });
  check("asp runs lists the session and what was refused", runs.code === 0 && /claude-code\s+ended\s+1 calls, 1 refused/.test(runs.out), runs.out + runs.err);
} finally { upstream.close(); }

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
