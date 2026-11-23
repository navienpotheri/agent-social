/**
 * Offer collisions (the owner's decision of 2026-11-23): two agents offer on the same house job and the second is refused because it was already taken. The board is not steered to prevent this (the per-agent job slots
 * are off unless `--job-slots`); what happens is recorded instead, from the trace alone: who offered first, how long after, what the one refused did next, whether it offered again on the same job or moved to another,
 * and how long it took to have an offer accepted on another job.
 */
import type { TraceEvent } from "./types.ts";

export interface Collision { job: string; winner: string; loser: string; tick: number; winnerTick: number; gapMs: number; next: string; outcome: "moved" | "retried" | "none"; recoverMs?: number }
export interface CollisionReport { offers: number; refused: number; collisions: Collision[]; slotsOn: boolean }

const ms = (a: string, b: string): number => Math.max(0, Date.parse(b) - Date.parse(a));

export function collisionReport(events: TraceEvent[], slotsOn: boolean): CollisionReport {
  const tools = events.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool");
  // The trace is in the order calls finished, so the offer that won may be written after the refusals that followed it: the winner of a job is its earliest accepted offer wherever it stands.
  const first = new Map<string, { agent: string; at: string; turn: number }>();
  for (const e of tools) if (e.tool === "offer_on_job" && e.ok) { const job = String(e.input.job ?? ""), w = first.get(job); if (!w || Date.parse(e.at) < Date.parse(w.at)) first.set(job, { agent: e.agent, at: e.at, turn: e.turn }); }
  const out: Collision[] = [];
  let offers = 0, refused = 0;
  tools.forEach((e, i) => {
    if (e.tool !== "offer_on_job") return;
    offers++;
    const job = String(e.input.job ?? "");
    if (e.ok) return;
    const w = first.get(job);
    if (!w || w.agent === e.agent) return;
    refused++;
    const later = tools.slice(i + 1).filter((x) => x.agent === e.agent);
    const nextOffer = later.find((x) => x.tool === "offer_on_job");
    const accepted = later.find((x) => x.tool === "offer_on_job" && x.ok && String(x.input.job ?? "") !== job);
    const outcome: Collision["outcome"] = nextOffer ? (String(nextOffer.input.job ?? "") === job ? "retried" : "moved") : "none";
    out.push({ job, winner: w.agent, loser: e.agent, tick: e.turn, winnerTick: w.turn, gapMs: ms(w.at, e.at), next: later[0]?.tool ?? "nothing more", outcome, ...(accepted ? { recoverMs: ms(e.at, accepted.at) } : {}) });
  });
  return { offers, refused, collisions: out, slotsOn };
}

const median = (xs: number[]): number | undefined => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const secs = (n: number): string => `${Math.round(n / 100) / 10} s`;

export function renderCollisions(r: CollisionReport): string {
  const L = ["## Offer collisions", ""];
  const n = r.collisions.length;
  L.push(`Per-agent job slots were ${r.slotsOn ? "on" : "off"}: the board was not arranged to keep agents apart. ${n} of ${r.offers} offer${r.offers === 1 ? "" : "s"} ${n === 1 ? "was" : "were"} refused because another agent had taken the job first.`);
  if (!n) return L.join("\n") + "\n\n";
  const winners = new Map<string, number>(), nexts = new Map<string, number>();
  for (const c of r.collisions) { winners.set(c.winner, (winners.get(c.winner) ?? 0) + 1); nexts.set(c.next, (nexts.get(c.next) ?? 0) + 1); }
  const moved = r.collisions.filter((c) => c.outcome === "moved").length, retried = r.collisions.filter((c) => c.outcome === "retried").length, none = r.collisions.filter((c) => c.outcome === "none").length;
  const rec = r.collisions.flatMap((c) => (c.recoverMs !== undefined ? [c.recoverMs] : []));
  const gap = median(r.collisions.map((c) => c.gapMs));
  L.push(`The one refused had come ${gap !== undefined ? `a median of ${secs(gap)}` : "some time"} after the one that got the job. First to offer, by agent: ${[...winners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a, k]) => `${a} ${k}`).join(", ")}.`);
  L.push(`What the one refused did next: ${[...nexts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, k]) => `${t} ${k}`).join(", ")}. ${moved} offered on another job, ${retried} offered again on the same job, ${none} offered on no job after it. ${rec.length} had an offer accepted on another job, after a median of ${rec.length ? secs(median(rec)!) : "no time (none did)"}.`);
  L.push(`Ticks (turn numbers of the refused offer, with the winning offer's): ${r.collisions.slice(0, 8).map((c) => `${c.loser} t${c.tick} (${c.winner} t${c.winnerTick})`).join(", ")}${n > 8 ? ", ..." : ""}.`);
  L.push("These are counts of one run; what a refused agent does is its own choice and is not steered.");
  return L.join("\n") + "\n\n";
}

export interface DeliveryReport { delivered: number; refused: number; agents: number; retried: number; passed: number; reasons: Array<[string, number]> }
/** Deliveries the house check refused, as a measure of what agents can do: how many, by how many agents, how many were tried again on the same contract and how many then passed. */
export function deliveryReport(events: TraceEvent[]): DeliveryReport {
  const tools = events.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool" && e.tool === "deliver_job");
  const refusedAgents = new Set<string>(), tried = new Set<string>();
  let refused = 0, retried = 0, passed = 0;
  const byContract = new Map<string, typeof tools>();
  for (const e of tools) { const c = String(e.input.contract ?? ""); byContract.set(c, [...(byContract.get(c) ?? []), e]); }
  for (const list of byContract.values()) {
    const bad = list.filter((e) => !e.ok && e.refused === "market_refused");
    if (!bad.length) continue;
    refused += bad.length; for (const e of bad) refusedAgents.add(e.agent);
    const agentTried = list.length > bad.length || bad.length > 1;
    if (agentTried) { retried++; tried.add(list[0]!.agent); }
    if (list.some((e) => e.ok)) passed++;
  }
  return { delivered: tools.filter((e) => e.ok).length, refused, agents: refusedAgents.size, retried, passed, reasons: [] };
}
export function renderDeliveries(r: DeliveryReport): string {
  return `## Deliveries refused by the house check

${r.refused} deliver${r.refused === 1 ? "y was" : "ies were"} refused by the house check (by ${r.agents} agent${r.agents === 1 ? "" : "s"}); ${r.retried} contract${r.retried === 1 ? "" : "s"} had a delivery tried again, and ${r.passed} then passed. ${r.delivered} deliveries were accepted in all. This measures what the agents wrote against a stated criterion, not whether they meant well.

`;
}
