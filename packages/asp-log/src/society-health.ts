/**
 * Society health: does the society stay non-stationary, and do agents adapt to change (register row DK77; owner principle 2026-11-12). Pure functions over a list of finished jobs and
 * a list of world events, so the same code runs on a simulated society in tests and on the records a log holds (`activityFromRecords`).
 *
 * Measures, per period (a day by default): job-mix drift (the total variation distance between this period's mix of job kinds and the one before, 0 to 1), price-level movement (the change
 * of the median price against the period before, as a fraction), event frequency (events a period), behaviour change after an event (mix and price shift in the periods after, against the
 * periods before) and adaptation time per agent (periods from an event to the agent's first job of a kind it had not done in the periods before). Two alarms: QUIET (activity below a floor
 * for a stated number of periods in a row) and TOO FAST (mix drift or price movement above a ceiling for a stated number of periods in a row, so nobody can learn from it); and a third,
 * FROZEN (activity above the floor, yet neither mix nor price has moved for a stated number of periods: a society that has stopped changing is not non-stationary).
 * A measure only reads and reports; it never changes a balance, a tier, a rank or a record. Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { calendarBetween } from "./world.ts";
import { effectiveClass, higherClass, type JobClass } from "./market.ts";

export interface Activity { at: number; agent: string; kind: string; price: number }
export interface HealthEvent { at: number; type: string; title?: string }

export interface HealthOptions {
  /** Period length in ms. Default one day. */
  periodMs?: number;
  /** The first period starts here and the last one ends at `until` (both ms). Default: the start of the period of the first activity, and the last activity. */
  from?: number;
  until?: number;
  /** Fewer jobs than this in a period is quiet. Default 3. */
  quietFloor?: number;
  /** Consecutive quiet periods (ending at the last period) that raise QUIET. Default 3. */
  quietPeriods?: number;
  /** Mix drift above this (0 to 1) is fast. Default 0.5. */
  fastMix?: number;
  /** Price movement above this fraction is fast. Default 0.5. */
  fastPrice?: number;
  /** Consecutive fast periods that raise TOO_FAST. Default 3. */
  fastPeriods?: number;
  /** Mix drift and price movement both below these count as no change. Defaults 0.02 and 0.01. */
  frozenMix?: number;
  frozenPrice?: number;
  /** Consecutive unchanged, busy periods that raise FROZEN. Default 7. */
  frozenPeriods?: number;
  /** Periods looked at each side of an event. Default 2. */
  eventWindow?: number;
}

export interface PeriodStat { index: number; start: string; jobs: number; agents: number; medianPrice: number | null; mixDrift: number | null; priceMovement: number | null }
export interface EventEffect { type: string; at: string; period: number; mixShift: number | null; priceShift: number | null }
export interface Adaptation { agent: string; event: string; periods: number | null }
export interface HealthAlarm { id: "QUIET" | "TOO_FAST" | "FROZEN"; since: string; periods: number; says: string }
export interface HealthReport {
  periodMs: number;
  periods: PeriodStat[];
  jobs: number;
  events: number;
  eventsPerPeriod: number;
  afterEvents: EventEffect[];
  adaptation: Adaptation[];
  /** Agents that did a new kind of job after an event, as a share of the agents active before it; null when no event had agents before it. */
  adaptedShare: number | null;
  alarms: HealthAlarm[];
}

const DAY = 86_400_000;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mixOf = (rows: Activity[]) => { const m = new Map<string, number>(); for (const r of rows) m.set(r.kind, (m.get(r.kind) ?? 0) + 1); return m; };
function tv(a: Map<string, number>, b: Map<string, number>): number {
  const na = [...a.values()].reduce((x, y) => x + y, 0), nb = [...b.values()].reduce((x, y) => x + y, 0);
  if (!na || !nb) return 0;
  let d = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) d += Math.abs((a.get(k) ?? 0) / na - (b.get(k) ?? 0) / nb);
  return d / 2;
}
const iso = (ms: number) => new Date(ms).toISOString();

