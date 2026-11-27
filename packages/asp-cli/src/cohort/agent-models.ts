/**
 * What the trace says about each agent as a whole, for the report of a run with `--signals` (DK1315, DK1314, DK1309, DK1310): a world model per agent built from its recorded observations, acts and stated beliefs, with versions
 * kept over time (DK1315); a role and standing profile computed from the log with the evidence for each named role (DK1314); the load an agent's context puts on each turn (DK1309); and a check that feedback from the society
 * did not make an agent worse, against a control (DK1310). All of it is computed from the trace of one run: built with stand-ins and partial until a real run reads it.
 */
import type { TraceEvent } from "./types.ts";

type ToolEv = Extract<TraceEvent, { t: "tool" }>;
type ModelEv = Extract<TraceEvent, { t: "model" }>;
const tools = (events: TraceEvent[], agent: string): ToolEv[] => events.filter((e): e is ToolEv => e.t === "tool" && e.agent === agent);
const WRITES_BELIEF = new Set(["forum_post", "forum_comment", "lesson_publish", "notebook_write", "workspace_write", "send_message"]);
const short = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, 90);

// ---------- DK1315: a world model per agent, in versions ----------
export type WorldModel = Record<string, string>;
export interface ModelVersion { version: number; upToTick: number; model: WorldModel }

/** The model after the agent's acts up to `tick`: what it did and how often, what it was refused and whether it then managed, the places it looked at, and what it said it believes (its own words, as it wrote them). */
export function modelAt(events: TraceEvent[], agent: string, tick: number): WorldModel {
  const m: WorldModel = {};
  const ok = new Map<string, number>(), no = new Map<string, number>(), refusedAt = new Map<string, number>();
  for (const e of tools(events, agent)) {
    if (e.turn > tick) continue;
    if (e.ok) { ok.set(e.tool, (ok.get(e.tool) ?? 0) + 1); }
    else { no.set(e.tool, (no.get(e.tool) ?? 0) + 1); if (!refusedAt.has(e.tool)) refusedAt.set(e.tool, e.turn); m[`corrected:${e.tool}:${e.refused ?? "refused"}`] = `was refused (${e.refused ?? "refused"})`; }
    if (e.ok && e.tool === "inspect") m[`place:${String(e.input.place ?? "")}`] = "looked at closely";
    if (e.ok && e.tool === "lesson_read") m[`lesson:${String(e.input.id ?? "listing")}`] = "read";
    if (e.ok && WRITES_BELIEF.has(e.tool)) { const txt = short(String(e.input.text ?? e.input.lesson ?? e.input.title ?? "")); if (txt) m[`belief:${e.tool}:${e.turn}`] = txt; }
  }
  for (const [t, n] of ok) m[`tool:${t}`] = `ok ${n}${no.get(t) ? `, refused ${no.get(t)}` : ""}${refusedAt.has(t) ? ", learned: managed it after a refusal" : ""}`;
  for (const [t, n] of no) if (!ok.has(t)) m[`tool:${t}`] = `refused ${n}, never yet managed`;
  return m;
}

/** Versions of the model, one at every `every` ticks (the agent's own turn numbers) up to its last act; a version is kept even when it equals the one before. */
export function modelVersions(events: TraceEvent[], agent: string, every = 5): ModelVersion[] {
  const last = Math.max(0, ...tools(events, agent).map((e) => e.turn));
  const out: ModelVersion[] = [];
  for (let t = every, v = 1; t < last + every; t += every, v++) out.push({ version: v, upToTick: Math.min(t, last), model: modelAt(events, agent, Math.min(t, last)) });
  return out;
}

/** What differs between two versions: facts added, facts that changed, facts gone. */
export function diffModels(a: WorldModel, b: WorldModel): { added: string[]; changed: string[]; removed: string[] } {
  return { added: Object.keys(b).filter((k) => !(k in a)).sort(), changed: Object.keys(b).filter((k) => k in a && a[k] !== b[k]).sort(), removed: Object.keys(a).filter((k) => !(k in b)).sort() };
}

