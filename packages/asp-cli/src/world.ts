/**
 * `asp world today|calendar|replay <date>` (and `tick`, `schedule`, which write): the world calendar and the seeded event generator that keep the society non-stationary
 * (register rows DK76 and DK77; docs/spec-deltas.md S170; docs/institutions/world-build-notes.md).
 *
 * The reads work on a local log and, through the service's read-only `worldRecords` call, on a hosted one. The writes sign with the world authority's key, kept in
 * `<home>/world-authority.json` (a local mock of the operator's key: the hosted service's world authority is not set up yet, docs/gaps-register.md DK76). Every number
 * printed is counted from the logged records; every event says why it fired. Credits are accounting entries, not money. An event never changes a tier, a rank or a standing.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { b64urlDecode, b64urlEncode, createRecord, publicKeyFromSeed, randomSeed, signerFromSeed, type AspRecord, type Signer } from "@agent-social/asp-core";
import {
  GENERATOR, WORLD_DID, calendarBetween, dayBody, dayOf, dayRecords, dayStart, explainDay, generateDay, isDay, seedCommitment, worldStateAt,
  type CalendarEntryBody, type DayBody, type Effect, type EffectType, type WorldEvent,
} from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export interface WorldIo { out: (l: string) => void }
export interface WorldOpts {
  home: string;
  log: LogHandle;
  io: WorldIo;
  /** The clock records are stamped with. */
  now: () => string;
  flags: { day?: string; days?: string; seed?: string; json?: boolean; title?: string; kind?: string; from?: string; to?: string; target?: string; effect?: string; value?: string };
}
class WorldUsage extends Error {}
export { WorldUsage };

const EFFECTS: EffectType[] = ["price_multiplier", "job_type_open", "service_outage", "tax_free", "gathering"];

interface Authority { kid: string; seed: string }
function authorityFile(home: string) { return join(home, "world-authority.json"); }
function worldFile(home: string) { return join(home, "world.json"); }

/** The world authority's signer; made on first use. A fresh random key per home, never printed. */
function authority(home: string): Signer & { publicKey: Uint8Array } {
  const file = authorityFile(home);
  let a: Authority;
  if (existsSync(file)) a = JSON.parse(readFileSync(file, "utf8")) as Authority;
  else {
    a = { kid: `${WORLD_DID}#key-1`, seed: b64urlEncode(randomSeed()) };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(a), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* not on every platform */ }
  }
  return signerFromSeed(a.kid, b64urlDecode(a.seed));
}

/** The seed the generator runs on: the one the operator set (`--seed`), else the one this home already has, else a new random one. Kept in `<home>/world.json`. */
function seedOf(home: string, flag: string | undefined, create: boolean): string | undefined {
  const file = worldFile(home);
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { seed: string }).seed : undefined;
  if (flag !== undefined) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(flag)) throw new WorldUsage("--seed is 1 to 64 letters, digits, dots, dashes or underscores");
    if (saved !== undefined && saved !== flag) throw new WorldUsage(`this home already runs on a seed (${seedCommitment(saved).slice(0, 19)}...); a world has one seed. Use another --home for another world`);
    if (saved === undefined) writeFileSync(file, JSON.stringify({ seed: flag, commitment: seedCommitment(flag), generator: GENERATOR }, null, 2));
    return flag;
  }
  if (saved !== undefined || !create) return saved;
  const fresh = b64urlEncode(randomSeed()).slice(0, 22);
  writeFileSync(file, JSON.stringify({ seed: fresh, commitment: seedCommitment(fresh), generator: GENERATOR }, null, 2));
  return fresh;
}

const dayArg = (flags: WorldOpts["flags"], rest: string[], now: string) => {
  const d = rest[0] ?? flags.day ?? dayOf(Date.parse(now));
  if (!isDay(d)) throw new WorldUsage(`${d} is not a day: use YYYY-MM-DD`);
  return d;
};
const hhmm = (iso: string) => iso.slice(11, 16);
const when = (e: { starts: string; ends: string }) => (e.starts.slice(0, 10) === e.ends.slice(0, 10) ? `${e.starts.slice(0, 10)} ${hhmm(e.starts)} to ${hhmm(e.ends)}Z` : `${e.starts.slice(0, 16)}Z to ${e.ends.slice(0, 16)}Z`);

function whyLine(e: WorldEvent, seed: string, generator: string): string {
  return `why: the ${e.event_type} draw for ${e.event_id.slice(0, 10)} was ${e.draw} of 1000, below its chance of ${e.chance}, on seed ${seedCommitment(seed).slice(7, 19)}... (${generator})`;
}
const describe = (e: Effect) => e.type === "price_multiplier" ? `price of ${e.target} listings x${e.value / 1000}` : e.type === "job_type_open" ? `job type ${e.target} open` : e.type === "service_outage" ? `${e.target} is down` : e.type === "tax_free" ? "transaction tax waived" : `free gathering in the ${e.target}`;

