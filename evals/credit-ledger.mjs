// Watches where every credit is, by entity, while a job (or a long run) goes on: balances, stakes, what is locked in escrow and bond, what the protocol itself holds, whether the total still adds up,
// and the tokens the sessions used (an estimate in credits, never a charge). Reads only what the CLI prints, so it works on a local log or on the hosted service through the saved login.
//   node evals/credit-ledger.mjs --home <ASP_HOME> [--contract <id> ...] [--entity name=did ...] [--juror name=did ...] [--granted <n>] [--every <seconds>] [--rate <credits per 1000 tokens>] [--out <file.ndjson>]
// With no --entity it watches the saved login's person, agent and bank. With --every it samples until stopped (Ctrl-C); without it, once. Nothing here prints a token or a key.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { conservation, deltas, formatTable, meteredUse, snapshot } = await import(new URL("../packages/asp-cli/src/ledger.ts", import.meta.url).href);

const args = process.argv.slice(2);
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const one = (name, d) => all(name)[0] ?? d;
const HOME = resolve(one("home", process.env.ASP_HOME ?? ""));
if (!HOME || !existsSync(HOME)) { console.error("give --home <ASP_HOME> (a folder that exists)"); process.exit(2); }
const ASP = resolve(fileURLToPath(new URL("../packages/asp-cli/bin/asp.mjs", import.meta.url)));
const pair = (s) => { const i = s.indexOf("="); return { name: s.slice(0, i), did: s.slice(i + 1) }; };
let entities = all("entity").map(pair);
if (!entities.length) {
  try { const id = JSON.parse(readFileSync(join(HOME, "config.json"), "utf8")).identities; entities = [{ name: "principal", did: id.me }, { name: "agent", did: id.agent }, { name: "bank", did: id.bank }]; }
  catch { console.error("no --entity given and no saved login with identities in that home"); process.exit(2); }
}
let jurors = all("juror").map(pair);
let contracts = all("contract");
// With no --contract, the job that evals/live-job.mjs is walking (its saved contract id) is watched while it is open: nothing to copy.
if (!contracts.length) {
  try { const j = JSON.parse(readFileSync(join(HOME, "live-job.json"), "utf8")); if (j.contract && !j.settled) { contracts = [j.contract]; console.log(`(watching the job in progress: ${j.contract.slice(0, 19)}...)`); } } catch { /* no job in progress */ }
}
let granted = one("granted") === undefined ? undefined : Number(one("granted"));
const rate = Number(one("rate", "1"));
const every = Number(one("every", "0"));
const out = one("out");

// An old login override in this shell changes whose balances are read, and a revoked token reads none: said at the start, as the CLI says it.
if (process.env.ASP_LOG_URL || process.env.ASP_LOG_TOKEN) console.log("note: ASP_LOG_URL or ASP_LOG_TOKEN is set in this shell and overrides the saved login; unset them (unset ASP_LOG_URL ASP_LOG_TOKEN) unless that is what you want to watch");
const run = async (a) => { const r = spawnSync(process.execPath, ["--experimental-strip-types", ASP, ...a], { env: { ...process.env, ASP_HOME: HOME, ASP_NO_FOCUS: "1" }, encoding: "utf8", timeout: 60_000 }); return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" }; };
const run0 = run;
// The court's seated jurors (asp court seat) hold and stake credits, so they are counted without being told; and with no total given, the first reading is the baseline the rest are checked against.
if (!all("juror").length) {
  const domain = entities[0].did.split(":")[2];
  for (let n = 1; n <= 3; n++) { const did = `did:web:${domain}:court:juror-${n}`; const r = await run0(["market", "juror", "show", did]); if (/staked [1-9]/.test(r.out)) jurors.push({ name: `juror${n}`, did }); }
}
const names = [...entities, ...jurors].map((e) => e.name);
const began = new Date().toISOString();
const snaps = [];
let n = 0;
async function sample() {
  const label = `t${String(n++).padStart(2, "0")} ${new Date().toISOString().slice(11, 19)}`;
  const s = await snapshot(run, { entities, jurors, contracts, granted, label });
  if (granted === undefined) { granted = s.total + (contracts.length ? 0 : 0); s.held = 0; console.log(`(no total was given: this first reading, ${s.total} credits, is the baseline the later ones are checked against)`); }
  const prev = snaps.at(-1);
  snaps.push(s);
  const use = meteredUse(HOME, began, rate);
  console.log("\n" + formatTable(snaps.slice(-6), names));
  if (prev) { const d = deltas(prev, s); const moved = Object.entries(d).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`); console.log(`since the last sample: ${moved.length ? moved.join(", ") : "no credit moved"}`); }
  const c = conservation(s, contracts.length ? 1 : 0);
  console.log(`check: ${c.ok ? "OK" : "PROBLEM"}: ${c.note}`);
  console.log(`metered since start: ${use.sessions} session(s), ${use.tokens} tokens, about ${use.estimate} credit(s) at ${rate} per 1,000 tokens (an estimate: credits do not pay the model provider)`);
  if (out) appendFileSync(out, JSON.stringify({ ...s, check: c, metered: use }) + "\n");
}
await sample();
if (every > 0) { for (;;) { await new Promise((r) => setTimeout(r, every * 1000)); await sample(); } }
