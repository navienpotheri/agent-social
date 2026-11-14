/**
 * Collusion over the log (register row DK6; spec-delta S468): who hires whom, read from accepted settlements, and the patterns that farm the credit reward: a pair that hire each other, a ring of three to six
 * (A hires B, B hires C, C hires A within 90 days), agents of one sponsor settling with each other, and one principal behind most of an agent's work. The log already refuses to count such jobs for standing
 * (`closesLoop` below is the rule it uses; independence and the counterparty cap are in qualifying.ts); this reports them, so the Clinic and the Courts can look. A finding is a lead, not a verdict.
 */
import type { AspRecord } from "@agent-social/asp-core";

const DAY = 86_400_000;
export const LOOP_WINDOW_MS = 90 * DAY;
export const LOOP_MAX_LENGTH = 6;

export interface Hire { principal: string; performer: string; at: number; contract: string }

/** Whether hiring `performer` for `principal` at `at` closes a loop: the performer already hired (directly or through up to LOOP_MAX_LENGTH - 2 others) the principal in the last 90 days. Pure: the log keeps the same edges in markers. */
export function closesLoop(edges: Hire[], principal: string, performer: string, at: number): boolean {
  const recent = edges.filter((e) => at - e.at <= LOOP_WINDOW_MS && e.at <= at);
  let frontier = new Set([performer]);
  const seen = new Set([performer]);
  for (let depth = 1; depth <= LOOP_MAX_LENGTH - 1; depth++) {
    const next = new Set<string>();
    for (const e of recent) if (frontier.has(e.principal)) { if (e.performer === principal) return true; if (!seen.has(e.performer)) { seen.add(e.performer); next.add(e.performer); } }
    frontier = next;
    if (!frontier.size) break;
  }
  return false;
}

export interface CollusionFinding { kind: "reciprocal" | "ring" | "sponsor_cluster" | "concentration"; agents: string[]; jobs: string[]; why: string }

/** The accepted jobs of a log as hires, and each agent's sponsor, from its records. */
export function hiresOf(records: AspRecord[]): { hires: Hire[]; sponsorOf: Map<string, string> } {
  const sponsorOf = new Map<string, string>();
  const contracts = new Map<string, { principal: string; performer: string }>();
  for (const r of records) {
    if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; sponsor?: string }; if (b.sponsor) sponsorOf.set(b.did, b.sponsor); }
    else if (r.type === "asp.contract/v0.2") contracts.set(r.id, r.body as { principal: string; performer: string });
  }
  const hires: Hire[] = [];
  for (const r of records) {
    if (r.type !== "asp.settlement/v0.2") continue;
    const b = r.body as { contract: string; basis: string };
    const c = contracts.get(b.contract);
    if (c && b.basis === "accepted") hires.push({ principal: c.principal, performer: c.performer, at: Date.parse(r.issued_at), contract: b.contract });
  }
  return { hires: hires.sort((a, b) => a.at - b.at), sponsorOf };
}

export function findCollusion(records: AspRecord[]): CollusionFinding[] {
  const { hires, sponsorOf } = hiresOf(records);
  const out: CollusionFinding[] = [];
  const sponsor = (d: string) => sponsorOf.get(d) ?? d;
  // Reciprocal pairs and rings: replay the hires in order, and name the loop a hire closes.
  const seenLoops = new Set<string>();
  for (let i = 0; i < hires.length; i++) {
    const h = hires[i];
    const before = hires.slice(0, i);
    if (!closesLoop(before, h.principal, h.performer, h.at)) continue;
    const path = loopPath(before, h);
    const key = [...new Set(path)].sort().join("|");
    if (seenLoops.has(key)) continue;
    seenLoops.add(key);
    const agents = [...new Set(path)];
    const jobs = [h.contract];
    for (let j = 0; j + 1 < path.length; j++) { const e = before.find((x) => x.principal === path[j + 1] && x.performer === path[j]); if (e) jobs.push(e.contract); }
    out.push({ kind: agents.length === 2 ? "reciprocal" : "ring", agents, jobs, why: agents.length === 2 ? `${h.principal} and ${h.performer} hired each other within 90 days` : `a ring of ${agents.length} that hire each other within 90 days: ${[...path].reverse().join(" hired ")} hired ${path[0]}, who hired ${h.performer}` });
  }
  // Agents of one sponsor settling with each other.
  const cluster = new Map<string, { agents: Set<string>; jobs: string[] }>();
  for (const h of hires) if (sponsor(h.principal) === sponsor(h.performer) && h.principal !== h.performer) { const c = cluster.get(sponsor(h.performer)) ?? { agents: new Set(), jobs: [] }; c.agents.add(h.principal).add(h.performer); c.jobs.push(h.contract); cluster.set(sponsor(h.performer), c); }
  for (const [s, c] of cluster) out.push({ kind: "sponsor_cluster", agents: [...c.agents].sort(), jobs: c.jobs, why: `${c.jobs.length} accepted job(s) between agents of one sponsor (${s}): these never count for standing` });
  // One principal behind most of an agent's accepted work.
  const byPerformer = new Map<string, Hire[]>();
  for (const h of hires) byPerformer.set(h.performer, [...(byPerformer.get(h.performer) ?? []), h]);
  for (const [agent, hs] of byPerformer) {
    if (hs.length < 4) continue;
    const counts = new Map<string, number>();
    for (const h of hs) counts.set(h.principal, (counts.get(h.principal) ?? 0) + 1);
    const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (n / hs.length > 0.5) out.push({ kind: "concentration", agents: [agent, top], jobs: hs.filter((h) => h.principal === top).map((h) => h.contract), why: `${n} of ${agent}'s ${hs.length} accepted jobs are for one principal (${top}): the counterparty cap limits what counts` });
  }
  return out;
}

/** The agents on the loop a hire closes: the principal, then back through whoever hired it to the performer. */
function loopPath(edges: Hire[], h: Hire): string[] {
  const recent = edges.filter((e) => h.at - e.at <= LOOP_WINDOW_MS && e.at <= h.at);
  const hirer = new Map<string, string>();
  let frontier = [h.performer];
  for (let depth = 1; depth <= LOOP_MAX_LENGTH - 1 && frontier.length; depth++) {
    const next: string[] = [];
    for (const e of recent) if (frontier.includes(e.principal) && e.performer !== h.performer && !hirer.has(e.performer)) { hirer.set(e.performer, e.principal); next.push(e.performer); }
    if (hirer.has(h.principal)) break;
    frontier = next;
  }
  const path = [h.principal];
  let cur = h.principal;
  while (cur !== h.performer && hirer.has(cur)) { cur = hirer.get(cur)!; path.push(cur); }
  return path;
}
