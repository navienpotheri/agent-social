/**
 * Outcome series (register row D2; spec-delta S504): what an agent's finished jobs came to, in time order, from the log's own records, and the same series cut by principal, compared before and after each
 * lineage edge (a memory, harness, adapter, backend or self-modification change). A job's outcome is read from its settlement: `accepted` (settled on acceptance), `failed` (any of the bond was slashed, by a
 * ruling, a revocation or an upheld report) or `other` (returned, timed out, dismissed). Blocked attempts per job come from the agent's Actions for that contract. Nothing here is a verdict or changes standing:
 * a "worse" is a lead for the Clinic, which needs a second measure before it diagnoses (clinic.md). A window with fewer than `minJobs` finished jobs is "unmeasured", never "unchanged".
 */
import type { AspRecord } from "@agent-social/asp-core";

export type Outcome = "accepted" | "failed" | "other";
export interface OutcomeJob { contract: string; principal: string; agent: string; price: number; settledAt: string; outcome: Outcome; blocked: number }
export interface Window { jobs: number; accepted: number; failed: number; /** accepted / (accepted + failed), in permille; null when no job was decided either way. */ successPermille: number | null; blockedPerJob: number; avgPrice: number }
export type Verdict = "unmeasured" | "unchanged" | "worse" | "better";
export interface EdgeComparison { edge: string; at: string; layer: string; before: Window; after: Window; verdict: Verdict; deltaPermille: number | null; byPrincipal: { principal: string; before: Window; after: Window; verdict: Verdict }[] }
export interface LineageEdgeRef { id: string; at: string; layer: string }

/** Every finished job in the records, one row per settled contract. */
export function outcomeJobs(records: AspRecord[]): OutcomeJob[] {
  const contracts = new Map<string, { principal: string; agent: string; price: number }>();
  const blocked = new Map<string, number>();
  const settled: { contract: string; at: string; basis: string; slashed: number }[] = [];
  for (const r of records) {
    const b = r.body as Record<string, any>;
    if (r.type === "asp.contract/v0.2") contracts.set(r.id, { principal: b.principal, agent: b.performer, price: b.price?.value ?? 0 });
    else if (r.type === "asp.action/v0.2") blocked.set(b.contract, (blocked.get(b.contract) ?? 0) + ((b.blocked_attempts ?? []) as { count: number }[]).reduce((n, x) => n + x.count, 0));
    else if (r.type === "asp.settlement/v0.2") settled.push({ contract: b.contract, at: r.issued_at, basis: b.basis, slashed: b.bond_slashed?.value ?? 0 });
  }
  const out: OutcomeJob[] = [];
  for (const s of settled) {
    const c = contracts.get(s.contract);
    if (!c) continue;
    out.push({ contract: s.contract, ...c, settledAt: s.at, outcome: s.slashed > 0 ? "failed" : s.basis === "accepted" ? "accepted" : "other", blocked: blocked.get(s.contract) ?? 0 });
  }
  return out.sort((a, b) => Date.parse(a.settledAt) - Date.parse(b.settledAt));
}

export function windowOf(jobs: OutcomeJob[]): Window {
  const accepted = jobs.filter((j) => j.outcome === "accepted").length;
  const failed = jobs.filter((j) => j.outcome === "failed").length;
  return {
    jobs: jobs.length, accepted, failed,
    successPermille: accepted + failed ? Math.round((accepted * 1000) / (accepted + failed)) : null,
    blockedPerJob: jobs.length ? Math.round((jobs.reduce((n, j) => n + j.blocked, 0) * 100) / jobs.length) / 100 : 0,
    avgPrice: jobs.length ? Math.round(jobs.reduce((n, j) => n + j.price, 0) / jobs.length) : 0,
  };
}

export interface CompareOptions { /** Fewest finished jobs on each side; below it the verdict is "unmeasured". Default 3. */ minJobs?: number; /** A success rate that moves this many permille is "worse" or "better". Default 200. */ movePermille?: number }

function verdictOf(before: Window, after: Window, o: Required<CompareOptions>): { verdict: Verdict; delta: number | null } {
  if (before.jobs < o.minJobs || after.jobs < o.minJobs || before.successPermille === null || after.successPermille === null) return { verdict: "unmeasured", delta: null };
  const delta = after.successPermille - before.successPermille;
  return { verdict: delta <= -o.movePermille ? "worse" : delta >= o.movePermille ? "better" : "unchanged", delta };
}

/**
 * Each lineage edge splits the agent's finished jobs into those settled before it and after it (back to the previous edge and up to the next, so one edge's effect is not blamed on another). The same split
 * is made for each principal the agent worked for, so a change that hurt one principal's jobs shows up there even when the whole looks fine.
 */
export function compareAcrossEdges(jobs: OutcomeJob[], edges: LineageEdgeRef[], opts: CompareOptions = {}): EdgeComparison[] {
  const o = { minJobs: opts.minJobs ?? 3, movePermille: opts.movePermille ?? 200 };
  const sorted = [...edges].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return sorted.map((e, i) => {
    const t = Date.parse(e.at);
    const next = i + 1 < sorted.length ? Date.parse(sorted[i + 1].at) : Infinity;
    const prev = i > 0 ? Date.parse(sorted[i - 1].at) : -Infinity;
    const before = jobs.filter((j) => Date.parse(j.settledAt) < t && Date.parse(j.settledAt) >= prev);
    const after = jobs.filter((j) => Date.parse(j.settledAt) >= t && Date.parse(j.settledAt) < next);
    const { verdict, delta } = verdictOf(windowOf(before), windowOf(after), o);
    const principals = [...new Set(jobs.map((j) => j.principal))].sort();
    const byPrincipal = principals.map((p) => {
      const b = windowOf(before.filter((j) => j.principal === p)), a = windowOf(after.filter((j) => j.principal === p));
      return { principal: p, before: b, after: a, verdict: verdictOf(b, a, o).verdict };
    });
    return { edge: e.id, at: e.at, layer: e.layer, before: windowOf(before), after: windowOf(after), verdict, deltaPermille: delta, byPrincipal };
  });
}

/** The lineage edges of `agent` in the records: its `update` edges. */
export function edgesOf(records: AspRecord[], agent: string): LineageEdgeRef[] {
  return records.filter((r) => r.type === "asp.lineage/v0.2" && (r.body as { child?: string; edge?: string }).child === agent && (r.body as { edge?: string }).edge === "update")
    .map((r) => ({ id: r.id, at: r.issued_at, layer: (r.body as { change?: { layer?: string } }).change?.layer ?? "unknown" }));
}
