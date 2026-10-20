// (Second version: tasks with a hidden house rule each, agents run side by side, and a --calibrate mode.)
// The small pilot of Phase 1 (docs/credits-and-learning-experiment.md): do real agents on a free model show a skill signal the bond floor could price? Two agents, a Learner and a Static one, do a practice
// job each round on the 40-task set (tasks.mjs); the Learner writes a lesson after each and carries its notes into the next task; every round both are measured on a rotating sample of held-out tasks. The
// floor is then computed from the readings with the tested function (packages/asp-log/src/bond-floor.ts). Nothing is written to the log; sessions run in local mode through `asp run codex --local`.
//   node evals/learning/pilot.mjs [--rounds 5] [--n 10] [--model nvidia/nemotron-3-super-120b-a12b:free] [--concurrency 2] [--out <dir>] [--timeout-min 5]
//   node evals/learning/pilot.mjs --calibrate --oracle   the same reading with the three house rules given as notes: can the model apply a rule it is told without breaking its files (Amendment 9)
//   node evals/learning/pilot.mjs --calibrate   one no-notes reading: how much of the task set the model passes before anything is learned
//   --extend-to <round>     if the decision after --rounds is in the middle band, continue to this round, where a significance test decides (Amendment 8)
//   --test-reflect          write one lesson from a sample verdict and print it (to check that the lesson call works with the model)
//   --provider openai       use OpenAI directly instead of OpenRouter (key in OPENAI_API_KEY or ~/.asp-openai-key; model like gpt-5-mini; needs --price-in and --price-out)
//   --max-spend <dollars>   stop before the next session once the estimated spend on a paid model reaches this (price read from OpenRouter's model list)
//   node evals/learning/pilot.mjs --fake     a simulated solver instead of a model (no key, no time): to check the runner
// The OpenRouter key is read from OPENROUTER_API_KEY or ~/.asp-openrouter-key and is passed to the child process only; it is never printed. A run can be stopped and started again: finished sessions are kept in <out>/pilot-state.json.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRACTICE, RULES, TASKS, check, heldOutSample, makeTask, solve } from "./tasks.mjs";
import { decide } from "./decide.mjs";
import { bondFloorPermille } from "../../packages/asp-log/src/bond-floor.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const ASP = resolve(here, "../../packages/asp-cli/bin/asp.mjs");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const FAKE = args.includes("--fake");
const ROUNDS = Number(opt("rounds", "5")), N = Number(opt("n", "10")), CONC = Number(opt("concurrency", "2"));
const EXTEND_TO = Number(opt("extend-to", String(ROUNDS)));   // continue to this round if the decision after ROUNDS is in the middle band (Amendment 8)
const MODEL = opt("model", "nvidia/nemotron-3-super-120b-a12b:free"), TIMEOUT_MS = Number(opt("timeout-min", "3")) * 60_000;
const OUT = resolve(opt("out", join(tmpdir(), FAKE ? "asp-learning-pilot-fake" : "asp-learning-pilot")));
const AGENTS = ["learner", "static"];
const ORACLE = args.includes("--oracle");   // with --calibrate: the three house rules are given as notes (an oracle Learner), to measure whether the model can apply a rule it is told (Amendment 9)
const ORACLE_NOTES = RULES.map((r) => `${r.id}: ${r.text}`);
// A spending cap for a paid model (US dollars). The price per million tokens comes from OpenRouter's public model list; a free model costs nothing and needs no cap. Tokens are counted from the run logs and
// the reflection calls, and the run stops before the next session once the cap is reached (the state is kept, so it can be raised and resumed). The count is an estimate from the tokens the gateway saw.
const MAX_SPEND = opt("max-spend", undefined) === undefined ? undefined : Number(opt("max-spend"));
let PRICE = { in: 0, out: 0 };
// The provider behind Codex: OpenRouter (default) or OpenAI directly (--provider openai: the key is read from OPENAI_API_KEY or ~/.asp-openai-key, the model is named without a prefix, e.g. gpt-5-mini, and the
// price per million tokens is given with --price-in and --price-out, since OpenAI has no public model list to read it from). Nothing here prints a key.
const PROVIDER = opt("provider", "openrouter");
if (!["openrouter", "openai"].includes(PROVIDER)) { console.error("--provider is openrouter or openai"); process.exit(2); }
const KEY_ENV = PROVIDER === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
const KEY_FILE = join(homedir(), PROVIDER === "openai" ? ".asp-openai-key" : ".asp-openrouter-key");
const KEY = FAKE ? "" : (process.env[KEY_ENV] ?? (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : ""));
if (!FAKE && !KEY) { console.error(`no ${PROVIDER} key: set ${KEY_ENV} or put it in ${KEY_FILE} (or use --fake)`); process.exit(2); }
mkdirSync(OUT, { recursive: true });
// Codex's Windows write sandbox lists the temp folder as writable and hangs when that folder is huge (found 2026-10-19: with a small empty temp folder a command ran in 0.2 seconds, with the user's own it never returned). Each run gets a small
// temp folder of its own, so a session cannot depend on how full the machine's temp folder is.
const SMALL_TMP = join(OUT, "tmp");
mkdirSync(SMALL_TMP, { recursive: true });

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
// Provider errors (a 429 limit, a 5xx) that the gateway recorded in any run log since a time: the first calibration of v2 had three sessions end in a provider 500 and wait out the timeout, and they were
// scored as failures. With sessions running side by side the error cannot be tied to one session, so a failed attempt in a window that had any provider error is not counted.
function providerErrorsSince(t0) {
  const root = join(OUT, "asp-home", "local", "runs");
  const found = [];
  try {
    for (const d of readdirSync(root)) {
      const f = join(root, d, "run-log.ndjson");
      if (!existsSync(f) || statSync(f).mtimeMs < t0 - 1000) continue;
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (!line.includes('"model_error"')) continue;
        try { const e = JSON.parse(line); if (Date.parse(e.at) >= t0 - 1000) found.push(e.data?.status ?? "error"); } catch { /* half a line */ }
      }
    }
  } catch { /* no runs yet */ }
  return found;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The estimated spend so far: the tokens every session's run log recorded at its end, plus the reflection calls, at the model's price per million tokens.
