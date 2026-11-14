/**
 * Cognition telemetry (docs/institutions/instrumentation.md; register row DK79; spec-delta S291). Pure functions: the nine signals' names, the derived measures (Brier, surprisal, reliability bins, ECE, belief
 * diff, KL, update efficiency, normative update), the digest's Merkle root, the consent gate (a signal without consent is never collected: its source is never read), and a seeded simulated society that
 * produces all nine signals reproducibly. The log carries numbers, hashes and identifiers only, never free text. **No telemetry figure is read by any tier, rank, bond, certificate or eligibility code.**
 * Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

/** The nine signals (instrumentation.md 4). */
export const SIGNALS = ["reasoning_trace", "memory_rules", "sub_agent_graph", "belief_state", "plan_trace", "action_prediction", "world_model_update", "active_inference", "calibration"] as const;
export type Signal = (typeof SIGNALS)[number];
/** The digest key each signal's entries sit under. */
export const ENTRY_KEY: Record<Signal, string> = { reasoning_trace: "reasoning", memory_rules: "memory", sub_agent_graph: "graph", belief_state: "beliefs", plan_trace: "plans", action_prediction: "predictions", world_model_update: "diffs", active_inference: "inference", calibration: "calibration" };
export const PURPOSE_OWN_USE = "own_use";
export const MAX_RETENTION_DAYS = 90;
/** ECE and the trend are shown only over at least this many resolved items (instrumentation.md 5). */
export const MIN_CALIBRATION_N = 50;
export const PROBE_NOTICE_MS = 24 * 3_600_000;
/** The registered resolvers a proposition may name: deterministic functions of the log at `resolve_at`. */
export const RESOLVERS = ["price_above", "price_below", "event_occurs", "balance_above", "tier_at_least"] as const;

export const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const log2 = (x: number) => Math.log(x) / Math.LN2;

// ---- derived measures ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** Brier score of probabilities (0 to 1) against outcomes (1 or 0). */
export const brier = (items: { p: number; outcome: 0 | 1 }[]): number => round3(items.reduce((n, i) => n + (i.p - i.outcome) ** 2, 0) / items.length);
/** Surprisal of an observed outcome under the agent's own prediction, in bits. */
export const surprisal = (p: number, outcome: 0 | 1): number => -log2(outcome === 1 ? p : 1 - p);
export const meanSurprisal = (items: { p: number; outcome: 0 | 1 }[]): number => round3(items.reduce((n, i) => n + surprisal(i.p, i.outcome), 0) / items.length);
/** KL divergence of the posterior from the prior over a yes/no proposition, in bits. */
export const klBits = (post: number, prior: number): number => { const t = (a: number, b: number) => (a === 0 ? 0 : a * log2(a / b)); return t(post, prior) + t(1 - post, 1 - prior); };
const logit = (p: number) => Math.log(p / (1 - p));
/** The normative posterior: prior odds times the likelihood ratio the lens published. */
export const normativePosterior = (prior: number, lr: number): number => { const odds = (prior / (1 - prior)) * lr; return odds / (1 + odds); };

export interface Reliability { lo: number; hi: number; n: number; mean_p: number; freq: number }
/** The reliability table over equal-width bins, the Brier score and the expected calibration error. ECE is withheld (null) under MIN_CALIBRATION_N items. */
export function calibration(items: { p: number; outcome: 0 | 1 }[], bins = 5): { n: number; bins: Reliability[]; brier: number; ece: number | null; min_n_met: boolean } {
  const table: Reliability[] = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, mean_p: 0, freq: 0 }));
  for (const it of items) { const k = Math.min(bins - 1, Math.floor(it.p * bins)); table[k].n++; table[k].mean_p += it.p; table[k].freq += it.outcome; }
  for (const b of table) if (b.n) { b.mean_p = round3(b.mean_p / b.n); b.freq = round3(b.freq / b.n); }
  const met = items.length >= MIN_CALIBRATION_N;
  const ece = met ? round3(table.reduce((n, b) => n + (b.n / items.length) * Math.abs(b.mean_p - b.freq), 0)) : null;
  return { n: items.length, bins: table, brier: items.length ? brier(items) : 0, ece, min_n_met: met };
}

