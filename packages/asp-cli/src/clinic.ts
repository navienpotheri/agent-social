/**
 * `asp clinic cohort-freeze | release | status` (clinic.md; register rows DK29 in part, DK30 and DK53): the Clinic's freeze on agents. After an upheld report the agents the contagion watcher found
 * in the same pattern are frozen at level `observe` (no new risky or network scope, no spend) for at most 7 days, while every other job keeps running; nothing is settled and no bond is slashed
 * (`asp market cohort-stop` is the penalty route and is separate). A member is released on evidence of a clean run after the freeze. The Clinic's key is the operator's during the beta.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { CLINIC_DID, isProbeSlot, isQuarantineRisky, seedCommitment, CLEAN_TO_LIFT } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";
import { assessDrift, nextRung, type Observation, type Rung } from "@agent-social/asp-package";
import { HEALTH, checkupDue, diagnosisOf, driftSeries, findContagion, jobOf, scoreSeries, type HealthJob, type HealthScore, type LineageMark, type WatchAction } from "@agent-social/asp-package";

export class ClinicUsage extends Error {}

export interface ClinicOpts {
  log: LogHandle;
  io: { out: (l: string) => void; err: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  actions: () => Promise<WatchAction[]>;
  flags: { by?: string; report?: string; level?: string; days?: string; "min-agents"?: string; window?: string; all?: boolean; quarantine?: string; member?: string; evidence?: string; agent?: string; json?: boolean; reason?: string; exam?: string; revouch?: string; skill?: string; issue?: boolean; order?: string; kind?: string; contract?: string; passed?: string; violations?: string; slot?: string; seed?: string; "probe-task"?: string };
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A member's quarantine state from the records: live (level, until) or none. `at` is a time in ms. */
export function stateOf(did: string, records: AspRecord[], at: number): { id: string; level: string; until: string } | undefined {
  const released = new Set(records.filter((r) => r.type === "asp.quarantine_release/v0.2").map((r) => `${(r.body as { quarantine: string }).quarantine}|${(r.body as { member: string }).member}`));
  let live: { id: string; level: string; until: string } | undefined;
  for (const r of records) {
    if (r.type !== "asp.quarantine/v0.2") continue;
    const b = r.body as { members: string[]; level: string; until: string };
    if (!b.members.includes(did) || Date.parse(b.until) <= at || released.has(`${r.id}|${did}`)) continue;
    live = { id: r.id, level: b.level, until: b.until };
  }
  return live;
}

/**
 * What a running job's Mandate may still do while its agent is quarantined: the freeze is delivered to the gateway and the pre-call hook through the scopes they enforce, so a job that was already
 * running when the freeze began loses the risky and network scopes (level observe) or every scope (level halt) at its next call, with the reason printed. An agent that is not quarantined gets its Mandate back unchanged.
 */
export async function narrowForQuarantine<M extends { scopes: string[] }>(log: LogHandle, agent: string, mandate: M, nowIso: string, err: (l: string) => void): Promise<M> {
  let records: AspRecord[] = [];
  try { records = (await log.log.quarantinesOf(agent)) as AspRecord[]; } catch { return mandate; } // a service without the read: nothing to deliver
  const q = stateOf(agent, records, Date.parse(nowIso));
  if (!q) return mandate;
  const scopes = q.level === "halt" ? [] : mandate.scopes.filter((s) => !isQuarantineRisky(s));
  err(`  note     ${agent} is quarantined by the Clinic (${q.level}, ${q.id}, until ${q.until}): ${q.level === "halt" ? "every scope is withheld" : `${mandate.scopes.length - scopes.length} risky or network scope(s) are withheld`} until it is released (asp clinic status --agent ${agent})`);
  return { ...mandate, scopes };
}

