// Dissects a long-horizon run (evals/long-horizon.mjs) into a report: liveness, cost, governance, integrity, outcome and a timeline of the worst stage. Reads files only; it changes nothing
// and prints nothing secret. Writes <out>/report.md and prints it.
//   node evals/long-horizon-report.mjs [--run <the run's log dir>] [--home <ASP_HOME>] [--project <dir>] [--out <dir>]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { readRunLog } from "../packages/asp-package/src/index.ts";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const RUN = resolve(arg("run", join(homedir(), "asp-long-run")));
const HOME = resolve(arg("home", process.env.ASP_HOME ?? join(homedir(), ".asp")));
const PROJECT = resolve(arg("project", join(homedir(), "asp-long-project")));
const OUT = resolve(arg("out", RUN));

const results = JSON.parse(readFileSync(join(RUN, "results.json"), "utf8"));
const samples = readFileSync(join(RUN, "samples.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const runLines = readFileSync(join(RUN, "run.log"), "utf8").split("\n");
const startedAt = Date.parse(runLines[0].split(" ")[0]);
const endedAt = Date.parse(samples.at(-1).at);

// The sessions of this run: from the ASP home's session index, inside the run's time window.
const index = existsSync(join(HOME, "runs.ndjson")) ? readFileSync(join(HOME, "runs.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const starts = index.filter((r) => r.t === "start" && Date.parse(r.at) >= startedAt - 5000 && Date.parse(r.at) <= endedAt + 5000);
const ends = new Map(index.filter((r) => r.t === "end").map((r) => [r.sid, r]));

// Each session's run log: recorded in the session's end record (S114), else the gateway folder whose first event matches the session's start time.
const runDirs = existsSync(join(HOME, "runs")) ? readdirSync(join(HOME, "runs")).filter((d) => existsSync(join(HOME, "runs", d, "run-log.ndjson"))) : [];
const logOf = (s) => {
  const rec = ends.get(s.sid)?.runLog;
  if (rec && existsSync(rec)) return rec;
  let best, gap = Infinity;
  for (const d of runDirs) {
    const f = join(HOME, "runs", d, "run-log.ndjson");
    const first = readFileSync(f, "utf8").split("\n", 1)[0];
    try { const e = JSON.parse(first); const g = Math.abs(Date.parse(e.at) - Date.parse(s.at)); if (g < gap && g < 20_000) { gap = g; best = f; } } catch { /* not a run log */ }
  }
  return best;
};

const rows = [];
const scopeCounts = {};
const refusals = {};
let gated = 0, gatedNoAnswer = 0, gatedRefused = 0, gatedSkipped = 0;
let chainsOk = 0, chainsBad = 0, totalEvents = 0, tokensIn = 0, tokensOut = 0;
for (const s of starts) {
  const file = logOf(s);
  const check = file ? readRunLog(file) : undefined;
  if (check?.ok) chainsOk++; else chainsBad++;
  const ev = check?.events ?? [];
  totalEvents += ev.length;
  let calls = 0, refused = 0;
  for (const e of ev) {
    const d = e.data ?? {};
    if (e.kind === "model_reply") { tokensIn += d.tokens_in ?? 0; tokensOut += d.tokens_out ?? 0; }
    if (e.kind !== "tool_call") continue;
    calls++;
    const sc = d.scope || "(no scope)";
    scopeCounts[sc] ??= { allowed: 0, refused: 0 };
    if (d.allowed === false) { refused++; scopeCounts[sc].refused++; const why = String(d.reason ?? "").replace(/^the scope \S+ /, "").replace(/\d+ seconds/, "N seconds").slice(0, 90); refusals[why] = (refusals[why] ?? 0) + 1; } else scopeCounts[sc].allowed++;
    if (d.gated) { gated++; if (/no answer/.test(d.reason ?? "")) gatedNoAnswer++; else if (d.allowed === false) gatedRefused++; }
    if (d.gate_skipped) gatedSkipped++;
  }
  const t0 = Date.parse(s.at), t1 = ends.get(s.sid) ? Date.parse(ends.get(s.sid).at) : t0;
  rows.push({ sid: s.sid, at: s.at, secs: Math.round((t1 - t0) / 1000), state: ends.get(s.sid)?.state ?? "no end", calls, refused, events: ev.length, chain: check ? (check.ok ? "ok" : "BROKEN") : "no log", purpose: s.purpose.slice(0, 48), file });
}

// Records and bytes: first and last sample, and per hour.
const first = samples[0], last = samples.at(-1);
const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000;
const grown = last.records - first.records;
const callsTotal = rows.reduce((n, r) => n + r.calls, 0);
const perCall = callsTotal ? grown / callsTotal : 0;

// The product: run its own tests.
let outcome = "no project folder";
if (existsSync(PROJECT)) {
  const files = spawnSync(process.execPath, ["-e", "const fs=require('fs'),p=require('path');const w=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.name==='__pycache__'||e.name==='.git'?[]:e.isDirectory()?w(p.join(d,e.name)):[p.join(d,e.name)]);console.log(w(process.argv[1]).length)", PROJECT], { encoding: "utf8" }).stdout.trim();
  const t = spawnSync("python", ["-m", "unittest", "discover", "-s", "tests", "-q"], { cwd: PROJECT, encoding: "utf8", timeout: 60_000 });
  const tail = ((t.stderr ?? "") + (t.stdout ?? "")).trim().split("\n").slice(-3).join(" | ");
  outcome = `${files} files; unit tests ${t.status === 0 ? "PASS" : t.status === null ? "could not run (python missing?)" : "FAIL"}: ${tail.slice(0, 200)}`;
}

// The worst stage, as a timeline.
const worst = [...rows].sort((a, b) => b.secs - a.secs)[0];
const timeline = [];
if (worst?.file) for (const e of readRunLog(worst.file).events) {
  if (!["tool_call", "run_start", "run_end", "stopped", "kill"].includes(e.kind)) continue;
  const d = e.data ?? {};
  timeline.push(`${e.at.slice(11, 19)}  ${e.kind.padEnd(9)} ${e.kind === "tool_call" ? `${d.allowed === false ? "REFUSED" : "allowed"}${d.gated ? " [gated]" : ""} ${d.scope ?? ""}: ${String(d.input ?? "").replace(/\s+/g, " ").slice(0, 70)}${d.reason ? ` (${String(d.reason).slice(0, 50)})` : ""}` : ""}`);
}

const md = [];
md.push(`# Long-horizon run report`, ``, `Run window ${new Date(startedAt).toISOString()} to ${new Date(endedAt).toISOString()} (${hours.toFixed(2)} h); ${results.results.length} stages; ${rows.length} sessions found in the ASP home.`, ``);
md.push(`## 1. Liveness`, ``, `- Stages ended exit 0: ${results.results.filter((r) => r.code === 0).length} of ${results.results.length}.`, `- Samples reachable: ${samples.filter((s) => s.reachable).length} of ${samples.length}.`,
  `- The driver's memory: ${Math.min(...samples.map((s) => s.memoryMB))} to ${Math.max(...samples.map((s) => s.memoryMB))} MB.`, `- Longest session: ${worst?.secs ?? 0} s (${worst?.purpose ?? "-"}).`, ``);
md.push(`## 2. Cost`, ``, `| Measure | Value |`, `|---|---|`, `| Tool calls judged | ${callsTotal} |`, `| Tokens (in / out) | ${tokensIn} / ${tokensOut} |`, `| Records written | ${first.records} to ${last.records} (+${grown}) |`,
  `| Records per tool call | ${perCall.toFixed(2)} |`, `| Records per hour | ${hours ? (grown / hours).toFixed(1) : "-"} |`, `| Bytes | ${first.bytes} to ${last.bytes} |`, `| At this rate, a 2000-record quota lasts | ${perCall ? Math.round(2000 / perCall) : "-"} tool calls |`, ``);
md.push(`## 3. Governance`, ``, `| Scope | Allowed | Refused |`, `|---|---|---|`, ...Object.entries(scopeCounts).sort().map(([k, v]) => `| ${k} | ${v.allowed} | ${v.refused} |`), ``,
  `Gated approvals asked: ${gated} (no answer: ${gatedNoAnswer}, refused by the person: ${gatedRefused}); gated calls skipped by a pattern or "always": ${gatedSkipped}.`, ``, `Refusal reasons:`, ...Object.entries(refusals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${v}x ${k}`), ``);
md.push(`## 4. Integrity`, ``, `- Run-log hash chains: ${chainsOk} verify, ${chainsBad} do not (or are missing). ${totalEvents} events in all.`, `- The records on the service can be replayed independently: \`asp account export\` then \`asp log verify --full\` on an import (docs/testing-map.md UC-43).`, ``);
md.push(`## 5. Outcome`, ``, `- Product: ${outcome}`, ``);
md.push(`## 6. Per session`, ``, `| Session | Started | Secs | State | Calls | Refused | Events | Chain | Task |`, `|---|---|---|---|---|---|---|---|---|`, ...rows.map((r) => `| ${r.sid} | ${r.at.slice(11, 19)} | ${r.secs} | ${r.state} | ${r.calls} | ${r.refused} | ${r.events} | ${r.chain} | ${r.purpose} |`), ``);
md.push(`## 7. Timeline of the longest session`, ``, "```", ...timeline.slice(0, 40), timeline.length > 40 ? `... ${timeline.length - 40} more events` : "", "```", ``);
md.push(`## What this run cannot tell you`, ``, `One session running continuously for hours; the Mandate expiring mid-run; a laptop sleeping; an approval answered live from another window; more than one agent at a time.`, ``);
const text = md.join("\n");
writeFileSync(join(OUT, "report.md"), text);
console.log(text);
