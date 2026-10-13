// Walks one job through its whole life, one step per run, and shows the credits by entity after each step, so a person can see what happens without copying ids around.
//   node evals/live-job.mjs next    [--home <ASP_HOME>]   do the next step
//   node evals/live-job.mjs status  [--home <ASP_HOME>]   where the job is and the credits now
//   node evals/live-job.mjs reject  [--home <ASP_HOME>]   instead of accepting a delivery: reject it (opens a dispute)
//   node evals/live-job.mjs reset   [--home <ASP_HOME>]   forget the saved job (nothing in the log is touched)
// Options for the first step: --price 40 --bond 20 --gate (hold shell commands for your yes) --skip-work (record a report by hand instead of running Claude Code; for a rehearsal)
// It uses the saved login's person, agent and bank. Everything it writes to the log is permanent. Credits are accounting entries, not money. It never prints a token or a key.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { conservation, formatTable, snapshot } = await import(new URL("../packages/asp-cli/src/ledger.ts", import.meta.url).href);
const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const HOME = resolve(opt("home", process.env.ASP_HOME ?? ""));
if (!existsSync(HOME)) { console.error("give --home <ASP_HOME> (a folder that exists)"); process.exit(2); }
const ASP = resolve(fileURLToPath(new URL("../packages/asp-cli/bin/asp.mjs", import.meta.url)));
const STATE = join(HOME, "live-job.json");
const id = JSON.parse(readFileSync(join(HOME, "config.json"), "utf8")).identities;
const { me: ME, agent: AGENT, bank: BANK } = id;
const entities = [{ name: "principal", did: ME }, { name: "agent", did: AGENT }, { name: "bank", did: BANK }];
const PROJECT = resolve(opt("project", join(process.env.HOME ?? process.env.USERPROFILE ?? ".", "asp-live-project")));
const PKG = resolve(opt("package", join(process.env.HOME ?? process.env.USERPROFILE ?? ".", "asp-market-pkg")));

const run = async (a, { inherit = false } = {}) => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", ASP, ...a], { env: { ...process.env, ASP_HOME: HOME, ASP_NO_FOCUS: "1" }, encoding: "utf8", timeout: 600_000, stdio: inherit ? ["inherit", "inherit", "inherit"] : "pipe" });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const must = async (a) => { const r = await run(a); if (r.code) { console.error(`\nThat step failed: ${a.slice(0, 3).join(" ")}\n${(r.err || r.out).trim().slice(0, 600)}`); process.exit(1); } return r.out; };
const grab = (re, text) => { const m = re.exec(text); if (!m) { console.error(`could not read an id from: ${text.slice(0, 200)}`); process.exit(1); } return m[1]; };
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : undefined);
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2) + "\n");

const ORDER = ["intent", "offer", "contract", "bond", "mandate", "work", "deliver", "decide", "settle", "done"];
const SAYS = {
  intent: "You said what you want done, what it may cost at most, and by when.",
  offer: "Your agent offered to do it for a price, with a bond (credits it would lose if it misbehaves).",
  contract: "You and the agent agreed. Nothing is locked yet.",
  bond: "The price went into escrow (taken from you) and the bond was locked (taken from the agent). The protocol also holds a small court-fee reserve while the job is open.",
  mandate: "You stated exactly what the agent may do. The job is now Running, and the gateway removes anything outside it before the agent sees it.",
  work: "The agent did the work under the Mandate, and the gateway reported what it actually did (the Action).",
  deliver: "The agent delivered its result with a claim about it.",
  accept: "You accepted the delivery.",
  reject: "You rejected the delivery. The job is Disputed: three neutral jurors would now rule.",
  settle: "The job was settled and the credits moved.",
};
const NEXT = { intent: "offer", offer: "contract", contract: "bond", bond: "mandate", mandate: "work", work: "deliver", deliver: "decide", decide: "settle", settle: "done" };

async function show(state, label) {
  const contracts = state.contract && !state.settled ? [state.contract] : [];
  const snaps = [...(state.rows ?? [])];
  const s = await snapshot(run, { entities, contracts, granted: state.granted, label });
  snaps.push(s);
  state.rows = snaps.map((x) => ({ ...x })).slice(-12);
  console.log("\n" + formatTable(snaps.slice(-8), ["principal", "agent", "bank"]));
  const c = conservation(s, contracts.length);
  console.log(`credits: ${c.ok ? "OK" : "PROBLEM"}: ${c.note}`);
  return s;
}

if (cmd === "reset") { rmSync(STATE, { force: true }); console.log("saved job forgotten (nothing in the log was touched)"); process.exit(0); }
let state = load();
if (cmd === "status") {
  if (!state) { console.log("no job in progress. `node evals/live-job.mjs next` starts one."); process.exit(0); }
  console.log(`job in progress: ${state.contract ? `contract ${state.contract.slice(0, 19)}...` : "not yet contracted"}; next step: ${state.step}`);
  await show(state, "now"); save(state); process.exit(0);
}
if (cmd !== "next" && cmd !== "reject") { console.error("usage: node evals/live-job.mjs next|status|reject|reset [--home <ASP_HOME>]"); process.exit(2); }

