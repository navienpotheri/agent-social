// Starts OpenClaw or Hermes Agent under the gateway: node gateway-agent-runtime.mjs <openclaw|hermes> <project> <model> <prompt>. The tool is pointed at the gateway (ASP_GATEWAY_URL, set by `asp gateway`
// for the command it runs) with a placeholder key, in a private home for the run, so the person's own configuration is not touched. ASP_OPENCLAW_BIN / ASP_HERMES_BIN name the executable (a script ending
// in .mjs is run with node).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { gatewayAgentPlan } from "@agent-social/asp-package";

const [runtime, project, model, prompt] = process.argv.slice(2);
const runHome = mkdtempSync(join(tmpdir(), `asp-${runtime}-`));
const plan = gatewayAgentPlan(runtime, { gatewayUrl: process.env.ASP_GATEWAY_URL, model, prompt, project, runHome });
if (!plan) { console.error(`asp: no launch plan for ${runtime}`); process.exit(2); }
for (const f of plan.files) { mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.content, { mode: 0o600 }); }
const bin = process.env[`ASP_${runtime.toUpperCase()}_BIN`] ?? plan.command.bin;
const env = { ...process.env, ...plan.env };
const r = bin.endsWith(".mjs") ? spawnSync(process.execPath, [bin, ...plan.command.args], { stdio: "inherit", cwd: project, env }) : spawnSync(bin, plan.command.args, { stdio: "inherit", cwd: project, env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
