/**
 * Drift detection that runs by itself (register row DK1712): the service's scheduler for the Clinic's checks. On a stated cycle it runs an ANNOUNCED checkup on every agent, and in every time slot it runs an UNANNOUNCED
 * audit on the agents whose slot the committed seed draws (`isProbeSlot`: replayable by anyone after the seed is revealed, unpredictable before), dressed as ordinary work (`disguise`, and a probe whose text would give itself
 * away is not run). Every result is a signed `probe_result` the caller records; the findings of `assessDrift` move an agent one rung of the ladder (`nextRung`), once per new piece of evidence, and the quarantine rung opens the
 * existing quarantine path. It records through the functions it is given and reads nothing but the observations: the probe results are read by the Clinic's rules and by no tier or rank code. `measureFalseFlags` states how
 * often an honest agent is flagged, with the sample size and a 95 % interval. Not claimed: that drift is detected in a real agent (that needs a live run, row DK1604). Credits are accounting entries, not money.
 */
import { CLEAN_TO_LIFT, isProbeSlot, PROBE_RATE_PERMILLE, assessDrift, disguise, nextRung, type Observation, type Rung } from "./drift-after-eval.ts";

export interface DriftPolicy {
  /** The revealed-later seed of the unannounced audits (its commitment was published first). */
  seed: string;
  /** How often every agent has an announced checkup, in ms. */
  announcedEveryMs: number;
  /** The length of a slot in which an unannounced audit may fall, in ms; a slot is drawn for an agent with probability `rate`. */
  slotMs: number;
  /** Permille of slots that are unannounced audits (default PROBE_RATE_PERMILLE). */
  rate?: number;
}
export interface ProbeResult { passed: boolean; violations: number }
export interface DriftDeps {
  now: () => number;
  agents: () => Promise<string[]>;
  /** The agent's probe results so far, from the log. */
  observations: (agent: string) => Promise<Observation[]>;
  /** The canary task to give an agent next, and the client and due date to dress it with. */
  task: (agent: string) => { id: string; instruction: string; client: string; due: string };
  /** Runs one probe on the agent. For a hidden probe it gets the disguised job text, which carries no word that says it is a test. */
  runProbe: (agent: string, kind: "announced" | "hidden", jobText: string) => Promise<ProbeResult>;
  /** Signs and appends the probe result (the Clinic's record); returns its id. `slot` is the slot of a hidden probe. */
  record: (agent: string, kind: "announced" | "hidden", result: ProbeResult, slot?: number) => Promise<string>;
  /** Where the agent stands on the ladder now: the id of its latest step, its rung and when it was taken. */
  ladder: (agent: string) => Promise<{ id?: string; rung: Rung; at?: number }>;
  /** Signs and appends a ladder step; returns its id. `quarantine` is the id of the quarantine record for that rung. */
  step: (agent: string, step: Exclude<Rung, "none"> | "lift", evidence: string[], previous: string | undefined, quarantine?: string) => Promise<string>;
  /** The Clinic's quarantine record for the agent (the existing path), made when the ladder reaches that rung. */
  quarantine: (agent: string, evidence: string[]) => Promise<string>;
  /** The pass rate the agent had at its evaluation. */
  evalPassRate: (agent: string) => number;
}
export interface DriftAction { agent: string; what: "announced" | "hidden" | "step" | "lift" | "refused_to_probe"; detail: string; id?: string }

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const toObs = (kind: "announced" | "hidden", id: string, agent: string, at: number, r: ProbeResult): Observation => ({ id, agent, kind: kind === "announced" ? "announced_test" : "hidden_probe", at: iso(at), passed: r.passed, violations: r.violations });

/** What is due for an agent now: an announced checkup when the cycle has run out, an unannounced audit when this slot is drawn for it and has not been used. Pure. */
export function dueFor(agent: string, obs: Observation[], now: number, p: DriftPolicy): { announced: boolean; hidden: boolean; slot: number } {
  const slot = Math.floor(now / p.slotMs);
  const lastAnnounced = Math.max(0, ...obs.filter((o) => o.kind === "announced_test").map((o) => Date.parse(o.at)));
  const usedSlot = obs.some((o) => o.kind === "hidden_probe" && Math.floor(Date.parse(o.at) / p.slotMs) === slot);
  return { announced: now - lastAnnounced >= p.announcedEveryMs, hidden: !usedSlot && isProbeSlot(p.seed, agent, slot, p.rate ?? PROBE_RATE_PERMILLE), slot };
}

