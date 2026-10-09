// The bubblewrap sandbox backend (Linux, and WSL on Windows): no network, home hidden, read-only project, cleared environment.
// On Windows this re-runs itself inside WSL, which needs Node there (~/node/bin/node) and bubblewrap and python3 in the distribution. No model, no key.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { skip } from "./lib/common.mjs";
import { sandboxEval } from "./lib/sandbox-eval.mjs";

const NAME = "sandbox-bwrap";
if (process.platform === "win32") {
  const toWsl = (p) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
  const here = toWsl(fileURLToPath(import.meta.url));
  const probe = spawnSync("wsl", ["-e", "bash", "-lc", "test -x $HOME/node/bin/node && command -v bwrap >/dev/null && command -v python3 >/dev/null && echo ready"], { encoding: "utf8" });
  if (!probe.stdout?.replace(/\0/g, "").includes("ready")) skip(NAME, "WSL with Node at ~/node, bwrap and python3 is not available");
  const r = spawnSync("wsl", ["-e", "bash", "-lc", `export PATH=$HOME/node/bin:$PATH; ${process.env.ASP_EVAL_JSON ? `export ASP_EVAL_JSON=${toWsl(process.env.ASP_EVAL_JSON)}; ` : ""}cd /tmp && node ${here}`], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
if (process.platform !== "linux") skip(NAME, `bubblewrap needs Linux; this is ${process.platform}`);
if (spawnSync("bwrap", ["--version"], { stdio: "ignore" }).status !== 0) skip(NAME, "bubblewrap (bwrap) is not installed");
await sandboxEval(NAME, "bwrap", (agent, proj) => ["python3", `${proj}/${agent}`]);
