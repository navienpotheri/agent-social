// ASP Containment Benchmark (ACB) v0.3: runs the suites and writes one results file.
//   node evals/benchmark/run.mjs                          interception + audit + policy (seconds)
//   node evals/benchmark/run.mjs --suite swarm            only the swarm grid (about 2 minutes)
//   node evals/benchmark/run.mjs --all --json out.json    everything, with the combined results written to out.json
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const wanted = val("--suite") ?? (args.includes("--all") ? "all" : "quick");
const suites = { interception: "interception.mjs", audit: "audit.mjs", policy: "policy.mjs", court: "court.mjs", blind: "blind.mjs", chains: "chains.mjs", swarm: "swarm.mjs" };
// injection.mjs (suite 6) and llmjudge.mjs (suite 9) call a real model and cost money, so they are never part of --all: run them on their own.
const chosen = wanted === "all" ? Object.keys(suites) : wanted === "quick" ? ["interception", "audit", "policy", "court", "blind", "chains"] : [wanted];
if (chosen.some((s) => !suites[s])) { console.error(`unknown suite ${wanted}; use interception, audit, policy, swarm, --all`); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), "acb-"));
const combined = { benchmark: "ASP Containment Benchmark v0.3", ranAt: new Date().toISOString(), suites: {} };
for (const s of chosen) {
  const out = join(dir, `${s}.json`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(suites[s], import.meta.url)), "--json", out], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`suite ${s} failed (exit ${r.status})`); process.exit(1); }
  combined.suites[s] = JSON.parse(readFileSync(out, "utf8"));
  console.log("");
}
const out = val("--json");
if (out) { writeFileSync(out, JSON.stringify(combined, null, 2)); console.log(`combined results written to ${out}`); }