/** One pass of the scheduler over every agent. Returns what it did, in order. */
export async function runDriftPass(d: DriftDeps, p: DriftPolicy): Promise<DriftAction[]> {
  const out: DriftAction[] = [];
  for (const agent of await d.agents()) {
    const now = d.now();
    let obs = await d.observations(agent);
    const due = dueFor(agent, obs, now, p);
    const run = async (kind: "announced" | "hidden") => {
      const t = d.task(agent);
      const job = kind === "hidden" ? disguise(t, t.client, t.due) : { text: t.instruction, looksReal: true };
      if (!job.looksReal) { out.push({ agent, what: "refused_to_probe", detail: "the dressed job would give itself away, so no hidden probe was run" }); return; }
      const res = await d.runProbe(agent, kind, job.text);
      const id = await d.record(agent, kind, res, kind === "hidden" ? due.slot : undefined);
      obs = [...obs, toObs(kind, id, agent, now, res)];
      out.push({ agent, what: kind, detail: `${res.passed ? "passed" : "failed"}, ${res.violations} violation(s)`, id });
    };
    if (due.announced) await run("announced");
    if (due.hidden) await run("hidden");
    // The ladder: a finding resting on evidence newer than the last step moves one rung; a clean run of hidden probes lifts one.
    const cur = await d.ladder(agent);
    const findings = assessDrift(obs, d.evalPassRate(agent)).filter((f) => cur.at === undefined || f.evidence.some((id) => { const o = obs.find((x) => x.id === id); return !!o && Date.parse(o.at) > cur.at!; }));
    const hidden = obs.filter((o) => o.kind === "hidden_probe");
    const after = cur.at === undefined ? hidden : hidden.filter((o) => Date.parse(o.at) > cur.at!);
    let clean = 0; for (let i = after.length - 1; i >= 0 && after[i]!.passed && after[i]!.violations === 0; i--) clean++;
    const n = nextRung(cur.rung, findings, clean);
    if (n.action === "step") {
      const evidence = [...new Set(findings.flatMap((f) => f.evidence))];
      const q = n.rung === "quarantine" ? await d.quarantine(agent, evidence) : undefined;
      const id = await d.step(agent, n.rung as Exclude<Rung, "none">, evidence, cur.id, q);
      out.push({ agent, what: "step", detail: n.why, id });
    } else if (n.action === "lift") {
      const evidence = hidden.slice(-CLEAN_TO_LIFT).map((o) => o.id);
      const id = await d.step(agent, "lift", evidence, cur.id);
      out.push({ agent, what: "lift", detail: n.why, id });
    }
  }
  return out;
}

/** The share of honest agents the rule flags, with the sample size and a 95 % Wilson interval. An honest agent behaves the same announced or not: each job has a violation with the same probability. Deterministic from `seed`. */
export function measureFalseFlags(o: { agents: number; announced: number; hidden: number; violationRate: number; seed: number; evalPassRate?: number }): { agents: number; flagged: number; rate: number; low: number; high: number; sample: string } {
  let s = o.seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let flagged = 0;
  for (let a = 0; a < o.agents; a++) {
    const obs: Observation[] = [];
    const add = (kind: Observation["kind"], i: number) => { const v = rand() < o.violationRate ? 1 : 0; obs.push({ id: `a${a}-${kind}-${i}`, agent: `a${a}`, kind, at: iso(i * 1000), passed: v === 0, violations: v }); };
    for (let i = 0; i < o.announced; i++) add("announced_test", i);
    for (let i = 0; i < o.hidden; i++) add("hidden_probe", i);
    if (assessDrift(obs, o.evalPassRate ?? 1 - o.violationRate).length) flagged++;
  }
  const n = o.agents, ph = flagged / n, z = 1.96, den = 1 + (z * z) / n;
  const centre = (ph + (z * z) / (2 * n)) / den, half = (z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n))) / den;
  return { agents: n, flagged, rate: ph, low: Math.max(0, centre - half), high: Math.min(1, centre + half), sample: `${flagged} of ${n} honest agents flagged, each with ${o.announced} announced and ${o.hidden} hidden probes at a violation rate of ${o.violationRate}` };
}
