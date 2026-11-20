// A long run of a small society of agents that stay abreast of the open web, for hours (multiple 8-hour runs). Real model agents (open-weight models on OpenRouter),
// each its own identity with a bond, taking priced jobs from clients, working under a Mandate through the gateway, delivering cited claims, graded against the pages
// they really fetched, accepted or disputed (panel, ruling, bond slashed). They read and leave notes in a shared commons, so one agent's finding reaches the others.
// Everything goes through the real `asp` commands against one shared log service, so the signed log is the record of the whole run. Credits are accounting entries.
//
//   node evals/society-run.mjs --out ~/asp-society/run1 --hours 8 --agents 8 --key-file ~/.asp-openrouter-key --max-spend 10
//   node evals/society-run.mjs --stub --hours 0.05 --agents 4 --gap-minutes 0.05        offline smoke test: stand-in model and web, no key, no cost
//   node evals/society-run.mjs --out <same dir> --report-only                             rewrite report.md from the log and state
//   --problems <file>   the problems to solve, one per line, add to it while it runs; answers go to answers.jsonl and the report.
// Re-running with the same --out resumes: identities, the log and the spend so far are kept; only the clock restarts.
// It stops at the end of the hours or the spend cap (--max-spend, dollars, estimated from token counts and --price-in/--price-out per million tokens), whichever is first.
// Watch it: status.txt is rewritten every minute; events.ndjson has one line per job; `asp dashboard` works on the folder's asp home (ASP_HOME=<out>/asp ASP_LOG_URL=<url in state.json>).
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStub } from "./society/stub.mjs";

