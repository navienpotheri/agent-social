/**
 * `asp society cohort verify <run-dir>` (register row DK1801): re-checks a finished cohort run from what it left on disk, and says plainly what holds and what does not. It does not trust the report: it opens the
 * run's own ASP log and replays it, reads the trace, and compares the two.
 *
 *   1. the run folder has what a run leaves: trace.jsonl, report.json, signed-trace.json and the local society's log;
 *   2. the log replays from the first record and verifies (every hash, every signature, every rule);
 *   3. spend: every agent's estimated spend (the sum of its model replies in the trace) is within the per-agent cap, the total within the total cap, and the report says the same as the trace;
 *   4. no key: no file of the run holds a secret-shaped string (the secret scanner of the gateway), and none holds the value of an environment variable the caller names (the model provider's key);
 *   5. outcomes match the log: for each agent, the tool calls in the trace are the Actions in the log, the calls the tool set refused are the Actions with blocked attempts, and the refusal records in the log are
 *      the ones the summary says were recorded (recorded + repeats + not recorded = refused);
 *   6. each agent has its passport, contract and Mandate in the log, and every scope its Actions used is in its Mandate.
 * The dollar figures are estimates from the token counts the provider reported and the prices the owner gave; this checks them against the caps, not against a bill. Credits are mock accounting entries.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AspRecord } from "@agent-social/asp-core";
import { LocalLog, scanForSecrets } from "@agent-social/asp-package";
import type { SignedTraceSummary } from "./signed-trace.ts";
import { MANDATE_REFUSALS } from "./signed-trace.ts";
import type { TraceEvent } from "./types.ts";

export interface VerifyCheck { name: string; ok: boolean; detail: string }
export interface VerifyResult { ok: boolean; checks: VerifyCheck[] }

const EPS = 1e-6;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) out.push(...files(p)); else out.push(p); }
  return out;
}

export async function verifyCohortRun(dir: string, o: { env?: NodeJS.ProcessEnv; keyEnvs?: string[] } = {}): Promise<VerifyResult> {
  const checks: VerifyCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  const need = ["trace.jsonl", "report.json", "signed-trace.json", join("society", "log", "log.ndjson")];
  const missing = need.filter((f) => !existsSync(join(dir, f)));
  if (!check("the run folder", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `has ${need.join(", ")}`)) return { ok: false, checks };

  const events = readFileSync(join(dir, "trace.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TraceEvent);
  const summary = JSON.parse(readFileSync(join(dir, "signed-trace.json"), "utf8")) as SignedTraceSummary;
  const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as { totalUsd: number; agents: number };
  const start = events.find((e): e is Extract<TraceEvent, { t: "start" }> => e.t === "start");
  if (!check("the trace", !!start, start ? `${events.length} events, run ${start.run}` : "no start event")) return { ok: false, checks };

  // 2. the log replays and verifies
  let local: LocalLog;
  try {
    local = await LocalLog.openFull(join(dir, "society", "log"));
    const v = await local.log.verify();
    check("the log verifies", v.ok === true, v.ok ? `replayed from the first record: ${(await local.log.head()).seq} records, every hash and signature checked` : `does not verify: ${JSON.stringify(v).slice(0, 200)}`);
  } catch (e) { check("the log verifies", false, `the log cannot be replayed: ${(e as Error).message.slice(0, 200)}`); return { ok: false, checks }; }

  // 3. spend within the caps
  const perAgent = new Map<string, number>();
  let total = 0;
  for (const e of events) if (e.t === "model") { perAgent.set(e.agent, (perAgent.get(e.agent) ?? 0) + e.usd); total += e.usd; }
  const over = [...perAgent.entries()].filter(([, usd]) => usd > start!.capUsdPerAgent + EPS);
  check("each agent within its cap", over.length === 0, over.length ? `over ${start!.capUsdPerAgent}: ${over.map(([a, u]) => `${a} $${u.toFixed(4)}`).join(", ")}` : `${perAgent.size} agent(s), the most $${Math.max(0, ...perAgent.values()).toFixed(4)} of $${start!.capUsdPerAgent} (estimated)`);
  check("the whole run within its cap", total <= start!.capUsdTotal + EPS, `$${total.toFixed(4)} of $${start!.capUsdTotal} (estimated)`);
  check("the report says what the trace says", Math.abs(report.totalUsd - total) < 1e-4, `report $${report.totalUsd.toFixed(4)}, trace $${total.toFixed(4)}`);

  // 4. no key in any file
  const found: string[] = [];
  for (const f of scanForSecrets(dir)) found.push(`${f.file}:${f.line} (${f.kind})`);
  const values = (o.keyEnvs ?? []).map((n) => (o.env ?? process.env)[n]).filter((x): x is string => !!x && x.length >= 8);
  if (values.length) for (const f of files(dir)) { const text = readFileSync(f, "utf8"); if (values.some((x) => text.includes(x))) found.push(`${f} (the value of a named key variable)`); }
  check("no key in any file", found.length === 0, found.length ? `found: ${found.slice(0, 5).join("; ")}` : `${files(dir).length} files scanned${values.length ? `, and for the ${values.length} named key value(s)` : ""}`);

  // 5. outcomes match the log
  const byDid = new Map(summary.agents.map((a) => [a.did, a]));
  const actions = ((await local.log.recordsOfTypes(["action"])) as AspRecord[]).filter((r) => byDid.has(r.issuer));
  const refusals = ((await local.log.recordsOfTypes(["gateway_refusal"])) as AspRecord[]).filter((r) => byDid.has(r.issuer));
  const trouble: string[] = [];
  for (const a of summary.agents) {
    const calls = events.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool" && e.agent === a.agent);
    const refused = calls.filter((c) => !c.ok && c.refused && MANDATE_REFUSALS.has(c.refused)).length;
    const mine = actions.filter((r) => r.issuer === a.did);
    const blocked = mine.filter((r) => ((r.body as { blocked_attempts?: unknown[] }).blocked_attempts ?? []).length > 0).length;
    const recs = refusals.filter((r) => r.issuer === a.did).length;
    if (mine.length !== calls.length) trouble.push(`${a.agent}: ${calls.length} calls in the trace, ${mine.length} Actions in the log`);
    if (blocked !== refused) trouble.push(`${a.agent}: ${refused} refused by the tool set in the trace, ${blocked} Actions with blocked attempts`);
    if (recs !== a.refusals.recorded) trouble.push(`${a.agent}: ${recs} refusal records in the log, the summary says ${a.refusals.recorded}`);
    if (a.refusals.recorded + a.refusals.duplicates + a.refusals.overflow + a.refusals.failed !== refused) trouble.push(`${a.agent}: refusal accounting ${a.refusals.recorded}+${a.refusals.duplicates}+${a.refusals.overflow}+${a.refusals.failed} is not ${refused}`);
  }
  if (summary.errors.length) trouble.push(`the signed trace noted ${summary.errors.length} error(s): ${summary.errors[0]}`);
  check("outcomes match the log", trouble.length === 0, trouble.length ? trouble.slice(0, 6).join("; ") : `${summary.agents.length} agent(s): every tool call is a signed Action, every tool-set refusal a blocked Action and a refusal record (or counted as a repeat)`);

  // 6. identities, Mandates and scopes
  const passports = new Set(((await local.log.recordsOfTypes(["passport"])) as AspRecord[]).map((r) => (r.body as { did: string }).did));
  const bad: string[] = [];
  for (const a of summary.agents) {
    if (!passports.has(a.did)) bad.push(`${a.agent}: no passport`);
    const m = await local.log.get(a.mandate);
    const mb = m?.record.body as { scopes?: string[]; contract?: string } | undefined;
    if (!mb || mb.contract !== a.contract) bad.push(`${a.agent}: its Mandate is not on its contract`);
    for (const r of actions.filter((x) => x.issuer === a.did)) for (const s of (r.body as { scopes_used: string[] }).scopes_used) if (!mb?.scopes?.includes(s)) { bad.push(`${a.agent}: used ${s}, which its Mandate does not grant`); break; }
  }
  check("identities, Mandates and scopes", bad.length === 0, bad.length ? bad.slice(0, 5).join("; ") : `each agent has a passport, a contract and a Mandate, and every scope its Actions used is one the Mandate grants`);
  return { ok: checks.every((c) => c.ok), checks };
}

export async function verifyCmd(dir: string | undefined, o: { io: { out: (l: string) => void }; env?: NodeJS.ProcessEnv; keyEnvs?: string[] }): Promise<number> {
  if (!dir) { o.io.out("asp society cohort verify <run-dir> [--api-key-env <VAR>]"); return 2; }
  const r = await verifyCohortRun(dir, { ...(o.env ? { env: o.env } : {}), ...(o.keyEnvs ? { keyEnvs: o.keyEnvs } : {}) });
  for (const c of r.checks) o.io.out(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  o.io.out(r.ok ? "the run verifies: the log, the spend, the files and the outcomes agree" : "the run does NOT verify: see the FAIL lines");
  return r.ok ? 0 : 1;
}
