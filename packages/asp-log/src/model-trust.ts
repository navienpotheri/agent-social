/**
 * Trust per model and version (register row DK1711): the record of what happened under each model, from the log's signed records and nothing else. An Action names the models that ran (by the name the provider resolved and,
 * where it gives one, a backend digest), so each agent's current model is known at each moment; every slash, refusal, Clinic drift finding and quarantine of an agent is counted under the model it was running when it happened.
 * A change of the model behind an agent (a new name, or the same name with a different digest: "a name can point to different weights") is a swap, and the agent is HELD from the swap until it passes a re-examination (an
 * exam result of its own, passed, after the swap). The table gives counts, with the number of agents and runs behind each, and a rate per 100 runs only when the runs are enough to read one: a small sample shows its counts and
 * no rate. Nothing here says a model is safe or aligned: it says what happened. Pure: records in, a table out. Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";

/** Runs a model needs before a rate is shown; under it the counts are shown and the rate is not. */
export const MIN_RUNS_FOR_RATE = 30;
const T = (s: string) => `asp.${s}/v0.2`;

export interface ModelRow { model: string; provider: string | null; name: string; digest: string | null; agents: number; runs: number; slashes: number; refusals: number; drift: number; quarantines: number; per100: { slashes: number; refusals: number; drift: number; quarantines: number } | null }
export interface ModelSwap { agent: string; at: string; action: string; from: string; to: string }
export interface ModelHold { agent: string; since: string; from: string; to: string; reexam: "pending" | "passed"; passedAt?: string }
export interface ModelTrust { models: ModelRow[]; swaps: ModelSwap[]; holds: ModelHold[]; minRunsForRate: number; note: string }

const keyOf = (m: { provider?: string; name: string; digest?: string }) => `${m.provider ?? "?"}|${m.name}|${m.digest ?? "no digest"}`;
const body = (r: AspRecord) => r.body as Record<string, any>;

/** `records` are the log's records in log order (actions, contracts, settlements, refusals, clinic diagnoses, quarantines, exam results; others are ignored). */
export function modelTrust(records: AspRecord[], o: { houseAgents?: ReadonlySet<string> } = {}): ModelTrust {
  const rows = new Map<string, ModelRow & { agentSet: Set<string> }>();
  const row = (key: string) => {
    if (!rows.has(key)) { const [provider, name, digest] = key.split("|"); rows.set(key, { model: key, provider: provider === "?" ? null : provider!, name: name!, digest: digest === "no digest" ? null : digest!, agents: 0, runs: 0, slashes: 0, refusals: 0, drift: 0, quarantines: 0, per100: null, agentSet: new Set() }); }
    return rows.get(key)!;
  };
  const current = new Map<string, string>(); // agent -> the model it ran last
  const seenIds = new Map<string, Map<string, string | null>>(); // agent -> provider|name -> digest
  const swaps: ModelSwap[] = [];
  const contracts = new Map<string, string>(); // contract id -> performer
  const exams: { holder: string; at: string }[] = [];
  const count = (agent: string, f: (r: ModelRow) => void) => { if (o.houseAgents?.has(agent)) return; const k = current.get(agent); if (k) f(row(k)); };
  for (const r of records) {
    const b = body(r);
    if (r.type === T("action")) {
      const models = (b.metrics?.models ?? []) as { name: string; provider?: string; digest?: string }[];
      if (!models.length || o.houseAgents?.has(r.issuer)) continue;
      const known = seenIds.get(r.issuer);
      const ids = known ?? new Map<string, string | null>();
      let swapped: { from: string; to: string } | undefined;
      for (const m of models) {
        const id = `${m.provider ?? ""}|${m.name}`;
        const was = ids.get(id);
        if (known && !ids.has(id)) swapped = { from: current.get(r.issuer) ?? "?", to: keyOf(m) };
        else if (known && was && m.digest && was !== m.digest) swapped = { from: `${m.provider ?? "?"}|${m.name}|${was}`, to: keyOf(m) };
        if (!ids.has(id) || (m.digest && !was)) ids.set(id, m.digest ?? was ?? null);
        else if (m.digest && was !== m.digest) ids.set(id, m.digest);
      }
      seenIds.set(r.issuer, ids);
      if (swapped) swaps.push({ agent: r.issuer, at: r.issued_at, action: r.id, ...swapped });
      const key = keyOf(models[0]!);
      current.set(r.issuer, key);
      const rw = row(key); rw.runs++; rw.agentSet.add(r.issuer);
    } else if (r.type === T("contract")) contracts.set(r.id, b.performer);
    else if (r.type === T("settlement")) { const p = contracts.get(b.contract); if (p && (b.bond_slashed?.value ?? 0) > 0) count(p, (m) => m.slashes++); }
    else if (r.type === T("refusal")) count(r.issuer, (m) => m.refusals++);
    else if (r.type === T("clinic_diagnosis")) count(b.agent, (m) => m.drift++);
    else if (r.type === T("quarantine")) for (const a of (b.members ?? []) as string[]) count(a, (m) => m.quarantines++);
    else if (r.type === T("exam_result") && b.passed === true) exams.push({ holder: b.holder, at: r.issued_at });
  }
  const models = [...rows.values()].map(({ agentSet, ...m }) => {
    const enough = m.runs >= MIN_RUNS_FOR_RATE, per = (n: number) => Math.round((n / m.runs) * 1000) / 10;
    return { ...m, agents: agentSet.size, per100: enough ? { slashes: per(m.slashes), refusals: per(m.refusals), drift: per(m.drift), quarantines: per(m.quarantines) } : null };
  }).sort((a, b) => b.runs - a.runs || (a.model < b.model ? -1 : 1));
  // A hold begins at the latest swap of an agent and ends at the first passed exam of its own after it.
  const latest = new Map<string, ModelSwap>(); for (const s of swaps) latest.set(s.agent, s);
  const holds: ModelHold[] = [...latest.values()].map((s) => {
    const pass = exams.find((e) => e.holder === s.agent && Date.parse(e.at) > Date.parse(s.at));
    return { agent: s.agent, since: s.at, from: s.from, to: s.to, reexam: pass ? "passed" : "pending", ...(pass ? { passedAt: pass.at } : {}) };
  });
  return { models, swaps, holds, minRunsForRate: MIN_RUNS_FOR_RATE, note: "Counts are what the signed records show under each model; a rate per 100 runs is shown only from 30 runs. This says what happened, not that a model is safe or aligned. Credits are accounting entries, not money." };
}
