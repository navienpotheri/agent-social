import { sha256Id } from "@agent-social/asp-core";
import type { JurorRow, PassportRow, StoredRecord } from "./store.ts";

export const DEFAULT_PANEL_SIZE = 3;

/** The minimum a ruling panel needs: record lookups plus the two registry queries drawPanel uses. */
export interface PanelSource {
  getRecord(id: string): Promise<StoredRecord | undefined>;
  getPassport(did: string): Promise<PassportRow | undefined>;
  activeJurors(): Promise<JurorRow[]>;
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
 * A deterministic, reproducible draw for a Courts ruling panel: excludes the contract's principal
 * and performer, and any juror *sponsored by* either of them (conflict-free), then picks `size`
 * DIDs from what's left of the staked jurors (see JurorRow), seeded from `seed` — normally the id
 * of the rejection that opened the dispute, itself unpredictable before the dispute exists and
 * fixed once it does. One seat for each control: two jurors with the same sponsor never sit together (BM11). The same inputs always produce the same panel, so anyone (including
 * EventLog.verify()'s replay) can recompute and check it without the draw itself being a record.
 */
export async function drawPanel(source: PanelSource, opts: { principal: string; performer: string; seed: string; size?: number; also?: string[]; exclude?: string[] }): Promise<string[]> {
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
    seats.add(keyOf.get(d)!);
    picked.push(d);
  }
  return picked;
}