function tokensSoFar() {
  let tin = state.reflect?.in ?? 0, tout = state.reflect?.out ?? 0;
  const root = join(OUT, "asp-home", "local", "runs");
  try {
    for (const d of readdirSync(root)) {
      const f = join(root, d, "run-log.ndjson");
      if (!existsSync(f)) continue;
      for (const line of readFileSync(f, "utf8").split("\n")) {
        // Every model reply carries its tokens. (The run's closing `run_end` line is not used: a session that is ended the moment its check passes never writes it, so counting it would miss
        // exactly the sessions that succeed; found 2026-10-19 when a calibration in which every session passed showed $0.00.)
        if (!line.includes('"model_reply"')) continue;
        try { const d = JSON.parse(line).data; tin += d?.tokens_in ?? 0; tout += d?.tokens_out ?? 0; } catch { /* half a line */ }
      }
    }
  } catch { /* no runs yet */ }
  return { tin, tout };
}
const spendNow = () => { const t = tokensSoFar(); return (t.tin * PRICE.in + t.tout * PRICE.out) / 1e6; };
async function loadPrice() {
  if (MAX_SPEND === undefined || FAKE) return;
  if (PROVIDER === "openai") {
    if (opt("price-in", undefined) === undefined || opt("price-out", undefined) === undefined) { console.error("with --provider openai give --price-in and --price-out (dollars per million tokens, from https://openai.com/api/pricing/) so the spending cap can work"); process.exit(2); }
    PRICE = { in: Number(opt("price-in")), out: Number(opt("price-out")) };
    log(`price of ${MODEL} (as given): $${PRICE.in.toFixed(2)} a million tokens in, $${PRICE.out.toFixed(2)} out; cap $${MAX_SPEND}; spent so far about $${spendNow().toFixed(3)}`);
    return;
  }
  try {
    const list = (await (await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(30_000) })).json()).data ?? [];
    const m = list.find((x) => x.id === MODEL);
    if (!m) throw new Error(`the model ${MODEL} is not in OpenRouter's list, so its price is unknown`);
    PRICE = { in: Number(m.pricing.prompt) * 1e6, out: Number(m.pricing.completion) * 1e6 };
    log(`price of ${MODEL}: $${PRICE.in.toFixed(2)} a million tokens in, $${PRICE.out.toFixed(2)} out; cap $${MAX_SPEND}; spent so far about $${spendNow().toFixed(3)}`);
  } catch (e) { console.error(`cannot set a spending cap: ${e.message}`); process.exit(2); }
}
async function attempt(key, agent, index, notes, tries = 0) {
  if (state.done[key]) return state.done[key];
  if (MAX_SPEND !== undefined && !FAKE && spendNow() >= MAX_SPEND) throw Object.assign(new Error(`the spending cap of $${MAX_SPEND} is reached (about $${spendNow().toFixed(2)} spent)`), { infra: true, cap: true });
  const dir = join(OUT, "work", key.replace(/[^\w-]/g, "_"));
  rmSync(dir, { recursive: true, force: true });
  const prompt = makeTask(index, dir) + (notes.length ? `\n\nNotes from your earlier work on similar tasks (use them if they help):\n${notes.map((n) => `- ${n}`).join("\n")}` : "");
  const t0 = Date.now();
  let ran = { out: "" };
  if (FAKE) { const knows = agent === "oracle" || (agent === "learner" && notes.length >= 1 + (index % 3)); const logicOk = hash(key + "L") < 0.85; if (logicOk) solve(index, dir, { compliant: knows || hash(key + "R") < 0.05 }); }
  else {
    ran = await run(process.execPath, [ASP, "run", "codex", "--local", "--provider", PROVIDER, "--model", MODEL, "--project", dir, "--prompt", prompt],
      { ...process.env, ASP_HOME: join(OUT, "asp-home"), ASP_NO_FOCUS: "1", [KEY_ENV]: KEY, TEMP: SMALL_TMP, TMP: SMALL_TMP, TMPDIR: SMALL_TMP }, dir, () => check(index, dir).pass);
  }
  const r = check(index, dir);
  // A provider that refuses or fails the call is not a task that failed: the first pilot counted a day's free-model limit (HTTP 429) as thirty-four failures of one agent. The attempt is made again after a pause
  // (up to four tries), and if the provider is still failing the run stops, the state is kept, and nothing is counted.
  const providerErrs = providerErrorsSince(t0);
  const refused = /HTTP 4(29|01)|rate limit exceeded|free-models-per-day|Too Many Requests|refused the API key/i.test(ran.out);
  if (!r.pass && !FAKE && (refused || providerErrs.length)) {
    const why = refused ? (ran.out.match(/rate limit[^\n]{0,80}|HTTP 4\d\d[^\n]{0,80}/i) ?? ["rate limit"])[0].trim() : `provider errors ${[...new Set(providerErrs)].join(", ")}`;
    if (tries < 4) { log(`${key}: the provider failed the call (${why}); waiting 70 seconds and trying again (${tries + 1} of 4)`); await sleep(70_000); return attempt(key, agent, index, notes, tries + 1); }
    throw Object.assign(new Error(`the model provider failed the call (${why})`), { infra: true });
  }
  const res = { pass: r.pass, logic: r.logic, why: r.why, secs: Math.round((Date.now() - t0) / 1000), task: index, family: TASKS[index].family };
  state.done[key] = res; save();
  log(`${MAX_SPEND !== undefined && !FAKE ? `$${spendNow().toFixed(2)}  ` : ""}${key.padEnd(24)} task ${String(index).padStart(2)} ${TASKS[index].family.padEnd(13)} ${res.pass ? "pass" : "FAIL"}  ${res.secs}s${res.pass ? "" : "  " + res.why.slice(0, 60)}`);
  return res;
}