export function renderWorldModels(events: TraceEvent[], handles: string[]): string {
  const L = ["## A world model for each agent, in versions", ""];
  let versions = 0, withChange = 0, corrected = 0, learned = 0;
  const lines: string[] = [];
  for (const h of handles) {
    const v = modelVersions(events, h);
    if (!v.length) continue;
    versions += v.length;
    const final = v[v.length - 1]!.model;
    corrected += Object.keys(final).filter((k) => k.startsWith("corrected:")).length;
    learned += Object.values(final).filter((x) => x.includes("learned:")).length;
    let changes = 0;
    for (let i = 1; i < v.length; i++) { const d = diffModels(v[i - 1]!.model, v[i]!.model); if (d.added.length || d.changed.length || d.removed.length) changes++; }
    if (changes) withChange++;
    if (lines.length < 5 && v.length > 1) { const d = diffModels(v[0]!.model, v[v.length - 1]!.model); lines.push(`- ${h}: ${v.length} versions, ${d.added.length} facts added and ${d.changed.length} changed between the first and the last; corrected on ${Object.keys(final).filter((k) => k.startsWith("corrected:")).length}, learned ${Object.values(final).filter((x) => x.includes("learned:")).length}.`); }
  }
  L.push(`${versions} versions of ${handles.length} agents' models were kept (one at every five ticks); ${withChange} agents' models changed between versions; ${corrected} corrections (a refused act) and ${learned} cases of managing an act after a refusal were recorded. A model holds only what the trace shows: what the agent did, was refused, looked at, and wrote as its own words (stated beliefs are quoted, not inferred).`);
  L.push(...lines);
  L.push("Built from the trace of one run with scripted agents in the tests; a real run is what shows whether the versions track what a real agent learned.");
  return L.join("\n") + "\n\n";
}

// ---------- DK1314: a role and standing profile ----------
export interface Profile { handle: string; acts: number; roles: Array<{ role: string; evidence: string }>; talksTo: string[]; usesTop: string[]; teaches: number; beliefs: number; heldOut: string }

/** First-try acceptance of deliveries in the first and the second half of an agent's deliveries, as a small held-out change: the first half stands in for before, the second for after. */
function change(es: ToolEv[]): string {
  const d = es.filter((e) => e.tool === "deliver_job"), seen = new Set<string>(), first: boolean[] = [];
  for (const e of d) { const c = String(e.input.contract ?? ""); if (!seen.has(c)) { seen.add(c); first.push(e.ok); } }
  if (first.length < 2) return "too few deliveries to say";
  const h = Math.floor(first.length / 2), a = first.slice(0, h), b = first.slice(h), r = (x: boolean[]): number => x.filter(Boolean).length / x.length;
  return `first-try acceptance ${a.filter(Boolean).length} of ${a.length} then ${b.filter(Boolean).length} of ${b.length}${r(b) > r(a) ? " (up)" : r(b) < r(a) ? " (down)" : " (level)"}`;
}

