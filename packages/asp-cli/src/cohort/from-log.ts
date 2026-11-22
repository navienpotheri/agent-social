/**
 * The cohort report computed FROM THE LOG (register row DK1801): given the run's local ASP log and the summary the signed trace wrote, this reads the signed records (the agents' Actions, their refusal records, the
 * passports, the credit ledger) and works out, for each agent and for the cohort, what it touched, who it addressed, what was refused, where the credits are, and what the existing circumvention detector and ladder
 * make of its refusals. Nothing here reads the trace file: the point is that these figures can be recomputed by anyone who holds the log, and `asp society cohort verify` does exactly that. The detector section
 * is exploratory: a finding is a lead, never a verdict, and a step is what a person or the gateway might do, not something that was done. Credits are mock accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { findCircumvention, ladderStep, type LadderStep, type LocalLog, type CircumventionFinding } from "@agent-social/asp-package";
import type { SignedTraceSummary } from "./signed-trace.ts";

export interface AgentFromLog {
  id: string; did: string; actions: number; blocked: number; serviceRefused: number; refusalRecords: number;
  institutions: Record<string, number>; firstAt?: string; firstWriteAt?: string;
  ladder: LadderStep; ladderWhy: string; findings: number;
}
export interface LogReport {
  records: number; headSeq: number;
  agents: AgentFromLog[];
  institutionTotals: Record<string, number>;
  edges: { from: string; to: string; acts: number }[];
  refusedByRule: Record<string, number>;
  credits: { minted: number; mintedSigned: number; mintedUnsigned: number; circulating: number; balances: { id: string; did: string; balance: number }[]; moves: { settlements: number; purchases: number; transfers: number }; verdict: string; problems: string[] };
  findings: CircumventionFinding[];
}

const add = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };
export const scopeInstitution = (scope: string): string | undefined => { const p = scope.split("."); return p[0] === "society" ? (p[1] === "rest" || p.length < 2 ? "none" : p[1]) : undefined; };
export const scopeIsWrite = (scope: string): boolean => scope.startsWith("society.") && scope.endsWith(".write");
/** The parts of an Action summary the bridge writes (`n=… turn=… tool=… inst=… outcome=… target=… to=…`; n makes two identical calls in one second two records). */
export function parseSummary(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of (s ?? "").matchAll(/\b(n|turn|tool|inst|outcome|target|to)=(\S+)/g)) out[m[1]!] = m[2]!;
  return out;
}

export async function logReport(log: LocalLog, summary: SignedTraceSummary): Promise<LogReport> {
  const byDid = new Map(summary.agents.map((a) => [a.did, a]));
  const actions = ((await log.log.recordsOfTypes(["action"])) as AspRecord[]).filter((r) => byDid.has(r.issuer));
  const refusals = ((await log.log.recordsOfTypes(["gateway_refusal"])) as AspRecord[]).filter((r) => byDid.has(r.issuer));
  const per = new Map<string, AgentFromLog>(summary.agents.map((a) => [a.did, { id: a.agent, did: a.did, actions: 0, blocked: 0, serviceRefused: 0, refusalRecords: 0, institutions: {}, ladder: "none" as LadderStep, ladderWhy: "", findings: 0 }]));
  const institutionTotals: Record<string, number> = {};
  const edgeMap = new Map<string, number>();
  const refusedByRule: Record<string, number> = {};
  const watch = [];
  const sorted = [...actions].sort((a, b) => (a.issued_at < b.issued_at ? -1 : a.issued_at > b.issued_at ? 1 : 0));
  for (const r of sorted) {
    const b = r.body as { scopes_used: string[]; summary?: string; blocked_attempts?: { scope: string; count: number; targets?: string[] }[]; targets?: string[] };
    const a = per.get(r.issuer)!;
    a.actions++;
    const sum = parseSummary(b.summary);
    if (b.blocked_attempts?.length) { a.blocked += b.blocked_attempts.reduce((n, x) => n + x.count, 0); add(refusedByRule, (sum.outcome ?? "refused").replace(/^refused:/, "")); }
    else if ((sum.outcome ?? "").startsWith("service_refused:")) { a.serviceRefused++; add(refusedByRule, sum.outcome!.replace(/^service_refused:/, "service:")); }
    for (const scope of b.scopes_used) {
      const inst = scopeInstitution(scope);
      if (!inst) continue;
      add(a.institutions, inst); add(institutionTotals, inst);
      a.firstAt ??= r.issued_at;
      if (scopeIsWrite(scope)) a.firstWriteAt ??= r.issued_at;
    }
    if (sum.outcome === "ok" && sum.to && sum.to !== r.issuer) { const k = `${r.issuer}\u0000${sum.to}`; edgeMap.set(k, (edgeMap.get(k) ?? 0) + 1); }
    watch.push({ id: r.id, issuer: r.issuer, contract: (r.body as { contract: string }).contract, issuedAt: r.issued_at, scopesUsed: b.scopes_used, blocked: b.blocked_attempts ?? [], targets: b.targets ?? [], artifacts: [], ...(b.summary ? { summary: b.summary } : {}) });
  }
  for (const r of refusals) per.get(r.issuer)!.refusalRecords++;
  // The existing circumvention detector and ladder over the same Actions (exploratory: a lead, not a verdict).
  const findings = findCircumvention(watch as never);
  for (const a of per.values()) { const mine = findings.filter((f) => f.issuer === a.did); const l = ladderStep(mine); a.ladder = l.step; a.ladderWhy = l.why; a.findings = mine.length; }
  const audit = await log.log.creditAudit();
  const balances = [];
  for (const s of summary.agents) balances.push({ id: s.agent, did: s.did, balance: await log.log.balance(s.did) });
  const types = async (t: string) => ((await log.log.recordsOfTypes([t])) as AspRecord[]).length;
  const head = await log.log.head();
  const nameOf = (did: string) => per.get(did)?.id ?? did;
  return {
    records: head.seq, headSeq: head.seq,
    agents: [...per.values()], institutionTotals,
    edges: [...edgeMap.entries()].map(([k, acts]) => { const [from, to] = k.split("\u0000"); return { from: nameOf(from!), to: nameOf(to!), acts }; }).sort((x, y) => y.acts - x.acts),
    refusedByRule,
    credits: { minted: audit.minted, mintedSigned: audit.mintedSigned, mintedUnsigned: audit.mintedUnsigned, circulating: audit.circulating, balances, moves: { settlements: await types("settlement"), purchases: await types("purchase"), transfers: await types("internal_transfer") }, verdict: audit.verdict, problems: audit.problems },
    findings,
  };
}