export function societyHealth(activity: Activity[], events: HealthEvent[] = [], opts: HealthOptions = {}): HealthReport {
  const periodMs = opts.periodMs ?? DAY;
  const quietFloor = opts.quietFloor ?? 3, quietPeriods = opts.quietPeriods ?? 3;
  const fastMix = opts.fastMix ?? 0.5, fastPrice = opts.fastPrice ?? 0.5, fastPeriods = opts.fastPeriods ?? 3;
  const frozenMix = opts.frozenMix ?? 0.02, frozenPrice = opts.frozenPrice ?? 0.01, frozenPeriods = opts.frozenPeriods ?? 7;
  const win = opts.eventWindow ?? 2;
  const rows = [...activity].sort((a, b) => a.at - b.at);
  const from = opts.from ?? Math.floor((rows[0]?.at ?? 0) / periodMs) * periodMs;
  const until = opts.until ?? rows.at(-1)?.at ?? from;
  const n = rows.length || opts.from !== undefined ? Math.max(1, Math.ceil((until - from + 1) / periodMs)) : 0;
  const by: Activity[][] = Array.from({ length: n }, () => []);
  for (const r of rows) { const i = Math.floor((r.at - from) / periodMs); if (i >= 0 && i < n) by[i].push(r); }
  const mixes = by.map(mixOf), med = by.map((p) => median(p.map((r) => r.price)));
  const periods: PeriodStat[] = by.map((p, i) => {
    const prevHas = i > 0 && by[i - 1].length > 0 && p.length > 0;
    return {
      index: i, start: iso(from + i * periodMs), jobs: p.length, agents: new Set(p.map((r) => r.agent)).size, medianPrice: med[i],
      mixDrift: prevHas ? tv(mixes[i - 1], mixes[i]) : null,
      priceMovement: prevHas && med[i - 1]! > 0 ? Math.abs(med[i]! - med[i - 1]!) / med[i - 1]! : null,
    };
  });

  const inWindow = events.filter((e) => e.at >= from && e.at <= from + n * periodMs).sort((a, b) => a.at - b.at);
  const range = (a: number, b: number) => by.slice(Math.max(0, a), Math.max(0, b)).flat();
  const afterEvents: EventEffect[] = inWindow.map((e) => {
    const p = Math.floor((e.at - from) / periodMs);
    const before = range(p - win, p), after = range(p + 1, p + 1 + win);
    const mb = median(before.map((r) => r.price)), ma = median(after.map((r) => r.price));
    return { type: e.type, at: iso(e.at), period: p, mixShift: before.length && after.length ? tv(mixOf(before), mixOf(after)) : null, priceShift: mb && ma !== null ? (ma - mb) / mb : null };
  });

  // Adaptation: periods from the event to the agent's first job of a kind it had not done in the `win`+... periods before it (all earlier periods: what it had been doing).
  const adaptation: Adaptation[] = [];
  let before = 0, adapted = 0;
  for (const e of inWindow) {
    const p = Math.floor((e.at - from) / periodMs);
    const prior = new Map<string, Set<string>>();
    for (const r of range(0, p + 1)) { if (r.at > e.at) continue; (prior.get(r.agent) ?? prior.set(r.agent, new Set()).get(r.agent)!).add(r.kind); }
    const later = rows.filter((r) => r.at > e.at);
    for (const [agent, kinds] of prior) {
      const first = later.find((r) => r.agent === agent && !kinds.has(r.kind));
      adaptation.push({ agent, event: e.type, periods: first ? Math.max(0, Math.floor((first.at - from) / periodMs) - p) : null });
      before++; if (first) adapted++;
    }
  }

  // Alarms, judged over the run of periods that ends at the last period.
  const alarms: HealthAlarm[] = [];
  const tail = (pred: (i: number) => boolean) => { let k = 0; while (k < n && pred(n - 1 - k)) k++; return k; };
  const quiet = tail((i) => periods[i].jobs < quietFloor);
  if (quiet >= quietPeriods) alarms.push({ id: "QUIET", since: periods[n - quiet].start, periods: quiet, says: `fewer than ${quietFloor} jobs a period for ${quiet} periods in a row` });
  const fast = tail((i) => (periods[i].mixDrift ?? 0) > fastMix || (periods[i].priceMovement ?? 0) > fastPrice);
  if (fast >= fastPeriods) alarms.push({ id: "TOO_FAST", since: periods[n - fast].start, periods: fast, says: `the job mix or the price level moved more than the ceiling for ${fast} periods in a row, faster than agents can learn from` });
  const frozen = tail((i) => periods[i].jobs >= quietFloor && periods[i].mixDrift !== null && periods[i].mixDrift! <= frozenMix && (periods[i].priceMovement ?? 0) <= frozenPrice);
  if (frozen >= frozenPeriods) alarms.push({ id: "FROZEN", since: periods[n - frozen].start, periods: frozen, says: `busy but unchanged for ${frozen} periods: neither the job mix nor the price level moved` });

  return { periodMs, periods, jobs: rows.length, events: inWindow.length, eventsPerPeriod: n ? inWindow.length / n : 0, afterEvents, adaptation, adaptedShare: before ? adapted / before : null, alarms };
}

