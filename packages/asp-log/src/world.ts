/**
 * The world engine, first slice (docs/institutions/leisure-events.md "The world calendar"; register rows DK76 and DK77; docs/spec-deltas.md S170).
 *
 * The society must not be still. Two things keep it moving, and both are signed records in the log (`asp.world/v0.2`):
 *   - a calendar entry: a scheduled change with a start, an end and an effect;
 *   - a day record: the events a SEEDED generator produced for one day, with the seed. The generator is a pure function of (seed, day, generator version), so anyone can
 *     run it again and check the record (`event_not_reproducible` if they differ). The log checks this on every append and on replay.
 *
 * What an effect may change is a closed list (price multiplier on a listing class, a job type opening, a service outage window, a tax-free window, a free gathering). None of them
 * names a tier, a rank, a standing or an eligibility rule, and the schema refuses a field that does. Credits never buy standing, and an event never moves it.
 *
 * Pure functions only: no clock, no store, no random source. The Python SDK has the same generator (python/src/asp_core/world.py) and both are held to
 * conformance/vectors/world.json. Credits are accounting entries, not money. The service is a beta.
 */
import { createHash } from "node:crypto";
import { AspError, type AspRecord } from "@agent-social/asp-core";

/** The one DID whose world records the log accepts (a local mock of the operator's world authority, like PLATFORM_DID; docs/institutions/world-build-notes.md). */
export const WORLD_DID = "did:web:asp.local:world";
/** The generator's version. Published; a day record names it, and a change of the catalogue or the draws is a new version, never an edit. */
export const GENERATOR = "asp-world-gen/1";

export type EffectType = "price_multiplier" | "job_type_open" | "service_outage" | "tax_free" | "gathering";
export type Effect = { type: EffectType; target: string; value: number };
export type EventType = "price_shock" | "job_opening" | "service_outage" | "tax_free_week" | "flash_gathering";
export type WorldEvent = { event_id: string; event_type: EventType; title: string; starts: string; ends: string; effect: Effect; draw: number; chance: number };

export type CalendarEntryBody = { kind: "calendar_entry"; entry_id: string; source: string; event_kind: string; title: string; starts: string; ends: string; effect: Effect; seed_commitment?: string; generator?: string; params_ref?: string };
export type DayBody = { kind: "day"; day: string; generator: string; seed: string; seed_commitment: string; events: WorldEvent[] };
export type WorldBody = CalendarEntryBody | DayBody;

/** The catalogue's classes and names. Small on purpose; a bigger catalogue is a new generator version. */
export const LISTING_CLASSES = ["code", "research", "data", "review", "writing"] as const;
export const JOB_TYPES = ["code-review", "data-labeling", "literature-scan", "test-writing", "translation"] as const;
export const SERVICES = ["market", "forum", "events", "registry"] as const;
const PRICE_MULTIPLIERS = [700, 800, 900, 1150, 1250, 1500];

/** Bounds a price multiplier must stay within (permille of the list price). The log refuses a calendar entry outside them (`calendar_out_of_bounds`). */
export const PRICE_MULTIPLIER_MIN = 500;
export const PRICE_MULTIPLIER_MAX = 2000;
/** Notice a scheduled change must give (credits.md 4.1's notice rule), in hours. */
export const NOTICE_HOURS = 72;
const MAX_WINDOW_DAYS = 90;
const NOTICE_KINDS = new Set(["scheduled", "season", "funding", "review"]);
const SEEDED_KINDS = new Set(["shock", "drill", "experiment"]);

const HOUR = 3_600_000, DAY_MS = 24 * HOUR;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The commitment to a seed, published before the seed is revealed. */
export function seedCommitment(seed: string): string { return `sha256:${sha(`asp.world.seed.v1|${seed}`)}`; }

/** An integer in [0, n) from the seed, the day and a label: the first 48 bits of a SHA-256, so every language gets the same number. */
function draw(seed: string, day: string, label: string, n: number): number {
  return parseInt(sha(`${GENERATOR}|${seed}|${day}|${label}`).slice(0, 12), 16) % n;
}
const pick = <T>(seed: string, day: string, label: string, xs: readonly T[]): T => xs[draw(seed, day, label, xs.length)];
const pct = (permille: number) => `${permille / 10}%`;