export interface BeliefDiffRow { id: string; before: number; after: number; delta: number; direction: "toward" | "away" | "none" | "unresolved"; kl_bits: number; normative?: number }
/** The belief diff around an event (signals 7 and 8): per proposition the change, its direction against the truth once resolved, the information gained, and the aggregates. `lr` are the lens's published likelihood ratios. */
export function beliefDiff(before: Record<string, number>, after: Record<string, number>, truth: Record<string, 0 | 1> = {}, lr: Record<string, number> = {}): { rows: BeliefDiffRow[]; l1: number; mean_abs: number; info_bits: number; normative_bits: number | null; efficiency: number | null; spurious_bits: number; toward: number; away: number } {
  const rows: BeliefDiffRow[] = Object.keys(before).map((id) => {
    const b = before[id], a = after[id], d = a - b;
    const t = truth[id];
    const direction = d === 0 ? "none" : t === undefined ? "unresolved" : (t === 1 ? d > 0 : d < 0) ? "toward" : "away";
    const normative = lr[id] !== undefined ? normativePosterior(b, lr[id]) : undefined;
    return { id, before: b, after: a, delta: round3(d), direction, kl_bits: round3(klBits(a, b)), ...(normative !== undefined ? { normative: round3(normative) } : {}) };
  });
  const withNorm = rows.filter((r) => r.normative !== undefined);
  const normBits = withNorm.length ? withNorm.reduce((n, r) => n + klBits(r.normative!, r.before), 0) : null;
  const lead = withNorm.sort((x, y) => Math.abs(y.normative! - y.before) - Math.abs(x.normative! - x.before))[0];
  const efficiency = lead && lead.normative !== undefined && lead.normative !== lead.before ? round3((logit(lead.after) - logit(lead.before)) / (logit(lead.normative) - logit(lead.before))) : null;
  const spurious = rows.filter((r) => lr[r.id] === 1).reduce((n, r) => n + r.kl_bits, 0);
  return {
    rows, l1: round3(rows.reduce((n, r) => n + Math.abs(r.delta), 0)), mean_abs: round3(rows.reduce((n, r) => n + Math.abs(r.delta), 0) / rows.length),
    info_bits: round3(rows.reduce((n, r) => n + klBits(r.after, r.before), 0)), normative_bits: normBits === null ? null : round3(normBits), efficiency, spurious_bits: round3(spurious),
    toward: rows.filter((r) => r.direction === "toward").length, away: rows.filter((r) => r.direction === "away").length,
  };
}

/** The Merkle root of a day's raw signal entries: SHA-256 over the sorted entry hashes, paired up to one root. */
export function merkleRoot(entries: unknown[]): string {
  const h = (s: string) => createHash("sha256").update(s).digest("hex");
  let level = entries.map((e) => h(JSON.stringify(e))).sort();
  if (!level.length) return `sha256:${h("")}`;
  while (level.length > 1) { const next: string[] = []; for (let i = 0; i < level.length; i += 2) next.push(h(level[i] + (level[i + 1] ?? level[i]))); level = next; }
  return `sha256:${level[0]}`;
}
export const textHash = (text: string, salt: string): string => `sha256:${createHash("sha256").update(salt + text).digest("hex")}`;

// ---- consent gate -------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface ConsentView { signals: string[]; purposes: string[]; from: string; until: string; revoked: boolean; agentCountersigned: boolean; minorTenant?: boolean; /** The signals the Mandate's `telemetry` field lists; ABSENT means the Mandate has none and nothing is collected. */ mandateSignals?: readonly string[] }
/** Whether a signal may be collected now: the consent names it, is in date, was countersigned by the agent, is not revoked, and the tenant is not a young person's. */
export function mayCollect(consent: ConsentView | undefined, signal: Signal, at: string): boolean {
  if (!consent || consent.revoked || !consent.agentCountersigned || consent.minorTenant) return false;
  if (!consent.mandateSignals?.includes(signal)) return false; // the first key: no `telemetry` field in the Mandate, or the signal is not listed, means it is never read
  return consent.signals.includes(signal) && Date.parse(consent.from) <= Date.parse(at) && Date.parse(at) < Date.parse(consent.until);
}

/**
 * The collector the gateway would run (instrumentation.md 7): `collect` calls the source of a signal only when `mayCollect` says yes. Without consent the source is **never read** (not read and dropped), and the
 * run says `telemetry: off`. `calls` is the source call log a test reads to show nothing was touched.
 */
