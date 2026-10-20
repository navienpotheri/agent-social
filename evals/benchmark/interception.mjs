// ASP Containment Benchmark (ACB) v0.2, suite 1: interception. No model, no account, no network: it asks the gateway's own judge about every case.
//   node evals/benchmark/interception.mjs            prints the tables
//   node evals/benchmark/interception.mjs --json out.json   also writes the results
import { writeFileSync } from "node:fs";
import { judge } from "../../packages/asp-package/src/gateway/judge.ts";
import { CASES, MANDATES } from "./cases.mjs";

// What we compare against.
const systems = {
  "No governance": () => true,
  // A typical command denylist: it looks only at shell command text and has no idea what a Mandate grants or which hosts are allowed.
  "Command denylist": (call) => {
    const cmd = typeof call.args.command === "string" ? call.args.command : "";
    return !/\b(curl|wget|nc|ncat|ssh|scp|sftp|rsync|telnet|sudo)\b|git push|rm -rf/i.test(cmd);
  },
  "ASP gateway": (call, mandate) => judge(call, mandate.scopes, [], () => false, mandate.hosts).allow,
};

const should = (k) => CASES.filter((x) => x.expect === k);
const rate = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const results = { suite: "interception", benchmark: "ASP Containment Benchmark v0.2", cases: CASES.length, systems: {} };

for (const [name, allow] of Object.entries(systems)) {
  const rows = {};
  const bucket = (key) => (rows[key] ??= { block: 0, shouldBlock: 0, wrongRefusal: 0, shouldAllow: 0, misses: [], falseRefusals: [] });
  for (const k of CASES) {
    const allowed = allow(k.call, MANDATES[k.mandate]);
    for (const key of ["all", `L${k.level}`, k.category]) {
      const b = bucket(key);
      if (k.expect === "block") { b.shouldBlock++; if (!allowed) b.block++; else b.misses.push(k); }
      else { b.shouldAllow++; if (!allowed) { b.wrongRefusal++; b.falseRefusals.push(k); } }
    }
  }
  results.systems[name] = rows;
}

const line = (label, b) => `  ${label.padEnd(30)} blocked ${String(b.block).padStart(3)}/${String(b.shouldBlock).padEnd(3)} ${rate(b.block, b.shouldBlock).padStart(5)}   wrongly refused ${String(b.wrongRefusal).padStart(2)}/${String(b.shouldAllow).padEnd(3)} ${rate(b.wrongRefusal, b.shouldAllow).padStart(5)}`;
console.log(`=== ${results.benchmark}: ${CASES.length} cases (${should("block").length} should be blocked, ${should("allow").length} should be allowed) ===`);
for (const [name, rows] of Object.entries(results.systems)) {
  console.log(`\n${name}`);
  console.log(line("all cases", rows.all));
  for (const lvl of ["L1", "L2", "L3"]) if (rows[lvl]) console.log(line(`${lvl} ${{ L1: "plain violation", L2: "disguised violation", L3: "needs a sandbox" }[lvl]}`, rows[lvl]));
  if (rows.benign || rows.lookalike) { const b = { block: 0, shouldBlock: 0, wrongRefusal: (rows.benign?.wrongRefusal ?? 0) + (rows.lookalike?.wrongRefusal ?? 0), shouldAllow: (rows.benign?.shouldAllow ?? 0) + (rows.lookalike?.shouldAllow ?? 0) }; console.log(line("ordinary work (false refusals)", b)); }
}

const asp = results.systems["ASP gateway"];
console.log("\nBy category (blocked of should-block, or wrongly refused of should-allow)");
const cats = [...new Set(CASES.map((k) => k.category))];
console.log(`  ${"category".padEnd(16)} ${"No governance".padEnd(16)} ${"Command denylist".padEnd(18)} ASP gateway`);
const cell = (sys, cat) => { const b = results.systems[sys][cat]; return b.shouldBlock ? `${b.block}/${b.shouldBlock}` : `${b.wrongRefusal} wrong/${b.shouldAllow}`; };
for (const cat of cats) console.log(`  ${cat.padEnd(16)} ${cell("No governance", cat).padEnd(16)} ${cell("Command denylist", cat).padEnd(18)} ${cell("ASP gateway", cat)}`);
const showLists = process.argv.includes("--misses");
if (showLists) console.log("\nASP gateway: calls it let through that it should have blocked");
if (showLists) for (const k of asp.all.misses) console.log(`  L${k.level} ${k.id}: ${typeof k.call.args.command === "string" ? k.call.args.command : JSON.stringify(k.call.args)}${k.note ? `   (${k.note})` : ""}`);
console.log("\nASP gateway: ordinary work it wrongly refused");
for (const k of asp.all.falseRefusals) console.log(`  ${k.id}: ${typeof k.call.args.command === "string" ? k.call.args.command : JSON.stringify(k.call.args)}${k.note ? `   (${k.note})` : ""}`);

// How long one decision takes.
const N = 50;
const times = [];
for (let r = 0; r < N; r++) for (const k of CASES) { const t = process.hrtime.bigint(); systems["ASP gateway"](k.call, MANDATES[k.mandate]); times.push(Number(process.hrtime.bigint() - t) / 1000); }
times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
results.decisionMicroseconds = { median: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), p99: +pct(0.99).toFixed(1), samples: times.length };
console.log(`\nOne decision takes ${results.decisionMicroseconds.median} microseconds (median), ${results.decisionMicroseconds.p95} (95th percentile) over ${times.length} calls.`);

results.aspMisses = asp.all.misses.map((k) => ({ id: k.id, level: k.level, category: k.category, note: k.note }));
results.aspWrongRefusals = asp.all.falseRefusals.map((k) => ({ id: k.id, note: k.note }));
const json = process.argv.indexOf("--json");
if (json > 0) { writeFileSync(process.argv[json + 1], JSON.stringify({ ...results, systems: Object.fromEntries(Object.entries(results.systems).map(([n, rows]) => [n, Object.fromEntries(Object.entries(rows).map(([k, b]) => [k, { blocked: b.block, shouldBlock: b.shouldBlock, wronglyRefused: b.wrongRefusal, shouldAllow: b.shouldAllow }]))])) }, null, 2)); console.log(`results written to ${process.argv[json + 1]}`); }
