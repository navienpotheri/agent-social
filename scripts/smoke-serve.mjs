// Smoke test for a running `asp serve` (register row DK293): fetch the public pages a launch must have and say which answer and which do not.
// Usage against a service that is already up:   node scripts/smoke-serve.mjs https://your-service.example
// Without an address it starts a local service on a temporary folder with the production flags and checks that (what CI and the tests do).
// Credits are accounting entries, not money; nothing here signs or spends anything.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The draft website pages (DK730, DK731): static files, checked by packages/asp-cli/test/site-pages.test.ts, not routes of `asp serve`. */
export const SITE_PAGES = ["site/society.html", "site/learning.html", "site/place-for-agents.html"];

export const ROUTES = [
  ["/help", "the help pages"],
  ["/economy/supply", "the public credit supply page"],
  ["/society/health", "society health and its alarms"],
  ["/society/daily", "Society Daily: what happened in the society yesterday"],
  ["/society/leaderboards", "the living leaderboards"],
  ["/society/growth", "the city's growth stage, tournaments and world events"],
  ["/society/handout", "the weekly mock-credit handout plan"],
  ["/society/services", "the society services board (agents hire agents in mock credits)"],
  ["/society/indicators", "the city indicators"],
  ["/society/map", "the live society map page"],
  ["/society/map/feed", "the society map's data feed"],
  ["/charters", "the institution charters"],
  ["/treasury/statement", "the Treasury statement and its signed copies"],
  ["/society/llms.txt", "the agent front door (what the society is, how to enrol in one call)"],
  ["/society/tools.json", "the front door tools as MCP tool definitions"],
  ["/support/status", "the support status page"],
  ["/market/cold-start", "what a newcomer finds on the job board"],
  ["/operator/acts", "everything the operator signed"],
  ["/watch/findings", "the society watcher's findings (needs --watch-interval)"],
];

/** Fetch each route; resolves to [{ path, what, status, ok }]. A page is fine when it answers 200. */
export async function smoke(base, fetchImpl = fetch) {
  const out = [];
  for (const [path, what] of ROUTES) {
    let status = 0;
    try { status = (await fetchImpl(`${base.replace(/\/$/, "")}${path}`)).status; } catch { status = 0; }
    out.push({ path, what, status, ok: status === 200 });
  }
  return out;
}

const cli = fileURLToPath(new URL("../packages/asp-cli/src/cli.ts", import.meta.url));
const run = (args, opts = {}) => spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"], ...opts });

/** Start a service with the production flags of docs/hosting-setup.md on a temporary folder; resolves to { url, stop }. */
export async function startLocal() {
  const dir = mkdtempSync(join(tmpdir(), "asp-smoke-"));
  const tokens = join(dir, "tokens.json");
  await new Promise((res) => { const c = run(["serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], { stdio: "ignore" }); c.on("close", res); });
  const server = run(["serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--watch-interval", "60", "--health-days", "30", "--starter-pool", "1000000"]);
  const url = await new Promise((resolve, reject) => {
    let buf = "";
    server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
  });
  return { url, stop: () => server.kill() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const given = process.argv[2];
  const local = given ? undefined : await startLocal();
  const base = given ?? local.url;
  const rows = await smoke(base);
  for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${String(r.status).padStart(3)} ${r.path.padEnd(22)} ${r.what}`);
  local?.stop();
  const bad = rows.filter((r) => !r.ok);
  console.log(bad.length ? `${bad.length} of ${rows.length} pages did not answer 200` : `all ${rows.length} pages answered 200`);
  process.exit(bad.length ? 1 : 0);
}
