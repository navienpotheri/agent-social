// Shared helpers for the live evaluations in this folder. Each evaluation builds a throwaway ASP home in the system temp folder,
// sets up parties and a job through the real CLI, runs a real agent or service, and reads what happened back from the log.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TOOLS = process.env.ASP_EVAL_TOOLS ?? join(homedir(), "asp-tools");
export const MODEL = process.env.ASP_EVAL_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free";
export const CLAUDE_MODEL = process.env.ASP_EVAL_CLAUDE_MODEL ?? "claude-haiku-5-5";
const KEY_FILE = process.env.ASP_EVAL_OPENROUTER_KEY_FILE ?? join(homedir(), ".asp-openrouter-key");

/** The CLI entry point, loaded from this repo. */
export async function loadMain() {
  return (await import(pathToFileURL(join(ROOT, "packages", "asp-cli", "src", "cli.ts")).href)).main;
}
export async function loadPackage() {
  return await import(pathToFileURL(join(ROOT, "packages", "asp-package", "src", "index.ts")).href);
}

/** True when a program is on the PATH. */
export function have(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}
/** Providers the evaluations can use for a model: the key lives in an environment variable or a file in the home folder (see PROVIDERS in canary.ts). */
export const PROVIDER_KEYS = {
  openrouter: { env: "ASP_OR_KEY", file: process.env.ASP_EVAL_OPENROUTER_KEY_FILE ?? join(homedir(), ".asp-openrouter-key") },
  groq: { env: "ASP_GROQ_KEY", file: join(homedir(), ".asp-groq-key") },
  cerebras: { env: "ASP_CEREBRAS_KEY", file: join(homedir(), ".asp-cerebras-key") },
  gemini: { env: "ASP_GEMINI_KEY", file: join(homedir(), ".asp-gemini-key") },
};
export const providerKey = (name) => { const p = PROVIDER_KEYS[name]; return process.env[p.env] ?? (existsSync(p.file) ? readFileSync(p.file, "utf8").trim() : undefined); };
export const openrouterKey = () => (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : undefined);
export const toolPath = (...p) => join(TOOLS, ...p);

