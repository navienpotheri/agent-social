/**
 * Paper-specific probes (row ENG130): small deterministic engines that score the skill a paper is about, not generic rule-writing. Each has a task generator on a seed, practice tasks the learner may see, held-out tasks the learner does not, and a
 * rule-based scorer. Three so far: calibration (Just Ask for Calibration: a stated confidence scored by Brier score and expected calibration error), verification (Chain-of-Verification: a draft checked against an independent table, scored by lookup) and memory (Mem0: the operations ADD, UPDATE, DELETE and NOOP over a scripted dialogue, the final state scored exactly).
 * They test an ingredient of each paper in a toy world, not the paper's system; the scoring rules are written in plain words on each engine. Everything is pure: the same artifact and seed give the same score.
 */
import { register, type CourseRun, type Engine } from "./engines.ts";

const rng = (seed: string): (() => number) => { let a = [...seed].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261); return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const run = (score: number, gate: number, measures: CourseRun["measures"], failures: string[]): CourseRun => ({ score_permille: Math.round(Math.max(0, Math.min(1, score)) * 1000), passed: score >= gate && failures.length === 0, measures, failures });

// ---- 1. calibration -------------------------------------------------------------------------------------------------------------------------------------------------------------
// A shop's past orders: for each item, how many of its last m orders were late. The next order is late with a hidden probability near that share (plus a seeded shift). The artifact is a table mapping the share of late orders
// to the confidence (probability the next order is late) the agent states. Scored on 40 held-out items by the Brier score against what happened and by the expected calibration error over five bins; the score is 1 minus the Brier score over 0.25
// (a constant 0.5 scores 0), and the gate is a Brier score at most 0.23 (a constant 0.5 scores 0.25) with a calibration error at most 0.20, loose because forty held-out items are few.
interface CalItem { late: number; of: number; outcome: boolean }
const calItems = (seed: string, n: number): CalItem[] => { const r = rng(seed); return Array.from({ length: n }, () => { const of = 10, share = Math.floor(r() * 11) / 10, p = Math.max(0.02, Math.min(0.98, share + (r() - 0.5) * 0.1)); return { late: Math.round(share * of), of, outcome: r() < p }; }); };
export const calibration: Engine = {
  id: "probe-calibration",
  leakTokens: (seed) => calItems(`${seed}|heldout`, 40).map((x, i) => `held-out order ${seed}-${i}-${x.late}`),
  practice: (seed) => ({ note: "Each item shows how many of an item's last 10 orders were late; the next order is late with about that probability. Give, for each share of late orders, the probability you would state that the next order is late.", items: calItems(`${seed}|practice`, 20).map((x) => ({ late_of_10: x.late, next_was_late: x.outcome })) }),
  run(artifact, seed, gate): CourseRun {
    const bins = (artifact as { bins?: Array<{ late_of_10: number; confidence: number }> })?.bins;
    if (!Array.isArray(bins) || !bins.length) return run(0, 0.5, {}, ["the artifact is {\"bins\": [{\"late_of_10\": 0..10, \"confidence\": 0..1}, ...]}"]);
    const pick = (late: number): number => { const exact = bins.find((b) => b.late_of_10 === late); if (exact) return Number(exact.confidence); const near = [...bins].sort((a, b) => Math.abs(a.late_of_10 - late) - Math.abs(b.late_of_10 - late))[0]!; return Number(near.confidence); };
    const items = calItems(`${seed}|heldout`, 40);
    let brier = 0; const binSum = Array.from({ length: 5 }, () => ({ n: 0, conf: 0, hit: 0 }));
    for (const it of items) { const c = Math.max(0, Math.min(1, pick(it.late))); brier += (c - (it.outcome ? 1 : 0)) ** 2; const b = Math.min(4, Math.floor(c * 5)); binSum[b]!.n++; binSum[b]!.conf += c; binSum[b]!.hit += it.outcome ? 1 : 0; }
    brier /= items.length;
    const ece = binSum.reduce((a, b) => a + (b.n ? (b.n / items.length) * Math.abs(b.conf / b.n - b.hit / b.n) : 0), 0);
    const score = 1 - brier / 0.25;
    return { score_permille: Math.round(Math.max(0, score) * 1000), passed: brier <= 0.23 && ece <= 0.2, measures: { brier: Math.round(brier * 1000) / 1000, ece: Math.round(ece * 1000) / 1000 }, failures: brier <= 0.23 && ece <= 0.2 ? [] : [`Brier ${brier.toFixed(3)} (at most 0.230) and expected calibration error ${ece.toFixed(3)} (at most 0.200)`] };
  },
};

