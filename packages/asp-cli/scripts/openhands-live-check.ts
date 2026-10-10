/**
 * Live check against the installed OpenHands, with no LLM call: materializes a Claude Code agent for
 * OpenHands and runs the real generated launch.sh (in WSL on Windows), with openhands replaced by
 * scripts/openhands-probe.py running on OpenHands' own Python. The probe builds the agent context the
 * way the OpenHands CLI does and reports what the model would see.
 *
 *   node packages/asp-cli/scripts/openhands-live-check.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openhands, toWslPath, type Harness } from "@agent-social/asp-package";
import { main } from "../src/cli.ts";
import { makeFixture } from "../test/fixture.ts";

const win = process.platform === "win32";
const lx = win ? toWslPath : (p: string) => p;
const sh = (cmd: string) => (win ? spawnSync("wsl.exe", ["--", "bash", "-lc", cmd], { encoding: "utf8" }) : spawnSync("bash", ["-lc", cmd], { encoding: "utf8" }));
const wslHome = sh("echo $HOME").stdout.trim() || homedir();
const python = `${wslHome}/.local/share/uv/tools/openhands/bin/python`;
const probe = lx(fileURLToPath(new URL("./openhands-probe.py", import.meta.url)));

const f = makeFixture();
const io = { out: () => {}, err: (l: string) => console.error(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
await main(["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:check"], io);
await main(["identity", "new", "--kind", "agent", "--did", "did:web:example.com:agents:check-coder", "--sponsor", "did:web:example.com:users:check"], io);
const pkg = join(f.root, "check.aspkg");
if (await main(["pack", "--runtime", "claude-code", "--agent", "did:web:example.com:agents:check-coder", "--project", f.project, "--user-home", f.home, "--out", pkg], io)) process.exit(1);

// ~/.asp/runs lives under the Windows home; the probe checks HOME contains "/runs/".
const runDir = join(mkdtempSync(join(tmpdir(), "asp-oh-")), "runs", "check");
const plan = await openhands.materialize({
  pkgDir: pkg, harness: JSON.parse(readFileSync(join(pkg, "harness", "harness.json"), "utf8")) as Harness,
  project: f.project, runDir, agentName: "check-coder", sourceRuntime: "claude-code",
  env: { ...process.env, GITHUB_TOKEN: "probe-token", API_BASE: "x", ASP_OPENHANDS_CMD: `${python} ${probe}` },
});
const r = spawnSync(plan.command, plan.args, { cwd: plan.cwd, env: { ...process.env, ...plan.env }, encoding: "utf8" });
const line = (r.stdout + r.stderr).split("\n").find((l) => l.startsWith("ASP-PROBE "));
if (!line) { console.error(r.stdout, r.stderr); process.exit(1); }
const report = JSON.parse(line.slice("ASP-PROBE ".length)) as Record<string, boolean>;
for (const [name, ok] of Object.entries(report)) console.log(`${ok ? "PASS" : "FAIL"}  ${name.replace(/_/g, " ")}`);
process.exit(Object.values(report).every(Boolean) ? 0 : 1);