// A short lesson after a task: from the buggy source's family and what happened. Real: one chat call to the same model; fake: a fixed line.
async function reflect(index, result, dir) {
  if (FAKE) return `project rule: ${(result.why.match(/house rule (H\d)/) ?? ["", "none"])[1]} - ${result.why.slice(result.why.indexOf(":") + 2)}`.slice(0, 200);
  let src = ""; try { src = readFileSync(join(dir, "src.js"), "utf8").slice(0, 600); } catch { /* none */ }
  const ask = `You just worked on a small JavaScript task for a project that has house coding rules that are not written down. Your final source:\n${src}\nThe reviewer's verdict: ${result.pass ? "accepted" : result.why}.\nWrite ONE general lesson of at most 30 words that would help you meet this project's rules on the next task. If it was accepted, write what you did that the project wants. Output only the lesson.`;
  // A reasoning model spends its output budget on reasoning first: the first Linux pilot gave this call 80 tokens, gpt-5-mini used them all, the text came back empty, and a silent fallback line
  // ("lesson about X: check boundaries") was stored as the Learner's lesson for every round, so it never learned anything (found 2026-10-19 at 80 of 106 sessions). So: a large budget, minimal reasoning,
  // a few tries, and no fallback: if no real lesson can be had the run stops (nothing is counted) and says why.
  let last = "no answer";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const direct = PROVIDER === "openai";
      const res = await fetch(direct ? "https://api.openai.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: ask }], ...(direct ? { max_completion_tokens: 2000, reasoning_effort: "minimal" } : { max_tokens: 2000, reasoning: { effort: "minimal" } }) }), signal: AbortSignal.timeout(90_000) });
      const body = await res.json();
      state.reflect = { in: (state.reflect?.in ?? 0) + (body.usage?.prompt_tokens ?? 0), out: (state.reflect?.out ?? 0) + (body.usage?.completion_tokens ?? 0) };
      const text = body.choices?.[0]?.message?.content?.trim();
      if (text && text.length >= 20) return text.replace(/\s+/g, " ").slice(0, 240);
      last = body.error?.message ?? `an empty or very short answer (${text?.length ?? 0} characters; finish: ${body.choices?.[0]?.finish_reason ?? "?"})`;
    } catch (e) { last = e.message; }
    await sleep(3000);
  }
  throw Object.assign(new Error(`the Learner's lesson could not be written (${last}); the run stops rather than store a placeholder lesson`), { infra: true });
}