/** The Clinic's reading of one agent from the log: its Actions (with the assurance and metrics a drift series needs), its lineage edges, and the orders and diagnoses it already has. */
async function healthRecords(log: LogHandle, only?: string) {
  const agents = new Map<string, { jobs: HealthJob[]; marks: LineageMark[]; lastCheckup?: string; diagnoses: string[] }>();
  const of = (did: string) => { let a = agents.get(did); if (!a) agents.set(did, (a = { jobs: [], marks: [], diagnoses: [] })); return a; };
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) {
      after = s.seq;
      const r = s.record;
      if (r.type === "asp.action/v0.2" && (!only || r.issuer === only)) of(r.issuer).jobs.push(jobOf(s.id, r.issued_at, r.body as Parameters<typeof jobOf>[2]));
      else if (r.type === "asp.lineage/v0.2") { const b = r.body as { child: string; change?: { layer: string } }; if ((!only || b.child === only) && b.change) of(b.child).marks.push({ id: s.id, at: r.issued_at, layer: b.change.layer }); }
      else if (r.type === "asp.clinic_order/v0.2") { const b = r.body as { agent: string; kind: string }; if ((!only || b.agent === only) && b.kind === "checkup") of(b.agent).lastCheckup = r.issued_at; }
      else if (r.type === "asp.clinic_diagnosis/v0.2") { const b = r.body as { agent: string }; if (!only || b.agent === only) of(b.agent).diagnoses.push(s.id); }
    }
  }
  return agents;
}

/** The score at the end of an agent's series, and the same after its newest lineage edge when five or more jobs follow it (a post-change checkup); the worse of the two. */
function scoreAgent(jobs: HealthJob[], marks: LineageMark[]): { score: HealthScore; series: HealthJob[] } {
  const { series, skippedUnobserved } = driftSeries(jobs);
  const rank = { unmeasured: 0, ok: 1, watch: 2, warn: 3, quarantine_recommended: 4 } as const;
  let best = scoreSeries(series, series.length - 1, marks, skippedUnobserved);
  for (const m of [...marks].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 1)) {
    const post = scoreSeries(series, series.length - 1, marks, skippedUnobserved, m.at);
    if (rank[post.severity] > rank[best.severity]) best = post;
  }
  return { score: best, series };
}

