import { sha256Id } from "@agent-social/asp-core";
import type { JurorRow, PassportRow, StoredRecord } from "./store.ts";

export const DEFAULT_PANEL_SIZE = 3;

/** The minimum a ruling panel needs: record lookups plus the two registry queries drawPanel uses. */
export interface PanelSource {
  getRecord(id: string): Promise<StoredRecord | undefined>;
  getPassport(did: string): Promise<PassportRow | undefined>;
  activeJurors(): Promise<JurorRow[]>;
  /** Markers (the funders a v2 draw reads); a source without them draws as v1. */
  getMarker?(key: string): Promise<string | undefined>;
}

/** From this time a record's panel is drawn by v2 (docs/institutions/courts.md, "The panel draw is versioned", DK365): v1 plus one seat for each funding source. Records before it replay as v1, always. */
export const PANEL_DRAW_V2_FROM = "2026-12-15T00:00:00Z";
/** New jurors one sponsor (or one person) may register in a day from the v2 draw date (DK365, S1012). */
export const JUROR_NEW_PER_DAY = 3;
/** From this time a dispute's panel is drawn by v3 (DK122, S1611; courts.md CT-5 and CT-7): the seed is made from the records of three other controllers that follow the rejection, not from the rejection the rejecting party wrote, and a juror who sat on JUROR_CASELOAD_CAP cases in the last JUROR_CASELOAD_WINDOW_DAYS is not drawn. v3 includes v2. */
export const PANEL_DRAW_V3_FROM = "2026-12-15T00:00:00Z";
export const panelDrawIsV3 = (from: string | undefined, issuedAt: string): boolean => Date.parse(issuedAt) >= Date.parse(from ?? PANEL_DRAW_V3_FROM);
/** How many other controllers' records the v3 seed is made from. */
export const SEED_CONTROLLERS = 3;
/** The v3 caseload cap: cases a juror sat on inside the window. (A draw is lazy, so a case is not "open" until a ruling is signed; the load is what was sat on.) */
export const JUROR_CASELOAD_CAP = 5;
export const JUROR_CASELOAD_WINDOW_DAYS = 7;
export const panelDrawIsV2 = (from: string | undefined, issuedAt: string): boolean => Date.parse(issuedAt) >= Date.parse(from ?? PANEL_DRAW_V2_FROM);
/** The stake rule (DK365, S1200; owner decision DK365-stake in docs/owner-decisions.md): from the v2 draw a juror must hold at least JUROR_STAKE_PER_CASE credits of stake for every case it has sat on in the last JUROR_CASE_WINDOW_DAYS days, and one more for the case it is drawn for. */
export const JUROR_STAKE_PER_CASE = 20;
export const JUROR_CASE_WINDOW_DAYS = 30;
const casesKey = (did: string) => `juror_cases:${did}`;
const FUNDER_CAP = 50;
const funderKey = (did: string) => `funders:${did}`;

/** Records that these jurors sat on a ruling at `at` (a case they signed as members of the drawn panel): the load the stake rule counts. */
export async function noteJurorService(tx: { getMarker(k: string): Promise<string | undefined>; putMarker(k: string, v: string): Promise<void> }, jurors: readonly string[], at: string): Promise<void> {
  for (const d of new Set(jurors)) {
    const raw = await tx.getMarker(casesKey(d));
    const list: string[] = raw ? JSON.parse(raw) : [];
    list.push(at);
    await tx.putMarker(casesKey(d), JSON.stringify(list.slice(-FUNDER_CAP)));
  }
}

/** Records that `payer` paid `recipient` (a settlement payout, a bounty): the counterparties an account has been funded by. Not recorded when they are one control (the recipient's sponsor or the payer's) or the payer is an account of the society. */
export async function noteFunder(tx: { getMarker(k: string): Promise<string | undefined>; putMarker(k: string, v: string): Promise<void>; getPassport(d: string): Promise<PassportRow | undefined> }, recipient: string, payer: string, isReserved: (d: string) => boolean): Promise<void> {
  if (!recipient || !payer || recipient === payer || isReserved(payer) || isReserved(recipient)) return;
  const [pr, pp] = [await tx.getPassport(recipient), await tx.getPassport(payer)];
  if (pr?.sponsor === payer || pp?.sponsor === recipient || (pr?.sponsor && pr.sponsor === pp?.sponsor)) return;
  const raw = await tx.getMarker(funderKey(recipient));
  const list: string[] = raw ? JSON.parse(raw) : [];
  if (list.includes(payer)) return;
  list.push(payer);
  await tx.putMarker(funderKey(recipient), JSON.stringify(list.slice(-FUNDER_CAP)));
}