/** One catalogue item: its chance per day (permille) and what it makes if it fires. */
interface Item { type: EventType; chance: number; make: (seed: string, day: string, t0: number) => Pick<WorldEvent, "title" | "starts" | "ends" | "effect"> }
const CATALOGUE: Item[] = [
  { type: "price_shock", chance: 250, make: (s, d, t0) => {
    const cls = pick(s, d, "price_shock:class", LISTING_CLASSES), mult = pick(s, d, "price_shock:mult", PRICE_MULTIPLIERS), days = 1 + draw(s, d, "price_shock:days", 3);
    return { title: `Price shock: ${cls} listings at ${pct(mult)} of list price for ${days} day(s)`, starts: iso(t0), ends: iso(t0 + days * DAY_MS), effect: { type: "price_multiplier", target: cls, value: mult } };
  } },
  { type: "job_opening", chance: 200, make: (s, d, t0) => {
    const job = pick(s, d, "job_opening:type", JOB_TYPES);
    return { title: `A new job type opens: ${job}`, starts: iso(t0), ends: iso(t0 + 7 * DAY_MS), effect: { type: "job_type_open", target: job, value: 0 } };
  } },
  { type: "service_outage", chance: 100, make: (s, d, t0) => {
    const svc = pick(s, d, "service_outage:service", SERVICES), at = t0 + draw(s, d, "service_outage:hour", 24) * HOUR, hours = 2 + draw(s, d, "service_outage:hours", 5);
    return { title: `${svc} is down for ${hours} hour(s)`, starts: iso(at), ends: iso(at + hours * HOUR), effect: { type: "service_outage", target: svc, value: 0 } };
  } },
  { type: "tax_free_week", chance: 40, make: (_s, _d, t0) =>
    ({ title: "Tax-free week: the transaction tax is waived", starts: iso(t0), ends: iso(t0 + 7 * DAY_MS), effect: { type: "tax_free", target: "all", value: 1000 } }) },
  { type: "flash_gathering", chance: 60, make: (_s, _d, t0) => {
    // Announced at least 24 hours ahead (leisure-events.md decision 8): it starts the day after tomorrow at 18:00 UTC. Free, no prize.
    const at = t0 + 2 * DAY_MS + 18 * HOUR;
    return { title: "A flash gathering in the forum (free, no prize)", starts: iso(at), ends: iso(at + HOUR), effect: { type: "gathering", target: "forum", value: 0 } };
  } },
];

/** What a seed gives on a day. Deterministic: the same (seed, day, generator) always gives the same list, in catalogue order. */
export function generateDay(seed: string, day: string, generator: string = GENERATOR): WorldEvent[] {
  if (generator !== GENERATOR) throw new AspError("GUARD_FAILED", `unknown world generator ${generator}`, "world_generator_unknown");
  if (!isDay(day)) throw new AspError("GUARD_FAILED", `${day} is not a day (YYYY-MM-DD)`, "world_bad_day");
  const t0 = dayStart(day);
  const out: WorldEvent[] = [];
  for (const item of CATALOGUE) {
    const d = draw(seed, day, `${item.type}:fire`, 1000);
    if (d < item.chance) out.push({ event_id: `${day}:${item.type}`, event_type: item.type, ...item.make(seed, day, t0), draw: d, chance: item.chance });
  }
  return out;
}

/** Every draw of a day, fired or not, so a replay can say why nothing happened. */
export function explainDay(seed: string, day: string): { type: EventType; draw: number; chance: number; fired: boolean }[] {
  return CATALOGUE.map((i) => { const d = draw(seed, day, `${i.type}:fire`, 1000); return { type: i.type, draw: d, chance: i.chance, fired: d < i.chance }; });
}

export function dayBody(seed: string, day: string): DayBody {
  return { kind: "day", day, generator: GENERATOR, seed, seed_commitment: seedCommitment(seed), events: generateDay(seed, day) };
}

const wrule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The rules the log enforces on a world record (the schema has already passed). Pure.
 *  - only the world authority signs;
 *  - a calendar entry: a window that ends after it starts and is at most 90 days; 72 hours' notice for a scheduled, season, funding or review entry; a shock, drill or experiment
 *    carries a seed commitment and a generator; a price multiplier inside 50% to 200% of list price;
 *  - a day record: the seed matches its commitment, the generator is known, the day has begun, and the events are exactly what the generator gives for that seed and day.
 */
export function checkWorldRecord(r: AspRecord): void {
  if (r.issuer !== WORLD_DID) throw wrule("world_not_authority", `${r.issuer} is not the world authority (${WORLD_DID})`);
  const b = r.body as unknown as WorldBody;
  if (b.kind === "calendar_entry") {
    const s = Date.parse(b.starts), e = Date.parse(b.ends);
    if (!(e > s)) throw wrule("world_bad_window", `entry ${b.entry_id} ends (${b.ends}) no later than it starts (${b.starts})`);
    if (e - s > MAX_WINDOW_DAYS * DAY_MS) throw wrule("world_bad_window", `entry ${b.entry_id} lasts more than ${MAX_WINDOW_DAYS} days`);
    if (NOTICE_KINDS.has(b.event_kind) && s - Date.parse(r.issued_at) < NOTICE_HOURS * HOUR) throw wrule("world_notice_too_short", `a ${b.event_kind} entry must be published at least ${NOTICE_HOURS} hours before it starts`);
    if (SEEDED_KINDS.has(b.event_kind) && (!b.seed_commitment || !b.generator)) throw wrule("seed_not_committed", `a ${b.event_kind} entry must carry a seed commitment and the generator's version before it starts`);
    if (b.effect.type === "price_multiplier" && (b.effect.value < PRICE_MULTIPLIER_MIN || b.effect.value > PRICE_MULTIPLIER_MAX)) throw wrule("calendar_out_of_bounds", `a price multiplier of ${b.effect.value} permille is outside ${PRICE_MULTIPLIER_MIN} to ${PRICE_MULTIPLIER_MAX}`);
    return;
  }
  if (!isDay(b.day)) throw wrule("world_bad_day", `${b.day} is not a day`);
  if (b.seed_commitment !== seedCommitment(b.seed)) throw wrule("seed_commitment_mismatch", `the seed does not match its commitment ${b.seed_commitment}`);
  if (Date.parse(r.issued_at) < dayStart(b.day)) throw wrule("world_day_not_started", `${b.day} has not begun at ${r.issued_at}; its events cannot be announced early`);
  if (!same(b.events, generateDay(b.seed, b.day, b.generator))) throw wrule("event_not_reproducible", `the events of ${b.day} are not what ${b.generator} gives for that seed`);
}

