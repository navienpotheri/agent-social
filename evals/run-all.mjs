// Runs the evaluations and prints one table. Usage: node evals/run-all.mjs [fast|models|real|all] [--only name,name] [--list]
//   fast    no model, no account: swarm, self-report-sdk, sandbox-bwrap, sandbox-docker
//   models  an open-weight model on OpenRouter (needs the key): canary-suite, gateway-open-model, gateway-codex, gateway-agents goose|aider|opencode
//   real    real agents on your own logins: canary-gate-claude, gateway-claude-code, gateway-claude-memory, known-bad, service-two-machines, trial-three-jobs
// An evaluation whose prerequisites are missing is skipped, not failed. The exit code is 1 if any evaluation fails.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const GROUPS = {
  fast: [["swarm"], ["self-report-sdk"], ["sandbox-bwrap"], ["sandbox-docker"]],
  models: [["canary-suite"], ["gateway-open-model"], ["gateway-codex"], ["gateway-agents", "goose"], ["gateway-agents", "aider"], ["gateway-agents", "opencode"]],
  real: [["canary-gate-claude"], ["gateway-claude-code"], ["gateway-claude-memory"], ["known-bad"], ["service-two-machines"], ["trial-three-jobs"]],
};
GROUPS.all = [...GROUPS.fast, ...GROUPS.models, ...GROUPS.real];
const args = process.argv.slice(2);
const group = args.find((a) => GROUPS[a]) ?? "fast";
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(",") : undefined;
const list = GROUPS[group].filter(([n, ...rest]) => !only || only.includes([n, ...rest].join(" ")) || only.includes(n));
if (args.includes("--list")) { for (const e of list) console.log(e.join(" ")); process.exit(0); }

const tmp = mkdtempSync(join(tmpdir(), "asp-eval-results-"));
const rows = [];
for (const [name, ...extra] of list) {
  const json = join(tmp, `${name}-${extra.join("-")}.json`);
  const r = spawnSync(process.execPath, [join(here, `${name}.mjs`), ...extra], { stdio: "inherit", env: { ...process.env, ASP_EVAL_JSON: json } });
  const res = existsSync(json) ? JSON.parse(readFileSync(json, "utf8")) : undefined;
  const label = [name, ...extra].join(" ");
  if (res?.skipped) rows.push({ label, result: "skipped", detail: res.skipped });
  else if (!res) rows.push({ label, result: "ERROR", detail: `exit ${r.status}, no result written` });
  else {
    const c = (s) => res.checks.filter((x) => x.status === s).length;
    rows.push({ label, result: c("fail") ? "FAIL" : "pass", detail: `${res.checks.length} checks, ${c("fail")} failed, ${c("inconclusive")} inconclusive, ${c("known-gap")} known gap(s)` });
  }
}
console.log("\n=== summary ===");
const w = Math.max(...rows.map((r) => r.label.length));
for (const r of rows) console.log(`  ${r.result.padEnd(8)} ${r.label.padEnd(w)}  ${r.detail}`);
process.exitCode = rows.some((r) => r.result === "FAIL" || r.result === "ERROR") ? 1 : 0;