/**
 * Walks backward from `from` through `prev` links to the most recent rejection (an acceptance
 * Attestation with verdict "rejected") that opened this dispute — the fixed point a ruling panel's
 * draw is seeded from. Returns undefined if none is found (e.g. `from` is null or predates it).
 */
export async function findRejection(source: PanelSource, from: string | null): Promise<string | undefined> {
  let cursor = from;
  while (cursor) {
    const rec = await source.getRecord(cursor);
    if (!rec) return undefined;
    const body = rec.record.body as { kind?: string; verdict?: string };
    if (rec.record.type === "asp.attestation/v0.2" && body.kind === "acceptance" && body.verdict === "rejected") return rec.id;
    cursor = rec.record.prev;
  }
  return undefined;
}

/**
 * The v3 seed of a dispute's panel (DK122, S1611): the contract and the ids of the first record from each of SEED_CONTROLLERS distinct controllers (a sponsor, or the issuer itself when it has none) that follow the
 * rejection and are not the parties' or their sponsors'. Nothing the rejecting party writes can move it (200 variants of the rejection give the same seed), a party's own records and many records of one controller
 * do not count, and until three other controllers have recorded something the panel is not drawn (undefined). `beforeSeq` limits the records read to those before a ruling, so the panel a ruling was checked against is
 * the panel it is paid against. Not claimed: that a party with three controllers of its own cannot steer it (the last of them to record chooses among its own variants); the defence is that this costs three
 * sponsored identities and shows in the log.
 */
export async function disputeSeedV3(source: { getRecord(id: string): Promise<StoredRecord | undefined>; getPassport(did: string): Promise<PassportRow | undefined>; recordsSince(after: number, limit: number): Promise<StoredRecord[]> }, contractId: string, rejectionId: string, parties: readonly string[], beforeSeq?: number): Promise<string | undefined> {
  const rej = await source.getRecord(rejectionId);
  if (!rej) return undefined;
  const controlOf = async (did: string) => (await source.getPassport(did))?.sponsor ?? did;
  const partyControl = new Set<string>();
  for (const p of parties) { partyControl.add(p); partyControl.add(await controlOf(p)); }
  const seen = new Map<string, string>();
  let after = rej.seq;
  for (;;) {
    const page = await source.recordsSince(after, 200);
    if (!page.length) break;
    for (const r of page) {
      after = r.seq;
      if (beforeSeq !== undefined && r.seq >= beforeSeq) return seen.size >= SEED_CONTROLLERS ? seedOf(contractId, seen) : undefined;
      const issuer = r.record.issuer, c = await controlOf(issuer);
      if (partyControl.has(issuer) || partyControl.has(c) || seen.has(c)) continue;
      seen.set(c, r.id);
      if (seen.size >= SEED_CONTROLLERS) return seedOf(contractId, seen);
    }
  }
  return undefined;
}
const seedOf = (contractId: string, seen: Map<string, string>): string => sha256Id(new TextEncoder().encode(`dispute-v3|${contractId}|${[...seen.values()].join("|")}`));

/**
 * A deterministic, reproducible draw for a Courts ruling panel: excludes the contract's principal
 * and performer, and any juror *sponsored by* either of them (conflict-free), then picks `size`
 * DIDs from what's left of the staked jurors (see JurorRow), seeded from `seed` — normally the id
 * of the rejection that opened the dispute, itself unpredictable before the dispute exists and
 * fixed once it does. One seat for each control: two jurors with the same sponsor never sit together (BM11). The same inputs always produce the same panel, so anyone (including
 * EventLog.verify()'s replay) can recompute and check it without the draw itself being a record.
 */