// ---- 2. verification ------------------------------------------------------------------------------------------------------------------------------------------------------------
// A draft lists claims about people (city, year, field); some values are wrong. A fact table is the independent source. The artifact is a list of checks, each {attribute, source}: source "table" checks a claim's attribute against the
// table and drops the claim when it differs; source "draft" checks it against the draft itself (which agrees with itself) and drops nothing. Score: precision of the claims kept (true claims over claims kept) minus a recall penalty for true claims dropped;
// the gate is a precision of at least 0.9 on every run with at least 80 percent of the true claims kept.
interface Claim { who: string; city: string; year: number; field: string; ok: { city: boolean; year: boolean; field: boolean } }
const CITIES = ["Oslo", "Lima", "Kyoto", "Accra", "Quito", "Tallinn"], FIELDS = ["optics", "botany", "acoustics", "geology", "linguistics"];
const draftOf = (seed: string): { truth: Claim[]; draft: Claim[] } => { const r = rng(seed), truth: Claim[] = [], draft: Claim[] = []; for (let i = 0; i < 12; i++) { const city = CITIES[Math.floor(r() * CITIES.length)]!, year = 1900 + Math.floor(r() * 100), field = FIELDS[Math.floor(r() * FIELDS.length)]!; const t: Claim = { who: `P${i}`, city, year, field, ok: { city: true, year: true, field: true } }; truth.push(t); const wrong = r() < 0.4, attr = (["city", "year", "field"] as const)[Math.floor(r() * 3)]!; const d: Claim = { ...t, ok: { ...t.ok } }; if (wrong) { d.ok[attr] = false; if (attr === "city") d.city = CITIES[(CITIES.indexOf(city) + 1) % CITIES.length]!; if (attr === "year") d.year = year + 7; if (attr === "field") d.field = FIELDS[(FIELDS.indexOf(field) + 1) % FIELDS.length]!; } draft.push(d); } return { truth, draft }; };
export const verification: Engine = {
  id: "probe-verification",
  leakTokens: (seed) => draftOf(`${seed}|heldout`).draft.map((d) => `${d.who} ${d.city} ${d.year} ${d.field}`),
  practice: (seed) => { const { truth, draft } = draftOf(`${seed}|practice`); return { note: "A draft lists claims about people; a fact table is an independent source. Choose which attributes (city, year, field) to check and against which source (\"table\" or \"draft\").", draft: draft.map((d) => ({ who: d.who, city: d.city, year: d.year, field: d.field })), table: truth.map((t) => ({ who: t.who, city: t.city, year: t.year, field: t.field })) }; },
  run(artifact, seed, gate): CourseRun {
    const checks = (artifact as { checks?: Array<{ attribute: string; source: string }> })?.checks;
    if (!Array.isArray(checks)) return run(0, 0.9, {}, ["the artifact is {\"checks\": [{\"attribute\": \"city\"|\"year\"|\"field\", \"source\": \"table\"|\"draft\"}, ...]}"]);
    const { draft } = draftOf(`${seed}|heldout`);
    const tableChecked = new Set(checks.filter((c) => c.source === "table").map((c) => c.attribute));
    const kept = draft.filter((d) => ![...tableChecked].some((a) => d.ok[a as "city" | "year" | "field"] === false));
    const trueKept = kept.filter((d) => d.ok.city && d.ok.year && d.ok.field).length, trueAll = draft.filter((d) => d.ok.city && d.ok.year && d.ok.field).length;
    const precision = kept.length ? trueKept / kept.length : 0, recall = trueAll ? trueKept / trueAll : 1, before = trueAll / draft.length;
    const score = precision * (recall >= 0.8 ? 1 : recall);
    return { score_permille: Math.round(score * 1000), passed: precision >= 0.9 && recall >= 0.8, measures: { precision_before: Math.round(before * 1000) / 1000, precision_after: Math.round(precision * 1000) / 1000, recall: Math.round(recall * 1000) / 1000 }, failures: precision >= 0.9 && recall >= 0.8 ? [] : [`precision after the check ${precision.toFixed(2)} (at least 0.90) with ${(recall * 100).toFixed(0)}% of the true claims kept (at least 80%)`] };
  },
};

