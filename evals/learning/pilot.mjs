// The small pilot of Phase 1 (docs/credits-and-learning-experiment.md): do real agents on a free model show a skill signal the bond floor could price? Two agents, a Learner and a Static one, do a practice
// job each round on the 40-task set (tasks.mjs); the Learner writes a lesson after each and carries its notes into the next task; every round both are measured on a rotating sample of held-out tasks. The
// floor is then computed from the readings with the tested function (packages/asp-log/src/bond-floor.ts). Nothing is written to the log; sessions run in local mode through `asp run codex --local`.
//   node evals/learning/pilot.mjs [--rounds 5] [--n 10] [--model nvidia/nemotron-3-super-120b-a12b:free] [--concurrency 2] [--out <dir>] [--timeout-min 5]
//   node evals/learning/pilot.mjs --fake     a simulated solver instead of a model (no key, no time): to check the runner
// The OpenRouter key is read from OPENROUTER_API_KEY or ~/.asp-openrouter-key and is passed to the child process only; it is never printed. A run can be stopped and started again: finished sessions are kept in <out>/pilot-state.json.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRACTICE, TASKS, check, heldOutSample, makeTask, solve } from "./tasks.mjs";
import { bondFloorPermille } from "../../packages/asp-log/src/bond-floor.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const ASP = resolve(here, "../../packages/asp-cli/bin/asp.mjs");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const FAKE = args.includes("--fake");
const ROUNDS = Number(opt("rounds", "5")), N = Number(opt("n", "10")), CONC = Number(opt("concurrency", "2"));
const MODEL = opt("model", "nvidia/nemotron-3-super-120b-a12b:free"), TIMEOUT_MS = Number(opt("timeout-min", "3")) * 60_000;
const OUT = resolve(opt("out", join(tmpdir(), FAKE ? "asp-learning-pilot-fake" : "asp-learning-pilot")));
const AGENTS = ["learner", "static"];
const KEY = FAKE ? "" : (process.env.OPENROUTER_API_KEY ?? (existsSync(join(homedir(), ".asp-openrouter-key")) ? readFileSync(join(homedir(), ".asp-openrouter-key"), "utf8").trim() : ""));
if (!FAKE && !KEY) { console.error("no OpenRouter key: set OPENROUTER_API_KEY or put it in ~/.asp-openrouter-key (or use --fake)"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const STATE = join(OUT, "pilot-state.json");
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { done: {}, notes: { learner: [], static: [] }, readings: { learner: [], static: [] }, jobs: { learner: [], static: [] } };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);
const hash = (s) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16) / 0xffffffff;

// One attempt at one task, with the agent's notes. Real: asp run codex --local; fake: a stand-in whose skill rises with the number of notes (so the pipeline can be checked).
// Ends a process and its children (codex starts its own): taskkill on Windows, a process group elsewhere.
function killTree(p) {
  try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); else p.kill("SIGKILL"); } catch { /* gone */ }
}
// Runs a command until it exits, a timeout, or `stopWhen()` is true (polled every 4 seconds). The smoke test found that a session often fixed the bug in seconds and then did not exit for the whole timeout,
// so a session is ended as soon as its check passes.
function run(cmd, cmdArgs, env, cwd, stopWhen) {
  return new Promise((done) => {
    const p = spawn(cmd, cmdArgs, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "", finished = false;
    const end = (code) => { if (finished) return; finished = true; clearTimeout(t); clearInterval(poll); done({ code, out }); };
    p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
    const t = setTimeout(() => { killTree(p); end(-2); }, TIMEOUT_MS);
    const poll = stopWhen ? setInterval(() => { try { if (stopWhen()) { killTree(p); end(0); } } catch { /* not yet */ } }, 4000) : undefined;
    p.on("close", (code) => end(code));
    p.on("error", () => end(-1));
  });
}
async function attempt(key, agent, index, notes) {
  if (state.done[key]) return state.done[key];
  const dir = join(OUT, "work", key.replace(/[^\w-]/g, "_"));
  rmSync(dir, { recursive: true, force: true });
  const prompt = makeTask(index, dir) + (notes.length ? `\n\nNotes from your earlier work on similar tasks (use them if they help):\n${notes.map((n) => `- ${n}`).join("\n")}` : "");
  const t0 = Date.now();
  if (FAKE) { if (hash(key) < Math.min(0.9, 0.4 + (agent === "learner" ? 0.07 * notes.length : 0))) solve(index, dir); }
  else {
    await run(process.execPath, [ASP, "run", "codex", "--local", "--provider", "openrouter", "--model", MODEL, "--project", dir, "--prompt", prompt],
      { ...process.env, ASP_HOME: join(OUT, "asp-home"), ASP_NO_FOCUS: "1", OPENROUTER_API_KEY: KEY }, dir, () => check(index, dir).pass);
  }
  const r = check(index, dir);
  const res = { pass: r.pass, why: r.why, secs: Math.round((Date.now() - t0) / 1000), task: index, family: TASKS[index].family };
  state.done[key] = res; save();
  log(`${key.padEnd(24)} task ${String(index).padStart(2)} ${TASKS[index].family.padEnd(13)} ${res.pass ? "pass" : "FAIL"}  ${res.secs}s${res.pass ? "" : "  " + res.why.slice(0, 60)}`);
  return res;
}

// A short lesson after a task: from the buggy source's family and what happened. Real: one chat call to the same model; fake: a fixed line.
async function reflect(index, result, dir) {
  if (FAKE) return `lesson about ${TASKS[index].family}: check boundaries and empty input`;
  let src = ""; try { src = readFileSync(join(dir, "src.js"), "utf8").slice(0, 600); } catch { /* none */ }
  const ask = `You just worked on a small JavaScript bug (kind: ${TASKS[index].family}). Your final source:\n${src}\nResult: ${result.pass ? "the test passed" : "the test still failed: " + result.why}.\nWrite ONE general lesson of at most 25 words that would help fix a different bug of this kind next time. Output only the lesson.`;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: ask }], max_tokens: 80 }), signal: AbortSignal.timeout(60_000) });
    const text = (await res.json()).choices?.[0]?.message?.content?.trim();
    return text ? text.replace(/\s+/g, " ").slice(0, 200) : `lesson about ${TASKS[index].family}: check boundaries`;
  } catch { return `lesson about ${TASKS[index].family}: check boundaries`; }
}

