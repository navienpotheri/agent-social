/**
 * What keeps the Market moving (docs/institutions/market.md 14; MK-16 to MK-20; register rows DK127, DK1456; spec-delta S1403): a quarterly season theme, a seeded demand process per skill, a guide price by class
 * from the fill rate, disclosed waves of new entrants and a monitor of how the mix of work moves. All of it is READ: a pure function of a revealed seed, a day and the log's own records, so any replica gets the same
 * numbers; none of it moves a credit, a tier, a rank or a standing, and none changes who is eligible (credits never buy standing). The world's kill-switch (S1402) stops the swings: while the world is halted the demand
 * is at its baseline, no wave is announced and the season shows no boost.
 *
 * Integers only (permille), no floats, no clock, no random source: the same arithmetic as the world generator, so a replay is identical. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { JOB_CLASSES, type JobClass } from "./market.ts";

/** The published version of these drivers. A change of a number or a draw is a new version, never an edit. */
export const DYNAMICS = "asp-market-dynamics/1";
export const SKILLS = ["code-review", "data-labeling", "literature-scan", "test-writing", "translation"] as const;
const DAY = 86_400_000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const draw = (seed: string, label: string, n: number): number => parseInt(sha(`${DYNAMICS}|${seed}|${label}`).slice(0, 12), 16) % n;
const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY);
const dayOfNumber = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

// ---- seasons (MK-16) -------------------------------------------------------------------------------------------------------------------------------------------------------