// A one-off check of the lesson call on a sample verdict: node evals/learning/pilot.mjs --test-reflect --model <m>
export async function testReflect() {
  const dir = join(OUT, "work", "reflect-test"); rmSync(dir, { recursive: true, force: true });
  makeTask(0, dir); solve(0, dir);
  const verdict = check(0, dir);
  const lesson = await reflect(0, verdict, dir);
  console.log(`verdict shown to the model: ${verdict.why}\\nlesson: ${lesson}`);
  console.log(`tokens counted for the call: in ${state.reflect?.in ?? 0}, out ${state.reflect?.out ?? 0}`);
}

async function pool(items, fn) { const out = []; let next = 0; await Promise.all(Array.from({ length: CONC }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } })); return out; }

async function reading(agent, round) {
  const notes = agent === "learner" ? [...state.notes.learner] : agent === "oracle" ? ORACLE_NOTES : [];
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

// A reading with no notes, for the Static agent only: what the model does on this task set before anything is learned. The first pilot showed a pass rate near the ceiling is useless for the experiment.
// What is wrong with a session's source, for the apply-reliability calibration: the corruption kinds found in the first pilots.
function corruptionKind(src) {
  if (/^export\s*\/\*\*/m.test(src)) return "duplicated `export` before the JSDoc";
  if (/\\\r?\n\\/.test(src)) return "a string literal written as backslash-newline-backslash";
  if (src.includes("\\n")) return "literal backslash-n left in the file";
  return undefined;
}

export async function calibrateOracle() {
  await loadPrice();
  log(`apply-reliability calibration: ${N} held-out tasks, the three house rules given as notes, ${FAKE ? "a simulated solver" : `model ${MODEL}`}`);
  const r = await reading("oracle", 98);
  const done = Object.entries(state.done).filter(([k]) => k.startsWith("oracle-read98-"));
  const logicPass = done.filter(([, v]) => v.logic).length;
  const kinds = {};
  for (const [k] of done) {
    let src = ""; try { src = readFileSync(join(OUT, "work", k.replace(/[^\w-]/g, "_"), "src.js"), "utf8"); } catch { /* none */ }
    const kind = corruptionKind(src);
    if (kind) kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  console.log(`\nWith the rules given as notes: the tests pass on ${logicPass} of ${done.length}, and the full check passes on ${r.passes} of ${r.n} (${Math.round((100 * r.passes) / r.n)}%).`);
  console.log(`Corruption kinds found: ${Object.keys(kinds).length ? Object.entries(kinds).map(([k, n]) => `${k}: ${n}`).join("; ") : "none"}.`);
  const valid = done.length === r.n && logicPass / done.length >= 0.8 && r.passes / r.n >= 0.6;
  console.log(valid ? "Apply-reliability VALID under Amendment 9 (tests pass on at least 80%; the full check on at least 60%): the model can apply a rule it is told without breaking its files."
    : "Apply-reliability NOT valid: the model cannot apply a rule it is told reliably on this runtime (tests under 80% or the full check under 60%). Do not run the pilot with it.");
  return r;
}

export async function calibrate() {
  await loadPrice();
  log(`calibration: ${N} held-out tasks, no notes, ${FAKE ? "a simulated solver" : `model ${MODEL}`}`);
  const r = await reading("static", 99);
  const done = Object.entries(state.done).filter(([k]) => k.startsWith("static-read99-")).map(([, v]) => v);
  const logicPass = done.filter((d) => d.logic).length;
  console.log(`\nWith no notes: the tests pass on ${logicPass} of ${done.length} tasks (can the model do the tasks at all), and the full check, which includes the hidden house rule, passes on ${r.passes} of ${r.n} (${Math.round((100 * r.passes) / r.n)}%).`);
  // Tool reliability (Amendment 4): the agent must be able to do the underlying tasks before anything is learned.
  const valid = done.length === r.n && logicPass / done.length >= 0.8 && r.passes / r.n <= 0.7;
  console.log(valid
    ? "Calibration VALID under the pre-registered rule (tests pass on at least 80% of tasks: the model can drive the runtime; the full check passes on at most 70%). A full pass rate near zero is expected, because the house rules are hidden: improvement shows as a rise from there."
    : r.passes / r.n > 0.7 ? "Calibration NOT valid: the full check already passes on more than 70% of tasks, so there is nothing to learn. Do not run the pilot."
    : "Calibration NOT valid: the tests pass on fewer than 80% of tasks, so this model cannot drive the runtime reliably (or sessions are failing for another reason, such as malformed tool calls). Do not run the pilot with it; try the next candidate model.");
  return r;
}

// The numbers the decision rule reads, from the saved state, at a round.
function evidence(round) {
  const rows = {};
  for (const agent of AGENTS) {
    const accepted = []; let c = 0;
    for (let i = 0; i < state.readings[agent].length; i++) { if (i > 0 && state.jobs[agent][i - 1]) c++; accepted.push(c); }
    rows[agent] = track(state.readings[agent], accepted);
  }
  const sess = (pred) => Object.entries(state.done).filter(([k]) => pred(k)).map(([, v]) => v);
  const share = (agent) => { const rr = sess((k) => k.startsWith(`${agent}-read`)); return { n: rr.length, ok: rr.filter((v) => v.logic).length }; };
  const rel = sess((k) => k.startsWith("static-") || k.startsWith("learner-read0-"));
  return {
    rows, input: { round, learner: state.readings.learner, static: state.readings.static, floorLearner: rows.learner[round]?.floor, floorStatic: rows.static[round]?.floor,
      reliability: { ok: rel.filter((v) => v.logic).length, n: rel.length }, share: { learner: share("learner"), static: share("static") },
      lessons: { n: state.notes.learner.length, placeholder: state.notes.learner.filter((t) => t.length < 20 || /^lesson about .*: check boundaries$/.test(t)).length } },
  };
}

export async function pilot() {
  await loadPrice();
  const LAST = Math.max(ROUNDS, EXTEND_TO);
  log(`pilot: ${AGENTS.join(" and ")}, ${ROUNDS} rounds${LAST > ROUNDS ? ` (extended to ${LAST} if the first decision is in the middle band)` : ""}, ${N} held-out tasks a reading, ${FAKE ? "a simulated solver" : `model ${MODEL}`}, up to ${CONC} sessions at once; state in ${STATE}`);
  let limit = ROUNDS, verdict;
  // Round by round, both agents in turn, so a provider limit that arrives part-way hits both alike. After round ROUNDS the rule is read: a clear gap, a clear nothing or an invalid run stops here;
  // the middle band continues to round LAST, where a significance test decides (Amendment 8).
  for (;;) {
    for (let r = 0; r <= limit; r++) {
      for (const agent of AGENTS) {
        if (state.readings[agent].length > r) continue;
        if (r > 0) {
          const index = PRACTICE[(r - 1) % PRACTICE.length];
          const notes = agent === "learner" ? [...state.notes.learner] : [];
          const job = await attempt(`${agent}-job${r}-t${index}`, agent, index, notes);
          state.jobs[agent].push(job.pass);
          if (agent === "learner") { state.notes.learner.push(await reflect(index, job, join(OUT, "work", `${agent}-job${r}-t${index}`))); state.notes.learner = state.notes.learner.slice(-8); }
        }
        state.readings[agent].push(await reading(agent, r)); save();
      }
    }
    const ev = evidence(limit);
    verdict = decide({ ...ev.input, final: limit >= LAST });
    log(`decision at round ${limit}: ${verdict.status.toUpperCase()} - ${verdict.why}`);
    if (verdict.status === "middle" && limit < LAST) { limit = LAST; continue; }
    if (verdict.status === "middle") verdict = { status: "nogap", why: verdict.why };
    break;
  }
  const { rows: report, input } = evidence(limit);
  console.log("\nround   " + AGENTS.map((a) => `${a.padEnd(42)}`).join(""));
  for (let r = 0; r <= limit; r++) console.log(`${String(r).padEnd(8)}` + AGENTS.map((a) => { const x = report[a][r]; return `${x.reading.padEnd(6)} est ${x.est.toFixed(2)} imp ${x.improvements.toFixed(1)} reg ${x.regressions.toFixed(1)} floor ${String(x.floor).padStart(3)}`.padEnd(42); }).join(""));
  const sh = input.share;
  console.log(`\nTests-pass share of reading sessions: Learner ${sh.learner.ok}/${sh.learner.n} (${Math.round((100 * sh.learner.ok) / Math.max(1, sh.learner.n))}%), Static ${sh.static.ok}/${sh.static.n} (${Math.round((100 * sh.static.ok) / Math.max(1, sh.static.n))}%). Tool reliability (Static sessions and the Learner's round 0): ${input.reliability.ok}/${input.reliability.n}.`);
  console.log(`\nLearner's lessons: ${state.notes.learner.length ? "\n  - " + state.notes.learner.join("\n  - ") : "none"}`);
  if (MAX_SPEND !== undefined && !FAKE) console.log(`\nEstimated spend: about $${spendNow().toFixed(2)} of the $${MAX_SPEND} cap.`);
  const L = report.learner[limit], S = report.static[limit];
  console.log(`\nFloor at round ${limit}: Learner ${L.floor}, Static ${S.floor} (permille of the price).`);
  const headline = { gap: "GAP FOUND", nogap: "NO MEASURABLE GAP AT THIS SIZE", invalid: "INVALID RUN: NOT A RESULT, REPEAT IT" }[verdict.status];
  console.log(`\nDECISION (by docs/learning-pilot-decision-rule.md): ${headline}\n  ${verdict.why}`);
  console.log(`One run is one run: a gap found in a single run is reported as one run, and a floor difference under about 100 permille is within the noise the simulation predicts.`);
  writeFileSync(join(OUT, "pilot-report.json"), JSON.stringify({ model: FAKE ? "fake" : MODEL, rounds: limit, n: N, verdict, report, notes: state.notes.learner, jobs: state.jobs }, null, 1));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { if (args.includes("--test-reflect")) await testReflect(); else if (args.includes("--calibrate")) await (ORACLE ? calibrateOracle() : calibrate()); else await pilot(); } catch (e) {
    if (!e.infra) throw e;
    save();
    console.error(`\nStopped: ${e.message}. Nothing was counted as a failure. Progress is kept in ${STATE}; run the same command to carry on${e.cap ? " (raise --max-spend to go further)" : " (a free model's daily limit resets in a day)"}.`);
    process.exit(3);
  }
}
