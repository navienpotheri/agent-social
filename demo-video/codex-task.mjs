// The agent for the deeper demo: Codex on a cheap OpenRouter model, started by the gateway under a contract's Mandate.
// The gateway runs:  node demo-video/codex-task.mjs "<task>"   (DEMO_PROJECT and DEMO_MODEL override the folder and model)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const runtime = fileURLToPath(new URL("../packages/asp-cli/src/codex-runtime.mjs", import.meta.url));
const dir = process.env.DEMO_PROJECT ?? (process.platform === "win32" ? "C:/Users/Navie/flaky-app" : `${process.env.HOME}/flaky-app`);
const model = process.env.DEMO_MODEL ?? "openai/gpt-5-mini";
const r = spawnSync(process.execPath, [runtime, dir, model, process.argv[2] ?? "", "workspace-write"], { stdio: "inherit" });
process.exit(r.status ?? 1);