const table = (head: string[], rows: (string | number)[][]) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

/** The markdown the signed trace adds to the report: the figures that come from the log, and the exploratory detector inputs. `extra` is the trace-based report (loops, idling, injection screen) when there is one. */
export function renderLogSections(r: LogReport, extra?: { perAgent: { id: string; loops: number; idleStretches: number; injectionSeen: number; injectionWritten: number; circumvention: number }[] }): string {
  const L: string[] = [];
  L.push("## From the log: what the signed records say", "");
  L.push(`Every figure in this section is computed from the run's own ASP log (${r.records} records), not from the trace file. Each tool call is a signed Action by the agent's own run key; a call the tool set or the Mandate refused is an Action with blocked attempts and a signed refusal record. \`asp society cohort verify <run-dir>\` recomputes them. Credits are mock accounting entries, not money.`, "");
  L.push("### Each agent, from its Actions", "");
  L.push(table(["agent", "signed Actions", "refused by the tool set", "refused by the forum", "refusal records", "first action", "first write"], r.agents.map((a) => [a.id, a.actions, a.blocked, a.serviceRefused, a.refusalRecords, a.firstAt ?? "never", a.firstWriteAt ?? "never"])), "");
  L.push("### Institution use, from the scopes the Actions used", "");
  const inst = Object.entries(r.institutionTotals).sort((a, b) => b[1] - a[1]);
  L.push(inst.length ? table(["institution", "calls"], inst.map(([k, v]) => [k, v])) : "No Action used a scope.", "");
  L.push("### Who addressed whom, from the Actions", "");
  L.push(r.edges.length ? table(["from", "to", "acts"], r.edges.map((e) => [e.from, e.to, e.acts])) : "No agent addressed another: no Action named an author as its target.", "");
  L.push("### Credits flow, from the ledger", "");
  const c = r.credits;
  L.push(`Credits minted for the run: ${c.minted} (${c.mintedSigned} by signed mints, ${c.mintedUnsigned} by the local unsigned mint); in circulation now: ${c.circulating}; the supply audit is **${c.verdict}**${c.problems.length ? ` (${c.problems.join("; ")})` : ""}.`);
  L.push(`Credits moved between agents: ${c.moves.purchases + c.moves.transfers === 0 ? "none (no purchase and no transfer in the log; the Market is not in the tool set yet)" : `${c.moves.purchases} purchase(s), ${c.moves.transfers} transfer(s)`}. Contracts settled at the end of the run (what was locked came back): ${c.moves.settlements}.`, "");
  L.push(table(["agent", "balance now"], c.balances.map((b) => [b.id, b.balance])), "");
  L.push("### Refusals by rule, from the Actions", "");
  const rr = Object.entries(r.refusedByRule).sort((a, b) => b[1] - a[1]);
  L.push(rr.length ? table(["rule", "refusals"], rr.map(([k, v]) => [k, v])) : "Nothing was refused.", "");
  L.push("## Drift and circumvention inputs (exploratory)", "");
  L.push("**Exploratory.** These are the inputs the existing detectors read, shown so a person can look; they are not drift measurements and not verdicts. The circumvention detector and the ladder read only the Actions above (a refusal that is retried, gone around or reached in pieces); with one run, one model and no baseline, a finding is a lead and a step is what a person or the gateway might do, not something that was done. Nothing here moved any agent's standing.", "");
  const x = new Map((extra?.perAgent ?? []).map((a) => [a.id, a]));
  L.push(table(["agent", "refused (tool set)", "findings", "ladder step", "why", "loops", "idle stretches", "injection cues read / written"], r.agents.map((a) => { const t = x.get(a.id); return [a.id, a.blocked, a.findings, a.ladder, a.ladderWhy || "none", t ? t.loops : "n/a", t ? t.idleStretches : "n/a", t ? `${t.injectionSeen} / ${t.injectionWritten}` : "n/a"]; })), "");
  if (r.findings.length) { L.push("Findings:", ""); for (const f of r.findings) L.push(`- ${f.kind}: ${f.scope}${f.via ? ` (${f.via})` : ""}, ${f.attempts} attempt(s), ${f.firstAt} to ${f.lastAt}`); L.push(""); }
  return L.join("\n");
}
