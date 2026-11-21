/**
 * asp live preflight | report: readiness for a live run with a real model (owner's plan for the evening of 2026-11-23).
 *
 * preflight checks the machine and prints a green/red table, and exits 1 when anything is red. It never prints a key: it says only that the variable is set and how long it is. It starts a gateway of its own on a
 * free local port and calls it, so "the gateway is reachable" is tested, not assumed, and it proves `asp stop --all` on a throwaway home (a session record of this very process, a stop file written, nothing touched
 * in the real home).
 *
 * report summarises what a session proved, from its own run log (hash-chained, and checked here) and the session index: calls, refusals and why, the estimated spend against the cap, the identities used and the records
 * the log holds for the job. It states what it could not read. Credits are accounting entries, not money; the spend in dollars is an estimate from tokens and a price table, not a bill.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createGateway, priceFor, readRunLog, type RunEvent } from "@agent-social/asp-package";

export interface LiveCtx {
  home: string;
  env: Record<string, string | undefined>;
  out: (l: string) => void;
  flags: { runtime?: string; keyEnv?: string; provider?: string; model?: string; budgetUsd?: string; priceIn?: string; priceOut?: string; contract?: string; json?: boolean; service?: string };
  /** Runs `asp stop --all` against a home (the real command, so the check is of the real code). */
  stopAll: (home: string) => Promise<number>;
  /** The mandate record's scopes for a contract, or undefined when the log holds none. */
  mandateOf: (contract: string) => Promise<{ scopes: string[] } | undefined>;
  identities: () => { me?: string; agent?: string; bank?: string } | undefined;
}
export type Status = "ok" | "warn" | "fail";
export interface Check { name: string; status: Status; detail: string }

