// ASP Containment Benchmark (ACB) v0.3, suite 10: replay of real traces.
// Reads the gateway run logs of real sessions (Claude Code, Codex, Antigravity, an open-weight model) from evals/benchmark/traces-private/ (git-ignored: they hold prompts and account ids),
// takes every tool call the agent really made and the Mandate its job really held, and asks the CURRENT judge about it. The log also holds the verdict the judge gave at the time.
// What it shows: how often ordinary real work is refused (the false-refusal rate on real traffic, not on our own examples), and which calls the newer judge decides differently from the one that was running.
// Nothing from the logs except tool names, commands and verdicts is printed or written to the results file.
//   node evals/benchmark/replay.mjs [--dir <runs dir>] [--show] [--json out.json]
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judge } from "../../packages/asp-package/src/gateway/judge.ts";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("--dir", new URL("./traces-private/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const runsDir = existsSync(join(base, "runs")) ? join(base, "runs") : base;
if (!existsSync(runsDir)) { console.error(`no traces at ${runsDir}`); process.exit(2); }

const rows = [];
let runs = 0;
for (const d of readdirSync(runsDir)) {
  const f = join(runsDir, d, "run-log.ndjson");
  if (!existsSync(f)) continue;
  const events = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const start = events.find((e) => e.kind === "run_start");
  if (!start) continue;
  runs++;
  const scopes = start.data.scopes ?? [];
  const hosts = start.data.hosts;
  const runtime = /claude/.test(String(start.data.command ?? "")) ? "claude-code" : /codex/.test(String(start.data.command ?? "")) ? "codex" : /agy|antigravity/.test(String(start.data.command ?? "")) ? "antigravity" : "other";
  for (const e of events.filter((x) => x.kind === "tool_call")) {
    const input = e.data.input;
    const args = typeof input === "string" ? { command: input } : (input && typeof input === "object" ? input : {});
    const call = { name: String(e.data.tool ?? ""), args };
    const now = judge(call, scopes, [], () => false, hosts);
    rows.push({ runtime, tool: call.name, command: typeof input === "string" ? input : JSON.stringify(input ?? {}), recordedAllowed: e.data.allowed === true, nowAllowed: now.allow, recordedScope: e.data.scope, nowScope: now.scope, mandate: scopes.join("+") });
  }
}

const tot = rows.length;
// The logged "allowed" also reflects approval gates and stops, so the fair comparison is the scope each judge gave the call, and whether the current judge would refuse it.
const refusedNow = rows.filter((r) => !r.nowAllowed);
const scopeChanged = rows.filter((r) => r.recordedScope && r.recordedScope !== r.nowScope);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
console.log(`=== ASP Containment Benchmark v0.3, suite 10: replay of real traces (${runs} real runs, ${tot} tool calls) ===`);
const byRt = {}; rows.forEach((r) => { byRt[r.runtime] = (byRt[r.runtime] ?? 0) + 1; });
console.log(`  calls by agent: ${Object.entries(byRt).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`  the current judge would allow ${tot - refusedNow.length}/${tot} (${pct(tot - refusedNow.length, tot)}) and refuse ${refusedNow.length}`);
console.log(`  it gives a different scope from the one logged at the time on ${scopeChanged.length}/${rows.filter((r) => r.recordedScope).length} calls`);
const show = process.argv.includes("--show");
const line = (r) => `    [${r.runtime}] ${r.tool}: ${r.command.slice(0, 150).replace(/\s+/g, " ")}   (logged scope ${r.recordedScope ?? "none"}, now ${r.nowScope}; mandate ${r.mandate})`;
console.log("\n  Refused now:"); refusedNow.forEach((r) => console.log(line(r)));
if (scopeChanged.length) { console.log("\n  Scope differs from the logged one:"); scopeChanged.forEach((r) => console.log(line(r))); }
if (show) { console.log("\n  Every call:"); rows.forEach((r) => console.log(line(r))); }
const j = process.argv.indexOf("--json");
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify({ suite: "replay", runs, calls: tot, byAgent: byRt, allowedNow: tot - refusedNow.length, refusedNow: refusedNow.map((r) => ({ tool: r.tool, command: r.command.slice(0, 200) })), scopeChanged: scopeChanged.length }, null, 2));
