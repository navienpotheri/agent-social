// Live check 06: the monitor, the alerts and the status page (row DK1341; docs/incident-runbook.md; docs/live-check-cli.md). With --local it runs the whole drill on this machine with the real command line: a real service,
// a real webhook, the real `asp monitor check`, the service stopped on purpose and started again (this is what was logged for the row). Against the deployed server it does the same, with you stopping and starting the
// service and confirming that the alert reached your phone and your mail.
//
//   node scripts/live/06-monitor-status.mjs --local
//   node scripts/live/06-monitor-status.mjs --site https://<domain> [--status-dir /var/www/asp] [--yes]
//
// On the server, run it as the asp user (so it can read the status files) or give --site only and check the page in a browser when it asks.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { args, session } from "./lib.mjs";

const a = args();
const cli = fileURLToPath(new URL("../../packages/asp-cli/src/cli.ts", import.meta.url));
const s = session("monitor-status", { yes: !!a.yes });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asp = (argv, o = {}) => s.run(process.execPath, [cli, ...argv], o);

async function startService(dir, port = 0) {
  const tokens = join(dir, "tokens.json");
  if (!existsSync(tokens)) await new Promise((res) => { const c = spawn(process.execPath, [cli, "serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], { stdio: "ignore" }); c.on("close", res); });
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => { let buf = ""; server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); }); server.on("close", () => reject(new Error(`the service exited: ${buf}`))); setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000); });
  return { url, stop: () => new Promise((r) => { server.on("close", r); server.kill(); }) };
}

if (a.local) {
  const dir = mkdtempSync(join(tmpdir(), "asp-monitor-live-"));
  const statusDir = join(dir, "www");
  const heard = [];
  const hook = createServer(async (req, res) => { const c = []; for await (const x of req) c.push(x); try { heard.push(JSON.parse(Buffer.concat(c).toString())); } catch { /* ignore */ } res.writeHead(200); res.end(); });
  await new Promise((r) => hook.listen(0, "127.0.0.1", r));
  const hookUrl = `http://127.0.0.1:${hook.address().port}`;
  let svc = await startService(dir);
  const port = Number(new URL(svc.url).port);
  const monitor = (extra = []) => asp(["monitor", "check", "--service", svc.url, "--state", join(dir, "state.json"), "--status-out", join(statusDir, "status.json"), "--status-html-out", join(statusDir, "status.html"), "--incidents", join(statusDir, "incidents.json"), "--alert-webhook", hookUrl, "--alert-mail", "ops@example.org", "--home", dir, "--after", "2", "--json", ...extra], { env: { ...process.env, ASP_HOME: dir } });
  const level = async () => JSON.parse((await monitor()).out).level;
  const downAlerts = () => heard.filter((h) => h.check === "service" && h.kind === "down").length;
  try {
    s.title(`Monitor and status page, local drill (service ${svc.url})`);
    const first = await monitor();
    await s.check("the monitor runs against a healthy service and writes status.json and status.html", async () => { const j = JSON.parse(first.out); return existsSync(join(statusDir, "status.json")) && existsSync(join(statusDir, "status.html")) && j.checks.find((c) => c.id === "service").ok ? true : first.out.slice(0, 200); });
    await s.check("a society with no jobs yet is degraded (the QUIET alarm), not an outage", async () => JSON.parse(first.out).level !== "major_outage");
    await svc.stop();
    s.say("\nThe service is stopped on purpose.");
    await s.check("first failed check: major outage on the page, and no alert yet (an alert needs two in a row)", async () => (await level()) === "major_outage" && downAlerts() === 0 ? true : `alerts so far: ${downAlerts()}`);
    await s.check("second failed check: exactly one DOWN alert reaches the webhook", async () => { await level(); return downAlerts() === 1 ? true : `alerts: ${downAlerts()}`; });
    await s.check("a third and a fourth failed check do not alert again", async () => { await level(); await level(); return downAlerts() === 1 ? true : `alerts: ${downAlerts()}`; });
    await s.check("the alert mail was written to the outbox folder (no mail key is set here, so nothing is lost)", async () => { const box = join(dir, "monitor-outbox"); return existsSync(box) && readdirSync(box).some((f) => /\.json$/.test(f)) ? true : "no outbox"; });
    await s.check("the status page is still there while the service is down, says Major outage, and has the time it was written", async () => { const h = readFileSync(join(statusDir, "status.html"), "utf8"); return /Major outage/.test(h) && /Last checked <time id="at">\d{4}-/.test(h) ? true : "the page does not say it"; });
    const inc = await asp(["monitor", "incident", "--incidents", join(statusDir, "incidents.json"), "--title", "The service is not answering", "--status", "investigating", "--message", "Drill: we see it and are restarting it."]);
    await s.check("an incident written by the operator shows on the page at the next check", async () => { await level(); return /The service is not answering/.test(readFileSync(join(statusDir, "status.html"), "utf8")) && inc.code === 0 ? true : inc.err; });
    svc = await startService(dir, port);
    s.say("\nThe service is started again on the same address.");
    await s.check("the first check after the restart is not an outage and sends one RECOVERED alert", async () => { const l = await level(); return l !== "major_outage" && heard.filter((h) => h.check === "service" && h.kind === "recovered").length === 1 ? true : `level ${l}, recovered alerts ${heard.filter((h) => h.kind === "recovered").length}`; });
    await s.check("recovery is told once", async () => { await level(); return heard.filter((h) => h.check === "service" && h.kind === "recovered").length === 1 ? true : "told more than once"; });
    const st = await asp(["monitor", "status", "--status-out", join(statusDir, "status.json"), "--json"]);
    await s.check("asp monitor status reads the file and says the level and how old it is", async () => /"level":"(degraded|operational)"/.test(st.out) ? true : st.out);
  } finally { await svc.stop().catch(() => {}); hook.close(); }
  process.exit(s.done());
}