const KEY_ENV: Record<string, string> = { openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const freePort = () => new Promise<number>((resolve, reject) => { const s = createServer(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
const tool = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" && (!isAbsolute(cmd) || /\.(cmd|bat)$/i.test(cmd)) }); return r.status === 0 ? (r.stdout || r.stderr).trim().split("\n")[0] : undefined; };

export async function preflightChecks(c: LiveCtx): Promise<Check[]> {
  const out: Check[] = [];
  const add = (name: string, status: Status, detail: string) => out.push({ name, status, detail });

  const [maj, min] = process.versions.node.split(".").map(Number);
  add("Node", maj > 22 || (maj === 22 && min >= 18) ? "ok" : "fail", `${process.versions.node} (22.18 or newer runs the TypeScript directly)`);
  const git = tool("git", ["--version"]);
  add("git", git ? "ok" : "fail", git ?? "git was not found on the PATH");

  // The home is writable (keys, logs and run records are written there).
  try { mkdirSync(c.home, { recursive: true }); const probe = join(c.home, `.preflight-${process.pid}`); writeFileSync(probe, "ok"); rmSync(probe, { force: true }); add("the ASP home", "ok", `${c.home} is writable`); } catch (e) { add("the ASP home", "fail", `${c.home} is not writable: ${(e as Error).message}`); }
  // The runtime asp run will start, by the same rule asp run uses (claude-code is the default; ASP_CLAUDE_BIN and ASP_CLAUDE_SCRIPT name the program for Claude Code): installed, and which version.
  {
    const runtime = c.flags.runtime ?? "claude-code";
    const bins: Record<string, string> = { "claude-code": "claude", codex: "codex", goose: "goose", openclaw: "openclaw", hermes: "hermes", antigravity: "agy", openhands: "openhands" };
    const bin = bins[runtime];
    if (!bin) add(`runtime ${runtime}`, "fail", `asp run does not start ${runtime}: one of ${Object.keys(bins).join(", ")}`);
    else {
      const custom = runtime === "claude-code" && c.env.ASP_CLAUDE_BIN ? [c.env.ASP_CLAUDE_BIN, ...(c.env.ASP_CLAUDE_SCRIPT ? [c.env.ASP_CLAUDE_SCRIPT] : [])] : [bin];
      const ver = tool(custom[0], [...custom.slice(1), "--version"]);
      add(`runtime ${runtime}`, ver ? "ok" : "fail", ver ? `${custom.join(" ")}: ${ver}${c.flags.runtime ? "" : " (the default runtime; --runtime names another)"}` : `${custom.join(" ")} was not found on the PATH or did not answer --version: install it and sign in once by running it, then run this again`);
    }
  }
  try { const p = await freePort(); add("a local port", "ok", `127.0.0.1:${p} can be opened`); } catch (e) { add("a local port", "fail", `no local port could be opened: ${(e as Error).message}`); }

  // The key: an environment variable, never printed.
  const keyEnv = c.flags.keyEnv ?? KEY_ENV[c.flags.provider ?? "anthropic"] ?? "ANTHROPIC_API_KEY";
  const key = c.env[keyEnv];
  add(`key in ${keyEnv}`, key ? "ok" : "fail", key ? `set (${key.length} characters; not shown)` : `${keyEnv} is not set in this shell (set it in the shell, never on a command line)`);

  // The gateway: start one on a free port and call it.
  let gw: ReturnType<typeof createGateway> | undefined;
  try {
    gw = createGateway({ scopes: ["repo.read"], anthropicUpstream: "http://127.0.0.1:9", openaiUpstream: "http://127.0.0.1:9/v1" });
    const port = await gw.listen();
    const r = await fetch(`http://127.0.0.1:${port}/asp/health`, { signal: AbortSignal.timeout(5000) });
    add("the gateway", r.ok ? "ok" : "fail", r.ok ? `started on 127.0.0.1:${port} and answered /asp/health` : `answered ${r.status}`);
  } catch (e) { add("the gateway", "fail", `could not start or reach a gateway: ${(e as Error).message}`); }
  finally { await gw?.close().catch(() => undefined); }

  // The log service.
  const service = c.flags.service ?? c.env.ASP_LOG_URL;
  if (!service) add("the log service", "warn", "no service is configured (ASP_LOG_URL): the run uses the local log only");
  else {
    try {
      const base = service.endsWith("/") ? service : service + "/";
      const r = await fetch(new URL("health", base), { signal: AbortSignal.timeout(8000) });
      add("the log service", r.ok ? "ok" : "fail", `${new URL(base).host} answered ${r.status}`);
    } catch (e) { add("the log service", "fail", `${(() => { try { return new URL(service).host; } catch { return "the service"; } })()} was not reachable: ${(e as Error).message}`); }
  }

  // The Mandate and the identities.
  const ids = c.identities();
  add("identities", ids?.agent && ids.me ? "ok" : "fail", ids?.agent && ids.me ? `you ${ids.me}; agent ${ids.agent}` : "no saved identities: run asp join (or asp enrol) first");
  if (!c.flags.contract) add("the Mandate", "warn", "no --contract given: asp run makes a standing job with a Mandate sized to the task; pass --contract <id> to check one now");
  else {
    const m = await c.mandateOf(c.flags.contract).catch(() => undefined);
    add("the Mandate", m ? "ok" : "fail", m ? `loaded for ${c.flags.contract.slice(0, 19)}...: ${m.scopes.join(", ")}` : `no Mandate in the log for ${c.flags.contract}`);
  }

  // The budget cap.
  const cap = c.flags.budgetUsd === undefined ? undefined : Number(c.flags.budgetUsd);
  if (cap === undefined) add("the budget cap", "fail", "no --budget-usd: a live run with a real model must have a hard dollar cap");
  else if (!(cap > 0)) add("the budget cap", "fail", "--budget-usd must be a number of dollars above 0");
  else if (cap < 2) add("the budget cap", "warn", `${cap} dollars is a very small cap: the gateway also refuses a call whose WORST case (the whole request plus the largest reply it allows, 32,000 tokens for Claude Code) could pass the cap, and one such call can be worth about 0.5 to 1 dollar, so a cap this small can stop the run at its first call; use 2 dollars or more`);
  else {
    const pi = c.flags.priceIn === undefined ? undefined : Number(c.flags.priceIn), po = c.flags.priceOut === undefined ? undefined : Number(c.flags.priceOut);
    const price = priceFor(c.flags.model, { ...(pi !== undefined ? { inPerM: pi } : {}), ...(po !== undefined ? { outPerM: po } : {}) });
    const known = c.flags.model !== undefined && (pi !== undefined || po !== undefined || price.inPerM !== 15 || price.outPerM !== 75);
    add("the budget cap", known ? "ok" : "warn", `$${cap} hard cap; priced at $${price.inPerM} in and $${price.outPerM} out per million tokens${known ? "" : " (the model is not in the price table, so the high default is used: pass --price-in and --price-out to be exact)"}; an estimate, not the provider's bill`);
  }

  // asp stop --all, on a throwaway home.
  const tmp = mkdtempSyncSafe();
  try {
    writeFileSync(join(tmp, "runs.ndjson"), JSON.stringify({ t: "start", pid: process.pid, sid: "preflight", contract: "sha256:" + "0".repeat(64), at: new Date().toISOString(), runtime: "preflight", agent: "did:web:preflight", me: "did:web:preflight", bank: "did:web:preflight", purpose: "preflight", scopes: [], hosts: [] }) + "\n");
    const code = await c.stopAll(tmp);
    const ok = code === 0 && existsSync(join(tmp, "stop-preflight"));
    add("asp stop --all", ok ? "ok" : "fail", ok ? "wrote a stop file for a running session on a throwaway home (the real home was not touched)" : `did not stop a running session (exit ${code})`);
  } catch (e) { add("asp stop --all", "fail", (e as Error).message); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
  return out;
}
function mkdtempSyncSafe(): string { return mkdtempSync(join(tmpdir(), "asp-preflight-")); }

export async function livePreflight(c: LiveCtx): Promise<number> {
  const checks = await preflightChecks(c);
  const red = checks.filter((k) => k.status === "fail").length, amber = checks.filter((k) => k.status === "warn").length;
  if (c.flags.json) { c.out(JSON.stringify({ ready: red === 0, red, amber, checks }, null, 2)); return red ? 1 : 0; }
  const mark = { ok: "GREEN", warn: "AMBER", fail: "RED  " } as const;
  const w = Math.max(...checks.map((k) => k.name.length));
  for (const k of checks) c.out(`  ${mark[k.status]}  ${k.name.padEnd(w)}  ${k.detail}`);
  c.out(red ? `NOT READY: ${red} red${amber ? `, ${amber} amber` : ""}. Fix the red lines and run asp live preflight again.` : `READY${amber ? ` (${amber} amber: read them)` : ""}. Nothing was sent to a model provider by this check.`);
  return red ? 1 : 0;
}

// ---- the report ----

export interface ReportInput {
  session: { sid: string; runtime: string; agent: string; me: string; bank: string; at: string; purpose: string; scopes: string[]; hosts: string[]; contract: string };
  end?: { at: string; state: string; calls: number; refused: string[]; tokens: number; exitCode: number; stopped?: string };
  runLogPath?: string;
  /** Records the log holds for the job and the Action reports among them, when the log could be read. */
  log?: { records: number; actions: number };
}
export interface Report {
  session: string; runtime: string; started: string; ended?: string; state: string; exitCode?: number; task: string;
  identities: { sponsor: string; agent: string; bank: string }; mandate: { scopes: string[]; hosts: string[] };
  calls: { judged: number; allowed: number; refused: number; refusals: { tool: string; scope: string; reason: string }[] };
  model: { requests: number; tokensIn: number; tokensOut: number; spendUsdEstimate?: number; capUsd?: number; stoppedAtCap: boolean };
  holds: { outboundScan: number; untrustedHold: number; untrustedFlowHold: number; injectionSuspect: number; circumvention: number; budgetStops: number };
  runLog: { path?: string; events: number; chainOk?: boolean; problem?: string };
  records?: { onTheJob: number; actionReports: number };
  stopped?: string;
  notes: string[];
}

export function buildReport(i: ReportInput): Report {
  const notes: string[] = [];
  let events: RunEvent[] = []; let chainOk: boolean | undefined; let problem: string | undefined;
  if (i.runLogPath && existsSync(i.runLogPath)) { const r = readRunLog(i.runLogPath); events = r.events; chainOk = r.ok; problem = r.problem; if (!r.ok) notes.push(`the run log's hash chain does not verify: ${r.problem}`); }
  else notes.push("no run log was found for this session, so calls and spend come from the session index only");
  const d = (e: RunEvent) => (e as unknown as { data?: Record<string, any> }).data ?? {};
  const kind = (e: RunEvent) => (e as unknown as { kind?: string }).kind;
  const calls = events.filter((e) => kind(e) === "tool_call");
  const refusals = calls.filter((e) => d(e).allowed === false).map((e) => ({ tool: String(d(e).tool), scope: String(d(e).scope ?? ""), reason: String(d(e).reason ?? "").split(". Article")[0].slice(0, 200) }));
  const count = (k: string) => events.filter((e) => kind(e) === k).length;
  const end = events.filter((e) => kind(e) === "run_end").at(-1);
  const replies = events.filter((e) => kind(e) === "model_reply");
  const tokensIn = replies.reduce((n, e) => n + (d(e).tokens_in ?? 0), 0), tokensOut = replies.reduce((n, e) => n + (d(e).tokens_out ?? 0), 0);
  const budgetStops = events.filter((e) => kind(e) === "budget_stop");
  const judged = calls.length || i.end?.calls || 0;
  if (!calls.length && i.end) notes.push("the run log holds no tool-call events; the counts are the session index's");
  const spend = end ? d(end).spend_usd : undefined;
  return {
    session: i.session.sid, runtime: i.session.runtime, started: i.session.at, ...(i.end ? { ended: i.end.at } : {}), state: i.end?.state ?? "no end recorded", ...(i.end ? { exitCode: i.end.exitCode } : {}), task: i.session.purpose,
    identities: { sponsor: i.session.me, agent: i.session.agent, bank: i.session.bank }, mandate: { scopes: i.session.scopes, hosts: i.session.hosts },
    calls: { judged, allowed: calls.length ? calls.length - refusals.length : Math.max(0, judged - (i.end?.refused.length ?? 0)), refused: calls.length ? refusals.length : (i.end?.refused.length ?? 0), refusals: calls.length ? refusals : (i.end?.refused ?? []).map((r) => ({ tool: "", scope: "", reason: r })) },
    model: { requests: count("model_request"), tokensIn: tokensIn || 0, tokensOut: tokensOut || 0, ...(spend !== undefined ? { spendUsdEstimate: spend } : {}), ...(end && d(end).cap_usd !== undefined ? { capUsd: d(end).cap_usd } : {}), stoppedAtCap: budgetStops.some((e) => d(e).cap_usd !== undefined) },
    holds: { outboundScan: count("outbound_scan"), untrustedHold: count("untrusted_hold"), untrustedFlowHold: count("untrusted_flow_hold"), injectionSuspect: count("injection_suspect"), circumvention: count("circumvention"), budgetStops: budgetStops.length },
    runLog: { ...(i.runLogPath ? { path: i.runLogPath } : {}), events: events.length, ...(chainOk !== undefined ? { chainOk } : {}), ...(problem ? { problem } : {}) },
    ...(i.log ? { records: { onTheJob: i.log.records, actionReports: i.log.actions } } : { }),
    ...(i.end?.stopped ? { stopped: i.end.stopped } : {}),
    notes: [...notes, ...(spend === undefined ? ["no spend was recorded: the run did not use --budget-usd, or ended before it was written"] : ["the dollar figures are estimates from tokens and a price table, not the provider's bill"]), "credits are accounting entries, not money"],
  };
}

export function printReport(r: Report, out: (l: string) => void): void {
  out(`live run ${r.session}: ${r.state}${r.exitCode !== undefined ? ` (exit ${r.exitCode})` : ""}`);
  out(`  runtime     ${r.runtime}; started ${r.started}${r.ended ? `, ended ${r.ended}` : ""}`);
  out(`  task        ${r.task}`);
  out(`  identities  sponsor ${r.identities.sponsor}; agent ${r.identities.agent}; bank ${r.identities.bank}`);
  out(`  mandate     ${r.mandate.scopes.join(", ") || "none"}${r.mandate.hosts.length ? `; network to ${r.mandate.hosts.join(", ")}` : "; no network"}`);
  out(`  calls       ${r.calls.judged} judged: ${r.calls.allowed} allowed, ${r.calls.refused} refused`);
  for (const f of r.calls.refusals.slice(0, 12)) out(`    refused   ${f.tool ? `${f.tool} -> ${f.scope || "no scope"}: ` : ""}${f.reason}`);
  if (r.calls.refusals.length > 12) out(`    ... ${r.calls.refusals.length - 12} more in the run log`);
  out(`  model       ${r.model.requests} request(s), ${r.model.tokensIn} in / ${r.model.tokensOut} out tokens${r.model.spendUsdEstimate !== undefined ? `; estimated spend $${r.model.spendUsdEstimate}${r.model.capUsd !== undefined ? ` of a $${r.model.capUsd} cap${r.model.stoppedAtCap ? " (stopped at the cap)" : ""}` : ""}` : ""}`);
  const h = r.holds;
  out(`  held        outbound scan ${h.outboundScan}, untrusted text ${h.untrustedHold}, untrusted flow ${h.untrustedFlowHold}, injection suspected ${h.injectionSuspect}, circumvention ${h.circumvention}, budget stops ${h.budgetStops}`);
  out(`  run log     ${r.runLog.events} event(s)${r.runLog.chainOk === undefined ? "" : r.runLog.chainOk ? ", hash chain verifies" : `, DOES NOT VERIFY: ${r.runLog.problem}`}${r.runLog.path ? `  ${r.runLog.path}` : ""}`);
  if (r.records) out(`  in the log  ${r.records.onTheJob} record(s) on the job, ${r.records.actionReports} signed Action report(s)`);
  if (r.stopped) out(`  stopped     ${r.stopped}`);
  for (const n of r.notes) out(`  note        ${n}`);
}

export const _internal = { KEY_ENV, readFileSync };