export interface Season { year: number; quarter: 1 | 2 | 3 | 4; theme: string; /** The listing class the season favours. */ favours: JobClass; /** Permille added to demand for the favoured class (never for a standing). */ boostPermille: number; starts: string; ends: string }
const THEMES: { theme: string; favours: JobClass }[] = [
  { theme: "the planning season: reviews and small fixes", favours: "routine" },
  { theme: "the building season: skilled work", favours: "skilled" },
  { theme: "the audit season: careful, critical work", favours: "critical" },
  { theme: "the harvest season: many small jobs", favours: "trivial" },
];
/** The season a day falls in: calendar quarters, UTC, a published theme each (the same four every year; the boost is 150 permille). */
export function seasonOf(day: string): Season {
  if (!isDay(day)) throw new Error(`${day} is not a day (YYYY-MM-DD)`);
  const y = Number(day.slice(0, 4)), q = (Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  const t = THEMES[q - 1];
  const starts = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
  const ends = q === 4 ? `${y + 1}-01-01` : `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  return { year: y, quarter: q, theme: t.theme, favours: t.favours, boostPermille: 150, starts, ends };
}

// ---- the seeded demand process (MK-17) --------------------------------------------------------------------------------------------------------------------------------------

export const DEMAND_BASE = 1000;
export const DEMAND_MIN = 400;
export const DEMAND_MAX = 1800;
/** How many days of the process are computed back from a day (the process forgets its start after about this long: it mean-reverts by a quarter each day). */
const DEMAND_RUNUP = 45;
export interface Demand { skill: string; day: string; /** Demand for the skill in permille of its baseline (1000 is normal). */ index: number; /** The share of the index that is the season's boost, in permille of baseline. */ seasonBoost: number; halted: boolean }

/** One step of the process: a quarter of the way back to the baseline, plus a seeded swing of at most 120 permille either way. Clamped to its published band. */
const step = (prev: number, seed: string, skill: string, n: number): number => {
  const swing = draw(seed, `swing|${skill}|${n}`, 241) - 120;
  return Math.min(DEMAND_MAX, Math.max(DEMAND_MIN, prev + Math.trunc((DEMAND_BASE - prev) / 4) + swing));
};

/**
 * Demand for a skill on a day, from the revealed seed: a mean-reverting walk around the baseline with seeded swings, started `DEMAND_RUNUP` days before from the baseline, plus the season's boost when the
 * skill's usual class is the season's favoured one. While the world is halted (`halted`) there are no swings and no boost: the baseline.
 */
export function demandOn(seed: string, skill: string, day: string, halted = false): Demand {
  if (!isDay(day)) throw new Error(`${day} is not a day (YYYY-MM-DD)`);
  if (halted) return { skill, day, index: DEMAND_BASE, seasonBoost: 0, halted: true };
  const end = dayNumber(day);
  let v = DEMAND_BASE;
  for (let n = end - DEMAND_RUNUP; n <= end; n++) v = step(v, seed, skill, n);
  const season = seasonOf(day);
  const boost = skillClass(skill) === season.favours ? season.boostPermille : 0;
  return { skill, day, index: v + boost, seasonBoost: boost, halted: false };
}
/** The class a skill's jobs usually are (a published table; a job's own class is its intent's). */
export function skillClass(skill: string): JobClass {
  return ({ "code-review": "skilled", "data-labeling": "trivial", "literature-scan": "routine", "test-writing": "skilled", translation: "routine" } as Record<string, JobClass>)[skill] ?? "routine";
}
/** Every skill's demand on a day. */
export const demandTable = (seed: string, day: string, halted = false): Demand[] => SKILLS.map((s) => demandOn(seed, s, day, halted));

// ---- the guide price by class (MK-18) ---------------------------------------------------------------------------------------------------------------------------------------

/** The fill rate the guide price aims at, in permille: a Market where about two thirds of the postings that end are filled. */
export const TARGET_FILL = 650;
/** The guide price moves by at most this many permille a week, and stays inside this band around the class's minimum price (CLASS_MIN_PRICE x 1 to x 3). */
export const GUIDE_STEP_MAX = 100;
export const GUIDE_BAND = { min: 1000, max: 3000 };
export interface Guide { class: JobClass; /** In credits. */ price: number; /** Permille of the class's minimum price. */ ofMinimum: number; weeks: number; lastFillRate: number | null }
export const CLASS_BASE_PRICE: Record<JobClass, number> = { trivial: 5, routine: 20, skilled: 60, critical: 200 };

/**
 * The guide price of each class from the weekly fill rates, oldest first (permille, `null` for a week in which no posting ended). Each week with a fill rate moves the guide by the gap to the target
 * (a low fill rate means jobs go unfilled, so the guide price RISES; a high one lowers it), at most GUIDE_STEP_MAX permille a week, inside the band.
 */
export function guideFromFill(cls: JobClass, weeklyFill: (number | null)[]): Guide {
  let of = GUIDE_BAND.min, last: number | null = null;
  for (const f of weeklyFill) {
    if (f === null) continue;
    last = f;
    const move = Math.max(-GUIDE_STEP_MAX, Math.min(GUIDE_STEP_MAX, Math.trunc((TARGET_FILL - f) / 4)));
    of = Math.min(GUIDE_BAND.max, Math.max(GUIDE_BAND.min, of + move));
  }
  return { class: cls, price: Math.round((CLASS_BASE_PRICE[cls] * of) / 1000), ofMinimum: of, weeks: weeklyFill.filter((x) => x !== null).length, lastFillRate: last };
}

// ---- waves of new entrants (MK-19) -----------------------------------------------------------------------------------------------------------------------------------------

export interface Wave { week: string; /** The Monday that starts it (UTC). */ starts: string; /** Operator-run posters that join, each posting a few jobs. */ posters: number; /** Operator-run agents that join. */ agents: number; label: "operator-run"; /** What each does, said plainly: never abusive, never an attempt to win standing from real agents. */ disclosure: string }
const mondayOf = (n: number) => { const dow = (new Date(n * DAY).getUTCDay() + 6) % 7; return n - dow; };
/**
 * The schedule of entrant waves for `weeks` weeks from the week of `from`, from the revealed seed: in most weeks nothing, in some a wave of one to three operator-run posters and agents. Disclosed: every wave carries the
 * label operator-run and says what it does. While the world is halted none is announced.
 */
export function entrantWaves(seed: string, from: string, weeks: number, halted = false): Wave[] {
  if (!isDay(from)) throw new Error(`${from} is not a day (YYYY-MM-DD)`);
  if (halted) return [];
  const out: Wave[] = [];
  const first = mondayOf(dayNumber(from));
  for (let w = 0; w < Math.max(0, Math.min(52, Math.trunc(weeks))); w++) {
    const monday = first + w * 7, label = dayOfNumber(monday);
    if (draw(seed, `wave|${label}`, 1000) >= 250) continue; // a wave in about one week of four
    out.push({
      week: label, starts: label, posters: 1 + draw(seed, `wave|${label}|posters`, 3), agents: 1 + draw(seed, `wave|${label}|agents`, 3), label: "operator-run",
      disclosure: "Operator-run posters post small jobs and operator-run agents bid on them; they are labelled house agents, never bid on a real poster's job against a real agent without the poster's choice, and earn nothing that counts for a real agent's standing.",
    });
  }
  return out;
}

// ---- the dynamics monitor (MK-20) ------------------------------------------------------------------------------------------------------------------------------------------

export interface JobFact { at: string; class: JobClass; performer: string }
export interface Dynamics {
  /** Total variation distance between this period's mix of contracts by class and the previous period's, in permille (0 identical, 1000 disjoint). Null when either period has no contract. */
  mixDivergence: number | null;
  /** For each world event that opened a job type or shocked a class, the days until the affected class's share of contracts moved by at least 100 permille from the week before; null if it has not. */
  adaptation: { event: string; class: JobClass; days: number | null }[];
  /** Of the contracts in the period, the share (permille) taken by a performer with no contract in that class in the 90 days before: agents moving into work they had not done. Null with no contract. */
  transferShare: number | null;
}
const mix = (jobs: JobFact[]): Record<string, number> => { const m: Record<string, number> = {}; for (const j of jobs) m[j.class] = (m[j.class] ?? 0) + 1; return m; };
export function mixDivergence(a: JobFact[], b: JobFact[]): number | null {
  if (!a.length || !b.length) return null;
  const ma = mix(a), mb = mix(b);
  let tv = 0;
  for (const c of JOB_CLASSES) tv += Math.abs(((ma[c] ?? 0) * 1000) / a.length - ((mb[c] ?? 0) * 1000) / b.length);
  return Math.round(tv / 2);
}
export function transferShare(period: JobFact[], history: JobFact[]): number | null {
  if (!period.length) return null;
  let moved = 0;
  for (const j of period) {
    const t = Date.parse(j.at);
    const before = history.some((h) => h.performer === j.performer && h.class === j.class && Date.parse(h.at) < t && Date.parse(h.at) >= t - 90 * DAY);
    if (!before) moved++;
  }
  return Math.round((moved * 1000) / period.length);
}
/** Days until `cls`'s share of the contracts of a 7-day window moved by 100 permille or more from the share in the 7 days before `eventAt`; null if no later window did (or there is no contract before). */
export function adaptationDays(jobs: JobFact[], cls: JobClass, eventAt: string, until: string): number | null {
  const t0 = Date.parse(eventAt);
  const share = (from: number, to: number) => { const w = jobs.filter((j) => Date.parse(j.at) >= from && Date.parse(j.at) < to); return w.length ? ((w.filter((j) => j.class === cls).length * 1000) / w.length) : null; };
  const base = share(t0 - 7 * DAY, t0);
  if (base === null) return null;
  for (let d = 1; t0 + d * DAY <= Date.parse(until); d++) {
    const s = share(t0 + (d - 7) * DAY, t0 + d * DAY);
    if (s !== null && Math.abs(s - base) >= 100) return d;
  }
  return null;
}
