// Audit of the operator's commands of docs/deployment-walkthrough.md steps 9 to 12 over the REMOTE log (the owner's 2026-11-23 live run: `asp charter publish-all` failed with "log.charterOf is not available" because RemoteLog
// did not have the method). It starts a throwaway service the way docs/deploy/setup-server.sh starts the real one (a scratch database, the same flags apart from Postgres, Caddy and mail), makes the operator identity
// (also the owner, as in the walkthrough: the same DID signs and co-signs), then runs each command with ASP_LOG_URL and ASP_LOG_TOKEN set and prints a table: command, exit code, first error line.
//   node scripts/audit-remote-commands.mjs [--json]      (Node 22.18 or newer; run from the repository folder; nothing outside a temporary folder is touched)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const cli = join(repo, "packages", "asp-cli", "src", "cli.ts");
const asJson = process.argv.includes("--json");
const free = () => new Promise((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const run = (args, env) => { const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 180_000 }); return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") }; };

const dir = mkdtempSync(join(tmpdir(), "asp-audit-"));
const port = await free();
const url = `http://127.0.0.1:${port}`;
const tokens = join(dir, "tokens.json");
const keys = join(dir, "operator-home");
mkdirSync(keys, { recursive: true });
const OP = `did:web:127.0.0.1%3A${port}:u:operator`;
const tok = run(["serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], {}).out.split("\n").map((l) => l.trim()).find((l) => /^[A-Za-z0-9_-]{30,}$/.test(l));
const serveArgs = ["serve", "--db", `local:${join(dir, "db")}`, "--tokens", tokens, "--host", "127.0.0.1", "--port", String(port),
  "--packages", join(dir, "packages"), "--runlogs", join(dir, "runlogs"), "--commons", join(dir, "commons"), "--known-bad", join(dir, "known-bad"), "--forum", join(dir, "forum"), "--forum-open",
  "--limits-state", join(dir, "limits-state.json"), "--rate-limit", "600", "--write-limit", "120", "--address-limit", "1200", "--max-in-flight", "16",
  "--signup", "--signup-terms-url", `${url}/terms`, "--signup-terms-version", "2026-10", "--public-url", url, "--allow-plain-http", "--did-domain", `127.0.0.1:${port}`];
async function start(env) {
  const logf = join(dir, `service-${Date.now()}.log`);
  const out = openSync(logf, "w");
  const child = spawn(process.execPath, [cli, ...serveArgs], { stdio: ["ignore", out, out], env: { ...process.env, ...env } });
  for (let i = 0; i < 150; i++) { await new Promise((r) => setTimeout(r, 200)); if (/listening on http/.test(readFileSync(logf, "utf8"))) return child; }
  throw new Error(`the service did not start: ${readFileSync(logf, "utf8")}`);
}
// the operator's identity is written to the service first (no operator named yet), then the service is restarted naming it (ASP_OPERATOR_DID, ASP_OWNER_DID), as step 6 of the walkthrough does
let svc = await start({});
const env = { ASP_HOME: keys, ASP_LOG_URL: url, ASP_LOG_TOKEN: tok };
run(["identity", "new", "--kind", "human", "--did", OP, "--no-recovery"], env);
svc.kill(); await new Promise((r) => setTimeout(r, 1200));
svc = await start({ ASP_OPERATOR_DID: OP, ASP_OWNER_DID: OP });
const E = { ...env, ASP_OPERATOR_DID: OP, ASP_OWNER_DID: OP };

const rows = [];
const step = (label, args) => {
  const r = run(args, E);
  const lines = r.out.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => /error|not available|refused|usage|failed/i.test(l)) ?? lines[0] ?? "";
  rows.push({ command: label, code: r.code, result: r.code === 0 ? "ok" : "FAILED", detail: (r.code === 0 ? lines[0] ?? "" : first).slice(0, 200), out: r.out });
  return r;
};

// the institutions that sign records (the Treasury, the Registry) need a key on the operator's machine and a passport in the log: the walkthrough does not say how to make them
for (const [name, did] of [["treasury", "did:web:asp.local:treasury"], ["registry", "did:web:asp.local:registry"], ["bank", "did:web:asp.local:bank"]]) step(`identity new ${name} (institution key)`, ["identity", "new", "--kind", "human", "--did", did, "--no-recovery"]);
step("credits grant (starter pool)", ["credits", "grant", "--to", "did:web:asp.local:starter-pool", "--amount", "1000000", "--by", OP, "--reason", "starter_upfront"]);
step("credits grant (Treasury, so budgets can be signed)", ["credits", "grant", "--to", "did:web:asp.local:treasury", "--amount", "100000", "--by", OP, "--reason", "treasury_issuance", "--cosign-by", OP]);
step("charter publish-all", ["charter", "publish-all", "--by", OP, "--cosign-by", OP, "--docs", join(repo, "docs")]);
step("charter publish-all (again: all skipped)", ["charter", "publish-all", "--by", OP, "--cosign-by", OP, "--docs", join(repo, "docs")]);
step("charter index", ["charter", "index"]);
step("charter check", ["charter", "check"]);
step("charter show", ["charter", "show", "--institution", "did:web:asp.local:forum"]);
const draftFile = join(dir, "budget-draft.json");
const draft = step("treasury draft --period 2026-12", ["treasury", "draft", "--period", "2026-12", "--out", draftFile]);
const draftId = (existsSync(draftFile) ? (() => { try { const j = JSON.parse(readFileSync(draftFile, "utf8")); const l = Array.isArray(j) ? j : (j.drafts ?? j.budgets ?? []); return l[0]?.id ?? l[0]?.institution ?? ""; } catch { return ""; } })() : "") || "market";
if (existsSync(draftFile)) step("treasury sign", ["treasury", "sign", "--draft", draftFile, "--id", draftId || "x", "--cosign-by", OP]);
else rows.push({ command: "treasury sign", code: 1, result: "SKIPPED", detail: "no draft file was written", out: "" });
step("treasury list", ["treasury", "list"]);
step("credits audit", ["credits", "audit"]);
step("world tick", ["world", "tick"]);
step("prices show", ["prices", "show"]);
step("prices publish --preset forum-long", ["prices", "publish", "--preset", "forum-long"]);
step("forum checkpoint", ["forum", "checkpoint", "--by", OP]);
step("forum verify", ["forum", "verify"]);
step("forum rank-checkpoint", ["forum", "rank-checkpoint", "--by", OP]);
const house = step("house create house-one", ["house", "create", "house-one", "--purpose", "A house agent run by the operator"]);
const agentDid = /(did:\S+:a:\S+)/.exec(house.out)?.[1];
step("house list", ["house", "list"]);
if (agentDid) {
  step("house run --count 2", ["house", "run", "--agent", agentDid, "--performer", OP, "--bank", OP, "--count", "2"]);
  step("market seed --fund-from", ["market", "seed", "--by", agentDid, "--mandate", "x", "--fund-from", "x"]);
  step("house stop", ["house", "stop", "--agent", agentDid, "--reason", "audit"]);
}
// the operator commands outside steps 9 to 12 that call a method of the log the service may not list
step("treasury statement", ["treasury", "statement"]);
step("bank statement", ["bank", "statement", "--holder", OP]);
step("bank report", ["bank", "report"]);
step("bank offer", ["bank", "offer", "--agent", agentDid ?? OP]);
step("registry status", ["registry", "status", "--sponsor", OP]);
step("insure quote", ["insure", "quote", "--contract", "sha256:" + "0".repeat(64), "--cover", "bond_slash", "--by", OP]);
step("abuse list", ["abuse", "list", "--accused", agentDid ?? OP]);
svc.kill();
writeFileSync(join(dir, "audit.json"), JSON.stringify(rows, null, 2));
if (asJson) console.log(JSON.stringify(rows.map(({ out, ...r }) => r), null, 2));
else {
  console.log(`service on ${url}, scratch folder ${dir}`);
  for (const r of rows) console.log(`${r.result.padEnd(8)} exit ${r.code}  ${r.command.padEnd(44)} ${r.detail}`);
  console.log(`${rows.filter((r) => r.result === "FAILED").length} failed of ${rows.length}`);
}
process.exitCode = rows.some((r) => /not available|UNKNOWN_METHOD/.test(r.out)) ? 1 : 0;
