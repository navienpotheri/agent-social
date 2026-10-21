// ASP Containment Benchmark (ACB) v0.3, suite 7: held-out cases written blind.
// blind-cases.json was written by a separate author (an AI agent) given only a plain description of the Mandates, the scopes and the call shapes: it never saw the gateway's source,
// this benchmark's other cases, or any result. The cases are scored once, here, and not tuned to afterwards: misses are recorded as gaps, not patched to move the number.
//   node evals/benchmark/blind.mjs [--misses] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { judge } from "../../packages/asp-package/src/gateway/judge.ts";
import { MANDATES } from "./cases.mjs";

const fileArg = process.argv.indexOf("--file");
const caseFile = fileArg > 0 ? process.argv[fileArg + 1] : "blind-cases.json";
const cases = JSON.parse(readFileSync(new URL(`./${caseFile}`, import.meta.url), "utf8"));
const systems = {
  "No governance": () => true,
  "Command denylist": (call) => { const cmd = typeof call.args.command === "string" ? call.args.command : Array.isArray(call.args.command) ? call.args.command.join(" ") : (call.args.cmd ?? call.args.CommandLine ?? ""); return !/\b(curl|wget|nc|ncat|ssh|scp|sftp|rsync|telnet|sudo)\b|git push|rm -rf/i.test(String(cmd)); },
  "ASP gateway": (call, m) => judge(call, m.scopes, [], () => false, m.hosts).allow,
};
const rate = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const out = { suite: "blind", cases: cases.length, systems: {} };
const miss = [], wrong = [];
console.log(`=== ASP Containment Benchmark v0.3, suite 7: held-out cases written blind (${cases.length} cases: ${cases.filter((c) => c.expect === "block").length} should be blocked, ${cases.filter((c) => c.expect === "allow").length} allowed) ===`);
for (const [name, f] of Object.entries(systems)) {
  const rows = {};
  for (const c of cases) {
    const m = MANDATES[c.mandate]; if (!m) continue;
    const allowed = f(c.call, m);
    for (const key of ["all", c.level, c.category]) {
      const b = (rows[key] ??= { sb: 0, blocked: 0, sa: 0, wrong: 0 });
      if (c.expect === "block") { b.sb++; if (!allowed) b.blocked++; else if (name === "ASP gateway" && key === "all") miss.push(c); }
      else { b.sa++; if (!allowed) { b.wrong++; if (name === "ASP gateway" && key === "all") wrong.push(c); } }
    }
  }
  out.systems[name] = rows;
  const a = rows.all;
  console.log(`\n${name}\n  all cases   blocked ${a.blocked}/${a.sb} ${rate(a.blocked, a.sb)}   wrongly refused ${a.wrong}/${a.sa} ${rate(a.wrong, a.sa)}`);
  for (const lvl of ["L0", "L1", "L2", "L3"]) if (rows[lvl]) console.log(`  ${lvl}          blocked ${rows[lvl].blocked}/${rows[lvl].sb}   wrongly refused ${rows[lvl].wrong}/${rows[lvl].sa}`);
}
out.aspMisses = miss.map((c) => ({ id: c.id, level: c.level, category: c.category, note: c.note })); out.aspWrongRefusals = wrong.map((c) => ({ id: c.id, note: c.note }));
if (process.argv.includes("--misses")) {
  const show = (c) => `  ${c.id} [${c.level} ${c.category}, ${c.mandate}] ${JSON.stringify(c.call.args).slice(0, 110)}   (${c.note})`;
  console.log("\nASP let through, should have blocked:"); miss.forEach((c) => console.log(show(c)));
  console.log("\nASP wrongly refused:"); wrong.forEach((c) => console.log(show(c)));
}
const j = process.argv.indexOf("--json");
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 2));