async function pool(items, fn) { const out = []; let next = 0; await Promise.all(Array.from({ length: CONC }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } })); return out; }

async function reading(agent, round) {
  const notes = agent === "learner" ? [...state.notes.learner] : [];
  const sample = heldOutSample(`${agent}:${round}`, N);
  const results = await pool(sample, (index) => attempt(`${agent}-read${round}-t${index}`, agent, index, notes));
  return { round, passes: results.filter((r) => r.pass).length, n: N };
}

// The record, the way the simulation scores it: a smoothed estimate against a baseline and against its own best; then the floor.
export function track(readings, acceptedJobs, { alpha = 0.3, step = 0.15, k = 2 } = {}) {
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const fr = readings.map((r) => r.passes / r.n);
  const rows = [];
  let est = fr[0], best = est;
  for (let i = 0; i < fr.length; i++) {
    if (i > 0) { est = alpha * fr[i] + (1 - alpha) * est; best = Math.max(best, est); }
    const baseline = fr.slice(0, Math.min(k, i + 1)).reduce((a, b) => a + b, 0) / Math.min(k, i + 1);
    const rec = { ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0, verifiedImprovements: i === 0 ? 0 : clamp((est - baseline) / step, 0, 3.4), regressions: i === 0 ? 0 : clamp((best - est) / (2 * step), 0, 2), acceptedCleanJobs: acceptedJobs[i] ?? 0 };
    rows.push({ round: readings[i].round, reading: `${readings[i].passes}/${readings[i].n}`, est: +est.toFixed(2), improvements: +rec.verifiedImprovements.toFixed(2), regressions: +rec.regressions.toFixed(2), jobs: rec.acceptedCleanJobs, floor: Math.round(bondFloorPermille(rec)) });
  }
  return rows;
}

export async function pilot() {
  log(`pilot: ${AGENTS.join(" and ")}, ${ROUNDS} rounds, ${N} held-out tasks a reading, ${FAKE ? "a simulated solver" : `model ${MODEL}`}, up to ${CONC} sessions at once; state in ${STATE}`);
  for (const agent of AGENTS) {
    if (state.readings[agent].length === 0) { state.readings[agent].push(await reading(agent, 0)); save(); }
    for (let r = state.readings[agent].length; r <= ROUNDS; r++) {
      // The practice job: a task from the practice pool (a different family each round); accepted when its check passes.
      const index = PRACTICE[((r - 1) * 3) % PRACTICE.length];
      const notes = agent === "learner" ? [...state.notes.learner] : [];
      const job = await attempt(`${agent}-job${r}-t${index}`, agent, index, notes);
      state.jobs[agent].push(job.pass);
      if (agent === "learner") { state.notes.learner.push(await reflect(index, job, join(OUT, "work", `${agent}-job${r}-t${index}`))); state.notes.learner = state.notes.learner.slice(-8); }
      state.readings[agent].push(await reading(agent, r)); save();
    }
  }
  const report = {};
  console.log("\nround   " + AGENTS.map((a) => `${a.padEnd(42)}`).join(""));
  for (const agent of AGENTS) {
    const accepted = []; let c = 0; for (let i = 0; i <= ROUNDS; i++) { if (i > 0 && state.jobs[agent][i - 1]) c++; accepted.push(c); }
    report[agent] = track(state.readings[agent], accepted);
  }
  for (let r = 0; r <= ROUNDS; r++) console.log(`${String(r).padEnd(8)}` + AGENTS.map((a) => { const x = report[a][r]; return `${x.reading.padEnd(6)} est ${x.est.toFixed(2)} imp ${x.improvements.toFixed(1)} reg ${x.regressions.toFixed(1)} floor ${String(x.floor).padStart(3)}`.padEnd(42); }).join(""));
  const L = report.learner.at(-1), S = report.static.at(-1);
  console.log(`\nLearner's lessons: ${state.notes.learner.length ? "\n  - " + state.notes.learner.join("\n  - ") : "none"}`);
  console.log(`\nFinal floor: Learner ${L.floor}, Static ${S.floor} (permille of the price).`);
  console.log(L.floor < S.floor ? `The Learner's floor is ${S.floor - L.floor} below the Static agent's.` : `The Learner's floor is NOT below the Static agent's (difference ${L.floor - S.floor}).`);
  console.log(`One pilot, ${N} tasks a reading: a single run, so a difference smaller than about 100 permille is within the noise the simulation predicts. A real result needs the same run repeated.`);
  writeFileSync(join(OUT, "pilot-report.json"), JSON.stringify({ model: FAKE ? "fake" : MODEL, rounds: ROUNDS, n: N, report, notes: state.notes.learner, jobs: state.jobs }, null, 1));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await pilot();