if (!state) {
  const first = await snapshot(run, { entities, label: "start" });
  const granted = first.total;
  state = { step: "intent", price: Number(opt("price", "40")), bond: Number(opt("bond", "20")), gate: flag("gate"), skipWork: flag("skip-work"), granted, rows: [first], purpose: `Summarise the project folder in five lines (${new Date().toISOString().slice(0, 19)})` };
  console.log(`Starting a job. You, the principal: ${ME.split(":").slice(-1)[0]}. Your agent: ${AGENT.split(":").slice(-1)[0]}. Credits in play: ${granted}.`);
  console.log(`\n${formatTable([first], ["principal", "agent", "bank"])}`);
}

const step = cmd === "reject" ? "decide" : state.step;
const FUTURE = "2099-01-01T00:00:00Z", REVIEW = "2098-01-01T00:00:00Z";
if (step !== state.step && cmd === "reject" && state.step !== "decide") { console.error(`the job is not at the decision yet (next step: ${state.step})`); process.exit(1); }
console.log(`\n== ${step} ==`);

if (step === "intent") {
  const out = await must(["market", "intent", "--by", ME, "--purpose", state.purpose, "--criteria", "Exactly five lines, plain English", "--budget", String(state.price + 10), "--deadline", FUTURE, "--verification", "principal", "--review-deadline", REVIEW]);
  state.intent = grab(/^intent (\S+)/, out);
} else if (step === "offer") {
  const out = await must(["market", "offer", "--by", AGENT, "--intent", state.intent, "--price", String(state.price), "--plan", "Read the folder and write five lines", "--eta", "2098-01-01T00:00:00Z", "--bond-offered", String(state.bond)]);
  state.offer = grab(/^offer (\S+)/, out);
} else if (step === "contract") {
  const out = await must(["market", "contract", "--principal", ME, "--bank", BANK, "--intent", state.intent, "--offer", state.offer]);
  state.contract = grab(/^contract (\S+):/, out);
} else if (step === "bond") {
  await must(["market", "bond", "--contract", state.contract, "--backer", AGENT, "--amount", String(state.bond), "--escrow-payer", ME, "--escrow-amount", String(state.price)]);
} else if (step === "mandate") {
  await must(["market", "mandate", "--contract", state.contract, "--principal", ME, "--performer", AGENT, "--scopes", "repo.read", ...(state.gate ? ["--scopes", "shell.exec", "--gate", "shell.exec"] : [])]);
} else if (step === "work") {
  if (state.skipWork) {
    await must(["market", "action", "--contract", state.contract, "--by", AGENT, "--scopes-used", "repo.read", "--metrics", JSON.stringify({ requests: 5, tool_calls: 3, tokens_in: 4000, tokens_out: 900 }), "--summary", "work (rehearsal: reported by hand)"]);
  } else {
    if (!existsSync(PKG)) await must(["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", PROJECT, "--out", PKG]);
    console.log("Claude Code is working under the contract (about a minute). Anything it does outside the Mandate is removed before it runs.\n");
    const r = await run(["run", PKG, "--backend", "claude-code", "--project", PROJECT, "--prompt", "Look at every file in this folder and write a summary of what the project is in exactly five lines.", "--contract", state.contract, "--no-canary", "--approval-wait", "600"], { inherit: true });
    if (r.code) { console.error(`\nThe run ended with an error (exit ${r.code}). Nothing else was changed; run \`next\` again to retry this step.`); process.exit(1); }
  }
} else if (step === "deliver") {
  await must(["market", "deliver", "--contract", state.contract, "--by", AGENT, "--summary", "Five-line summary of the project folder", "--claim", "The summary is five lines::measured"]);
} else if (step === "decide") {
  if (cmd === "reject") { await must(["market", "reject", "--contract", state.contract, "--by", ME, "--reasons", "Not what I asked for"]); state.rejected = true; }
  else await must(["market", "accept", "--contract", state.contract, "--by", ME]);
} else if (step === "settle") {
  if (state.rejected) { console.log("A rejected job goes to the court: see Act 3 of docs/live-run-market.md (the operator seats the jurors and rules, then settle with --basis ruling)."); await show(state, "disputed"); save(state); process.exit(0); }
  await must(["market", "settle", "--contract", state.contract, "--bank", BANK, "--basis", "accepted"]);
  state.settled = true;
} else if (step === "done") { console.log("This job is finished. `reset` clears it so you can start another."); process.exit(0); }

console.log(SAYS[step === "decide" ? (state.rejected ? "reject" : "accept") : step]);
state.step = state.rejected ? "settle" : NEXT[step];
await show(state, step === "decide" ? (state.rejected ? "rejected" : "accepted") : step);
save(state);
const hint = { offer: "your agent makes its offer", contract: "you and the agent agree", bond: "the money is locked", mandate: "you state what it may do", work: "the agent works (this runs Claude Code)", deliver: "the agent delivers", decide: "you accept or reject", settle: "the job is settled and the credits move", done: "the job is finished" }[state.step];
if (hint) {
  console.log(`\nNext: ${hint}.`);
  if (state.step === "decide") { console.log("  to accept:  node evals/live-job.mjs next"); console.log("  to reject:  node evals/live-job.mjs reject"); }
  else console.log("  run:  node evals/live-job.mjs next");
}
