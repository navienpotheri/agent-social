/**
 * The report for ENG102: each lesson from creation to the agents it reached, with hashes and ticks (the turn number of the call in the trace); the gate's decision and reasons; who read it and what they did next; who cited it;
 * job outcomes before and after as the first grader; society-wide propagation; the files with hashes; and what each link cannot show.
 */
import { createHash } from "node:crypto";
import type { LessonShelf } from "./lessons.ts";
import type { TraceEvent } from "./types.ts";

export const hashText = (s: string): string => `sha256:${createHash("sha256").update(s).digest("hex")}`;
type ToolEv = Extract<TraceEvent, { t: "tool" }>;

/** The first-try acceptance of deliveries as the grader: a delivery the house check accepts on the first try on a contract counts as a pass. Events are in the order calls finished. */
function firstTry(events: TraceEvent[]): Map<string, Array<{ idx: number; pass: boolean }>> {
  const out = new Map<string, Array<{ idx: number; pass: boolean }>>(), seen = new Set<string>();
  events.forEach((e, idx) => {
    if (e.t !== "tool" || e.tool !== "deliver_job") return;
    const k = `${e.agent}|${String(e.input.contract ?? "")}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.set(e.agent, [...(out.get(e.agent) ?? []), { idx, pass: e.ok }]);
  });
  return out;
}

export interface HeldOut { readers: [number, number]; others: [number, number]; verdict: "flagged" | "helped" | "too few"; text: string }

/**
 * The held-out check of an admitted lesson (the Academy's check, in the society): on house-job deliveries that the lesson's author did not make and that came after the lesson was admitted, do the agents that had read it
 * (after their reading) pass the house check on the first try more often than the others? Three deliveries on each side are needed to say anything; a lesson whose readers did no better is FLAGGED, never removed.
 */
export function heldOutCheck(events: TraceEvent[], card: { handle: string; title: string }, readerHandles: string[]): HeldOut {
  const tl = events.map((e, idx) => ({ e, idx })).filter((x): x is { e: ToolEv; idx: number } => x.e.t === "tool");
  const toAgent = new Map<string, string>();
  for (const e of events) if (e.t === "agent") toAgent.set(e.handle, e.agent);
  const author = toAgent.get(card.handle) ?? card.handle;
  const admitted = tl.find((x) => x.e.agent === author && x.e.tool === "lesson_publish" && String(x.e.input.title ?? "") === card.title)?.idx ?? Infinity;
  const readerIds = new Set(readerHandles.map((h) => toAgent.get(h) ?? h));
  const readAt = new Map<string, number>();
  for (const x of tl) if (x.e.tool === "lesson_read" && x.e.ok && readerIds.has(x.e.agent) && !readAt.has(x.e.agent)) readAt.set(x.e.agent, x.idx);
  const seen = new Set<string>(), r: [number, number] = [0, 0], o: [number, number] = [0, 0];
  for (const x of tl) {
    if (x.e.tool !== "deliver_job" || x.e.agent === author || x.idx < admitted) continue;
    const k = `${x.e.agent}|${String(x.e.input.contract ?? "")}`; if (seen.has(k)) continue; seen.add(k);
    const side = readAt.has(x.e.agent) && x.idx > readAt.get(x.e.agent)! ? r : o;
    side[1]++; if (x.e.ok) side[0]++;
  }
  const f = (v: [number, number]): string => `${v[0]} of ${v[1]}`;
  if (r[1] < 3 || o[1] < 3) return { readers: r, others: o, verdict: "too few", text: `Held-out check: too few held-out deliveries to say (three are needed on each side: readers after reading ${f(r)}, others ${f(o)}).` };
  const helped = r[0] / r[1] > o[0] / o[1];
  return { readers: r, others: o, verdict: helped ? "helped" : "flagged", text: `Held-out check: ${helped ? "readers did better than the others" : "FLAGGED, readers did no better than the others (the card stays admitted; it is only flagged)"} on deliveries the author did not make after the card was admitted: readers after reading ${f(r)}, others ${f(o)}.` };
}

export function renderLessonEvidence(shelf: LessonShelf, events: TraceEvent[], docs: Array<{ id: string; by: string; title: string; hash: string }>, notes: Array<{ handle: string; name: string; hash: string }>, agents: number): string {
  const L = ["## Continual learning: the chain for each lesson, with hashes and ticks", ""];
  const tools = events.map((e, idx) => ({ e, idx })).filter((x): x is { e: ToolEv; idx: number } => x.e.t === "tool");
  const handleToAgent = new Map<string, string>();
  for (const e of events) if (e.t === "agent") handleToAgent.set(e.handle, e.agent);
  const tickOf = (agent: string, tool: string, test: (e: ToolEv) => boolean): string => { const x = tools.find((y) => y.e.agent === agent && y.e.tool === tool && test(y.e)); return x ? `t${x.e.turn}` : "t?"; };
  if (!shelf.cards.length) L.push("No agent published a lesson card in this run, so there is no chain to follow.");
  for (const c of shelf.cards) {
    const a = handleToAgent.get(c.handle) ?? c.handle;
    L.push(`- ${c.id} (${c.hash.slice(0, 19)}...) by ${c.handle}, written at ${tickOf(a, "lesson_publish", (e) => String(e.input.title ?? "") === c.title)}: "${c.title}".`);
    L.push(`  - Gate: ${c.decision.admitted ? "ADMITTED" : "REFUSED"}${c.decision.reasons.length ? ` because ${c.decision.reasons.join("; ")}` : " (it states its evidence, names a tool the author called, holds no instruction, no link, and is not a copy)"}.`);
    if (c.decision.admitted) {
      const reads = shelf.reads.filter((r) => r.id === c.id), cites = shelf.cites.filter((r) => r.id === c.id);
      const next = reads.map((r) => {
        const ag = handleToAgent.get(r.handle) ?? r.handle;
        const at = tools.find((y) => y.e.agent === ag && y.e.tool === "lesson_read" && String(y.e.input.id ?? "") === c.id);
        const after = at ? tools.find((y) => y.e.agent === ag && y.idx > at.idx && y.e.tool !== "lesson_read") : undefined;
        return `${r.handle} read at ${at ? `t${at.e.turn}` : "t?"}, next ${after ? after.e.tool : "nothing"}`;
      });
      L.push(`  - ${heldOutCheck(events, c, reads.map((x) => x.handle)).text}`);
      L.push(`  - Fed back to others (through the gate, never raw): read by ${reads.length} agent${reads.length === 1 ? "" : "s"}${next.length ? ` (${next.join("; ")})` : ""}; cited by ${cites.length}${cites.length ? ` (${cites.map((x) => x.handle).join(", ")})` : ""}.`);
    }
  }
  const ft = firstTry(events), reader = new Set(shelf.reads.map((r) => handleToAgent.get(r.handle) ?? r.handle));
  const firstReadIdx = new Map<string, number>();
  for (const x of tools) if (x.e.tool === "lesson_read" && x.e.ok && reader.has(x.e.agent) && !firstReadIdx.has(x.e.agent)) firstReadIdx.set(x.e.agent, x.idx);
  let bP = 0, bN = 0, aP = 0, aN = 0, wP = 0, wN = 0;
  for (const [ag, list] of ft) for (const d of list) {
    if (reader.has(ag)) { if (d.idx < (firstReadIdx.get(ag) ?? Infinity)) { bN++; if (d.pass) bP++; } else { aN++; if (d.pass) aP++; } }
    else { wN++; if (d.pass) wP++; }
  }
  const f = (p: number, n: number): string => (n ? `${p} of ${n}` : "no deliveries");
  L.push("", `Job outcomes as the first grader (a delivery the house check accepts on the first try on a contract): agents with access to an admitted lesson (${reader.size}): before their first reading ${f(bP, bN)}, after ${f(aP, aN)}; agents without access: ${f(wP, wN)}. One run and a handful of deliveries: this shows what was counted and nothing about whether the lessons helped; the spread between repeat runs (ENG72) is not measured.`);
  const writers = new Set(shelf.admitted().map((c) => c.handle));
  L.push("", `Society-wide: ${shelf.cards.length} card${shelf.cards.length === 1 ? "" : "s"} written, ${shelf.admitted().length} admitted, ${shelf.cards.length - shelf.admitted().length} refused; ${reader.size} of ${agents} agents read at least one admitted lesson (by lesson_read, as a listing or by id), ${new Set(shelf.cites.map((c) => c.handle)).size} cited one; ${writers.size} agent${writers.size === 1 ? "" : "s"} wrote an admitted lesson.`);
  L.push("", `Notebooks: ${shelf.notebookWrites.filter((w) => w.action === "added").length} admitted lesson${shelf.notebookWrites.filter((w) => w.action === "added").length === 1 ? "" : "s"} ${shelf.notebookWrites.filter((w) => w.action === "added").length === 1 ? "was" : "were"} placed in the notebook of an agent that cited ${shelf.notebookWrites.filter((w) => w.action === "added").length === 1 ? "it" : "them"}, as one labelled line each and never raw${shelf.notebookWrites.length ? ` (${shelf.notebookWrites.slice(0, 5).map((w) => `${w.id} to ${w.handle} ${w.action}, ${w.hash.slice(0, 19)}...`).join("; ")})` : ""}. Each is a trace event (lesson_notebook) and the agent can delete the line; a notebook exists only for an agent that keeps ticks.`);
  L.push("", `Files (hashes of the text): ${shelf.cards.length} lesson card${shelf.cards.length === 1 ? "" : "s"}${shelf.cards.length ? ` (${shelf.cards.slice(0, 6).map((c) => `${c.id} ${c.hash.slice(0, 19)}...`).join(", ")})` : ""}; ${docs.length} library document${docs.length === 1 ? "" : "s"}${docs.length ? ` (${docs.slice(0, 6).map((d) => `${d.id} by ${d.by} ${d.hash.slice(0, 19)}...`).join(", ")})` : ""}; ${notes.length} workspace note${notes.length === 1 ? "" : "s"}${notes.length ? ` (${notes.slice(0, 6).map((n) => `${n.handle}/${n.name} ${n.hash.slice(0, 19)}...`).join(", ")})` : ""}.`);
  L.push("", "What each link cannot show: the gate checks form and the author's own record, not whether a lesson is true (the Academy's held-out check of a lesson is not built); a reading is not learning, and what a reader did next may have nothing to do with the card; the held-out check is a few deliveries from one run and does not separate a lesson from the time an agent had to learn anything else; the before and after is a few deliveries from one run; a lesson reaches an agent's notebook only after the agent cited it, and a stand-in run keeps no notebooks, so this link is shown only in a run with ticks.");
  return L.join("\n") + "\n\n";
}