/** A fresh working folder under the system temp folder. */
export function workdir(name) {
  const dir = join(tmpdir(), "asp-evals", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir.replace(/\\/g, "/");
}

export const D = (n) => `did:web:example.com:${n}`;

/** Collects named checks and prints a result. A check is pass, fail, or inconclusive (the agent never did the thing under test). */
export class Eval {
  constructor(name, description) { this.name = name; this.checks = []; this.notes = []; console.log(`\n=== ${name}: ${description} ===`); }
  pass(name, detail) { this.checks.push({ name, status: "pass", detail }); console.log(`  PASS  ${name}${detail ? ` (${detail})` : ""}`); }
  fail(name, detail) { this.checks.push({ name, status: "fail", detail }); console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ""}`); }
  inconclusive(name, detail) { this.checks.push({ name, status: "inconclusive", detail }); console.log(`  ?     ${name}${detail ? ` (${detail})` : ""}`); }
  check(name, ok, detail) { return ok ? this.pass(name) : this.fail(name, detail); }
  /** A failure we already know about and track in docs/gaps-register.md: shown, but it does not fail the run. */
  knownGap(name, id, detail) { this.checks.push({ name, status: "known-gap", detail: `gaps register ${id}${detail ? `: ${detail}` : ""}` }); console.log(`  GAP   ${name} (gaps register ${id})`); }
  note(text) { this.notes.push(text); console.log(`  note  ${text}`); }
  /** Prints the verdict; the exit code is 1 on any failure, 0 otherwise (inconclusive is not a failure but is shown). */
  finish() {
    const failed = this.checks.filter((c) => c.status === "fail").length;
    const unsure = this.checks.filter((c) => c.status === "inconclusive").length;
    const gaps = this.checks.filter((c) => c.status === "known-gap").length;
    console.log(`  => ${failed ? "FAILED" : unsure ? "passed with inconclusive checks" : "passed"} (${this.checks.length} checks, ${failed} failed, ${unsure} inconclusive, ${gaps} known gap(s))`);
    if (process.env.ASP_EVAL_JSON) writeFileSync(process.env.ASP_EVAL_JSON, JSON.stringify({ name: this.name, checks: this.checks, notes: this.notes }, null, 2));
    process.exitCode = failed ? 1 : 0;
    return !failed;
  }
}

/** Ends an evaluation early because something it needs is missing: not a failure. */
export function skip(name, reason) {
  console.log(`\n=== ${name}: SKIPPED (${reason}) ===`);
  if (process.env.ASP_EVAL_JSON) writeFileSync(process.env.ASP_EVAL_JSON, JSON.stringify({ name, skipped: reason }, null, 2));
  process.exit(0);
}

/** An ASP home driven through the real CLI in this process (one command at a time). */
export async function session(dir, extraEnv = {}) {
  const main = await loadMain();
  const home = `${dir}/asp`;
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, ASP_HOME: home, ...extraEnv };
  const s = {
    dir, home, env,
    async asp(args, more = {}) {
      const out = [], err = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ...env, ...more }, cwd: dir });
      return { code, out: out.join("\n"), err: err.join("\n") };
    },
    async must(args, more) { const r = await s.asp(args, more); if (r.code) throw new Error(`failed: asp ${args.join(" ")}\n${r.err || r.out}`); return r; },
    grab(re, text) { const m = re.exec(text); if (!m) throw new Error(`no match for ${re} in: ${text.slice(0, 200)}`); return m[1]; },
    async balance(did) { return Number(s.grab(/: (\d+) credits/, (await s.must(["credits", "balance", did])).out)); },
    /** Human principal, bank, and one agent sponsored by the principal. */
    async parties({ principal = D("users:alice"), bank = D("bank"), agents = [D("agents:coder")] } = {}) {
      await s.must(["identity", "new", "--kind", "human", "--did", principal]);
      await s.must(["identity", "new", "--kind", "human", "--did", bank]);
      for (const a of agents) await s.must(["identity", "new", "--kind", "agent", "--did", a, "--sponsor", principal, "--purpose", "An evaluation agent"]);
      return { principal, bank, agents };
    },
    /** Intent, offer, contract, bond and Mandate; returns the contract id. */
    async job({ principal, bank, agent, scopes, gates = [], mandateFlags = [], shareToCommons = false, reviewDeadline, purpose = `Evaluation job ${Math.random().toString(36).slice(2, 8)}`, price = 1000, bond = 200 }) {
      await s.must(["credits", "grant", "--to", principal, "--amount", String(price + 200)]);
      await s.must(["credits", "grant", "--to", agent, "--amount", String(bond + 200)]);
      const intent = s.grab(/^intent (\S+)/, (await s.must(["market", "intent", "--by", principal, "--purpose", purpose, "--budget", String(price), "--deadline", "2099-01-01T00:00:00Z", ...(reviewDeadline ? ["--verification", "principal", "--review-deadline", reviewDeadline] : [])])).out);
      const offer = s.grab(/^offer (\S+)/, (await s.must(["market", "offer", "--by", agent, "--intent", intent, "--price", String(price), "--plan", "do it", "--eta", "2098-01-01T00:00:00Z"])).out);
      const contract = s.grab(/^contract (\S+):/, (await s.must(["market", "contract", "--principal", principal, "--bank", bank, "--intent", intent, "--offer", offer])).out);
      await s.must(["market", "bond", "--contract", contract, "--backer", agent, "--amount", String(bond), "--escrow-payer", principal, "--escrow-amount", String(price)]);
      await s.must(["market", "mandate", "--contract", contract, "--principal", principal, "--performer", agent, ...scopes.flatMap((x) => ["--scopes", x]), ...gates.flatMap((g) => ["--gate", g]), ...(shareToCommons ? ["--share-to-commons"] : []), ...mandateFlags]);
      return contract;
    },
    /** Every Action in the log, newest last. */
    async actions() {
      const { LocalLog } = await loadPackage();
      const local = await LocalLog.open(home);
      return (await local.log.since(0, 5000)).filter((x) => x.record.type === "asp.action/v0.2").map((x) => ({ issuer: x.record.issuer, ...x.record.body }));
    },
    async verifyLog() { return (await s.asp(["log", "verify"])).out.trim(); },
  };
  return s;
}

/** Runs a program with inherited output; returns its exit status. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  return r.status ?? 1;
}
export { execFileSync };

/** Runs `asp gateway` around a command and reads the outcome back from its report and from the log. */
export async function gateway(s, { contract, agent, flags = [], command, env = {} }) {
  const r = await s.asp(["gateway", "--contract", contract, "--by", agent, "--max-strikes", "10", ...flags, "--", ...command], env);
  const lines = r.err.split("\n");
  const refused = lines.filter((l) => /^\s*REFUSED /.test(l)).map((l) => l.trim());
  const allowed = lines.filter((l) => /^\s*allowed /.test(l)).map((l) => l.trim());
  const summaryLine = lines.find((l) => /^\s*summary /.test(l));
  const summary = summaryLine ? JSON.parse(summaryLine.replace(/^\s*summary\s+/, "")) : undefined;
  return { ...r, refused, allowed, summary, lines };
}

/** OpenRouter as an OpenAI-compatible upstream, with the key kept in the evaluation's environment (never the agent's). */
export function openrouterFlags() {
  return ["--openai-upstream", "https://openrouter.ai/api/v1", "--openai-key-env", "ASP_OR_KEY"];
}
