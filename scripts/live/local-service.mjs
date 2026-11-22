// A throwaway log service on this machine for the live runs (the owner's P0 of 2026-11-22): `node scripts/live/local-service.mjs start|stop|status [--dir <dir>] [--port 8787] [--pow-bits 12]`.
// `scripts/live-local-service.ps1` is the PowerShell wrapper the owner runs. Nothing here is the hosted service and nothing is shared: the log lives in <dir>/db, the operator and owner keys in <dir>/operator-keys, and
// the service listens on 127.0.0.1 only. What it sets up, and why each part is needed (a run without one fails in the way the test shows):
//   - key-only sign-up ON (`--signup`, no Google required), so `asp enrol` works and a sponsored tenant can be made with `asp signup` and `asp join --token-env`;
//   - the operator and the owner named (ASP_OPERATOR_DID, ASP_OWNER_DID) as two identities of this service, so credits are minted as SIGNED records (no unsigned-mint refusal);
//   - the starter pool funded by a signed mint of the operator, cosigned by the owner, so a new agent's starter credits are granted (otherwise: "the starter pool is full right now");
//   - the throwaway database under <dir>/db, so a real run never touches the hosted service or the owner's own home.
// Credits are accounting entries, not money. No key, token or recovery code is printed except the throwaway admin token, which is only in <dir>/ops-token.txt.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(repo, "packages", "asp-cli", "src", "cli.ts");
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "start";
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dir = resolve(flag("dir", join(homedir(), "asp-live-local")));
const port = Number(flag("port", "8787"));
const bits = flag("pow-bits", "12");
const url = `http://127.0.0.1:${port}`;
const state = join(dir, "service.json");
const say = (l = "") => console.log(l);

const asp = (args, env = {}) => {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`asp ${args[0]} ${args[1] ?? ""} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")}`);
  return r.stdout;
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readState = () => { try { return JSON.parse(readFileSync(state, "utf8")); } catch { return undefined; } };

async function listening(logFile, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const t = readFileSync(logFile, "utf8"); if (/listening on http/.test(t)) return t; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the service did not start in ${timeoutMs / 1000} s; see ${logFile}`);
}
function serve(extraEnv, logFile) {
  const out = openSync(logFile, "w");
  const child = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "db")}`, "--tokens", join(dir, "tokens.json"), "--host", "127.0.0.1", "--port", String(port),
    "--signup", "--signup-terms-url", `${url}/terms`, "--signup-difficulty", bits, "--did-domain", `127.0.0.1:${port}`, "--starter-pool", "100000", "--allow-plain-http", "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"],
  { detached: true, stdio: ["ignore", out, out], windowsHide: true, env: { ...process.env, ...extraEnv } });
  child.unref();
  return child;
}
const stopPid = (pid) => { try { process.kill(pid); } catch { /* gone */ } };

async function start() {
  const running = readState();
  if (running && alive(running.pid)) { say(`already running on ${running.url} (pid ${running.pid}); stop it with: node scripts/live/local-service.mjs stop`); printHow(running.url); return 0; }
  mkdirSync(dir, { recursive: true });
  const keys = join(dir, "operator-keys");
  const tokens = join(dir, "tokens.json");
  const opEnv = { ASP_HOME: keys };
  const OP = `did:web:127.0.0.1%3A${port}:u:operator`, OW = `did:web:127.0.0.1%3A${port}:u:owner`;
  const first = !existsSync(tokens);
  if (first) {
    const t = asp(["serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"]).split("\n").map((l) => l.trim()).find((l) => /^[A-Za-z0-9_-]{30,}$/.test(l));
    if (!t) throw new Error("could not read the admin token");
    writeFileSync(join(dir, "ops-token.txt"), t + "\n", { mode: 0o600 });
    asp(["serve", "starter", "--tokens", tokens, "--starter-pool", "100000"]);
    // Step 1: the service with no operator yet, so that the operator's and the owner's identities can be written to it; step 2: the same service, now naming them.
    say("making the operator and owner identities (throwaway, on this machine) ...");
    const log1 = join(dir, "service-setup.log");
    const s1 = serve({}, log1);
    try {
      await listening(log1);
      const env = { ...opEnv, ASP_LOG_URL: url, ASP_LOG_TOKEN: t };
      for (const d of [OP, OW]) asp(["identity", "new", "--kind", "human", "--did", d, "--no-recovery"], env);
    } finally { stopPid(s1.pid); await new Promise((r) => setTimeout(r, 1500)); }
  }
  const token = readFileSync(join(dir, "ops-token.txt"), "utf8").trim();
  const logFile = join(dir, "service.log");
  const child = serve({ ASP_OPERATOR_DID: OP, ASP_OWNER_DID: OW }, logFile);
  await listening(logFile);
  if (first) {
    asp(["credits", "grant", "--to", "did:web:asp.local:starter-pool", "--amount", "100000", "--by", OP, "--reason", "treasury_issuance", "--cosign-by", OW], { ...opEnv, ASP_LOG_URL: url, ASP_LOG_TOKEN: token, ASP_OPERATOR_DID: OP });
  }
  writeFileSync(state, JSON.stringify({ pid: child.pid, url, port, dir, startedAt: new Date().toISOString() }, null, 2) + "\n");
  say(`the local service is running on ${url} (pid ${child.pid}); the log is in ${join(dir, "db")}`);
  printHow(url);
  return 0;
}
function printHow(u) {
  say();
  say("In another PowerShell window, from the repository folder (a fresh ASP_HOME for each agent keeps them apart):");
  say("  # the key-only agent: no person, no browser");
  say(`  $env:ASP_HOME = "$HOME\\asp-live-local\\agent-keyonly"`);
  say(`  npm run asp -- enrol --service ${u} --name live-keyonly-1 --accept-terms`);
  say(`  $env:ANTHROPIC_API_KEY = "<your key>"`);
  say(`  npm run asp -- run claude-code --project <a scratch folder> --prompt "<a small task>" --model claude-haiku-5-5 --budget-usd 3`);
  say("  npm run asp -- runs ; npm run asp -- live report ; npm run asp -- account show");
  say("  # the sponsored agent: a person behind it (a tenant signed up with the form, no Google, no browser)");
  say(`  $env:ASP_HOME = "$HOME\asp-live-local\agent-sponsored"`);
  say(`  npm run asp -- signup --service ${u} --name live-sponsor-1 --accept-terms      # prints a token once; copy it into the next line`);
  say(`  $env:SPONSOR_TOKEN = "<that token>"`);
  say(`  npm run asp -- join --service ${u} --token-env SPONSOR_TOKEN --yes --agent-name sponsored-1     # shows the recovery code once: write it down`);
  say(`  npm run asp -- run claude-code --project <a scratch folder> --prompt "<the same small task>" --model claude-haiku-5-5 --budget-usd 3`);
  say();
  say("To stop the service: node scripts/live/local-service.mjs stop   (or .\\scripts\\live-local-service.ps1 -Stop). To start again from nothing: delete the folder " + dir + ".");
}
function stop() {
  const s = readState();
  if (!s) { say("no local service is recorded here"); return 0; }
  if (alive(s.pid)) { stopPid(s.pid); say(`stopped the local service (pid ${s.pid})`); } else say("the local service was not running");
  rmSync(state, { force: true });
  return 0;
}
function status() {
  const s = readState();
  say(s && alive(s.pid) ? `running on ${s.url} (pid ${s.pid})` : "not running");
  return 0;
}

try {
  process.exitCode = cmd === "stop" ? stop() : cmd === "status" ? status() : await start();
} catch (e) { console.error(`error: ${e.message}`); process.exitCode = 1; }