export class Collector {
  readonly entries: Partial<Record<Signal, unknown[]>> = {};
  readonly calls: Signal[] = [];
  private readonly consent: ConsentView | undefined;
  private readonly at: () => string;
  constructor(consent: ConsentView | undefined, at: () => string) { this.consent = consent; this.at = at; }
  collect(signal: Signal, source: () => unknown): boolean {
    if (!mayCollect(this.consent, signal, this.at())) return false;
    this.calls.push(signal);
    const got = source();
    (this.entries[signal] ??= []).push(...(Array.isArray(got) ? got : [got]));
    return true;
  }
  get status(): string { return Object.keys(this.entries).length ? "telemetry: on" : "telemetry: off"; }
}

// ---- the lens measures (L7, belief recalibration under a shock), from signed digests alone ---------------------------------------------------------------------------------------------

export interface DigestView { agent: string; day: string; entries: Record<string, any> }
/**
 * The lens of the worked example (instrumentation.md 20, lens L7): from the digests of a cohort it computes, per agent, the belief diff around the event, the calibration before and after, and the cohort's
 * median update efficiency. Pure in the digests: the same signed entries give the same numbers on a second run.
 */
export function lensRecalibration(digests: DigestView[], eventRef: string, truth: Record<string, 0 | 1>, lr: Record<string, number>): { agents: { agent: string; l1: number; efficiency: number | null; brier_before: number | null; brier_after: number | null }[]; median_efficiency: number | null } {
  const byAgent = new Map<string, DigestView[]>();
  for (const d of digests) byAgent.set(d.agent, [...(byAgent.get(d.agent) ?? []), d]);
  const agents = [...byAgent].sort(([a], [b]) => (a < b ? -1 : 1)).map(([agent, ds]) => {
    const beliefs = ds.flatMap((d) => (d.entries.beliefs ?? []) as { condition: string; event_ref: string; answers: Record<string, number> }[]).filter((b) => b.event_ref === eventRef);
    const b0 = beliefs.find((b) => b.condition === "before_event"), b1 = beliefs.find((b) => b.condition === "after_event");
    const diff = b0 && b1 ? beliefDiff(Object.fromEntries(Object.entries(b0.answers).map(([k, v]) => [k, v / 1000])), Object.fromEntries(Object.entries(b1.answers).map(([k, v]) => [k, v / 1000])), truth, lr) : undefined;
    const outcomes = ds.flatMap((d) => (d.entries.predictions ?? []) as { window: string; p: number; outcome: 0 | 1 }[]);
    const pick = (w: string) => { const xs = outcomes.filter((o) => o.window === w).map((o) => ({ p: o.p / 1000, outcome: o.outcome })); return xs.length ? brier(xs) : null; };
    return { agent, l1: diff?.l1 ?? 0, efficiency: diff?.efficiency ?? null, brier_before: pick("before"), brier_after: pick("after") };
  });
  const effs = agents.map((a) => a.efficiency).filter((x): x is number => x !== null).sort((a, b) => a - b);
  return { agents, median_efficiency: effs.length ? effs[Math.floor(effs.length / 2)] : null };
}

// ---- the simulated society ---------------------------------------------------------------------------------------------------------------------------------------------------