async function records(o: WorldOpts): Promise<AspRecord[]> { return (await o.log.log.worldRecords()) as AspRecord[]; }

export async function worldCmd(sub: string | undefined, rest: string[], o: WorldOpts): Promise<number> {
  if (sub === "today" || sub === undefined) return today(rest, o);
  if (sub === "calendar") return calendar(o);
  if (sub === "replay") return replay(rest, o);
  if (sub === "tick") return tick(rest, o);
  if (sub === "schedule") return schedule(o);
  throw new WorldUsage(`asp world today | calendar | replay <date> | tick | schedule (not ${sub})`);
}

async function today(rest: string[], o: WorldOpts): Promise<number> {
  const now = o.now(), recs = await records(o), day = dayArg(o.flags, rest, now);
  const at = rest[0] || o.flags.day ? `${day}T12:00:00Z` : now;
  const st = worldStateAt(recs, at);
  const logged = dayRecords(recs, day);
  if (o.flags.json) { o.io.out(JSON.stringify({ day, at, state: st, recorded: logged.map((r) => ({ id: r.id, ...(r.body as object) })) }, null, 2)); return 0; }
  o.io.out(`World on ${day} (UTC), as of ${at.slice(0, 16)}Z   (credits are accounting entries, not money)`);
  if (!st.because.length) o.io.out("  Nothing is changing right now.");
  for (const b of st.because) {
    const ev = recs.flatMap((r) => ((r.body as unknown as DayBody).events ?? []).map((e) => ({ r, e }))).find((x) => x.e.event_id === b.id);
    const eff = ev?.e.effect ?? (recs.map((r) => r.body as unknown as CalendarEntryBody).find((c) => `entry:${c.entry_id}` === b.id)?.effect as Effect);
    o.io.out(`  - ${b.title}`);
    o.io.out(`      ${describe(eff)}; ${when(b)}; from ${b.source === "calendar" ? "the calendar" : "the generator"} (${b.id})`);
    if (ev) { const body = ev.r.body as unknown as DayBody; o.io.out(`      ${whyLine(ev.e, body.seed, body.generator)}`); }
  }
  const price = Object.entries(st.priceMultiplier).map(([c, m]) => `${c} x${m / 1000}`).join(", ");
  o.io.out(`  prices: ${price || "at list"};  tax: ${st.taxFree ? "waived" : "normal"};  down: ${st.outages.join(", ") || "nothing"};  job types opened by events: ${st.openJobTypes.join(", ") || "none"}`);
  o.io.out(logged.length ? `Day record for ${day}: ${logged.length} (${logged.map((r) => r.id.slice(0, 19)).join(", ")}), ${(logged[0].body as unknown as DayBody).events.length} event(s).` : `No day record for ${day} yet (asp world tick writes it).`);
  o.io.out("Events change prices, work and service windows. They never change a tier, a rank, a standing or who is eligible.");
  return 0;
}