// ---- 3. memory ------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A scripted dialogue of facts about a user (key, value). Each message is one of: new (a key not stored), same (a key with the stored value), changed (a key with a different value), refined (the stored value with more information),
// less (the stored value stated with less information), retracted (the user withdraws a key). The artifact maps each message kind to one operation ADD, UPDATE, DELETE or NOOP. The scorer runs the dialogue through the policy and compares the final memory
// with the true final state exactly, key by key; the score is the share of keys right and the gate is all keys right on every run.
type Kind = "new" | "same" | "changed" | "refined" | "less" | "retracted";
const KINDS: Kind[] = ["new", "same", "changed", "refined", "less", "retracted"];
const GOLD: Record<Kind, string> = { new: "ADD", same: "NOOP", changed: "UPDATE", refined: "UPDATE", less: "NOOP", retracted: "DELETE" };
interface Msg { key: string; value: string; kind: Kind }
const dialogue = (seed: string): { msgs: Msg[]; final: Record<string, string> } => { const r = rng(seed), mem: Record<string, string> = {}, msgs: Msg[] = []; const keys = ["city", "diet", "pet", "job", "hobby", "car"]; for (const key of keys) { mem[key] = `${key}-a`; msgs.push({ key, value: `${key}-a`, kind: "new" }); } for (let i = 0; i < 12; i++) { const key = keys[Math.floor(r() * keys.length)]!; if (!(key in mem)) continue; const kind = (["same", "changed", "refined", "less", "retracted"] as Kind[])[Math.floor(r() * 5)]!; if (kind === "same") msgs.push({ key, value: mem[key]!, kind }); else if (kind === "changed") { mem[key] = `${key}-${i}`; msgs.push({ key, value: mem[key]!, kind }); } else if (kind === "refined") { mem[key] = `${mem[key]} (more detail)`; msgs.push({ key, value: mem[key]!, kind }); } else if (kind === "less") msgs.push({ key, value: mem[key]!.split(" ")[0]!, kind }); else { delete mem[key]; msgs.push({ key, value: "", kind }); } } return { msgs, final: mem }; };
export const memory: Engine = {
  id: "probe-memory",
  leakTokens: (seed) => dialogue(`${seed}|heldout`).msgs.filter((m) => m.kind === "changed" || m.kind === "refined").map((m) => m.value),
  practice: (seed) => ({ note: "A dialogue states facts about a user. For each kind of message choose one operation: ADD, UPDATE, DELETE or NOOP. Kinds: new, same, changed, refined (the stored value with more information), less (the stored value with less information), retracted.", kinds: KINDS, example: dialogue(`${seed}|practice`).msgs.slice(0, 8) }),
  run(artifact, seed): CourseRun {
    const pol = (artifact as { operations?: Record<string, string> })?.operations;
    if (!pol || typeof pol !== "object") return run(0, 1, {}, ["the artifact is {\"operations\": {\"new\": \"ADD\", \"same\": ..., \"changed\": ..., \"refined\": ..., \"less\": ..., \"retracted\": ...}}"]);
    const { msgs, final } = dialogue(`${seed}|heldout`), mem: Record<string, string> = {};
    for (const m of msgs) { const op = String(pol[m.kind] ?? "NOOP").toUpperCase(); if (op === "ADD") { if (!(m.key in mem)) mem[m.key] = m.value; } else if (op === "UPDATE") mem[m.key] = m.value; else if (op === "DELETE") delete mem[m.key]; }
    const keys = new Set([...Object.keys(final), ...Object.keys(mem)]); let right = 0; for (const k of keys) if (final[k] === mem[k]) right++;
    const share = keys.size ? right / keys.size : 1;
    return { score_permille: Math.round(share * 1000), passed: right === keys.size, measures: { keys_right: right, keys: keys.size }, failures: right === keys.size ? [] : [`${keys.size - right} of ${keys.size} memory keys end wrong`] };
  },
};
register(calibration); register(verification); register(memory);