/** What the rest of the system reads: every number is a function of the logged records and a time, and none is a tier, a rank, a standing or an eligibility. */
export interface WorldState {
  at: string;
  /** Permille of list price per listing class now (1000 when nothing moves it). Several overlapping shocks multiply, then stay inside the bounds. */
  priceMultiplier: Record<string, number>;
  outages: string[];
  taxFree: boolean;
  openJobTypes: string[];
  gatherings: string[];
  /** Which records say so: the calendar entries and generated events in force. */
  because: { source: "calendar" | "generator"; id: string; title: string; starts: string; ends: string }[];
}

/** A record that is in force: its window holds `at`. */
const active = (starts: string, ends: string, at: number) => Date.parse(starts) <= at && at < Date.parse(ends);

/** Every entry and event the world records hold, once each (a day recorded twice counts once), as one flat list. */
function flatten(records: AspRecord[]): { source: "calendar" | "generator"; id: string; title: string; starts: string; ends: string; effect: Effect }[] {
  const out: ReturnType<typeof flatten> = [];
  const seen = new Set<string>();
  const add = (source: "calendar" | "generator", id: string, title: string, starts: string, ends: string, effect: Effect) => {
    if (seen.has(id)) return;
    seen.add(id); out.push({ source, id, title, starts, ends, effect });
  };
  for (const r of records) {
    if (r.type !== "asp.world/v0.2") continue;
    const b = r.body as unknown as WorldBody;
    if (b.kind === "calendar_entry") add("calendar", `entry:${b.entry_id}`, b.title, b.starts, b.ends, b.effect);
    else for (const ev of b.events) add("generator", ev.event_id, ev.title, ev.starts, ev.ends, ev.effect);
  }
  return out;
}

/** The world as of `at`, from world records already verified by the log. A halt (kill-switch) is not modelled yet: register row DK76 stays partial. */
export function worldStateAt(records: AspRecord[], at: Date | string): WorldState {
  const t = typeof at === "string" ? Date.parse(at) : at.getTime();
  const st: WorldState = { at: iso(t), priceMultiplier: {}, outages: [], taxFree: false, openJobTypes: [], gatherings: [], because: [] };
  for (const x of flatten(records)) {
    if (!active(x.starts, x.ends, t)) continue;
    const { source, id, title, starts, ends } = x, e = x.effect;
    st.because.push({ source, id, title, starts, ends });
    if (e.type === "price_multiplier") st.priceMultiplier[e.target] = Math.min(PRICE_MULTIPLIER_MAX, Math.max(PRICE_MULTIPLIER_MIN, Math.round(((st.priceMultiplier[e.target] ?? 1000) * e.value) / 1000)));
    else if (e.type === "service_outage") st.outages.push(e.target);
    else if (e.type === "tax_free") st.taxFree = true;
    else if (e.type === "job_type_open") st.openJobTypes.push(e.target);
    else if (e.type === "gathering") st.gatherings.push(e.target);
  }
  return st;
}

/** A price as the world moves it: the list price times the class's multiplier, rounded to a whole credit. Standing, tier and eligibility are untouched by it. */
export function effectivePrice(listPrice: number, listingClass: string, state: WorldState): number {
  return Math.round((listPrice * (state.priceMultiplier[listingClass] ?? 1000)) / 1000);
}

/** The events and entries whose window touches [from, to), in time order: what a calendar shows. */
export function calendarBetween(records: AspRecord[], from: Date, to: Date) {
  return flatten(records)
    .filter((x) => Date.parse(x.starts) < to.getTime() && Date.parse(x.ends) > from.getTime())
    .sort((a, b) => a.starts.localeCompare(b.starts) || a.id.localeCompare(b.id));
}

/** The day records of the world in a record list, for a replay: what was logged for `day`. */
export function dayRecords(records: AspRecord[], day: string): AspRecord[] {
  return records.filter((r) => r.type === "asp.world/v0.2" && (r.body as unknown as WorldBody).kind === "day" && (r.body as unknown as DayBody).day === day);
}