async function calendar(o: WorldOpts): Promise<number> {
  const now = o.now(), days = Math.max(1, Math.min(120, Math.trunc(Number(o.flags.days ?? 14)) || 14));
  const from = new Date(o.flags.from ?? `${dayOf(Date.parse(now))}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) throw new WorldUsage(`--from ${o.flags.from} is not a time`);
  const to = new Date(from.getTime() + days * 86_400_000);
  const items = calendarBetween(await records(o), from, to);
  if (o.flags.json) { o.io.out(JSON.stringify(items, null, 2)); return 0; }
  o.io.out(`World calendar, ${dayOf(from.getTime())} to ${dayOf(to.getTime())} (${items.length} item(s); only what the log holds)`);
  for (const i of items) o.io.out(`  ${i.starts.slice(0, 16)}Z to ${i.ends.slice(0, 16)}Z  ${i.title}  [${i.source}; ${describe(i.effect)}]`);
  if (!items.length) o.io.out("  Nothing is on the calendar for this stretch (asp world tick records days; asp world schedule adds an entry).");
  return 0;
}

async function replay(rest: string[], o: WorldOpts): Promise<number> {
  if (!rest[0] && !o.flags.day) throw new WorldUsage("asp world replay <date>  (YYYY-MM-DD)");
  const day = dayArg(o.flags, rest, o.now());
  const logged = dayRecords(await records(o), day);
  let seed: string, generator = GENERATOR, loggedEvents: WorldEvent[] | undefined;
  if (logged.length) { const b = logged[0].body as unknown as DayBody; seed = b.seed; generator = b.generator; loggedEvents = b.events; }
  else {
    const s = seedOf(o.home, undefined, false);
    if (s === undefined) throw new WorldUsage(`${day} is not in the log and this home has no seed to run it with; use asp world tick first`);
    seed = s;
  }
  const replayed = generateDay(seed, day, generator);
  const match = loggedEvents ? JSON.stringify(loggedEvents) === JSON.stringify(replayed) : undefined;
  if (o.flags.json) { o.io.out(JSON.stringify({ day, seed, generator, logged: loggedEvents ?? null, replayed, match: match ?? null, draws: explainDay(seed, day) }, null, 2)); return match === false ? 1 : 0; }
  o.io.out(`Replay of ${day}: seed ${seedCommitment(seed).slice(0, 19)}... (the seed itself is in the day record), generator ${generator}`);
  for (const d of explainDay(seed, day)) o.io.out(`  ${d.type.padEnd(16)} draw ${String(d.draw).padStart(3)} of 1000, chance ${String(d.chance).padStart(3)}  ${d.fired ? "FIRED" : "no"}`);
  for (const e of replayed) o.io.out(`  -> ${e.title}  (${when(e)}; ${describe(e.effect)})`);
  if (!replayed.length) o.io.out("  -> nothing fired: a quiet day.");
  if (match === undefined) o.io.out("Not in the log: this is what the seed would give, not a record of what happened.");
  else o.io.out(match ? `Verdict: matches the log (${logged.length} day record(s), ${loggedEvents!.length} event(s)). Anyone with the seed gets the same events.` : "Verdict: DOES NOT MATCH the day record in the log. The record or the generator has been changed.");
  return match === false ? 1 : 0;
}

/** Makes sure the world authority has a passport in this log (a self-issued first passport, which the log allows). */
async function ensureAuthority(o: WorldOpts, signer: Signer & { publicKey: Uint8Array }): Promise<void> {
  if (await o.log.log.passport(WORLD_DID)) return;
  await o.log.append(createRecord({
    type: "passport", issuer: WORLD_DID, subject: WORLD_DID, prev: null, issued_at: o.now(),
    body: { did: WORLD_DID, kind: "org", keys: [{ id: signer.kid, type: "Ed25519", public_key: b64urlEncode(signer.publicKey) }] },
  }, signer));
}

async function tick(rest: string[], o: WorldOpts): Promise<number> {
  const first = dayArg(o.flags, rest, o.now());
  const n = Math.max(1, Math.min(366, Math.trunc(Number(o.flags.days ?? 1)) || 1));
  const seed = seedOf(o.home, o.flags.seed, true)!;
  const signer = authority(o.home);
  await ensureAuthority(o, signer);
  let wrote = 0;
  for (let i = 0; i < n; i++) {
    const day = dayOf(dayStart(first) + i * 86_400_000);
    const existing = dayRecords(await records(o), day);
    if (dayStart(day) > Date.parse(o.now())) { o.io.out(`${day}: has not begun, so its events are not announced early; stopped`); break; }
    if (existing.length) { o.io.out(`${day}: already recorded (${existing[0]?.id.slice(0, 19)}...)`); continue; }
    const body = dayBody(seed, day);
    const r = await o.log.append(createRecord({ type: "world", issuer: WORLD_DID, subject: null, prev: null, body, issued_at: o.now() }, signer));
    wrote++;
    o.io.out(`${day}: recorded ${r.id.slice(0, 19)}... at log seq ${r.seq}; ${body.events.length ? body.events.map((e) => e.title).join("; ") : "a quiet day"}`);
  }
  o.io.out(`${wrote} day(s) written; seed commitment ${seedCommitment(seed)}`);
  return 0;
}

async function schedule(o: WorldOpts): Promise<number> {
  const f = o.flags;
  if (!f.title || !f.from || !f.to || !f.effect || !f.target) throw new WorldUsage(`asp world schedule --title <text> --from <time> --to <time> --effect ${EFFECTS.join("|")} --target <name> [--value <n>] [--kind scheduled|season|funding|review|shock|drill|experiment|event]`);
  if (!EFFECTS.includes(f.effect as EffectType)) throw new WorldUsage(`--effect is one of ${EFFECTS.join(", ")}`);
  const signer = authority(o.home);
  await ensureAuthority(o, signer);
  const kind = f.kind ?? "scheduled";
  const entryId = f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "entry";
  const seedFields = ["shock", "drill", "experiment"].includes(kind) ? { seed_commitment: seedCommitment(seedOf(o.home, f.seed, true)!), generator: GENERATOR } : {};
  const body: CalendarEntryBody = {
    kind: "calendar_entry", entry_id: entryId, source: "operator", event_kind: kind, title: f.title, starts: new Date(f.from).toISOString().replace(/\.\d{3}Z$/, "Z"), ends: new Date(f.to).toISOString().replace(/\.\d{3}Z$/, "Z"),
    effect: { type: f.effect as EffectType, target: f.target, value: Math.trunc(Number(f.value ?? (f.effect === "tax_free" ? 1000 : f.effect === "price_multiplier" ? 1000 : 0))) }, ...seedFields,
  };
  const r = await o.log.append(createRecord({ type: "world", issuer: WORLD_DID, subject: null, prev: null, body, issued_at: o.now() }, signer));
  o.io.out(`calendar entry ${entryId} recorded ${r.id.slice(0, 19)}... at log seq ${r.seq}: ${body.title} (${when(body)}; ${describe(body.effect)})`);
  return 0;
}