const flag = (n) => process.argv.includes(`--${n}`);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const HOURS = Number(arg("hours", "8"));
const N = Number(arg("agents", "8"));
const GAP_MIN = Number(arg("gap-minutes", "4"));
const MAX_SPEND = Number(arg("max-spend", "10"));
const PRICE_IN = Number(arg("price-in", "0.3"));
const PRICE_OUT = Number(arg("price-out", "1.0"));
const MODEL = arg("model", "openai/gpt-oss-120b");
const MAX_TURNS = arg("max-turns", "14");
const TOKEN_CAP = arg("token-cap", "80000");
const STUB = flag("stub");
const FORUM = flag("forum"); // also host the ASP forum and publish each accepted answer there (docs/forum-design.md)
const OUT = resolve(arg("out", join(homedir(), "asp-society", STUB ? "stub" : "run")));
const REPO = resolve(fileURLToPath(new URL("../", import.meta.url)));
const ASP = join(REPO, "packages/asp-cli/bin/asp.mjs");
const AGENT_JS = join(REPO, "evals/society/agent.mjs");
mkdirSync(OUT, { recursive: true });
const P = (f) => join(OUT, f);
const stamp = () => new Date().toISOString();
const log = (l) => { const s = `${stamp()}  ${l}`; console.log(s); appendFileSync(P("run.log"), s + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = async (t) => (await import("node:crypto")).createHash("sha256").update(t).digest("hex");

// The people and the agents.
const D = (s) => `did:web:example.com:${s}`;
const BANK = D("bank"), VER = D("verifier");
const CLIENTS = [D("users:client-1"), D("users:client-2")];
const JURORS = [1, 2, 3].map((i) => D(`jurors:j${i}`));
const PERSONAS = ["honest", "honest", "careless", "honest", "reckless", "honest", "careless", "honest"];
const AGENTS = Array.from({ length: N }, (_, i) => ({ did: D(`agents:a${i + 1}`), name: `a${i + 1}`, persona: PERSONAS[i % PERSONAS.length], client: CLIENTS[i % CLIENTS.length],
  benched: false, jobs: 0, accepted: 0, disputed: 0, slashed: 0, refusals: 0, failed: 0 }));
const PRICE = 100, BOND = 30, RESERVE = 10;
// The hosts a Mandate names. The log refuses a network scope without named hosts below tier 3 (docs/spec-deltas.md, default-deny egress), so the open web is a wide allowlist here,
// one host per line in --hosts-file (a "*.example.com" line covers subdomains). Anything else the search leads to is refused by the gateway and counted as a refused call.
const DEFAULT_HOSTS = ["html.duckduckgo.com", "duckduckgo.com", "en.wikipedia.org", "*.wikipedia.org", "github.com", "*.github.com", "raw.githubusercontent.com", "arxiv.org", "export.arxiv.org", "news.ycombinator.com", "hn.algolia.com",
  "www.reuters.com", "www.bbc.com", "www.theverge.com", "techcrunch.com", "arstechnica.com", "www.wired.com", "nvd.nist.gov", "www.cve.org", "openai.com", "www.anthropic.com", "huggingface.co", "stackoverflow.com", "*.stackexchange.com",
  "nodejs.org", "www.python.org", "developer.mozilla.org", "docs.python.org", "pypi.org", "www.npmjs.com", "lwn.net", "www.nature.com", "www.science.org", "openrouter.ai"];
const HOSTS = STUB ? ["127.0.0.1"] : arg("hosts-file") ? readFileSync(resolve(arg("hosts-file")), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : DEFAULT_HOSTS;
const TOPICS = [
  "new open-weight language model releases and their benchmarks", "security advisories and exploited vulnerabilities affecting developers", "AI agent frameworks and protocol standards (MCP, A2A)",
  "AI regulation and policy changes", "major open-source project releases and breaking changes", "GPU and AI chip supply news", "AI safety and evaluation research results",
  "developer tooling and coding-agent news", "cloud and AI provider outages, pricing and terms changes", "robotics and embodied AI announcements",
];

// State that survives a restart.
const state = existsSync(P("state.json")) ? JSON.parse(readFileSync(P("state.json"), "utf8")) : { setup: false, spend: 0, tokensIn: 0, tokensOut: 0, jobs: 0, runs: 0, byAgent: {}, port: 0 };
const saveState = () => writeFileSync(P("state.json"), JSON.stringify(state, null, 1));
for (const a of AGENTS) Object.assign(a, state.byAgent[a.did] ?? {});

// One shared log service so the agents can work at the same time.
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
state.port = port;
const LOG_URL = `http://127.0.0.1:${port}`;
const stub = STUB ? await startStub() : null;
const keyFromFile = arg("key-file") ? readFileSync(resolve(arg("key-file")), "utf8").trim() : undefined;
const KEY_ENV = "SOCIETY_UPSTREAM_KEY";
if (!STUB && !keyFromFile && !process.env[KEY_ENV] && !process.env.OPENROUTER_API_KEY && !flag("report-only")) { console.error("Needs --key-file <file with an OpenRouter key>, or OPENROUTER_API_KEY, or --stub."); process.exit(2); }
const UPSTREAM = stub ? stub.upstream : arg("upstream", "https://openrouter.ai/api/v1");
const env = { ...process.env, ASP_HOME: P("asp"), ASP_LOG_URL: LOG_URL, ASP_NO_FOCUS: "1", [KEY_ENV]: stub ? "stub" : (keyFromFile ?? process.env[KEY_ENV] ?? process.env.OPENROUTER_API_KEY ?? "") };
delete env.ASP_LOG_TOKEN;

let server;
const startServer = async () => {
  server = spawn(process.execPath, [ASP, "serve", "--db", `local:${P("db")}`, "--no-auth", "--port", String(port), "--rate-limit", "100000", "--write-limit", "100000", "--address-limit", "100000", "--max-in-flight", "64", ...(FORUM ? ["--forum", P("forum")] : [])], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => appendFileSync(P("service.log"), d)); server.stderr.on("data", (d) => appendFileSync(P("service.log"), d));
  for (let i = 0; i < 40; i++) { try { await fetch(`${LOG_URL}/`); return; } catch { await sleep(250); } }
  throw new Error("the log service did not start; see service.log");
};

const asp = (args, extraEnv = {}, timeoutMs = 120000) => new Promise((res) => {
  const c = spawn(process.execPath, [ASP, ...args], { env: { ...env, ...extraEnv } });
  let out = "", err = "";
  const t = setTimeout(() => c.kill(), timeoutMs);
  c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
  c.on("close", (code) => { clearTimeout(t); res({ code, out, err }); });
});
const must = async (args) => { const r = await asp(args); if (r.code !== 0) throw new Error(`asp ${args.slice(0, 3).join(" ")} failed: ${(r.err || r.out).slice(0, 300)}`); return r.out; };

async function setup() {
  for (const d of [BANK, VER, ...CLIENTS]) await must(["identity", "new", "--kind", "human", "--did", d]);
  for (const a of AGENTS) await must(["identity", "new", "--kind", "agent", "--did", a.did, "--sponsor", a.client, "--purpose", `Report what is current on the web (${a.persona})`]);
  for (const j of JURORS) { await must(["identity", "new", "--kind", "human", "--did", j]); await must(["credits", "grant", "--to", j, "--amount", "300"]); await must(["market", "juror", "register", "--by", j, "--stake", "100"]); }
  state.setup = true; saveState();
}

const ev = (o) => appendFileSync(P("events.ndjson"), JSON.stringify({ at: stamp(), ...o }) + "\n");
const spendNow = () => (state.tokensIn * PRICE_IN + state.tokensOut * PRICE_OUT) / 1e6;
// The problems to work: --problems <file>, one per line (blank lines and # comments ignored), re-read for every job so you can add to it during a run.
// Each problem is taken by one agent at a time and, once worked, goes to the back; with no file the agents work the built-in "stay abreast of the web" topics.
const PROBLEMS_FILE = arg("problems") ? resolve(arg("problems")) : undefined;
const taken = new Map();
const nextProblem = (a) => {
  if (!PROBLEMS_FILE || !existsSync(PROBLEMS_FILE)) return undefined;
  const list = readFileSync(PROBLEMS_FILE, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!list.length) return undefined;
  list.sort((x, y) => (taken.get(x) ?? 0) - (taken.get(y) ?? 0));
  taken.set(list[0], Date.now());
  return list[0];
};
const topicFor = (a, k) => {
  const problem = nextProblem(a);
  if (problem) return `${problem}\n\n(Other agents may have left notes on related work: read them first. Today is ${stamp().slice(0, 10)}.)`;
  // Half the time, follow up on a note another agent left in the commons: that is how one finding reaches the others.
  if (k % 2 === 1 && existsSync(P("notes.jsonl"))) {
    const others = readFileSync(P("notes.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((n) => n.by !== a.name && n.topic !== "stand-in");
    if (others.length) { const n = others[others.length - 1 - (k % Math.min(3, others.length))]; return `Check and update what ${n.by} reported on "${n.topic}": what has changed since, and is it right?`; }
  }
  return `What is current and newly changed in: ${TOPICS[(AGENTS.indexOf(a) + k) % TOPICS.length]}? Today is ${stamp().slice(0, 10)}.`;
};

// The forum allows one post and twenty comments per citizen per UTC day, so an agent's first accepted answer of the day is its post and the rest are comments on it
// (up to the cap; the rest stay in answers.jsonl). A refusal is logged, never fatal: the forum is a window on the run, not part of it.
async function toForum(a, job, topic, r, claims) {
  const day = stamp().slice(0, 10);
  const text = [(r.summary || "").trim(), "", ...claims.map((c) => `- ${c.text} (${c.url})`), "", `Contract ${job}. Graded only on whether the cited pages were really fetched; whether the answer is right is for readers to judge.`, ""].join("\n");
  const file = P(`work/${a.name}-${job.replace(/[^a-z0-9]/gi, "_")}.forum.md`);
  writeFileSync(file, text);
  state.forum ??= {};
  const mine = state.forum[a.did];
  try {
    if (!mine || mine.day !== day) {
      const out = await must(["forum", "post", file, "--by", a.did, "--title", topic.split("\n")[0].slice(0, 200), "--tag", "society", "--contract", job]);
      state.forum[a.did] = { day, post: /posted: (sha256:[0-9a-f]{64})/.exec(out)[1] };
    } else await must(["forum", "comment", mine.post, file, "--by", a.did]);
  } catch (e) { log(`${a.name}: forum: ${String(e.message).slice(0, 160)}`); }
}

async function oneJob(a) {
  const k = a.jobs++; state.jobs++;
  const topic = topicFor(a, k);
  const deadline = "2099-01-01T00:00:00Z";
  await must(["credits", "grant", "--to", a.client, "--amount", String(PRICE + RESERVE)]);
  await must(["credits", "grant", "--to", a.did, "--amount", String(BOND + RESERVE)]);
  const intent = /^intent (\S+)/m.exec(await must(["market", "intent", "--by", a.client, "--purpose", topic, "--criteria", "each claim cites a page the agent really read", "--budget", String(PRICE), "--deadline", deadline, "--verifier", VER]))[1];
  const offer = /^offer (\S+)/m.exec(await must(["market", "offer", "--by", a.did, "--intent", intent, "--price", String(PRICE), "--plan", "search, read, cite", "--eta", deadline]))[1];
  const job = /^contract (\S+):/m.exec(await must(["market", "contract", "--principal", a.client, "--performer", a.did, "--bank", BANK, "--intent", intent, "--offer", offer]))[1];
  await must(["market", "bond", "--contract", job, "--backer", a.did, "--amount", String(BOND), "--escrow-payer", a.client, "--escrow-amount", String(PRICE)]);
  await must(["market", "mandate", "--contract", job, "--principal", a.client, "--performer", a.did, "--scopes", "web.read", "--scopes", "repo.read", "--scopes", "repo.write", "--scopes", "tool.read_notes", "--scopes", "tool.write_note", ...HOSTS.flatMap((h) => ["--network-host", h])]);

  const resFile = P(`work/${a.name}-${k}.json`);
  const run = await asp(["gateway", "--contract", job, "--by", a.did, "--openai-upstream", UPSTREAM, "--openai-key-env", KEY_ENV, "--token-cap", TOKEN_CAP, "--", process.execPath, AGENT_JS, topic],
    { SOC_PERSONA: a.persona, SOC_MODEL: MODEL, SOC_OUT: resFile, SOC_NOTES: P("notes.jsonl"), SOC_ME: a.name, SOC_MAX_TURNS: MAX_TURNS, ...(stub ? { SOC_SEARCH_URL: stub.searchUrl } : {}) }, 25 * 60 * 1000);
  writeFileSync(P(`work/${a.name}-${k}.gateway.txt`), (run.err + "\n" + run.out).replace(/(sk-|Bearer )\S+/g, "$1[key]"));
  const refusals = (run.err + run.out).split("\n").filter((l) => /^\s*REFUSED /.test(l)).length;
  a.refusals += refusals;
  let r = { fetched: [], claims: [], summary: "", tokensIn: 0, tokensOut: 0, finished: false };
  try { r = JSON.parse(readFileSync(resFile, "utf8")); } catch { a.failed++; }
  state.tokensIn += r.tokensIn; state.tokensOut += r.tokensOut;

  // The delivery: each claim names its page; it carries the page's hash if the agent really fetched it, and the hash of the bare URL if it did not.
  const fetchedBy = new Map(r.fetched.map((f) => [f.url, f.sha256]));
  const claims = r.claims.length ? r.claims : [{ text: r.summary || "no result", url: "about:none" }];
  const claimArgs = [];
  for (const c of claims) claimArgs.push("--claim", `${c.text.replace(/::/g, ":")}::measured::${c.url.startsWith("http") ? c.url : "asp://none"}=${fetchedBy.get(c.url) ?? await sha256(c.url)}`);
  await must(["market", "deliver", "--contract", job, "--by", a.did, "--summary", (r.summary || "no result").slice(0, 400), ...claimArgs]);

  // The verifier checks every claimed page against what the agent fetched. This is the whole grading rule: no model judges the model.
  const grades = claims.map((c) => (fetchedBy.has(c.url) ? "measured" : "unverified"));
  const ok = grades.filter((g) => g === "measured").length;
  const verdict = ok === claims.length ? "confirmed" : ok > 0 ? "partly_confirmed" : "not_confirmed";
  await must(["market", "verify", "--contract", job, "--by", VER, "--verdict", verdict, ...grades.flatMap((g, i) => ["--grade", `${i}=${g}`])]);

  let outcome;
  if (verdict === "not_confirmed") {
    await must(["market", "reject", "--contract", job, "--by", a.client, "--reasons", "no claim cites a page the agent read"]);
    await must(["market", "panel", "draw", "--contract", job]);
    await must(["market", "rule", "--contract", job, "--by", JURORS[0], "--cosign-by", JURORS[1], "--verdict", "for_principal", "--fault", `${a.did}=1000`]);
    await must(["market", "settle", "--contract", job, "--bank", BANK, "--basis", "ruling", "--escrow-released", "0", "--bond-returned", "0", "--bond-slashed", String(BOND)]);
    a.disputed++; a.slashed++; outcome = "disputed, bond slashed";
  } else {
    await must(["market", "accept", "--contract", job, "--by", a.client]);
    await must(["market", "settle", "--contract", job, "--bank", BANK, "--basis", "accepted", "--escrow-released", String(PRICE), "--bond-returned", String(BOND), "--bond-slashed", "0"]);
    a.accepted++; outcome = "accepted, paid";
  }
  if (FORUM && verdict !== "not_confirmed") await toForum(a, job, topic, r, claims);
  state.byAgent[a.did] = Object.fromEntries(["jobs", "accepted", "disputed", "slashed", "refusals", "failed"].map((f) => [f, a[f]]));
  appendFileSync(P("answers.jsonl"), JSON.stringify({ at: stamp(), agent: a.name, persona: a.persona, job, problem: topic.slice(0, 600), verdict, summary: r.summary, claims }) + "\n");
  ev({ agent: a.name, persona: a.persona, job, topic: topic.slice(0, 140), verdict, outcome, fetched: r.fetched.length, claims: claims.length, turns: r.turns, tokens: r.tokensIn + r.tokensOut, refusals });
  log(`${a.name} (${a.persona}) job ${k + 1}: ${outcome}; fetched ${r.fetched.length}, refusals ${refusals}; spend $${spendNow().toFixed(2)}`);
  saveState();
}

async function tierOf(did) {
  const o = (await asp(["identity", "show", did])).out;
  const last = (re) => { const m = [...o.matchAll(re)]; return m.length ? Number(m[m.length - 1][1]) : undefined; };
  return { tier: last(/"tier": (\d+)/g) ?? NaN, slashCount: last(/"slashCount": (\d+)/g) ?? 0, acceptedJobs: last(/"acceptedJobs": (\d+)/g) ?? 0 };
}

async function statusText(end) {
  const rows = [];
  for (const a of AGENTS) { const t = await tierOf(a.did); rows.push(`${a.name.padEnd(4)} ${a.persona.padEnd(9)} jobs ${String(a.jobs).padStart(3)}  accepted ${String(a.accepted).padStart(3)}  disputed ${String(a.disputed).padStart(2)}  refused calls ${String(a.refusals).padStart(3)}  tier ${t.tier}  slashes ${t.slashCount}  accepted-on-record ${t.acceptedJobs}`); }
  const watch = (await asp(["watch", "--min-agents", "3", "--window", "900"])).out.split("\n").slice(0, 6).join("\n");
  const notes = existsSync(P("notes.jsonl")) ? readFileSync(P("notes.jsonl"), "utf8").split("\n").filter(Boolean).length : 0;
  return [`society run  ${STUB ? "(stand-in model and web)  " : ""}model ${MODEL}`, `now ${stamp()}   ends ${new Date(end).toISOString()}`, `jobs ${state.jobs}   commons notes ${notes}   tokens ${state.tokensIn}+${state.tokensOut}   est. spend $${spendNow().toFixed(2)} of $${MAX_SPEND}`, "", ...rows, "", "asp watch:", watch].join("\n");
}

async function report() {
  const verify = await asp(["log", "verify"]);
  const lines = [`# Society run report`, ``, `Written ${stamp()}. ${STUB ? "Stand-in model and web: a smoke test, not a result. " : ""}Credits are accounting entries, not money. Model ${MODEL}; ${AGENTS.length} agents; ${state.runs} run(s) so far.`, ``,
    `Jobs ${state.jobs}. Tokens ${state.tokensIn} in, ${state.tokensOut} out; estimated spend $${spendNow().toFixed(2)} (at $${PRICE_IN}/$${PRICE_OUT} per million tokens, a stated assumption).`, `Log: ${verify.out.trim().split("\n").slice(-2).join(" ")}`, ``,
    `| agent | persona | status | jobs | accepted | disputed (bond slashed) | refused calls | failed runs | tier | slashes on record |`, `|---|---|---|---|---|---|---|---|---|---|`];
  for (const a of AGENTS) { const t = await tierOf(a.did); lines.push(`| ${a.name} | ${a.persona} | ${a.benched ? "out (tier 0)" : "active"} | ${a.jobs} | ${a.accepted} | ${a.disputed} | ${a.refusals} | ${a.failed} | ${t.tier} | ${t.slashCount} |`); }
  const answers = existsSync(P("answers.jsonl")) ? readFileSync(P("answers.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.verdict !== "not_confirmed").slice(-10) : [];
  lines.push(``, `## Latest accepted answers (graded only on whether the cited pages were really read; whether they are right is for you to judge)`, ``, ...answers.map((x) => `- ${x.agent}: ${x.problem.split("\n")[0].slice(0, 120)} -> ${x.summary.slice(0, 300)}`));
  const notes = existsSync(P("notes.jsonl")) ? readFileSync(P("notes.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(-15) : [];
  lines.push(``, `## Latest commons notes`, ``, ...notes.map((n) => `- ${n.at.slice(0, 16)} ${n.by} (${n.persona}): ${n.topic}: ${n.text.slice(0, 200)}`));
  writeFileSync(P("report.md"), lines.join("\n") + "\n");
  log(`report written: ${P("report.md")}`);
}

async function worker(a, end) {
  if (a.benched) return;
  await sleep(Math.random() * 20000);
  while (Date.now() < end && spendNow() < MAX_SPEND) {
    try { await oneJob(a); } catch (e) { if (/excluded from bonding/.test(String(e.message))) { a.benched = true; log(`${a.name} (${a.persona}) is out: repeat slashes demoted it to tier 0 and it can no longer bond`); ev({ agent: a.name, benched: true }); state.byAgent[a.did] = { ...(state.byAgent[a.did] ?? {}), benched: true }; saveState(); return; } a.failed++; log(`${a.name}: job error: ${String(e.message).slice(0, 200)}`); ev({ agent: a.name, error: String(e.message).slice(0, 300) }); await sleep(30000); }
    const gap = GAP_MIN * 60000 * (0.5 + Math.random());
    await sleep(Math.min(gap, Math.max(0, end - Date.now())));
  }
}

await startServer();
mkdirSync(P("work"), { recursive: true });
if (flag("report-only")) { await report(); server.kill(); process.exit(0); }
if (!state.setup) { log("setting up identities"); await setup(); }
state.runs++; saveState();
const end = Date.now() + HOURS * 3600000;
log(`society run: ${N} agents, ${HOURS} h, spend cap $${MAX_SPEND}, model ${MODEL}${STUB ? " (stand-ins)" : ""}; log service ${LOG_URL}; folder ${OUT}`);
const ticker = setInterval(async () => { try { writeFileSync(P("status.txt"), await statusText(end)); } catch { /* next minute */ } }, 60000);
let stopping = false;
process.on("SIGINT", () => { if (stopping) process.exit(1); stopping = true; log("stopping after the jobs in flight (Ctrl-C again to quit now)"); });
await Promise.all(AGENTS.map((a) => worker(a, stopping ? 0 : end)));
clearInterval(ticker);
writeFileSync(P("status.txt"), await statusText(end));
await report();
if (spendNow() >= MAX_SPEND) log(`stopped at the spend cap ($${MAX_SPEND})`);
saveState(); server.kill(); stub?.close();
process.exit(0);
