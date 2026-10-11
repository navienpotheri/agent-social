// Starts the real Codex under the gateway: node codex-runtime.mjs <project> <model|-> <prompt> [read-only|workspace-write]. Codex is pointed at the gateway (ASP_GATEWAY_URL, set by
// `asp gateway` for the command it runs) as a Responses-API provider; "-" for the model leaves Codex's own default. On Windows the npm shim mangles quoted arguments, so Codex's own
// JavaScript entry point is run directly when it is there. ASP_CODEX_BIN names a script to run instead (the tests' stand-in).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const [project, model, prompt, sandbox = "read-only"] = process.argv.slice(2);
const gateway = `${process.env.ASP_GATEWAY_URL}/v1`;
const args = ["exec", "--skip-git-repo-check", "-C", project, "-s", sandbox, ...(model && model !== "-" ? ["-m", model] : []),
  "-c", "model_provider=asp_open", "-c", "model_providers.asp_open.name=ASP", "-c", `model_providers.asp_open.base_url=${JSON.stringify(gateway)}`,
  "-c", "model_providers.asp_open.wire_api=responses", "-c", "model_providers.asp_open.env_key=OPENAI_API_KEY", prompt];
if (process.env.ASP_CODEX_BIN) {
  const r = spawnSync(process.execPath, [process.env.ASP_CODEX_BIN, ...args], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
const js = [`${process.env.APPDATA ?? homedir()}/npm/node_modules/@openai/codex/bin/codex.js`].find((p) => existsSync(p));
const r = js ? spawnSync(process.execPath, [js, ...args], { stdio: "inherit" }) : spawnSync("codex", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