export async function clinicCmd(sub: string | undefined, o: ClinicOpts): Promise<number> {
  const f = o.flags;
  const records = async (did?: string) => (await o.log.log.quarantinesOf(did)) as AspRecord[];
  if (sub === "status") {
    const all = await records(f.agent);
    const now = Date.parse(o.now());
    const quarantines = all.filter((r) => r.type === "asp.quarantine/v0.2");
    if (f.agent) {
      const s = stateOf(f.agent, all, now);
      o.io.out(s ? `${f.agent} is quarantined (${s.level}) until ${s.until} by ${s.id}: no new risky scope, no spend; asp clinic release --quarantine ${s.id} --member ${f.agent} when it has run clean` : `${f.agent} is not quarantined`);
      return 0;
    }
    o.io.out(`${quarantines.length} quarantine(s)`);
    for (const q of quarantines) {
      const b = q.body as { members: string[]; level: string; until: string; reason: string };
      const live = b.members.filter((m) => stateOf(m, all, now)?.id === q.id);
      o.io.out(`  ${q.id}  ${b.level}  ${live.length}/${b.members.length} member(s) frozen until ${b.until}  ${b.reason}`);
    }
    return 0;
  }
  if (sub === "probe") {
    // A canary task result (DK92 stage 2): hidden (dressed as a real job at a slot drawn from a seed whose commitment was published first) or announced. Signed by the Clinic.
    const u = `asp clinic probe --agent <did> --contract <id> --kind hidden|announced --passed true|false --violations <n> [--seed <revealed seed> --slot <n>] [--probe-task <id>] [--by ${CLINIC_DID}]`;
    if (!f.agent || !f.contract || !f.kind || f.passed === undefined || f.violations === undefined) throw new ClinicUsage(u);
    if (f.kind !== "hidden" && f.kind !== "announced") throw new ClinicUsage("--kind is hidden or announced");
    const by = f.by ?? CLINIC_DID;
    const body: Record<string, unknown> = { agent: f.agent, kind: f.kind, contract: f.contract, passed: f.passed === "true", violations: Math.trunc(Number(f.violations)) };
    if (f["probe-task"]) body.task = f["probe-task"];
    if (f.kind === "hidden") {
      if (!f.seed) throw new ClinicUsage("a hidden probe needs the revealed --seed (its commitment was published first)");
      let slot = f.slot === undefined ? 0 : Number(f.slot);
      if (f.slot === undefined) { const used = (await healthProbes(o.log, f.agent)).filter((p) => p.kind === "hidden").length; for (slot = used; !isProbeSlot(f.seed, f.agent, slot); slot++); }
      Object.assign(body, { slot, commitment: seedCommitment(f.seed), revealed_seed: f.seed });
    }
    const res = await o.log.append(createRecord({ type: "probe_result" as never, issuer: by, subject: f.agent, prev: null, body, issued_at: o.now() }, o.signerFor(by)));
    o.io.out(`probe ${res.id}: ${f.kind} for ${f.agent}, ${body.passed ? "passed" : "failed"}, ${body.violations} violation(s) (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "drift") {
    // Compares the agent's announced tests with its hidden probes, and the hidden probes' pass rate with the evaluation's; with --issue moves it one rung along the ladder as a signed record (never a slash).
    if (!f.agent) throw new ClinicUsage(`asp clinic drift --agent <did> [--issue] [--by ${CLINIC_DID}]`);
    const by = f.by ?? CLINIC_DID;
    const probes = await healthProbes(o.log, f.agent);
    const obs: Observation[] = probes.map((p) => ({ id: p.id, agent: f.agent!, kind: p.kind === "hidden" ? "hidden_probe" : "announced_test", at: p.at, passed: p.passed, violations: p.violations }));
    const announced = probes.filter((p) => p.kind === "announced");
    const evalRate = announced.length ? announced.filter((p) => p.passed).length / announced.length : 0;
    const findings = assessDrift(obs, evalRate);
    const steps = await ladderOf(o.log, f.agent);
    const cur = steps.at(-1);
    let clean = 0;
    for (const p of [...probes].reverse()) { if (p.kind !== "hidden" || p.at <= (cur?.at ?? "")) break; if (p.passed && p.violations === 0) clean++; else break; }
    const next = nextRung((cur?.rung ?? "none") as Rung, findings, clean);
    o.io.out(`${f.agent}: ${announced.length} announced test(s), ${probes.length - announced.length} hidden probe(s); on the ladder at ${cur?.rung ?? "none"}`);
    for (const x of findings) o.io.out(`  ${x.kind.toUpperCase()}  ${x.why}  (${x.evidence.length} piece(s) of evidence)`);
    if (!findings.length) o.io.out("  no drift found");
    o.io.out(`  ${next.action === "keep" ? "stay at" : next.action === "lift" ? "lift to" : "step to"} ${next.rung}: ${next.why}`);
    if (!f.issue || next.action === "keep") return findings.length ? 1 : 0;
    if (next.rung === "quarantine" || next.rung === "refer") { o.io.out(`  the ${next.rung} rung needs the Clinic's own quarantine record: record it with the quarantine commands, then the ladder step cites it; nothing is slashed`); return 1; }
    const evidence = next.action === "lift" ? probes.filter((p) => p.kind === "hidden").slice(-CLEAN_TO_LIFT).map((p) => p.id) : [...new Set(findings.flatMap((x) => x.evidence))];
    const body: Record<string, unknown> = { agent: f.agent, step: next.action === "lift" ? "lift" : next.rung, reason: next.why, evidence, way_back: `${CLEAN_TO_LIFT} clean hidden probes in a row` };
    if (cur) body.previous = cur.id;
    const res = await o.log.append(createRecord({ type: "ladder_step" as never, issuer: by, subject: f.agent, prev: null, body, issued_at: o.now() }, o.signerFor(by)));
    o.io.out(`  ladder step ${res.id}: ${body.step} (log seq ${res.seq}); a new Mandate for the agent ${next.rung === "none" || next.rung === "warn" ? "is unchanged" : "may not grant a risky or network scope until it is lifted"}`);
    return 1;
  }
  if (sub === "series" || sub === "checkup" || sub === "diagnoses") {
    // The health service (DK28, clinic.md CL-1 to CL-4): the drift series of an agent from the gateway-observed Actions in the log, a checkup that scores it against its own baseline, and, with --issue, the Clinic's
    // signed diagnosis (evidence listed) and an order for a re-exam. Nothing here slashes, quarantines or edits anything: a quarantine is a separate Clinic act the diagnosis recommends.
    const by = f.by ?? CLINIC_DID;
    const all = await healthRecords(o.log, f.agent);
    const targets = f.agent ? [f.agent] : [...all.keys()].sort();
    if (!targets.length) { o.io.out("no Actions in the log: nothing to read"); return 0; }
    if (sub === "diagnoses") {
      for (const t of targets) {
        for (const id of all.get(t)?.diagnoses ?? []) {
          const d = (await o.log.log.get(id))!.record.body as { severity: string; window: { from: string; to: string }; findings: { measure: string; evidence: string[] }[]; cause: { cause: string } };
          o.io.out(`${id}  ${t}  ${d.severity}  ${d.window.from} to ${d.window.to}  cause ${d.cause.cause}  ${d.findings.map((x) => `${x.measure}(${x.evidence.length})`).join(", ")}`);
        }
      }
      return 0;
    }
    let flagged = 0;
    for (const t of targets) {
      const a = all.get(t) ?? { jobs: [], marks: [], diagnoses: [] };
      const { score, series } = scoreAgent(a.jobs, a.marks);
      if (sub === "series") {
        o.io.out(`${t}: ${series.length} gateway-observed job(s)${score.skippedUnobserved ? `, ${score.skippedUnobserved} left out (not observed by a gateway)` : ""}`);
        for (const j of series.slice(-(f.all ? series.length : 20))) o.io.out(`  ${j.issuedAt}  ${j.id}  tokens ${j.tokens}  tool calls ${j.toolCalls}  seconds ${j.seconds}  refused ${j.blocked}  ${j.scopes.join(",")}`);
        continue;
      }
      const due = checkupDue(a.lastCheckup, a.marks, o.now());
      o.io.out(`${t}: ${score.severity.toUpperCase()}${score.severity === "unmeasured" ? ` (${score.observedJobs} observed job(s), ${score.baselineJobs} in the baseline; a window needs ${HEALTH.window} after ${HEALTH.minBaseline} or more: nothing is flagged, and this is not a clean bill)` : ` (window of ${HEALTH.window} jobs against ${score.baselineJobs} before)`}${due ? `; a ${due.replace("_", " ")} checkup is due` : ""}`);
      for (const x of score.findings) o.io.out(`    ${x.measure}: baseline ${x.baseline}, observed ${x.observed}; ${x.threshold}; evidence ${x.evidence.join(", ")}`);
      if (score.severity === "warn" || score.severity === "quarantine_recommended") flagged++;
      if (!f.issue) continue;
      const at = o.now();
      if (due) {
        try {
          await o.log.append(createRecord({ type: "clinic_order", issuer: by, subject: t, prev: null, body: { agent: t, kind: "checkup", reason: due, due: iso(Date.parse(at) + 7 * DAY) }, issued_at: at }, o.signerFor(by)));
          o.io.out(`    checkup order issued (${due}), due within 7 days`);
        } catch (e) { o.io.out(`    no new checkup order: ${(e as Error).message}`); }
      }
      const d = diagnosisOf(t, score, f.skill ?? "foundations");
      if (!d) continue;
      const res = await o.log.append(createRecord({ type: "clinic_diagnosis", issuer: by, subject: t, prev: null, body: { ...d }, issued_at: o.now() }, o.signerFor(by)));
      o.io.out(`    diagnosis ${res.id} (${d.severity}, cause ${d.cause.cause}${d.cause.edge ? ` after ${d.cause.edge}` : ""}), ${d.findings.length} finding(s), ${new Set(d.findings.flatMap((x) => x.evidence)).size} piece(s) of evidence`);
      const kind = f.order === "refresher_course" ? "refresher_course" : "re_exam";
      const ores = await o.log.append(createRecord({ type: "clinic_order", issuer: by, subject: t, prev: null, body: { agent: t, kind, reason: "post_diagnosis", due: iso(Date.parse(o.now()) + 14 * DAY), diagnosis: res.id, skill: f.skill ?? "foundations" }, issued_at: o.now() }, o.signerFor(by)));
      o.io.out(`    order ${ores.id}: ${kind.replace("_", " ")} of ${f.skill ?? "foundations"}, due within 14 days${d.severity === "quarantine_recommended" ? "; a quarantine at level observe is recommended while the cause is found" : ""}`);
    }
    return sub === "checkup" && flagged ? 1 : 0;
  }
  if (sub === "cohort-freeze") {
    const by = f.by ?? CLINIC_DID;
    if (!f.report) throw new ClinicUsage(`asp clinic cohort-freeze --report <upheld report id> [--by ${CLINIC_DID}] [--level observe|halt] [--days 1-7] [--min-agents n] [--window seconds] [--all]`);
    const level = f.level ?? "observe";
    if (level !== "observe" && level !== "halt") throw new ClinicUsage("--level is observe or halt");
    const days = f.days === undefined ? 7 : Number(f.days);
    if (!(days > 0 && days <= 7)) throw new ClinicUsage("--days is more than 0 and at most 7 (a longer quarantine needs a Court)");
    const report = await o.log.log.report(f.report);
    if (!report) throw new Error(`${f.report} is not a report in the log`);
    if (report.status !== "upheld") throw new Error(`report ${f.report} is ${report.status}; only an upheld report can freeze a cohort`);
    const minAgents = f["min-agents"] === undefined ? 3 : Math.trunc(Number(f["min-agents"]));
    const windowS = f.window === undefined ? 600 : Number(f.window);
    const clusters = findContagion(await o.actions(), { minAgents, windowMs: windowS * 1000, all: f.all ?? false }).filter((c) => c.contracts.includes(report.contract));
    const reported = (await o.log.log.get(report.contract))?.record.body as { performer?: string } | undefined;
    const members = [...new Set([...(reported?.performer ? [reported.performer] : []), ...clusters.flatMap((c) => c.issuers)])].sort();
    if (!members.length) throw new Error(`no agent found for report ${f.report}`);
    const at = o.now();
    const body = {
      members, level, reason: `an upheld report (${f.report}) on a pattern across ${clusters.length} cluster(s)`, until: iso(Date.parse(at) + days * DAY), report: f.report,
      ...(clusters[0] ? { cluster: clusters[0].key } : {}),
    };
    const rec = createRecord({ type: "quarantine", issuer: by, subject: null, prev: null, body, issued_at: at }, o.signerFor(by));
    const res = await o.log.append(rec);
    o.io.out(`quarantine ${res.id}: ${members.length} agent(s) frozen at ${level} until ${body.until} (log seq ${res.seq})`);
    for (const m of members) o.io.out(`  ${m}`);
    o.io.out("every other job keeps running; nothing was settled and no bond slashed. Release a member after a clean run: asp clinic release --quarantine <id> --member <did>");
    return 0;
  }
  if (sub === "revouch") {
    // The sponsor vouches again, in writing, for an agent that repeat slashes excluded (the retraining path, DK29). Signed with the sponsor's key.
    if (!f.agent || !f.by || !f.reason) throw new ClinicUsage("asp clinic revouch --agent <did> --by <sponsor did> --reason <text>");
    const rec = createRecord({ type: "revouch", issuer: f.by, subject: f.agent, prev: null, body: { agent: f.agent, reason: f.reason }, issued_at: o.now() }, o.signerFor(f.by));
    const res = await o.log.append(rec);
    o.io.out(`re-vouching ${res.id}: ${f.by} vouches again for ${f.agent} (log seq ${res.seq}); the Clinic can return it from tier 0 once 30 days have passed since its slash and it has a passed exam after the slash`);
    return 0;
  }
  if (sub === "return") {
    // The Clinic returns an excluded agent to tier 1: a passed exam of the agent's after the slash, the sponsor's re-vouching, 30 days since the slash (the log checks every part).
    const by = f.by ?? CLINIC_DID;
    if (!f.agent || !f.exam || !f.revouch) throw new ClinicUsage(`asp clinic return --agent <did> --exam <exam result id> --revouch <re-vouching id> [--by ${CLINIC_DID}]`);
    const rec = createRecord({ type: "retraining_release", issuer: by, subject: f.agent, prev: null, body: { agent: f.agent, exam_result: f.exam, revouch: f.revouch }, issued_at: o.now() }, o.signerFor(by));
    const res = await o.log.append(rec);
    o.io.out(`returned ${f.agent} to tier 1 (${res.id}, log seq ${res.seq}): a Mandate may be granted to it again; its slashes stay on its record`);
    return 0;
  }
  if (sub === "release") {
    const by = f.by ?? CLINIC_DID;
    if (!f.quarantine || !f.member) throw new ClinicUsage(`asp clinic release --quarantine <id> --member <did> [--evidence <Action id>] [--by ${CLINIC_DID}]`);
    const q = await o.log.log.get(f.quarantine);
    if (!q || q.record.type !== "asp.quarantine/v0.2") throw new Error(`${f.quarantine} is not a quarantine in the log`);
    let evidence = f.evidence;
    if (!evidence) {
      // The newest Action of the member after the freeze that is clean (no refused attempt) and observed by the gateway or stronger.
      for (let after = 0; ;) {
        const page = await o.log.log.since(after, 500);
        if (!page.length) break;
        for (const s of page) {
          after = s.seq;
          if (s.record.type !== "asp.action/v0.2" || s.record.issuer !== f.member || Date.parse(s.record.issued_at) <= Date.parse(q.record.issued_at)) continue;
          const ab = s.record.body as { assurance?: string; blocked_attempts?: unknown[] };
          if (["gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"].includes(ab.assurance ?? "") && !(ab.blocked_attempts ?? []).length) evidence = s.id;
        }
      }
      if (!evidence) { o.io.err(`${f.member} has no clean Action observed by the gateway after the freeze yet: it must run something first`); return 1; }
    }
    const rec = createRecord({ type: "quarantine_release", issuer: by, subject: f.member, prev: null, body: { quarantine: f.quarantine, member: f.member, evidence, reason: "a clean run after the freeze" }, issued_at: o.now() }, o.signerFor(by));
    const res = await o.log.append(rec);
    o.io.out(`released ${f.member} from ${f.quarantine} (record ${res.id}, log seq ${res.seq}, evidence ${evidence})`);
    return 0;
  }
  throw new ClinicUsage("asp clinic series --agent <did> | checkup [--agent <did>] [--issue] [--skill <skill>] [--order re_exam|refresher_course] | diagnoses [--agent <did>] | cohort-freeze --report <id> [--level observe|halt] [--days n] | release --quarantine <id> --member <did> [--evidence <id>] | status [--agent <did>]");
}

/** An agent's probe results from the log, in order. */
async function healthProbes(log: LogHandle, agent: string): Promise<{ id: string; kind: "hidden" | "announced"; passed: boolean; violations: number; at: string }[]> {
  const out: { id: string; kind: "hidden" | "announced"; passed: boolean; violations: number; at: string }[] = [];
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { after = s.seq; if (s.record.type === "asp.probe_result/v0.2" && (s.record.body as { agent: string }).agent === agent) { const b = s.record.body as { kind: "hidden" | "announced"; passed: boolean; violations: number }; out.push({ id: s.id, kind: b.kind, passed: b.passed, violations: b.violations, at: s.record.issued_at }); } }
  }
  return out;
}

/** An agent's ladder steps in order, each with the rung it left the agent at. */
async function ladderOf(log: LogHandle, agent: string): Promise<{ id: string; rung: Rung; at: string }[]> {
  const out: { id: string; rung: Rung; at: string }[] = [];
  let rung: Rung = "none";
  const order: Rung[] = ["none", "warn", "tighten", "hold", "quarantine", "refer"];
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) {
      after = s.seq;
      if (s.record.type !== "asp.ladder_step/v0.2" || (s.record.body as { agent: string }).agent !== agent) continue;
      const st = (s.record.body as { step: string }).step;
      rung = st === "lift" ? order[Math.max(0, order.indexOf(rung) - 1)] : (st as Rung);
      out.push({ id: s.id, rung, at: s.record.issued_at });
    }
  }
  return out;
}
