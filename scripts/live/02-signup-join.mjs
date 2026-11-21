// Live check 02: sign up on a clean machine with a real Google account, `asp join`, token recovery, export and close (rows U1, U9, E9, DK546 live part; docs/live-check-cli.md). It needs the deployed service and a
// real Google account that is not your main one. It uses a temporary ASP_HOME so the sign-in is as a stranger's would be: nothing saved from before. Credits are accounting entries, not money. No model agent is used.
//
//   node scripts/live/02-signup-join.mjs --service https://<domain> [--yes]
//
// You do the parts only a person can (the browser, the Google account, the mail inbox); the script does everything it can check by itself and writes a report to paste into docs/live-run-checklist.md.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { args, session } from "./lib.mjs";

const a = args();
const service = String(a.service ?? "").replace(/\/$/, "");
if (!service) { console.error("usage: node scripts/live/02-signup-join.mjs --service https://<domain>"); process.exit(2); }
const s = session("signup-join", { yes: !!a.yes });
const bin = fileURLToPath(new URL("../../packages/asp-cli/bin/asp.mjs", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "asp live signup "));
const env = { ...process.env, ASP_HOME: home };
delete env.ASP_LOG_URL; delete env.ASP_LOG_TOKEN;
const asp = (argv) => s.run(process.execPath, [bin, ...argv], { env });
const interactive = (argv) => new Promise((resolve) => { const c = spawn(process.execPath, [bin, ...argv], { stdio: "inherit", env }); c.on("close", (code) => resolve(code ?? 1)); });

s.title(`Sign-up and join against ${service}, as a stranger (clean ASP_HOME ${home})`);
await s.check("the service answers /health and /join", async () => (await fetch(`${service}/health`)).status === 200 && (await fetch(`${service}/join`)).status === 200);
await s.check("the sign-up page says what is kept, that credits are not money, and asks for the declaration", async () => { const t = await (await fetch(`${service}/join`)).text(); return /not money|mock/i.test(t) && /adult|guardian/i.test(t) ? true : "the page lacks the credits statement or the declaration"; });

if (!a.yes) {
  s.say("\nNow `asp join` runs here. A browser opens. Sign in with the TEST Google account, accept the declaration, choose a tenant name that starts with 'live-' and write it down.");
  const code = await interactive(["join", "--service", service]);
  await s.check("`asp join` finished with exit 0", async () => code === 0 ? true : `exit ${code}`);
} else s.say("(--yes: `asp join` is not run; the checks after it need a person's sign-in, so they are skipped)");

const show = a.yes ? { code: 1, out: "", err: "" } : await asp(["account", "show"]);
let tenant = "";
if (!a.yes) {
  await s.check("`asp account show` names the tenant, the verified address and the limits", async () => { tenant = /tenant[: ]+([a-z][a-z0-9-]{2,31})/i.exec(show.out)?.[1] ?? ""; return show.code === 0 && tenant && /@/.test(show.out) ? true : show.out.slice(0, 300) + show.err.slice(0, 200); });
  await s.check("`asp status` says where things stand after joining (an identity, a first agent, the next command)", async () => { const r = await asp(["status"]); return r.code === 0 && /asp /.test(r.out) ? true : r.out.slice(0, 200) + r.err.slice(0, 200); });
  await s.human("The starter credits.", ["Run:  node " + bin + " account starter --did <your agent's did from `asp status`>", "It says how many credits were given (accounting entries, not money) and how many wait for a first accepted job."]);
  const probe = await asp(["token", "create", "live-probe", "--days", "1"]);
  const probeToken = probe.out.split("\n").map((l) => l.trim()).find((l) => /^[A-Za-z0-9_-]{30,}$/.test(l)) ?? "";
  await s.check("a machine token can be made (it will be used to prove recovery stops old tokens)", async () => probeToken ? true : probe.out.slice(0, 200) + probe.err.slice(0, 200));
  const works = async (t) => { const r = await fetch(`${service}/rpc`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ target: "log", method: "head", args: [] }) }); return r.status; };
  await s.check("the machine token works against the service before recovery", async () => (await works(probeToken)) === 200 ? true : "it did not");
  await s.human("Token recovery (U1).", ["Run:  node " + bin + " join --recover --service " + service, "Sign in with the SAME Google account in the browser. A new token is saved."]);
  await s.check("after recovery the old machine token no longer works", async () => (await works(probeToken)) === 401 ? true : "the old token still works");
  await s.check("after recovery `asp account show` still works with the new token", async () => (await asp(["account", "show"])).code === 0);
  const out = join(home, "export");
  const ex = await asp(["account", "export", "--out", out]);
  await s.check("`asp account export` writes the person's data to a folder", async () => { if (ex.code !== 0) return ex.err.slice(0, 200); const files = readdirSync(out); return files.length > 0 ? true : "the folder is empty"; });
  await s.check("the export holds no token, key or recovery code", async () => { const bad = []; for (const f of readdirSync(out)) { if (!statSync(join(out, f)).isFile()) continue; const t = readFileSync(join(out, f), "utf8"); if (/[A-Za-z0-9_-]{43}/.test(t.replace(/sha256:[0-9a-f]{64}/g, "").replace(/did:[A-Za-z0-9:._%-]+/g, "")) && /token|secret|recovery/i.test(t)) bad.push(f); } return bad.length ? `check these by eye: ${bad.join(", ")}` : true; });
  await s.human("The end-of-job mail and an alert (E9).", ["Run the stand-in session of script 03 against this tenant (node scripts/live/03-gateway-stand-in.mjs --hosted), then:", "  node " + bin + " mail address set <the Google address you signed up with>", "  node " + bin + " mail watch --once --send", "One end-of-job mail arrives in that inbox with the run summary and no secret; make the stand-in get killed (script 03 --kill) and an alert mail arrives at once."]);
  await s.human("Close the account and check the deletion (U9).", ["Run:  node " + bin + " account close --confirm " + (tenant || "<tenant>"), "It exports first and prints a receipt: what was removed and what is kept until its retention date. Write the receipt's date down."]);
  await s.check("the closed tenant's token is refused", async () => (await asp(["account", "show"])).code !== 0 ? true : "the account still answers");
  await s.human("On the server, check the tombstone.", ["Run:  sudo -u asp node /opt/asp/packages/asp-cli/bin/asp.mjs serve usage --tokens /var/lib/asp/tokens.json", "The closed tenant is listed as closed with a retain-until date, and nothing else of theirs (no contact line beyond what the privacy notice says is kept)."]);
}
process.exit(s.done());
