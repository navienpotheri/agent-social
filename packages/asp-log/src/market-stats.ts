/**
 * The Market's statistics and monthly report (docs/institutions/market.md 7, 8, MK-9 and MK-12; register rows DK126 and DK1453).
 *
 * Pure: the figures are computed from the log's records (and the posting states the log keeps beside them), so any replica gives the same numbers. Nothing here changes a record, a tier or a rank.
 * `GET /market/stats` is the whole-log view at a time; the monthly report is the same figures for the postings made in one calendar month, with the assignments by rule, the class checks and the removals.
 * Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { jobNeeds } from "./market-rules.ts";
import { JOB_CLASSES, type JobClass } from "./market.ts";

export interface ClassFigures { count: number; medianPrice: number | null }
export interface MarketStats {
  /** The time the figures were read at. */
  at: string;
  /** The month the report covers (YYYY-MM), or null for the whole log. */
  month: string | null;
  postings: { total: number; open: number; filled: number; assigned: number; withdrawn: number; removed: number; held: number; expired: number };
  /** Filled / (filled + withdrawn + removed + expired): the share of postings that ended in a contract. Null while none has ended. */
  fillRate: number | null;
  /** Open postings now by class, with the median budget of the open ones. */
  openByClass: Record<string, { count: number; medianBudget: number | null }>;
  /** Contracts formed in the period by the class of the job, with the median price. */
  jobsByClass: Record<string, ClassFigures>;
  /** Settlements that paid for work (accepted, silence or ruling) in the period, and how many of them counted for the performer's standing. `shareCounted` is null with no settlements. */
  settled: { count: number; counted: number; shareCounted: number | null; byBasis: Record<string, number> };
  assignmentsByRule: Record<string, number>;
  /** Class checks that raised a class, and postings reported (market.md 8: flags raised). */
  classChecks: { raised: number; confirmed: number };
}

const inMonth = (iso: string, month: string | null) => month === null || iso.slice(0, 7) === month;
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

export interface StatsInput {
  records: AspRecord[];
  /** The log's state of each posting that is not open: withdrawn, removed or held (market-rules `posting_state`). */
  postingStates: Record<string, string>;
  /** The contracts whose settlement the log counted for the performer's standing (from the qualifying feeds). */
  countedContracts: Set<string>;
}

export function computeMarketStats(input: StatsInput, at: string, month: string | null = null): MarketStats {
  const { records, postingStates } = input;
  const byId = new Map(records.map((r) => [r.id, r]));
  const raised = new Map<string, JobClass>();
  const postings: AspRecord[] = [];
  const stateOf = new Map<string, string>();
  const assignmentsByRule: Record<string, number> = {};
  const classChecks = { raised: 0, confirmed: 0 };
  for (const r of records) {
    if (r.type !== "asp.market_act/v0.2") continue;
    const b = r.body as Record<string, any>;
    if (b.act === "posting") { postings.push(r); stateOf.set(r.id, "open"); }
    else if (b.act === "withdraw") stateOf.set(b.posting, "withdrawn");
    else if (b.act === "assignment") { stateOf.set(b.posting, "assigned"); if (inMonth(r.issued_at, month)) assignmentsByRule[b.rule] = (assignmentsByRule[b.rule] ?? 0) + 1; }
    else if (b.act === "class_check") {
      if (b.verdict === "changed_to") { raised.set(b.intent, b.class); if (inMonth(r.issued_at, month)) classChecks.raised++; }
      else if (inMonth(r.issued_at, month)) classChecks.confirmed++;
    }
  }
  const intentOf = (contract: AspRecord): string | undefined => (contract.body as { basis?: { intent?: string } }).basis?.intent;
  const postingForIntent = new Map<string, string>();
  for (const p of postings) postingForIntent.set((p.body as { intent: string }).intent, p.id);
  const jobsByClass = new Map<JobClass, number[]>();
  for (const r of records) {
    if (r.type !== "asp.contract/v0.2") continue;
    const intent = intentOf(r);
    const posting = intent ? postingForIntent.get(intent) : undefined;
    if (posting && stateOf.get(posting) !== "withdrawn") stateOf.set(posting, "filled");
    if (!inMonth(r.issued_at, month)) continue;
    const intentRec = intent ? byId.get(intent) : undefined;
    const cls = intentRec ? jobNeeds(intentRec, raised.get(intent!)).class : "routine";
    jobsByClass.set(cls, [...(jobsByClass.get(cls) ?? []), (r.body as { price: { value: number } }).price.value]);
  }
  const p = { total: 0, open: 0, filled: 0, assigned: 0, withdrawn: 0, removed: 0, held: 0, expired: 0 };
  const openByClass = new Map<JobClass, number[]>();
  for (const post of postings) {
    if (!inMonth(post.issued_at, month)) continue;
    p.total++;
    const pb = post.body as { intent: string; expires: string };
    const forced = postingStates[post.id]; // removed or held by the Market: not shown on the board
    let st = stateOf.get(post.id) ?? "open";
    if (forced === "removed" || forced === "held") st = forced;
    if (st === "open" && Date.parse(pb.expires) <= Date.parse(at)) st = "expired";
    p[st as keyof typeof p]++;
    if (st === "open") {
      const intent = byId.get(pb.intent);
      if (intent) { const n = jobNeeds(intent, raised.get(pb.intent)); openByClass.set(n.class, [...(openByClass.get(n.class) ?? []), n.budget]); }
    }
  }
  const ended = p.filled + p.withdrawn + p.removed + p.expired;
  const settledBases = new Set(["accepted", "silence", "ruling"]);
  const settled = { count: 0, counted: 0, shareCounted: null as number | null, byBasis: {} as Record<string, number> };
  for (const r of records) {
    if (r.type !== "asp.settlement/v0.2" || !inMonth(r.issued_at, month)) continue;
    const b = r.body as { basis: string; contract: string };
    settled.byBasis[b.basis] = (settled.byBasis[b.basis] ?? 0) + 1;
    if (settledBases.has(b.basis)) { settled.count++; if (input.countedContracts.has(b.contract)) settled.counted++; }
  }
  if (settled.count) settled.shareCounted = Math.round((settled.counted * 1000) / settled.count) / 1000;
  const cls = (m: Map<JobClass, number[]>) => Object.fromEntries(JOB_CLASSES.filter((c) => m.has(c)).map((c) => [c, m.get(c)!]));
  return {
    at, month, postings: p,
    fillRate: ended ? Math.round((p.filled * 1000) / ended) / 1000 : null,
    openByClass: Object.fromEntries(Object.entries(cls(openByClass)).map(([c, xs]) => [c, { count: xs.length, medianBudget: median(xs) }])),
    jobsByClass: Object.fromEntries(Object.entries(cls(jobsByClass)).map(([c, xs]) => [c, { count: xs.length, medianPrice: median(xs) }])),
    settled, assignmentsByRule, classChecks,
  };
}

