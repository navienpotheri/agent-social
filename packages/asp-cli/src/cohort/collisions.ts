/**
 * Offer collisions (the owner's decision of 2026-11-23): two agents offer on the same house job and the second is refused because it was already taken. The board is not steered to prevent this (the per-agent job slots
 * are off unless `--job-slots`); what happens is recorded instead, from the trace alone: who offered first, how long after, what the one refused did next, whether it offered again on the same job or moved to another,
 * and how long it took to have an offer accepted on another job.
 */
import type { TraceEvent } from "./types.ts";

export interface Collision { job: string; winner: string; loser: string; gapMs: number; next: string; outcome: "moved" | "retried" | "none"; recoverMs?: number }
export interface CollisionReport { offers: number; refused: number; collisions: Collision[]; slotsOn: boolean }

const ms = (a: string, b: string): number => Math.max(0, Date.parse(b) - Date.parse(a));

export function collisionReport(events: TraceEvent[], slotsOn: boolean): CollisionReport {
  const tools = events.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool");
  // The trace is in the order calls finished, so the offer that won may be written after the refusals that followed it: the winner of a job is its earliest accepted offer wherever it stands.
  const first = new Map<string, { agent: string; at: string }>();
  for (const e of tools) if (e.tool === "offer_on_job" && e.ok) { const job = String(e.input.job ?? ""), w = first.get(job); if (!w || Date.parse(e.at) < Date.parse(w.at)) first.set(job, { agent: e.agent, at: e.at }); }
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
    out.push({ job, winner: w.agent, loser: e.agent, gapMs: ms(w.at, e.at), next: later[0]?.tool ?? "nothing more", outcome, ...(accepted ? { recoverMs: ms(e.at, accepted.at) } : {}) });
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
  L.push("These are counts of one run; what a refused agent does is its own choice and is not steered.");
  return L.join("\n") + "\n\n";
}
