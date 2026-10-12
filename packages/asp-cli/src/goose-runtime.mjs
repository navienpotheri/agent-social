// Starts Goose under the gateway: node goose-runtime.mjs <project> <model> <prompt>. Goose is pointed at the gateway (ASP_GATEWAY_URL, set by `asp gateway` for the command it runs) as an
// OpenAI-compatible host; its developer extension (shell and file edits) is on. ASP_GOOSE_BIN names the executable (default: goose on the PATH; a script is run with node when it ends in .mjs).
import { spawnSync } from "node:child_process";

const [project, model, prompt] = process.argv.slice(2);
const bin = process.env.ASP_GOOSE_BIN ?? "goose";
const args = ["run", "--with-builtin", "developer", "-t", prompt];
const env = { ...process.env, GOOSE_PROVIDER: "openai", GOOSE_MODEL: model, OPENAI_HOST: process.env.ASP_GATEWAY_URL, OPENAI_BASE_PATH: "v1/chat/completions", GOOSE_DISABLE_KEYRING: "1" };
const r = bin.endsWith(".mjs") ? spawnSync(process.execPath, [bin, ...args], { stdio: "inherit", cwd: project, env }) : spawnSync(bin, args, { stdio: "inherit", cwd: project, env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
