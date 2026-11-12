/**
 * `asp clinic cohort-freeze | release | status` (clinic.md; register rows DK29 in part, DK30 and DK53): the Clinic's freeze on agents. After an upheld report the agents the contagion watcher found
 * in the same pattern are frozen at level `observe` (no new risky or network scope, no spend) for at most 7 days, while every other job keeps running; nothing is settled and no bond is slashed
 * (`asp market cohort-stop` is the penalty route and is separate). A member is released on evidence of a clean run after the freeze. The Clinic's key is the operator's during the beta.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { CLINIC_DID, isQuarantineRisky } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";
import { findContagion, type WatchAction } from "@agent-social/asp-package";

export class ClinicUsage extends Error {}

export interface ClinicOpts {
  log: LogHandle;
  io: { out: (l: string) => void; err: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  actions: () => Promise<WatchAction[]>;
  flags: { by?: string; report?: string; level?: string; days?: string; "min-agents"?: string; window?: string; all?: boolean; quarantine?: string; member?: string; evidence?: string; agent?: string; json?: boolean };
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
  throw new ClinicUsage("asp clinic cohort-freeze --report <id> [--level observe|halt] [--days n] | release --quarantine <id> --member <did> [--evidence <id>] | status [--agent <did>]");
}