export function profileOf(events: TraceEvent[], handle: string): Profile {
  const es = tools(events, handle), count = (t: string): number => es.filter((e) => e.ok && e.tool === t).length;
  const peers = [...new Set(es.filter((e) => e.ok && e.tool === "send_message").map((e) => String(e.input.to ?? "")).filter((t) => t && !t.startsWith("house-")))];
  const used = new Map<string, number>();
  for (const e of es) if (e.ok) used.set(e.tool, (used.get(e.tool) ?? 0) + 1);
  const teaches = count("lesson_publish") + count("library_publish") + es.filter((e) => e.ok && e.tool === "forum_post").length;
  const roles: Profile["roles"] = [];
  if (count("deliver_job") >= 2) roles.push({ role: "worker", evidence: `${count("deliver_job")} deliveries accepted` });
  if (count("post_job") >= 1) roles.push({ role: "poster", evidence: `${count("post_job")} jobs posted` });
  if (peers.length >= 1 || count("send_message") >= 2) roles.push({ role: "talker", evidence: `wrote to ${peers.length ? peers.join(", ") : "no other agent"}; ${count("send_message")} messages` });
  if (teaches >= 2) roles.push({ role: "teacher", evidence: `${count("lesson_publish")} lessons, ${count("library_publish")} documents, ${count("forum_post")} posts` });
  if (count("inspect") >= 2) roles.push({ role: "explorer", evidence: `${count("inspect")} places looked at` });
  if (count("assess_submit") >= 1) roles.push({ role: "assessor", evidence: `${count("assess_submit")} assessments` });
  if (!roles.length) roles.push({ role: es.some((e) => e.ok && /^(write|post)/.test(e.scope)) ? "occasional writer" : "reader", evidence: `${es.length} calls, ${es.filter((e) => e.ok && e.writes).length} writes` });
  return { handle, acts: es.length, roles, talksTo: peers, usesTop: [...used.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} ${n}`), teaches, beliefs: es.filter((e) => e.ok && WRITES_BELIEF.has(e.tool)).length, heldOut: change(es) };
}

export function renderProfiles(events: TraceEvent[], handles: string[]): string {
  const ps = handles.map((h) => profileOf(events, h));
  const tally = new Map<string, number>();
  for (const p of ps) for (const r of p.roles) tally.set(r.role, (tally.get(r.role) ?? 0) + 1);
  const L = ["## Role and standing, from what each agent did", ""];
  L.push(`Roles are named only where the trace gives evidence: ${[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ") || "none"}. A role is a description of what was done in one run, not a rank and not a promise.`);
  for (const p of ps.slice(0, 8)) L.push(`- ${p.handle}: ${p.roles.map((r) => `${r.role} (${r.evidence})`).join("; ")}; uses ${p.usesTop.join(", ") || "nothing"}; ${p.heldOut}.`);
  return L.join("\n") + "\n\n";
}

// ---------- DK1309: the context load ----------
export const CONTEXT_BUDGET_TOKENS = 4000;
export function contextLoad(events: TraceEvent[], handles: string[]): { agents: number; turns: number; meanInput: number; maxInput: number; over: number; grew: number; costPerTurn: number } {
  const ms = events.filter((e): e is ModelEv => e.t === "model" && handles.includes(e.agent));
  const by = new Map<string, ModelEv[]>();
  for (const e of ms) by.set(e.agent, [...(by.get(e.agent) ?? []), e]);
  let grew = 0;
  for (const l of by.values()) if (l.length >= 6) { const k = Math.floor(l.length / 3), a = l.slice(0, k).reduce((n, e) => n + e.input + (e.cacheWrite ?? 0), 0) / k, b = l.slice(-k).reduce((n, e) => n + e.input + (e.cacheWrite ?? 0), 0) / k; if (b > 2 * a) grew++; }
  const inp = ms.map((e) => e.input + (e.cacheWrite ?? 0));
  return { agents: by.size, turns: ms.length, meanInput: ms.length ? Math.round(inp.reduce((n, x) => n + x, 0) / ms.length) : 0, maxInput: Math.max(0, ...inp), over: inp.filter((x) => x > CONTEXT_BUDGET_TOKENS).length, grew, costPerTurn: ms.length ? Math.round((ms.reduce((n, e) => n + (e.usd ?? 0), 0) / ms.length) * 1e5) / 1e5 : 0 };
}
export function renderContextLoad(events: TraceEvent[], handles: string[]): string {
  const c = contextLoad(events, handles);
  return `## The load on each turn (context and cost)\n\n${c.turns} model turns by ${c.agents} agents: the context fed to a turn averaged ${c.meanInput} tokens (largest ${c.maxInput}), and each turn cost $${c.costPerTurn} on average. ${c.over} turns were over the budget rule of ${CONTEXT_BUDGET_TOKENS} tokens, and ${c.grew} agent${c.grew === 1 ? "'s" : "s'"} context more than doubled between the first and the last third of its turns. The rule for what is fed back: recent (the last acts), relevant (the open items for this agent now), verified (house facts and gate-admitted text, labelled), with summaries and retrieval (the engine's own summary, lesson_read, library_search) in place of raw history. The measure is read from this run; the feed is bounded by the observation limits of the engine, and this section says whether that bound held.\n\n`;
}

// ---------- DK1310: did the society's feedback make an agent worse? ----------
/** Agents that read a lesson (the feedback) against the others (the control): first-try acceptance of deliveries before and after the first reading, and the same split at the same point in time for the control. */
export function harmCheck(events: TraceEvent[], handles: string[]): { exposed: number; control: number; expBefore: [number, number]; expAfter: [number, number]; ctlBefore: [number, number]; ctlAfter: [number, number]; verdict: string } {
  const tl = events.map((e, idx) => ({ e, idx })).filter((x): x is { e: ToolEv; idx: number } => x.e.t === "tool");
  const first = new Map<string, number>();
  for (const x of tl) if (x.e.ok && x.e.tool === "lesson_read" && !first.has(x.e.agent)) first.set(x.e.agent, x.idx);
  const point = first.size ? Math.min(...first.values()) : Infinity;
  const seen = new Set<string>();
  const tally = (exp: boolean): { b: [number, number]; a: [number, number] } => {
    const b: [number, number] = [0, 0], a: [number, number] = [0, 0];
    for (const x of tl) {
      if (x.e.tool !== "deliver_job" || !handles.includes(x.e.agent) || first.has(x.e.agent) !== exp) continue;
      const k = `${x.e.agent}|${String(x.e.input.contract ?? "")}`; if (seen.has(k)) continue; seen.add(k);
      const cut = exp ? first.get(x.e.agent)! : point, t = x.idx < cut ? b : a;
      t[1]++; if (x.e.ok) t[0]++;
    }
    return { b, a };
  };
  const e = tally(true), c = tally(false);
  const rate = (t: [number, number]): number => (t[1] ? t[0] / t[1] : NaN);
  const dE = rate(e.a) - rate(e.b), dC = rate(c.a) - rate(c.b);
  const enough = e.b[1] >= 3 && e.a[1] >= 3 && c.b[1] >= 3 && c.a[1] >= 3;
  const verdict = !first.size ? "no agent read a lesson, so there was no feedback to check" : !enough ? "too few deliveries on one side to say (three are needed before and after, for both groups)" : dE < dC - 0.25 ? "the readers got worse than the control by more than a quarter: look at it" : "no drop beyond a quarter against the control was seen";
  return { exposed: first.size, control: handles.length - first.size, expBefore: e.b, expAfter: e.a, ctlBefore: c.b, ctlAfter: c.a, verdict };
}
export function renderHarmCheck(events: TraceEvent[], handles: string[]): string {
  const h = harmCheck(events, handles), f = (t: [number, number]): string => `${t[0]} of ${t[1]}`;
  return `## Did the society's feedback make an agent worse?\n\nGrader: first-try acceptance of deliveries by the house check, split at the point where the first agent read a lesson (for the control) or at each reader's own first reading (for the readers). Readers (${h.exposed}): ${f(h.expBefore)} before, ${f(h.expAfter)} after. Control (${h.control}): ${f(h.ctlBefore)} before, ${f(h.ctlAfter)} after. Verdict: ${h.verdict}. This is the in-society battery only (job outcomes of one run); the held-out battery through the agent's own gateway (ENG75) is not wired, and one run has no spread (ENG72).\n\n`;
}