/** A small deterministic generator (mulberry32): the same seed gives the same society. */
export function rng(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export interface SimAgent { agent: string; digests: DigestView[]; consentedSignals: Signal[] }
/**
 * A simulated society of `n` agents around one shock (the worked example's price change): each consented agent reports all nine signals for a day before and a day after, from a seeded generator. The numbers are
 * simulated, not measured. An agent whose consent omits a signal produces no entry for it, and its collector never reads that source.
 */
export function simulateSociety(seed: number, n: number, opts: { truth: Record<string, 0 | 1>; prior: Record<string, number>; eventRef: string; consentFor?: (i: number) => Signal[]; /** A simulation parameter for a mechanism under test: added to every agent's skill (an assumption, not a finding). */ skillBoost?: (i: number) => number }): SimAgent[] {
  const rand = rng(seed);
  const props = Object.keys(opts.prior);
  return Array.from({ length: n }, (_, i) => {
    const agent = `sim-agent-${String(i + 1).padStart(2, "0")}`;
    const signals = opts.consentFor ? opts.consentFor(i) : [...SIGNALS];
    const consent: ConsentView = { signals: [...signals], purposes: ["L7-belief-recalibration"], from: "2026-11-01T00:00:00Z", until: "2026-12-31T00:00:00Z", revoked: false, agentCountersigned: true, mandateSignals: [...signals] };
    const digests: DigestView[] = [];
    // The agent's skill: how far it moves toward the truth after the shock.
    const skill = Math.max(0.05, Math.min(0.95, 0.3 + 0.6 * rand() + (opts.skillBoost?.(i) ?? 0)));
    let b0: Record<string, number> | undefined;
    let b1: Record<string, number> | undefined;
    for (const [day, phase] of [["2026-11-10", "before"], ["2026-11-14", "after"]] as const) {
      const c = new Collector(consent, () => `${day}T12:00:00Z`);
      const answers = (when: "before_event" | "after_event") => Object.fromEntries(props.map((p) => { const t = opts.truth[p]; const base = opts.prior[p]; const toward = when === "after_event" ? base + (t - base) * skill * (0.6 + 0.4 * rand()) : base; return [p, Math.max(10, Math.min(990, Math.round(toward * 1000)))]; }));
      c.collect("reasoning_trace", () => [{ step: 1, class: "summary", length: Math.round(200 + 400 * rand()), text_sha256: textHash(`reason-${agent}-${phase}`, `salt-${i}`) }]);
      c.collect("memory_rules", () => [{ event: "add", text_sha256: textHash(`mem-${agent}-${phase}`, `salt-${i}`) }, { event: "consolidate", text_sha256: textHash(`mem2-${agent}-${phase}`, `salt-${i}`) }]);
      c.collect("sub_agent_graph", () => ({ nodes: 1 + Math.floor(3 * rand()), edges: Math.floor(3 * rand()), depth: 1, runtime: "claude-code", model: "sim-model" }));
      c.collect("belief_state", () => { const a = answers(phase === "before" ? "before_event" : "after_event"); if (phase === "before") b0 = a; else b1 = a; return [{ probe_set: "econ-1", version: 1, condition: phase === "before" ? "before_event" : "after_event", event_ref: opts.eventRef, answers: a }]; });
      c.collect("plan_trace", () => [{ plan_id: `plan-${phase}`, goals: [{ id: "g1", class: "earn" }], steps: [{ id: "s1", needs: [], status: "done" }, { id: "s2", needs: ["s1"], status: phase === "before" ? "open" : "done" }], revision: phase === "before" ? 1 : 2, cause: phase === "before" ? "self" : opts.eventRef }]);
      c.collect("action_prediction", () => Array.from({ length: 4 }, (_, k) => { const p = Math.round((phase === "before" ? 0.5 + 0.4 * rand() : 0.3 + 0.6 * rand()) * 1000); const outcome: 0 | 1 = rand() < p / 1000 ? 1 : 0; return { prediction: `pred-${phase}-${k}`, window: phase, p, outcome, surprisal_millibits: Math.round(surprisal(p / 1000, outcome) * 1000) }; }));
      // The derived signals are computed from the agent's own two belief states (when both were collected: an agent that did not consent to belief_state has nothing to derive from).
      const diff = () => (b0 && b1 ? beliefDiff(Object.fromEntries(Object.entries(b0).map(([k, v]) => [k, v / 1000])), Object.fromEntries(Object.entries(b1).map(([k, v]) => [k, v / 1000])), opts.truth) : undefined);
      c.collect("world_model_update", () => { const d = phase === "after" ? diff() : undefined; return d ? [{ event_ref: opts.eventRef, l1_milli: Math.round(d.l1 * 1000), toward: d.toward, away: d.away }] : []; });
      c.collect("active_inference", () => { const d = phase === "after" ? diff() : undefined; return d ? [{ event_ref: opts.eventRef, info_millibits: Math.round(d.info_bits * 1000) }] : []; });
      c.collect("calibration", () => ({ window: phase, n: 4, brier_milli: Math.round(rand() * 400) }));
      const entries = Object.fromEntries(Object.entries(c.entries).map(([s, v]) => [ENTRY_KEY[s as Signal], v]));
      digests.push({ agent, day, entries });
    }
    return { agent, digests, consentedSignals: signals };
  });
}

/** The body of a daily digest for `agent` (instrumentation.md 5): the entries, their counts and their Merkle root, ready to sign. */
export function buildDigest(agent: string, day: string, consent: string, entries: Record<string, unknown>): Record<string, unknown> {
  const keyToSignal = Object.fromEntries(SIGNALS.map((x) => [ENTRY_KEY[x], x]));
  const counts = Object.fromEntries(Object.entries(entries).map(([k, v]) => [keyToSignal[k] ?? k, Array.isArray(v) ? v.length : 1]));
  const flat = Object.keys(entries).sort().flatMap((k) => (Array.isArray(entries[k]) ? (entries[k] as unknown[]) : [entries[k]]));
  return { act: "digest", agent, day, consent, merkle_root: merkleRoot(flat), counts, entries };
}