const site = (a.site ?? "").replace(/\/$/, "");
if (!site) { console.error("usage: node scripts/live/06-monitor-status.mjs --site https://<domain>   (or --local)"); process.exit(2); }
s.title(`Monitor and status page against ${site}`);
await s.check("the service answers /health", async () => (await fetch(`${site}/health`)).status === 200);
await s.check("the status page /status answers and is not the service's own page (it is the monitor's static file)", async () => { const r = await fetch(`${site}/status`); const t = await r.text(); return r.status === 200 && /Agent Social status/.test(t) ? true : `answered ${r.status}`; });
await s.check("/status.json is fresh: written within the last 10 minutes", async () => { const j = await (await fetch(`${site}/status.json`)).json(); const age = (Date.now() - Date.parse(j.checked_at)) / 60000; return age <= 10 ? true : `last written ${Math.round(age)} minutes ago: the monitor has stopped (systemctl status asp-monitor)`; });
await s.check("the page carries the beta statement and the no-outside-review line", async () => { const t = await (await fetch(`${site}/status`)).text(); return /no outside security review/.test(t) && /not money/.test(t) ? true : "a required line is missing"; });
await s.human("On the server, stop the service on purpose.", ["Run:  sudo systemctl stop asp-log", "Wait two minutes (the monitor checks every 60 seconds and alerts on the second failed check)."]);
await s.check("while the service is down, /status still answers and says Major outage", async () => { const r = await fetch(`${site}/status`); const t = await r.text(); return r.status === 200 && /Major outage/.test(t) ? true : `answered ${r.status}${/Major outage/.test(t) ? "" : " without Major outage (is it cached? is Caddy serving the static file?)"}`; });
await s.human("Check the alert arrived.", ["Your phone or webhook channel and your mail (the --alert-mail address) each have ONE message: \"[Agent Social] DOWN: The service answers\".", "If a second one arrives while the service stays down, that is a failure: write it down."]);
await s.human("Write the incident on the page.", ["Run (on the server):  sudo -u asp node /opt/asp/packages/asp-cli/bin/asp.mjs monitor incident --incidents /var/www/asp/incidents.json --title \"Drill: the service is not answering\" --status investigating --message \"This is a drill. We stopped the service on purpose.\"", "Reload " + site + "/status within a minute: the incident is on it."]);
await s.human("Start the service again.", ["Run:  sudo systemctl start asp-log", "Wait two minutes."]);
await s.check("the service answers again and the page is not Major outage", async () => { const h = await fetch(`${site}/health`); const t = await (await fetch(`${site}/status`)).text(); return h.status === 200 && !/Major outage/.test(t) ? true : "still down or the page is stale"; });
await s.human("Check the recovery alert arrived once, then resolve the drill incident.", ["One \"[Agent Social] recovered: The service answers\" on your phone and in your mail.", "Run:  sudo -u asp node /opt/asp/packages/asp-cli/bin/asp.mjs monitor incident --incidents /var/www/asp/incidents.json --id <the inc- id shown on the page> --status resolved --message \"The drill is over.\""]);
await s.human("Check the outside ping (the owner's step, the monitor lives on the same machine).", ["An uptime service you chose watches " + site + "/health and " + site + "/status.json (docs/owner-questions-cli.md, checklist OP-2) and has mailed or messaged you for the outage you just made."]);
process.exit(s.done());
