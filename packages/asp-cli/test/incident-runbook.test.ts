// Row DK1341 (spec-delta S1456): the incident runbook (docs/incident-runbook.md) is real. Every command on the page exists, its promises are the owner's decisions (H4: suspension within 2 working days, a written answer
// within 7), and a seeded incident is walked through on a running service: an abusive tenant is suspended and resumed, a leaked token is reset, and an outage is caught by the monitor, alerted once, shown on the static
// status page while the service is down, and alerted as recovered. Fake keys; the service is a real `asp serve` on this machine.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as netServer } from "node:net";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { monitorPass } from "../src/monitor.ts";

const root = new URL("../../../", import.meta.url);
const runbook = readFileSync(new URL("docs/incident-runbook.md", root), "utf8").replace(/\r\n/g, "\n");
const catalogue = (JSON.parse(readFileSync(new URL("docs/commands.json", root), "utf8")).groups as { commands: { command: string }[] }[]).flatMap((g) => g.commands.map((c) => c.command));
const commandsMd = readFileSync(new URL("docs/commands.md", root), "utf8");

const procs: ChildProcess[] = [];
const servers: Server[] = [];
after(() => { for (const p of procs) p.kill(); for (const s of servers) s.close(); });

test("the runbook has a section for each of the four things that go wrong, and says who does what and the owner's numbers", () => {
  for (const h of [/^## 1\. An outage/m, /^## 2\. A leaked key or token/m, /^## 3\. An abusive agent or tenant/m, /^## 4\. A request about someone's data/m, /^## 5\. Degraded, not down/m, /^## 6\. After any incident/m, /^## 0\. How you find out/m]) assert.match(runbook, h);
  assert.match(runbook, /within 2 working days/); assert.match(runbook, /written response to the person who reported within 7 days/);
  assert.match(runbook, /within 1 hour of the first alert/);
  assert.match(runbook, /no outside security review/);
  assert.match(runbook, /credits are accounting entries, not money|credits are accounting entries and not money/);
  assert.match(runbook, /The owner is on call, is the grievance officer, and acts\./);
});

test("every asp command the runbook tells the operator to run exists in the command catalogue, with the flags it uses", () => {
  const found = new Set<string>();
  for (const m of runbook.matchAll(/`(asp [^`\n]+)`|^(asp [^\n]+)$/gm)) found.add((m[1] ?? m[2]).trim());
  for (const m of runbook.matchAll(/(?:\$\(|\| |: |, then )(asp [a-z][^\n`"]*)/g)) found.add(m[1].trim());
  assert.ok(found.size >= 25, `the runbook names many commands (${found.size})`);
  const problems: string[] = [];
  for (const cmd of found) {
    const words = cmd.split(/\s+/).slice(1);
    const lead: string[] = [];
    for (const w of words) { if (/^[a-z][a-z-]*$/.test(w)) lead.push(w); else break; }
    if (!lead.length) continue; // `asp() {` shell function, or prose
    const entry = catalogue.filter((c) => c.startsWith(`asp ${lead[0]}`));
    if (!entry.length) { problems.push(`${cmd}: there is no asp ${lead[0]}`); continue; }
    if (lead[1] && !entry.some((c) => new RegExp(`(^|[ |])${lead[1]}( |$|\\|)`).test(c))) problems.push(`${cmd}: asp ${lead[0]} has no "${lead[1]}" in the catalogue`);
    for (const flag of cmd.match(/--[a-z][a-z-]*/g) ?? []) if (!commandsMd.includes(flag)) problems.push(`${cmd}: ${flag} is not an option in docs/commands.md`);
  }
  assert.deepEqual(problems, []);
});

// ---- the seeded incident on a running service ----

const cliTs = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (args: string[]) => new Promise<{ code: number; out: string; err: string }>((resolve) => {
  const c = spawn(process.execPath, [cliTs, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
  c.on("close", (code) => resolve({ code: code ?? 1, out, err }));
});
const freePort = () => new Promise<number>((resolve) => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
async function startService(tokens: string, dir: string, port: number) {
  const p = spawn(process.execPath, [cliTs, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  procs.push(p);
  await new Promise<void>((resolve, reject) => { let buf = ""; p.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); }); p.on("close", () => reject(new Error(`the service exited: ${buf}`))); setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000); });
  return p;
}
function client(url: string, token: string) {
  const home = mkdtempSync(join(tmpdir(), "asp-incident-client-"));
  return async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: url, ASP_LOG_TOKEN: token }, cwd: home };
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
}

test("a seeded incident, walked through the runbook on a running service: an abusive tenant, a leaked token and an outage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-incident-"));
  const tokens = join(dir, "tokens.json");
  const token = (await run(["serve", "token", "--tokens", tokens, "--tenant", "team-a"])).out.trim().split("\n").at(-1)!;
  await run(["serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"]);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let svc = await startService(tokens, dir, port);

  // a webhook the operator's phone would hear from, and the monitor's files
  const heard: any[] = [];
  const hook = createServer(async (req, res) => { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); heard.push(JSON.parse(Buffer.concat(c).toString())); res.writeHead(200); res.end(); });
  await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r)); servers.push(hook);
  const svcHeard = () => heard.filter((h) => h.check === "service"); // the empty society's QUIET alarm is its own, legitimate, alert
  const webhook = `http://127.0.0.1:${(hook.address() as { port: number }).port}`;
  const statusDir = mkdtempSync(join(tmpdir(), "asp-status-"));
  let clock = Date.parse("2026-12-01T10:00:00Z");
  const pass = () => monitorPass({ cfg: { service: url, now: () => new Date((clock += 60_000)).toISOString(), timeoutMs: 3000 }, stateFile: join(statusDir, "state.json"), statusOut: join(statusDir, "status.json"), statusHtmlOut: join(statusDir, "status.html"), incidentsFile: join(statusDir, "incidents.json"), after: 2, everySec: 60, sinks: { webhook } });

  // 0. quiet: the page says operational
  let r = await pass();
  // a society with no jobs yet has the QUIET alarm: degraded, never an outage; everything that matters for the service is ok
  assert.deepEqual(r.results.filter((x) => !x.ok).map((x) => x.id), ["society"], JSON.stringify(r.results));
  assert.notEqual(r.level, "major_outage");
  let c = client(url, token);
  assert.equal((await c(["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:u1"])).code, 0);

  // 3. an abusive tenant: contain (suspend), the person is told why, resume
  const susp = await run(["serve", "suspend", "--tokens", tokens, "--tenant", "team-a", "--reason", "abusive traffic reported twice"]);
  assert.match(susp.out, /team-a is suspended: abusive traffic reported twice/);
  const refused = await c(["identity", "show", "did:web:example.com:users:u1"]);
  assert.equal(refused.code, 1); assert.match(refused.err, /SUSPENDED/); assert.match(refused.err, /abusive traffic reported twice/);
  assert.match((await run(["serve", "audit", "--tokens", tokens])).out, /suspend/i, "the operator's own act is on the audit trail");
  await run(["serve", "resume", "--tokens", tokens, "--tenant", "team-a"]);
  assert.equal((await c(["identity", "show", "did:web:example.com:users:u1"])).code, 0);

  // 2. a leaked token: preserve, reset; the old token stops at once
  const reset = await run(["serve", "reset-token", "--tokens", tokens, "--tenant", "team-a"]);
  const fresh = reset.out.trim().split("\n").at(-1)!;
  assert.equal((await c(["identity", "show", "did:web:example.com:users:u1"])).code, 1, "the leaked token no longer works");
  assert.equal((await client(url, fresh)(["identity", "show", "did:web:example.com:users:u1"])).code, 0, "the new one does");

  // 1. an outage: the service dies; two failed checks make one alert; the static page says so while the service is down
  const exited = new Promise<void>((r2) => svc.on("close", () => r2()));
  svc.kill(); await exited;
  r = await pass();
  assert.equal(r.level, "major_outage"); assert.equal(svcHeard().length, 0, "one failed check is not yet an alert");
  r = await pass();
  assert.equal(svcHeard().length, 1); assert.equal(svcHeard()[0].kind, "down"); assert.equal(svcHeard()[0].check, "service");
  await pass();
  assert.equal(svcHeard().length, 1, "one alert, not one a minute");
  const html = readFileSync(join(statusDir, "status.html"), "utf8");
  assert.match(html, /Major outage/); assert.match(html, /The service answers/);
  // the operator says it on the page (section 0.1), then restarts the service (section 1.3)
  const inc = await run(["monitor", "incident", "--incidents", join(statusDir, "incidents.json"), "--title", "The service is not answering", "--status", "investigating", "--message", "We see it and are restarting it. Nothing is lost."]);
  assert.match(inc.out, /is investigating/);
  svc = await startService(tokens, dir, port);
  r = await pass();
  assert.deepEqual(r.results.filter((x) => !x.ok).map((x) => x.id), ["society"], JSON.stringify(r.results));
  assert.equal(svcHeard().length, 2); assert.equal(svcHeard()[1].kind, "recovered");
  await pass();
  assert.equal(svcHeard().length, 2, "recovery is told once");
  const resolved = await run(["monitor", "incident", "--incidents", join(statusDir, "incidents.json"), "--id", /inc-\d{8}-1/.exec(inc.out)![0], "--status", "resolved", "--message", "The service was restarted and is answering. The cause is being written up."]);
  assert.match(resolved.out, /is resolved \(2 updates\)/);
  await pass();
  const page = readFileSync(join(statusDir, "status.html"), "utf8");
  assert.doesNotMatch(page, /Major outage/); assert.match(page, /The service is not answering/); assert.match(page, /was restarted and is answering/);
});
