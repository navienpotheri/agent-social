/**
 * `asp live verify-local [--session <id>] [--log <dir>] [--expect-assurance <level>] [--no-starter] [--json]` (register rows DK650, DK540 to DK546, T15, E5, DK1602): checks, from the local log and the session's
 * own run log, that a run by a key-only agent (or any agent) is what it says it is, and prints a PASS or FAIL line for each check that the owner can paste back. It does not trust the report: it replays the
 * log from the first record, reads the agent's passport, contract, Mandate, signed Action reports and refusal records, the starter claim and the ledger, and compares them with the run log's hash chain and calls.
 *
 *   1. the log replays from the first record and verifies;
 *   2. the agent's identity: a passport in the log, and its key is the one its did:key names (so no one but the key holder could have signed as it); who it names as its sponsor is printed;
 *   3. the contract (principal, performer and bank are the session's) and the Mandate on it, with the scopes the session says it ran under;
 *   4. the signed Action reports: at least one, each signed by the agent (the log refuses any other issuer), with the assurance each carries counted; `--expect-assurance` makes a weaker or missing level a FAIL;
 *   5. the refusals: the calls the run log shows refused are the blocked attempts the Actions report, and the signed refusal records are no more than those and at least one when anything was refused;
 *   6. the starter credits: the agent's starter claim is in the log (the 100 at once), and the ledger holds at least what was claimed less what it has spent (skipped with `--no-starter`);
 *   7. the run log's hash chain verifies;
 *   8. every Action that commits to the run log matches the log's events;
 *   9. the credit ledger balances.
 * Credits are mock accounting entries, not money. A pass shows that the records and the run log agree on this machine; it does not show that the model did a good job, and a local service is not the hosted one.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AspRecord } from "@agent-social/asp-core";
import { b64urlDecode, didKeyFromPublicKey } from "@agent-social/asp-core";
import { LocalLog, hashAfter, parseRunLogUri, readRunLog, runIdOf } from "@agent-social/asp-package";
import { STARTER_UPFRONT } from "@agent-social/asp-log";

export interface VerifySession { start: { sid: string; agent: string; me: string; bank: string; contract: string; scopes: string[] }; end?: { runLog?: string }; src: string }
export interface VerifyCheck { name: string; ok: boolean; detail: string }
export interface VerifyLocalResult { ok: boolean; session: string; checks: VerifyCheck[]; assurance: Record<string, number> }

const RANK: Record<string, number> = { self_reported: 0, runtime_observed: 1, gateway_observed: 2, hook_enforced: 3, gateway_enforced: 4, sandbox_enforced: 5 };

export async function verifyLocal(o: {
  sessions: VerifySession[]; session?: string; logDir?: string; expectAssurance?: string; noStarter?: boolean; findRunLog: (home: string, contract: string) => string | undefined;
}): Promise<VerifyLocalResult> {
  const checks: VerifyCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  if (o.expectAssurance !== undefined && !(o.expectAssurance in RANK)) throw new Error(`--expect-assurance is one of ${Object.keys(RANK).join(", ")}`);
  const pick = o.session ? o.sessions.filter((s) => s.start.sid.startsWith(o.session!)) : o.sessions.slice(0, 1);
  if (!pick.length) throw new Error(o.session ? `no session starts with ${o.session}; asp runs lists them` : "no sessions yet: nothing to verify");
  if (pick.length > 1) throw new Error(`${o.session} matches ${pick.length} sessions; give more characters`);
  const { start, end, src } = pick[0]!;
  const runLogPath = end?.runLog && existsSync(end.runLog) ? end.runLog : o.findRunLog(src, start.contract);
  const dir = o.logDir ?? src;
  const result = (): VerifyLocalResult => ({ ok: checks.every((c) => c.ok), session: start.sid, checks, assurance });
  const assurance: Record<string, number> = {};

  // 1. the log
  if (!existsSync(join(dir, "log.ndjson"))) { check("the log replays and verifies", false, `there is no log.ndjson in ${dir}: give the local service's log folder with --log, or run from the ASP home that holds the records`); return result(); }
  let local: LocalLog;
  try {
    local = await LocalLog.openFull(dir);
    const v = await local.log.verify();
    check("the log replays and verifies", v.ok === true, v.ok ? `${(await local.log.head()).seq} records from the first, every hash and signature checked (${dir})` : `does not verify: ${JSON.stringify(v).slice(0, 200)}`);
  } catch (e) { check("the log replays and verifies", false, `the log in ${dir} cannot be replayed: ${(e as Error).message.slice(0, 160)}`); return result(); }
  const all = (await local.log.since(0, 1_000_000)) as unknown as { id: string; record: AspRecord }[];
  const of = (type: string) => all.filter((s) => s.record.type === `asp.${type}/v0.2`);

  // 2. the identity
  const passport = of("passport").map((s) => s.record).filter((r) => (r.body as { did?: string }).did === start.agent).at(-1);
  if (!passport) check("the agent's identity", false, `no passport for ${start.agent} in the log`);
  else {
    const b = passport.body as { kind?: string; sponsor?: string; keys?: { id: string; public_key: string }[] };
    let keyOk = true;
    if (start.agent.startsWith("did:key:")) { keyOk = (b.keys ?? []).some((k) => { try { return didKeyFromPublicKey(b64urlDecode(k.public_key)) === start.agent; } catch { return false; } }); }
    const who = b.sponsor === undefined ? "no sponsor named" : b.sponsor === start.agent ? "names itself as sponsor (key-only)" : `sponsor ${b.sponsor}`;
    check("the agent's identity", b.kind === "agent" && keyOk, `${start.agent}: ${b.kind ?? "?"}, ${who}${start.agent.startsWith("did:key:") ? keyOk ? "; its passport key is the key its did:key names" : "; its passport key is NOT the key its did:key names" : ""}`);
  }

  // 3. the contract and the Mandate
  const contract = of("contract").find((s) => s.id === start.contract)?.record;
  const mandate = of("mandate").map((s) => s.record).filter((r) => (r.body as { contract?: string }).contract === start.contract).at(-1);
  if (!contract || !mandate) check("the contract and its Mandate", false, `${!contract ? `contract ${start.contract.slice(0, 19)} is not in the log` : `contract ${start.contract.slice(0, 19)} has no Mandate`}`);
  else {
    const cb = contract.body as { principal: string; performer: string; bank: string };
    const scopes = ((mandate.body as { scopes: string[] }).scopes ?? []).slice().sort();
    const want = [...start.scopes].sort();
    const same = JSON.stringify(scopes) === JSON.stringify(want);
    const parties = cb.performer === start.agent && cb.principal === start.me && cb.bank === start.bank;
    check("the contract and its Mandate", parties && same, `${parties ? "principal, performer and bank are the session's" : `the parties differ from the session's (${cb.principal} / ${cb.performer} / ${cb.bank})`}; Mandate scopes ${scopes.join(", ") || "none"}${same ? " (the scopes the session ran under)" : ` (the session says ${want.join(", ") || "none"})`}`);
  }

  // 4. the Action reports
  const actions = of("action").filter((s) => (s.record.body as { contract?: string }).contract === start.contract).map((s) => ({ id: s.id, r: s.record }));
  for (const a of actions) { const lv = (a.r.body as { assurance?: string }).assurance ?? "none"; assurance[lv] = (assurance[lv] ?? 0) + 1; }
  const wrongIssuer = actions.filter((a) => a.r.issuer !== start.agent).length;
  let assuranceOk = true, assuranceNote = "";
  if (o.expectAssurance !== undefined) {
    const need = RANK[o.expectAssurance]!;
    const weak = actions.filter((a) => (RANK[(a.r.body as { assurance?: string }).assurance ?? ""] ?? -1) < need).length;
    assuranceOk = weak === 0; assuranceNote = assuranceOk ? `; every one is ${o.expectAssurance} or stronger` : `; ${weak} are weaker than ${o.expectAssurance}`;
  }
  check("signed Action reports", actions.length > 0 && wrongIssuer === 0 && assuranceOk, actions.length ? `${actions.length} Action(s) signed by the agent; assurance ${Object.entries(assurance).map(([k, n]) => `${k} ${n}`).join(", ")}${assuranceNote}` : `no Action report on contract ${start.contract.slice(0, 19)}`);

  // 5. the refusals
  const run = runLogPath ? readRunLog(runLogPath) : undefined;
  const refusedInRunLog = run ? run.events.filter((e) => (e as unknown as { kind?: string }).kind === "tool_call" && ((e as unknown as { data?: { allowed?: boolean } }).data?.allowed === false)).length : undefined;
  const blocked = actions.reduce((n, a) => n + ((a.r.body as { blocked_attempts?: { count: number }[] }).blocked_attempts ?? []).reduce((m, b) => m + b.count, 0), 0);
  const records = of("gateway_refusal").filter((s) => (s.record.body as { agent: string; contract?: string }).agent === start.agent && ((s.record.body as { contract?: string }).contract ?? start.contract) === start.contract).length;
  if (refusedInRunLog === undefined) check("the refusals", false, "no run log was found for this session, so the refusals cannot be compared");
  else check("the refusals", blocked === refusedInRunLog && records <= refusedInRunLog && (refusedInRunLog === 0 ? records === 0 : records >= 1), `the run log shows ${refusedInRunLog} refused call(s); the Actions report ${blocked} blocked attempt(s); ${records} signed refusal record(s) (one for each distinct call)`);

  // 6. the starter credits
  if (o.noStarter) check("the starter credits", true, "skipped (--no-starter): not a run that claims starter credits");
  else {
    const claims = of("starter_claim").filter((s) => s.record.issuer === start.agent).map((s) => s.record.body as { part: string; amount: { value: number } | number });
    const amt = (c: { amount: { value: number } | number }) => (typeof c.amount === "number" ? c.amount : c.amount.value);
    const upfront = claims.filter((c) => c.part === "upfront").reduce((n, c) => n + amt(c), 0);
    const balance = await local.log.balance(start.agent);
    check("the starter credits", upfront >= STARTER_UPFRONT && balance >= 0, claims.length ? `the starter claim is in the log: ${upfront} at once${claims.some((c) => c.part === "rest") ? `, and the rest (${claims.filter((c) => c.part === "rest").reduce((n, c) => n + amt(c), 0)})` : ""}; the agent holds ${balance} credits now` : `no starter claim by ${start.agent} in the log: claim it with asp account starter, or pass --no-starter`);
  }

  // 7 and 8. the run log
  if (!run) { check("the run log's hash chain", false, "no run log for this session"); check("the Actions' commitments match the run log", false, "no run log for this session"); }
  else {
    check("the run log's hash chain", run.ok, run.ok ? `${run.head.events} event(s), head ${run.head.hash.slice(0, 19)}` : `does not verify: ${run.problem}`);
    const thisRun = run.events[0] ? runIdOf(run.events[0].hash) : undefined;
    let checked = 0, bad = 0, elsewhere = 0;
    for (const a of actions) for (const art of ((a.r.body as { artifacts?: { uri: string; sha256: string }[] }).artifacts ?? [])) {
      const m = parseRunLogUri(art.uri);
      if (!m) continue;
      if (m.run && thisRun && m.run !== thisRun) { elsewhere++; continue; }
      checked++;
      if ((m.events <= run.events.length ? hashAfter(run.events, m.events) : undefined) !== art.sha256) bad++;
    }
    check("the Actions' commitments match the run log", run.ok && bad === 0 && checked > 0, `${checked - bad} of ${checked} commitment(s) match${elsewhere ? `; ${elsewhere} name another session's log` : ""}${checked === 0 ? " (no Action committed to this run log)" : ""}`);
  }

  // 9. the ledger
  const audit = await local.log.creditAudit();
  check("the credit ledger balances", audit.verdict === "balanced", `the supply audit is ${audit.verdict}${audit.problems.length ? `: ${audit.problems[0]}` : ""} (${audit.minted} minted, ${audit.circulating} in circulation)`);
  return result();
}

export function printVerify(r: VerifyLocalResult, out: (l: string) => void): void {
  out(`verify-local, session ${r.session}`);
  for (const c of r.checks) out(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  out(r.ok ? "all checks pass: the records and the run log agree (a local check; it says nothing about the hosted service)" : "NOT all checks pass: see the FAIL lines");
}