/**
 * The fill rate of each class by week (market.md 14.3, MK-18): for each Monday-started UTC week, the postings of the class that ended in it (filled by a contract, withdrawn, removed or expired) and the share that were filled,
 * in permille. Oldest week first; a week with no ending posting is not listed. Computed from the records and the posting states, so any replica gets the same series.
 */
export function weeklyFillByClass(input: StatsInput, at: string): Record<string, { week: string; ended: number; filled: number; fillRate: number | null }[]> {
  const { records, postingStates } = input;
  const byId = new Map(records.map((r) => [r.id, r]));
  const raised = new Map<string, JobClass>();
  const postings: AspRecord[] = [];
  const endedAt = new Map<string, { at: number; filled: boolean }>();
  for (const r of records) {
    if (r.type !== "asp.market_act/v0.2") continue;
    const b = r.body as Record<string, any>;
    if (b.act === "posting") postings.push(r);
    else if (b.act === "class_check" && b.verdict === "changed_to") raised.set(b.intent, b.class);
    else if (b.act === "withdraw" && !endedAt.has(b.posting)) endedAt.set(b.posting, { at: Date.parse(r.issued_at), filled: false });
  }
  const postingForIntent = new Map<string, string>();
  for (const p of postings) postingForIntent.set((p.body as { intent: string }).intent, p.id);
  for (const r of records) {
    if (r.type !== "asp.contract/v0.2") continue;
    const intent = (r.body as { basis?: { intent?: string } }).basis?.intent;
    const posting = intent ? postingForIntent.get(intent) : undefined;
    if (posting && !endedAt.has(posting)) endedAt.set(posting, { at: Date.parse(r.issued_at), filled: true });
  }
  const DAYMS = 86_400_000, now = Date.parse(at);
  const weekOf = (t: number) => { const d = Math.floor(t / DAYMS); const monday = d - ((new Date(d * DAYMS).getUTCDay() + 6) % 7); return new Date(monday * DAYMS).toISOString().slice(0, 10); };
  const acc = new Map<string, Map<string, { ended: number; filled: number }>>();
  for (const p of postings) {
    const pb = p.body as { intent: string; expires: string };
    const intent = byId.get(pb.intent);
    if (!intent) continue;
    const cls = jobNeeds(intent, raised.get(pb.intent)).class;
    let end = endedAt.get(p.id);
    if (!end && (postingStates[p.id] === "removed" || postingStates[p.id] === "held")) end = { at: Date.parse(p.issued_at), filled: false };
    if (!end && Date.parse(pb.expires) <= now) end = { at: Date.parse(pb.expires), filled: false };
    if (!end) continue;
    const wk = weekOf(end.at);
    const m = acc.get(cls) ?? new Map();
    const w = m.get(wk) ?? { ended: 0, filled: 0 };
    w.ended++; if (end.filled) w.filled++;
    m.set(wk, w); acc.set(cls, m);
  }
  const out: Record<string, { week: string; ended: number; filled: number; fillRate: number | null }[]> = {};
  for (const [cls, m] of acc) out[cls] = [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, ended: w.ended, filled: w.filled, fillRate: w.ended ? Math.round((w.filled * 1000) / w.ended) : null }));
  return out;
}