/** Finished jobs and world events from the records a log holds: an accepted settlement joined to its contract (the performer, the price in credits, and the listing class as the job's kind, the verification mode when the intent is not in the log). */
export function activityFromRecords(records: { id?: string; record?: AspRecord }[] | AspRecord[]): { activity: Activity[]; events: HealthEvent[]; recordsList: AspRecord[] } {
  const recs: (AspRecord & { id?: string })[] = (records as any[]).map((x) => (x.record ? { ...x.record, id: x.id ?? x.record.id } : x));
  const contracts = new Map<string, AspRecord>();
  for (const r of recs) if (r.type === "asp.contract/v0.2" && r.id) contracts.set(r.id, r);
  // A job's kind is its listing class (DK142): the contract's basis names the intent, the intent states a class (routine when none), the Market may have raised it (a class_check, never lowered), and the
  // price caps it as the standing rule does. A contract with no intent in the log (an older job) keeps the verification mode as its kind.
  const intents = new Map<string, AspRecord>();
  const raised = new Map<string, JobClass>();
  for (const r of recs) {
    if (r.type === "asp.intent/v0.2" && r.id) intents.set(r.id, r);
    if (r.type === "asp.market_act/v0.2") { const m = r.body as { act?: string; verdict?: string; intent?: string; class?: JobClass }; if (m.act === "class_check" && m.verdict === "changed_to" && m.intent && m.class) raised.set(m.intent, raised.has(m.intent) ? higherClass(raised.get(m.intent)!, m.class) : m.class); }
  }
  // House agents (DK291) are the operator's scripted agents: their jobs are not real cohort data, so they are left out of the figure.
  const house = new Set<string>();
  for (const r of recs) if (r.type === "asp.passport/v0.2" && (r.body as { house?: boolean }).house) house.add((r.body as { did: string }).did);
  const activity: Activity[] = [];
  for (const r of recs) {
    if (r.type !== "asp.settlement/v0.2") continue;
    const b = r.body as { contract?: string; basis?: string };
    if (b.basis !== "accepted" || !b.contract) continue;
    const c = contracts.get(b.contract);
    if (!c) continue;
    const cb = c.body as { performer?: string; price?: { value?: number } | number; verification?: { mode?: string } | string };
    const price = typeof cb.price === "number" ? cb.price : Number(cb.price?.value ?? 0);
    const verification = typeof cb.verification === "string" ? cb.verification : cb.verification?.mode ?? "job";
    const intentId = (c.body as { basis?: { intent?: string } }).basis?.intent;
    const intent = intentId ? intents.get(intentId) : undefined;
    const declared = intent ? ((intent.body as { class?: JobClass }).class ?? "routine") : undefined;
    const kind = declared ? effectiveClass(raised.has(intentId!) ? higherClass(raised.get(intentId!)!, declared) : declared, price) : verification;
    if (house.has(String(cb.performer ?? r.issuer))) continue;
    activity.push({ at: Date.parse(r.issued_at), agent: String(cb.performer ?? r.issuer), kind, price });
  }
  const first = Math.min(...recs.map((r) => Date.parse(r.issued_at)).filter(Number.isFinite), Date.now());
  const events = calendarBetween(recs as AspRecord[], new Date(first - DAY), new Date(Date.now() + DAY)).map((x) => ({ at: Date.parse(x.starts), type: x.id.startsWith("entry:") ? "calendar" : x.effect.type, title: x.title }));
  return { activity, events, recordsList: recs as AspRecord[] };
}

/** The monthly figure, as text: what a person reads. Every number is counted from the activity given. */
export function healthFigure(r: HealthReport, label = "this period"): string {
  const drift = r.periods.map((p) => p.mixDrift).filter((x): x is number => x !== null);
  const mv = r.periods.map((p) => p.priceMovement).filter((x): x is number => x !== null);
  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : "n/a");
  const lines = [
    `Society health, ${label}: ${r.jobs} finished job(s) over ${r.periods.length} period(s), ${r.events} event(s) (${r.eventsPerPeriod.toFixed(2)} a period).`,
    `  job-mix drift ${avg(drift)} a period on average, price movement ${avg(mv)}; agents that did a new kind of job after an event: ${r.adaptedShare === null ? "n/a" : `${Math.round(r.adaptedShare * 100)}%`}.`,
    ...(r.alarms.length ? r.alarms.map((a) => `  ALARM ${a.id} since ${a.since.slice(0, 10)}: ${a.says}`) : ["  No alarm: the society is neither quiet, frozen nor changing too fast to learn from."]),
  ];
  return lines.join("\n");
}
