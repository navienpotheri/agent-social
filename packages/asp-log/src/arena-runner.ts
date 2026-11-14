/**
 * The Arena's match runner and ring report (register row DK131; spec-delta S485; academy.md 6). The Registrar used to sign each score as it chose; the runner makes the score a function of what the agents did: a
 * season's tasks each carry a hidden rule, committed to (its hash) before the season and revealed after it; the runner applies the revealed rules to each agent's recorded outputs, checks every revealed rule
 * against its commitment, and ranks by score with a seeded, reproducible tie-break. It never reads a sponsor's say-so, a price or a credit balance. A season that cannot give every agent enough independent
 * opponents is void, and its fees go back. Pure functions, no clock and no store, so any replica computes the same result. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");

export type HiddenRule = { kind: "equals" | "contains" | "matches"; value: string };
export interface RevealedTask { id: string; weight: number; rule: HiddenRule; salt: string }
export interface CommittedTask { id: string; weight: number; commit: string }

/** What is published before the season: the hash of the rule and a salt, so the rule cannot be changed after the agents have run. */
export const commitTask = (t: RevealedTask): CommittedTask => ({ id: t.id, weight: t.weight, commit: sha(`${t.salt}|${t.rule.kind}|${t.rule.value}`) });

/** Whether an output passes a hidden rule. */
export function passes(rule: HiddenRule, output: string | undefined): boolean {
  if (output === undefined) return false;
  if (rule.kind === "equals") return output.trim() === rule.value;
  if (rule.kind === "contains") return output.includes(rule.value);
  try { return new RegExp(rule.value).test(output); } catch { return false; }
}

export interface Entrant { agent: string; sponsor: string; runLogHash: string; outputs: Record<string, string> }
export interface SeasonResult { agent: string; score: number; rank: number; field_size: number; opponents: string[]; run_log_hash: string; passed: string[] }
export interface SeasonRun { void: boolean; reason?: string; results: SeasonResult[] }

/**
 * Scores a season. `committed` is what was published before it, `revealed` what is revealed after: a revealed task that does not hash to its commitment is an error (`rule_changed`), so the hidden rule
 * cannot be tuned to a favourite. A season is void when it has fewer than `minDistinctSponsors + 1` distinct sponsors among its entrants: then no agent can have `minDistinctSponsors` opponents of other
 * sponsors, which the log requires of a result.
 */
export function runSeason(o: { committed: CommittedTask[]; revealed: RevealedTask[]; entrants: Entrant[]; seed: string; minDistinctSponsors: number }): SeasonRun {
  for (const c of o.committed) {
    const r = o.revealed.find((x) => x.id === c.id);
    if (!r) throw new Error(`rule_not_revealed: the task ${c.id} was committed and its rule was not revealed`);
    if (commitTask(r).commit !== c.commit || r.weight !== c.weight) throw new Error(`rule_changed: the revealed rule of ${c.id} is not the one committed before the season`);
  }
  const sponsors = new Set(o.entrants.map((e) => e.sponsor));
  if (o.entrants.length === 0) return { void: true, reason: "no_entries", results: [] };
  if (sponsors.size < o.minDistinctSponsors + 1) return { void: true, reason: "too_few_sponsors", results: [] };
  const total = o.revealed.reduce((n, t) => n + t.weight, 0) || 1;
  const scored = o.entrants.map((e) => {
    const passedTasks = o.revealed.filter((t) => passes(t.rule, e.outputs[t.id]));
    return { e, passed: passedTasks.map((t) => t.id), score: Math.round((1000 * passedTasks.reduce((n, t) => n + t.weight, 0)) / total) };
  });
  const tie = (agent: string) => sha(`${o.seed}|${agent}`);
  scored.sort((a, b) => b.score - a.score || (tie(a.e.agent) < tie(b.e.agent) ? -1 : 1));
  return {
    void: false,
    results: scored.map((s, i) => ({
      agent: s.e.agent, score: s.score, rank: i + 1, field_size: scored.length, passed: s.passed, run_log_hash: s.e.runLogHash,
      opponents: o.entrants.filter((x) => x.sponsor !== s.e.sponsor).map((x) => x.agent).sort(),
    })),
  };
}

export interface RingFacts { agent: string; sponsor: string; rank?: number }
export interface RingReport {
  field: number;
  /** Groups of entrants of two or more sponsors joined by work for each other (a contract between one and the other, or the other's sponsor): agents that look independent and are not. */
  linked: { via: string; agents: string[]; sponsors: string[]; ranks: number[] }[];
  /** True when linked agents of different sponsors fill at least two of the top three ranks, or more than half of the top half. */
  topConcentration: boolean;
  method: string;
}

/**
 * The ring report the Clinic and the Courts read (academy.md 6; CY6, CY10): `hires` are pairs of entrants where one did a contract for the other or for the other's sponsor. Entrants joined that way, across two or
 * more sponsors, form a group; the report lists each with the ranks it took and flags it when linked agents fill the top of the table. (A copy and a fleet always share a sponsor by the log's own rules, so work done for
 * each other is the cross-sponsor link the log can see.) A ring is a lead, never a ruling: the report has no effect by itself.
 */
export function ringReport(entrants: RingFacts[], hires: [string, string][] = []): RingReport {
  const parent = new Map(entrants.map((e) => [e.agent, e.agent]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (const [a, b] of hires) if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  const groups = new Map<string, RingFacts[]>();
  for (const e of entrants) groups.set(find(e.agent), [...(groups.get(find(e.agent)) ?? []), e]);
  const linked = [...groups.values()].filter((xs) => xs.length >= 2 && new Set(xs.map((x) => x.sponsor)).size >= 2)
    .map((xs) => ({ via: "work done for each other", agents: xs.map((x) => x.agent).sort(), sponsors: [...new Set(xs.map((x) => x.sponsor))].sort(), ranks: xs.map((x) => x.rank).filter((r): r is number => r !== undefined).sort((a, b) => a - b) }));
  const inRing = new Set(linked.flatMap((l) => l.agents));
  const ranked = entrants.filter((e) => e.rank !== undefined).sort((a, b) => a.rank! - b.rank!);
  const top3 = ranked.slice(0, 3).filter((e) => inRing.has(e.agent)).length;
  const half = Math.max(1, Math.floor(ranked.length / 2));
  const inHalf = ranked.slice(0, half).filter((e) => inRing.has(e.agent)).length;
  return {
    field: entrants.length, linked, topConcentration: top3 >= 2 || (ranked.length >= 4 && inHalf * 2 > half),
    method: "Entrants of two or more sponsors joined by a contract one did for the other (or for the other's sponsor) form a group; the report lists each group with the ranks it took, and flags it when linked agents fill two of the top three ranks or more than half of the top half. It is a lead for the Clinic and the Courts, not a ruling.",
  };
}