export async function drawPanel(source: PanelSource, opts: { principal: string; performer: string; seed: string; /** The time of the record that asks for the draw: the stake rule counts the cases a juror sat on before it (v2 only). */ at?: string; size?: number; also?: string[]; exclude?: string[]; /** Draw by v2: one seat for each funding source, and no juror funded by a party. */ v2?: boolean; /** Draw by v3 (needs `at`): a juror at the caseload cap is not drawn. */ v3?: boolean }): Promise<string[]> {
  const parties = new Set([opts.principal, opts.performer, ...(opts.also ?? [])]);
  // Conflicts (courts.md 5, CT-4): a juror is out if it is a party, is sponsored by a party, IS the sponsor of a party, shares a sponsor with a party, or is in a party's fleet.
  const partySponsors = new Set<string>(), partyFleets = new Set<string>();
  for (const p of parties) { const pp = await source.getPassport(p); if (pp?.sponsor) partySponsors.add(pp.sponsor); if (pp?.fleet) partyFleets.add(pp.fleet); }
  const out = new Set(opts.exclude ?? []);
  const candidates = (await source.activeJurors()).map((j) => j.did).filter((d) => !parties.has(d) && !partySponsors.has(d) && !out.has(d));
  // Sequential, not Promise.all: a PgTx wraps one client, which cannot run concurrent queries.
  const remaining: string[] = [];
  const keyOf = new Map<string, string>(); // the control behind a juror: its sponsor, or itself when it has none (BM11)
  for (const d of candidates) {
    const passport = await source.getPassport(d);
    const conflicted = !!passport && ((passport.sponsor && (parties.has(passport.sponsor) || partySponsors.has(passport.sponsor))) || (passport.fleet && partyFleets.has(passport.fleet)));
    if (!conflicted) { remaining.push(d); keyOf.set(d, passport?.sponsor ?? d); }
  }
  remaining.sort();
  // v2 (DK365): a juror's funding sources are who paid it or its sponsor (a settlement payout), other than its own control. One out if a source is a party or a party's sponsor, or a source it shares with a party;
  // one seat for each source below. A source with no markers (an older log, a juror never paid by anyone) costs nothing.
  const funders = new Map<string, Set<string>>();
  if (opts.v2 && source.getMarker) {
    const read = async (d: string): Promise<string[]> => { const raw = await source.getMarker!(funderKey(d)); return raw ? (JSON.parse(raw) as string[]) : []; };
    const partyControl = new Set<string>([...parties, ...partySponsors]);
    const partyFunders = new Set<string>();
    for (const p of parties) for (const f of await read(p)) partyFunders.add(f);
    const kept: string[] = [];
    for (const d of remaining) {
      const sp = (await source.getPassport(d))?.sponsor;
      const own = new Set<string>([d, ...(sp ? [sp] : [])]);
      const fs = new Set<string>([...(await read(d)), ...(sp ? await read(sp) : [])].filter((f) => !own.has(f)));
      if ([...fs].some((f) => partyControl.has(f) || partyFunders.has(f))) continue;
      funders.set(d, fs); kept.push(d);
    }
    remaining.splice(0, remaining.length, ...kept);
  }
  // v2 stake rule (DK365): a juror's stake covers every case it sat on in the window and one more.
  if (opts.v2 && source.getMarker && opts.at) {
    const staked = new Map((await source.activeJurors()).map((j) => [j.did, j.staked]));
    const since = Date.parse(opts.at) - JUROR_CASE_WINDOW_DAYS * 86_400_000;
    const kept: string[] = [];
    for (const d of remaining) {
      const raw = await source.getMarker(casesKey(d));
      const load = (raw ? (JSON.parse(raw) as string[]) : []).filter((t) => Date.parse(t) > since && Date.parse(t) <= Date.parse(opts.at!)).length;
      if ((staked.get(d) ?? 0) >= JUROR_STAKE_PER_CASE * (1 + load)) kept.push(d);
    }
    remaining.splice(0, remaining.length, ...kept);
  }
  // v3 caseload cap (DK122): a juror who sat on JUROR_CASELOAD_CAP cases inside the window is not drawn.
  if (opts.v3 && source.getMarker && opts.at) {
    const since = Date.parse(opts.at) - JUROR_CASELOAD_WINDOW_DAYS * 86_400_000;
    const kept: string[] = [];
    for (const d of remaining) {
      const raw = await source.getMarker(casesKey(d));
      const load = (raw ? (JSON.parse(raw) as string[]) : []).filter((t) => Date.parse(t) > since && Date.parse(t) <= Date.parse(opts.at!)).length;
      if (load < JUROR_CASELOAD_CAP) kept.push(d);
    }
    remaining.splice(0, remaining.length, ...kept);
  }
  const usedFunders = new Set<string>();
  const size = opts.size ?? DEFAULT_PANEL_SIZE;
  const picked: string[] = [];
  const seats = new Set<string>();
  let h = opts.seed;
  while (picked.length < size && remaining.length) {
    h = sha256Id(new TextEncoder().encode(h));
    const n = BigInt(`0x${h.replace(/^sha256:/, "").slice(0, 16)}`);
    const idx = Number(n % BigInt(remaining.length));
    const d = remaining[idx];
    remaining.splice(idx, 1);
    // One seat for each control (BM11): a front account that sponsors many jurors holds at most one seat, so it cannot win a panel majority by registering many jurors.
    if (seats.has(keyOf.get(d)!)) continue;
    const fs = funders.get(d);
    if (fs && [...fs].some((f) => usedFunders.has(f))) continue; // v2: one seat for each funding source
    seats.add(keyOf.get(d)!);
    if (fs) for (const f of fs) usedFunders.add(f);
    picked.push(d);
  }
  return picked;
}
