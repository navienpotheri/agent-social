/**
 * Inside-the-agent signals for real agents (ENG71, the real-agent half of DK79). What an agent PLANNED and did, what it remembered and used, the rules it
 * stated and broke, the regime its actions fall into, what it expected before an action and what happened, how its stated beliefs moved after an event.
 *
 * What these are, and are not. Every signal is derived from what the agent WROTE (labelled lines in its own notebook, which the briefing invites it to keep
 * when the sponsor consents) and from what it DID (its tool calls and their results). None is read from hidden reasoning: no signal here says anything about
 * what the model thought, only about what it wrote down and did, and the two can differ. An agent that writes nothing has no plan traces; an agent that
 * writes plans it never means has plan traces that mean nothing. The report says so for each signal.
 *
 * Consent. Nothing is collected unless the run names the signals (`--signals plans,rules,...`, the sponsor's consent for the run); text is kept only with
 * `--signals-text`, in a separate store (`<run>/signals-store/`), never in the trace. The records in the trace are whole numbers, hashes and identifiers.
 *
 * Pure functions of the trace: the same trace gives the same records and the same report on a second run (the lens).
 */
import { createHash } from "node:crypto";
import type { TraceEvent } from "./types.ts";

export const SIGNAL_KINDS = ["plans", "memory", "rules", "modes", "predictions", "beliefs", "worldmodel"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export interface SignalsConfig { kinds: SignalKind[]; text: boolean }
/** Calibration is computed only over this many items or more; fewer say so. */
export const CALIBRATION_MIN = 50;
const ACT_WINDOW = 12, STALE_AFTER = 20, MODE_WINDOW = 8;

export function parseSignals(v: string | undefined, text = false): SignalsConfig | undefined {
  if (v === undefined) { if (text) throw new Error("--signals-text keeps the text of the signals in a separate store: add --signals <list> (the consent) with it"); return undefined; }
  const raw = v === "" || v === "all" ? [...SIGNAL_KINDS] : v.split(",").map((x) => x.trim()).filter(Boolean);
  for (const k of raw) if (!(SIGNAL_KINDS as readonly string[]).includes(k)) throw new Error(`--signals names ${SIGNAL_KINDS.join(", ")} (any of them, or all); ${k} is none of those`);
  return { kinds: [...new Set(raw)] as SignalKind[], text };
}

/** The paragraph the briefing gains when the signals are consented to: it asks for labelled lines and nothing else, and says they are read. */
export function signalsBriefing(cfg: SignalsConfig): string {
  const want = (k: SignalKind) => cfg.kinds.includes(k);
  const lines: string[] = [];
  if (want("plans")) lines.push("PLAN: <something you intend to do>");
  if (want("rules")) lines.push("RULE: <a rule you set yourself, for example: never use <tool>>");
  if (want("predictions")) lines.push("EXPECT p=<0 to 1>: <what you expect the next action to do>");
  if (want("beliefs") || want("worldmodel")) lines.push("BELIEF p=<0 to 1>: <something you think is true about this society>");
  if (!lines.length) return "";
  return `\n\nYour sponsor has agreed that a few of your own notes are read as a record of how you work. If it helps you, keep labelled lines in your notebook, one to a line (nothing is required):\n${lines.join("\n")}\nThey are read as written; they say nothing about anything you do not write down.`;
}

export interface SignalRecord { kind: SignalKind; agent: string; turn: number; id: string; n: Record<string, number> }
export interface StoreLine { agent: string; kind: SignalKind; id: string; turn: number; text: string }
export interface Collected { records: SignalRecord[]; store: StoreLine[] }

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const STOP = new Set(["that", "this", "with", "will", "from", "have", "then", "than", "them", "they", "into", "when", "what", "your", "about", "would", "should", "could", "there", "their", "which", "again", "other", "after", "before", "next", "using", "never", "always"]);
const words = (s: string, min: number) => new Set((s.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length >= min && !STOP.has(w)));
const strings = (v: unknown): string => typeof v === "string" ? v : Array.isArray(v) ? v.map(strings).join(" ") : v && typeof v === "object" ? Object.values(v).map(strings).join(" ") : "";
const permille = (p: number) => Math.round(Math.max(0, Math.min(1, p)) * 1000);

interface Call { turn: number; tool: string; ok: boolean; refused?: string; text: string; key: string; i: number }
interface Line { label: string; p: number; text: string; id: string }

function parseLine(raw: string): Line | undefined {
  const m = /^\s*(?:[-*]\s*)?(PLAN|DONE|EXPECT|RULE|BELIEF)\b(?:\s+p\s*=\s*([01](?:\.\d+)?|\.\d+))?\s*:\s*(.+?)\s*$/i.exec(raw);
  if (!m) return undefined;
  const text = m[3]!;
  return { label: m[1]!.toUpperCase(), p: m[2] === undefined ? -1 : permille(Number(m[2])), text, id: sha(text.toLowerCase().replace(/\s+/g, " ")) };
}

/** What `cfg` consents to, from the trace; with no config nothing is collected (the consent test). */
export function collectSignals(events: TraceEvent[], cfg: SignalsConfig | undefined): Collected {
  const out: Collected = { records: [], store: [] };
  if (!cfg || !cfg.kinds.length) return out;
  const want = (k: SignalKind) => cfg.kinds.includes(k);
  const toolNames = new Set<string>();
  for (const e of events) if (e.t === "tool") toolNames.add(e.tool);
  const agents = [...new Set(events.filter((e) => e.t === "tool").map((e) => (e as { agent: string }).agent))].sort();
  const push = (r: SignalRecord, text?: string) => { out.records.push(r); if (cfg.text && text !== undefined) out.store.push({ agent: r.agent, kind: r.kind, id: r.id, turn: r.turn, text }); };

  for (const agent of agents) {
    const mine = events.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool" && e.agent === agent);
    const calls: Call[] = [];
    // The notebook, rebuilt from the writes that were accepted, and the labelled lines seen with the turn each first appeared.
    let notebook = "";
    const seen: { line: Line; raw: string; turn: number; after: number }[] = [];
    const states: { turn: number; after: number; beliefs: Map<string, number> }[] = [];
    mine.forEach((e) => {
      if (e.tool === "notebook_write" && e.ok) {
        const text = String(e.input.text ?? ""), next = e.input.mode === "append" ? (notebook ? notebook + "\n" : "") + text : text;
        const before = new Set(notebook.split("\n").map((l) => l.trim()).filter(Boolean));
        notebook = next;
        for (const raw of next.split("\n").map((l) => l.trim()).filter(Boolean)) if (!before.has(raw)) seen.push({ line: parseLine(raw) ?? { label: "NOTE", p: -1, text: raw, id: sha(raw.toLowerCase()) }, raw, turn: e.turn, after: calls.length });
        const beliefs = new Map<string, number>();
        for (const raw of next.split("\n")) { const l = parseLine(raw); if (l?.label === "BELIEF") beliefs.set(l.id, l.p); }
        states.push({ turn: e.turn, after: calls.length, beliefs });
      } else if (e.tool !== "notebook_write" && e.tool !== "notebook_read") {
        calls.push({ turn: e.turn, tool: e.tool, ok: e.ok, ...(e.refused ? { refused: e.refused } : {}), text: strings(e.input), key: JSON.stringify(e.input), i: calls.length });
      }
    });
    const callWords = (c: Call) => new Set([...words(c.tool.replace(/_/g, " "), 3), ...words(c.text, 4)]);

    if (want("plans")) {
      const dones = seen.filter((s) => s.line.label === "DONE");
      for (const s of seen.filter((x) => x.line.label === "PLAN")) {
        const w = words(s.line.text, 4);
        let acted = -1;
        for (const c of calls.slice(s.after, s.after + ACT_WINDOW)) { const cw = callWords(c); if ([...w].some((x) => cw.has(x))) { acted = c.turn; break; } }
        const doneTurn = dones.find((d) => d.turn >= s.turn && [...words(d.line.text, 4)].some((x) => w.has(x)))?.turn ?? -1;
        push({ kind: "plans", agent, turn: s.turn, id: s.line.id, n: { len: s.line.text.length, actedTurn: acted, doneTurn, acted: acted >= 0 || doneTurn >= 0 ? 1 : 0 } }, s.line.text);
      }
    }

    if (want("memory")) {
      const notes = seen.filter((s) => s.line.label !== "DONE");
      const CUE = /\b(no longer|was wrong|turned out|not true|correction|mistaken|instead)\b/i;
      for (const s of notes) {
        const w = [...words(s.line.text, 6)];
        const checkable = w.length >= 2;
        let used = -1;
        if (checkable) for (const c of calls.slice(s.after)) { const cw = callWords(c); if (w.filter((x) => cw.has(x)).length >= 2) { used = c.turn; break; } }
        const contradicted = checkable && seen.some((o) => o.turn > s.turn && o.line.label !== "DONE" && CUE.test(o.line.text) && w.filter((x) => words(o.line.text, 6).has(x)).length >= 2) ? 1 : 0;
        const later = calls.length - s.after;
        const stale = checkable && used < 0 && later >= STALE_AFTER && notebook.includes(s.raw) ? 1 : 0;
        push({ kind: "memory", agent, turn: s.turn, id: s.line.id, n: { len: s.line.text.length, checkable: checkable ? 1 : 0, usedTurn: used, used: used >= 0 ? 1 : 0, stale, contradicted } }, s.line.text);
      }
    }

    if (want("rules")) {
      for (const s of seen.filter((x) => x.line.label === "RULE")) {
        const named = [...toolNames].filter((t) => s.line.text.toLowerCase().includes(t.toLowerCase()));
        const negative = /\b(never|do not|don't|dont|avoid|stop using|no more)\b/i.test(s.line.text);
        const checkable = named.length > 0 && negative;
        const broken = checkable ? calls.slice(s.after).filter((c) => named.includes(c.tool)).length : 0;
        push({ kind: "rules", agent, turn: s.turn, id: s.line.id, n: { checkable: checkable ? 1 : 0, broken, kept: checkable && !broken ? 1 : 0 } }, s.line.text);
      }
    }

    if (want("modes")) {
      const mode = (w: Call[]): string => {
        const rest = w.filter((c) => c.tool === "rest" || c.tool === "wait_for").length / w.length;
        const bad = w.filter((c) => !c.ok).length / w.length;
        const sig = w.map((c) => `${c.tool}|${c.key}`);
        const loops = new Set(sig).size <= Math.ceil(w.length / 3) && w.length >= 3;
        if (rest >= 0.5) return "resting";
        if (bad >= 0.5 || loops) return "stuck";
        if (w.filter((c) => /post|reply|comment|offer|deliver|write|send|message|accept/.test(c.tool)).length / w.length >= 0.4) return "working";
        return "exploring";
      };
      let prev = "", segStart = 0;
      for (let i = 0; i < calls.length; i += MODE_WINDOW) {
        const w = calls.slice(i, i + MODE_WINDOW), m = mode(w);
        if (m !== prev) {
          const trigger = w.find((c) => !c.ok)?.refused ?? w[0]!.tool;
          push({ kind: "modes", agent, turn: w[0]!.turn, id: sha(`${agent}|${m}|${i}`), n: { mode: SIGNAL_MODES.indexOf(m), from: SIGNAL_MODES.indexOf(prev), startCall: i, previousCalls: i - segStart } }, `${prev || "start"} -> ${m} (trigger: ${trigger})`);
          prev = m; segStart = i;
        }
      }
    }

    if (want("predictions")) {
      for (const s of seen.filter((x) => x.line.label === "EXPECT")) {
        const next = calls[s.after];
        if (!next) continue;
        const expectedOk = !/\b(refus|fail|won't|will not|no reply|nothing|reject|blocked)\w*/i.test(s.line.text);
        const hit = expectedOk === next.ok ? 1 : 0;
        const p = s.line.p;
        // Brier on the stated probability that the expectation holds, in millionths.
        const brier = p >= 0 ? Math.round((p / 1000 - hit) ** 2 * 1_000_000) : -1;
        push({ kind: "predictions", agent, turn: s.turn, id: s.line.id, n: { p, expectedOk: expectedOk ? 1 : 0, actualOk: next.ok ? 1 : 0, hit, errorPermille: hit ? 0 : 1000, brierMillionths: brier } }, s.line.text);
      }
    }

    if (want("beliefs") || want("worldmodel")) {
      // An event is a refusal. The state before it is the last notebook state at or before it; the state after, the first one after it (and before the next event).
      const refusals = calls.filter((c) => c.refused);
      refusals.forEach((ev, k) => {
        const before = [...states].reverse().find((s) => s.after <= ev.i);
        const after = states.find((s) => s.after > ev.i && s.after <= (refusals[k + 1]?.i ?? Infinity));
        if (!before || !after) return;
        let changed = 0, added = 0, removed = 0;
        for (const [id, p] of after.beliefs) {
          if (!before.beliefs.has(id)) { added++; continue; }
          const b = before.beliefs.get(id)!;
          if (want("beliefs") && p >= 0 && b >= 0) push({ kind: "beliefs", agent, turn: ev.turn, id, n: { beforePermille: b, afterPermille: p, deltaPermille: p - b } });
          if (p !== b) changed++;
        }
        for (const id of before.beliefs.keys()) if (!after.beliefs.has(id)) removed++;
        if (want("worldmodel")) push({ kind: "worldmodel", agent, turn: ev.turn, id: sha(`${agent}|${ev.turn}|${ev.refused}`), n: { before: before.beliefs.size, after: after.beliefs.size, added, removed, changed } });
      });
    }
  }
  return out;
}
export const SIGNAL_MODES = ["", "exploring", "working", "resting", "stuck"];

export interface Calibration { items: number; computed: boolean; bins?: { from: number; to: number; items: number; stated: number; observed: number }[]; maxGapPermille?: number; note: string }
export interface SignalsReport {
  kinds: SignalKind[];
  textKept: boolean;
  agents: number;
  plans?: { items: number; acted: number; actedShare: number };
  memory?: { notes: number; checkable: number; used: number; stale: number; contradicted: number };
  rules?: { stated: number; checkable: number; broken: number; kept: number };
  modes?: { segments: number; changes: number; byMode: Record<string, number>; triggers: number };
  predictions?: { items: number; hits: number; hitShare: number; meanBrier: number | null; calibration: Calibration };
  beliefs?: { items: number; moved: number; meanAbsDeltaPermille: number };
  worldmodel?: { events: number; withChange: number; added: number; removed: number; changed: number };
  cannotTell: string[];
}

const CANNOT: Record<SignalKind, string> = {
  plans: "Plan traces: a plan item is a line the agent chose to write, and acted-on is a keyword match to its next calls. It does not say the plan caused the action, that the agent meant the plan, or that an agent with no plan lines had none.",
  memory: "Memory use: a note is used when two of its distinctive words reappear in a later call. It cannot tell use from coincidence, and notes with fewer than two distinctive words are not checkable. Stale and contradicted are cues in the text, not judgments of truth.",
  rules: "Rules: only a rule that is a prohibition naming one of the society's tools can be checked; every other rule is counted as stated and not checked. A kept rule may be kept because the call was never useful.",
  modes: "Modes: a label for each stretch of eight calls from its actions (resting, stuck, working, exploring). It is a description of behaviour, not a state of mind; a trigger is the first refused call or the first call in the stretch, not a cause.",
  predictions: "Predictions: the expectation is read as success or failure from its words and compared with the very next call's result. It cannot tell a good forecast from a lucky one, and one run is one draw.",
  beliefs: "Belief probes: the change in a stated probability across a refusal. It says what the agent wrote before and after, not what it came to believe; there is no ground truth for a belief the society does not settle, so beliefs have no calibration.",
  worldmodel: "World-model updates: the difference between the sets of belief lines before and after a refusal. An agent that rewrites its notebook for other reasons shows changes that are not updates.",
};

function aggregate(records: SignalRecord[], cfg: { kinds: SignalKind[]; text: boolean }): SignalsReport {
  const of = (k: SignalKind) => records.filter((r) => r.kind === k);
  const sum = (rs: SignalRecord[], key: string) => rs.reduce((a, r) => a + (r.n[key] ?? 0), 0);
  const r: SignalsReport = { kinds: cfg.kinds, textKept: cfg.text, agents: new Set(records.map((x) => x.agent)).size, cannotTell: cfg.kinds.map((k) => CANNOT[k]) };
  if (cfg.kinds.includes("plans")) { const p = of("plans"); r.plans = { items: p.length, acted: sum(p, "acted"), actedShare: p.length ? sum(p, "acted") / p.length : 0 }; }
  if (cfg.kinds.includes("memory")) { const m = of("memory"); r.memory = { notes: m.length, checkable: sum(m, "checkable"), used: sum(m, "used"), stale: sum(m, "stale"), contradicted: sum(m, "contradicted") }; }
  if (cfg.kinds.includes("rules")) { const u = of("rules"); r.rules = { stated: u.length, checkable: sum(u, "checkable"), broken: sum(u, "broken"), kept: sum(u, "kept") }; }
  if (cfg.kinds.includes("modes")) {
    const m = of("modes"), byMode: Record<string, number> = {};
    for (const x of m) { const k = SIGNAL_MODES[x.n.mode!]!; byMode[k] = (byMode[k] ?? 0) + 1; }
    r.modes = { segments: m.length, changes: m.filter((x) => x.n.from! > 0).length, byMode, triggers: m.filter((x) => x.n.from! > 0).length };
  }
  if (cfg.kinds.includes("predictions")) {
    const p = of("predictions"), withP = p.filter((x) => x.n.p! >= 0);
    r.predictions = { items: p.length, hits: sum(p, "hit"), hitShare: p.length ? sum(p, "hit") / p.length : 0, meanBrier: withP.length ? sum(withP, "brierMillionths") / withP.length / 1_000_000 : null, calibration: calibrate(withP) };
  }
  if (cfg.kinds.includes("beliefs")) { const b = of("beliefs"); r.beliefs = { items: b.length, moved: b.filter((x) => x.n.deltaPermille !== 0).length, meanAbsDeltaPermille: b.length ? b.reduce((a, x) => a + Math.abs(x.n.deltaPermille!), 0) / b.length : 0 }; }
  if (cfg.kinds.includes("worldmodel")) { const w = of("worldmodel"); r.worldmodel = { events: w.length, withChange: w.filter((x) => x.n.added! + x.n.removed! + x.n.changed! > 0).length, added: sum(w, "added"), removed: sum(w, "removed"), changed: sum(w, "changed") }; }
  return r;
}

/** Calibration of the stated probabilities against the outcomes, in five bins, only over 50 or more items. */
function calibrate(items: SignalRecord[]): Calibration {
  if (items.length < CALIBRATION_MIN) return { items: items.length, computed: false, note: `not computed: ${items.length} items with a stated probability, and calibration is computed only over ${CALIBRATION_MIN} or more` };
  const bins = [0, 200, 400, 600, 800].map((from) => {
    const xs = items.filter((x) => x.n.p! >= from && (from === 800 ? x.n.p! <= 1000 : x.n.p! < from + 200));
    return { from, to: from + 200, items: xs.length, stated: xs.length ? xs.reduce((a, x) => a + x.n.p!, 0) / xs.length : 0, observed: xs.length ? (xs.reduce((a, x) => a + x.n.hit!, 0) / xs.length) * 1000 : 0 };
  });
  const gaps = bins.filter((b) => b.items >= 5).map((b) => Math.abs(b.stated - b.observed));
  return { items: items.length, computed: true, bins, maxGapPermille: gaps.length ? Math.round(Math.max(...gaps)) : 0, note: "bins with fewer than five items are shown but not used for the largest gap; one run is one draw" };
}

export function signalsReport(events: TraceEvent[], cfg: SignalsConfig | undefined): SignalsReport | undefined {
  if (!cfg || !cfg.kinds.length) return undefined;
  return aggregate(collectSignals(events, cfg).records, cfg);
}

/** The lens: the report recomputed from the `signal` records in the trace alone (no notebook, no calls), for a second run to compare with. */
export function lensSignals(events: TraceEvent[], cfg: SignalsConfig): SignalsReport {
  const rs: SignalRecord[] = events.filter((e): e is Extract<TraceEvent, { t: "signal" }> => e.t === "signal").map((e) => ({ kind: e.kind, agent: e.agent, turn: e.turn, id: e.id, n: e.n }));
  return aggregate(rs, cfg);
}

export function renderSignals(r: SignalsReport): string {
  const L: string[] = ["## Inside the agent: what it wrote and did (ENG71)", "", `Consented signals: ${r.kinds.join(", ")}. ${r.textKept ? "The text is kept in a separate store (signals-store/), never in the trace." : "No text is kept: the trace holds whole numbers, hashes and identifiers only."} Agents with any record: ${r.agents}. These describe what the agent wrote in its notebook and did; none is a reading of hidden reasoning.`, ""];
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  if (r.plans) L.push(`- Plans: ${r.plans.items} items written, ${r.plans.acted} acted on (${pct(r.plans.actedShare)}).`);
  if (r.memory) L.push(`- Memory: ${r.memory.notes} notes, ${r.memory.checkable} checkable, ${r.memory.used} used later, ${r.memory.stale} stale, ${r.memory.contradicted} contradicted.`);
  if (r.rules) L.push(`- Rules: ${r.rules.stated} stated, ${r.rules.checkable} checkable; ${r.rules.broken} later calls broke one, ${r.rules.kept} kept.`);
  if (r.modes) L.push(`- Modes: ${r.modes.segments} stretches, ${r.modes.changes} changes (${Object.entries(r.modes.byMode).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}).`);
  if (r.predictions) L.push(`- Predictions: ${r.predictions.items} expectations, ${r.predictions.hits} as expected (${pct(r.predictions.hitShare)}); Brier ${r.predictions.meanBrier === null ? "n/a" : r.predictions.meanBrier.toFixed(3)}; calibration ${r.predictions.calibration.computed ? `largest gap ${r.predictions.calibration.maxGapPermille} per thousand` : r.predictions.calibration.note}.`);
  if (r.beliefs) L.push(`- Belief probes: ${r.beliefs.items} before-and-after pairs around a refusal, ${r.beliefs.moved} moved, mean change ${r.beliefs.meanAbsDeltaPermille.toFixed(0)} per thousand.`);
  if (r.worldmodel) L.push(`- World-model updates: ${r.worldmodel.events} refusals with a before and after, ${r.worldmodel.withChange} with a change (${r.worldmodel.added} added, ${r.worldmodel.removed} removed, ${r.worldmodel.changed} changed).`);
  L.push("", "What this cannot tell you:", ...r.cannotTell.map((c) => `- ${c}`), "- None of these reads hidden reasoning; an agent can write one thing and do another, and these show both only as written and as done.");
  return L.join("\n") + "\n";
}
