/**
 * The listing audit for the services board and the Market (register row DK818; spec-delta S1207; docs/intake/11th-nov.md, IMG_6490, paper P36): a listing's claims are machine-checkable fields; a deterministic probe
 * runs the service on a sample and records which claims held; the board shows a verified-claims share; a seller with an unsupported claim loses a slice of its bond and is posted in the Forum with the probe's hash.
 * Everything here is pure and seeded: the same listing and sample give the same record and the same hash. The services in the tests are scripted; a real seller's service is a live run. Credits are mock accounting entries.
 */
import { createHash } from "node:crypto";

/** The claims a listing may make, each one a field a probe can check. */
export type Claim =
  | { id: string; kind: "max_latency_ms"; value: number }          // the 95th-percentile latency over the sample is at most this
  | { id: string; kind: "min_accuracy_permille"; value: number }   // at least this share of the sample is answered correctly
  | { id: string; kind: "formats"; value: string[] };              // the service supports every one of these formats
/** A service the probe can run: input to output with the time it took, and the formats it supports. Scripted in tests. */
export interface Service { run(input: number): { output: number; latencyMs: number }; formats: string[] }
export interface Listing { id: string; seller: string; claims: Claim[]; bond: number; service: Service }
export interface ClaimResult { id: string; held: boolean; observed: number | string }
export interface AuditRecord { listing: string; seller: string; sample: number; results: ClaimResult[]; verifiedPermille: number; probeHash: string }

/** The slice of the bond one unsupported claim costs the seller (permille of the bond). */
export const SLICE_PERMILLE = 50;

const hash = (x: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(x)).digest("hex");
const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };

/** Runs the probe: the service on every input of the sample against the truth, then each claim against what was observed. */
export function probe(l: Listing, sample: number[], truth: (input: number) => number): AuditRecord {
  const runs = sample.map((i) => ({ i, ...l.service.run(i) }));
  const accuracy = Math.round((runs.filter((r) => r.output === truth(r.i)).length / runs.length) * 1000);
  const latency = p95(runs.map((r) => r.latencyMs));
  const results: ClaimResult[] = l.claims.map((c) => {
    if (c.kind === "max_latency_ms") return { id: c.id, held: latency <= c.value, observed: latency };
    if (c.kind === "min_accuracy_permille") return { id: c.id, held: accuracy >= c.value, observed: accuracy };
    const missing = c.value.filter((f) => !l.service.formats.includes(f));
    return { id: c.id, held: missing.length === 0, observed: missing.length ? `missing ${missing.join(",")}` : "all" };
  });
  const verifiedPermille = results.length ? Math.round((results.filter((r) => r.held).length / results.length) * 1000) : 1000;
  return { listing: l.id, seller: l.seller, sample: sample.length, results, verifiedPermille, probeHash: hash({ listing: l.id, sample, results }) };
}

/** What an audit costs a seller: a slice of the bond for each unsupported claim (never more than the bond). */
export const bondSlice = (l: Listing, r: AuditRecord): number => Math.min(l.bond, Math.round((l.bond * SLICE_PERMILLE * r.results.filter((x) => !x.held).length) / 1000));

/** The Forum post for a failed audit: the seller, which claims failed, the share verified and the probe's hash, and no text the seller wrote. */
export function forumPost(r: AuditRecord): { title: string; text: string } | null {
  const failed = r.results.filter((x) => !x.held);
  if (!failed.length) return null;
  return { title: `Listing audit: ${r.listing} (${r.verifiedPermille / 10}% of claims verified)`, text: `Seller ${r.seller}: claims that did not hold on the probe of ${r.sample} inputs: ${failed.map((f) => `${f.id} (observed ${f.observed})`).join("; ")}. Probe record ${r.probeHash}.` };
}

/** How a board orders its listings: by the number of claims made (an unaudited board, which rewards a long list of claims), or by the claims that held (an audited board). */
export type Ranking = "claimed" | "verified";
export function rank(listings: Listing[], records: Map<string, AuditRecord>, mode: Ranking): Listing[] {
  const score = (l: Listing) => (mode === "claimed" ? l.claims.length : l.claims.length * ((records.get(l.id)?.verifiedPermille ?? 0) / 1000));
  return [...listings].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
}

/** A buyer needs a latency and an accuracy; it picks the first listing on the board whose claims cover the need, and the pick is wrong when the real service does not meet it. */
export interface Need { maxLatencyMs: number; minAccuracyPermille: number }
export function simulateMarket(listings: Listing[], buyers: Need[], sample: number[], truth: (i: number) => number, mode: Ranking, audited: boolean): { firstListed: Record<string, number>; wrongPicks: number; slices: Record<string, number>; posts: number } {
  const records = new Map(listings.map((l) => [l.id, probe(l, sample, truth)]));
  // Without an audit a claim is taken at its word, so every claim counts as held.
  const view = audited ? records : new Map([...records].map(([id, r]) => [id, { ...r, verifiedPermille: 1000 }]));
  const board = rank(listings, view, mode);
  const firstListed: Record<string, number> = Object.fromEntries(listings.map((l) => [l.id, 0]));
  let wrongPicks = 0;
  for (const need of buyers) {
    const pick = board.find((l) => {
      const claimedLatency = l.claims.find((c) => c.kind === "max_latency_ms") as { value: number } | undefined;
      const claimedAccuracy = l.claims.find((c) => c.kind === "min_accuracy_permille") as { value: number } | undefined;
      const ok = !!claimedLatency && claimedLatency.value <= need.maxLatencyMs && !!claimedAccuracy && claimedAccuracy.value >= need.minAccuracyPermille;
      const verified = !audited || (view.get(l.id)?.verifiedPermille ?? 0) === 1000;
      return ok && (mode === "claimed" || verified);
    }) ?? board[0];
    firstListed[pick.id]++;
    const real = records.get(pick.id)!;
    const gotLatency = real.results.find((r) => r.id === "latency")?.observed as number | undefined;
    const gotAccuracy = real.results.find((r) => r.id === "accuracy")?.observed as number | undefined;
    if (gotLatency === undefined || gotAccuracy === undefined || gotLatency > need.maxLatencyMs || gotAccuracy < need.minAccuracyPermille) wrongPicks++;
  }
  const slices: Record<string, number> = {};
  let posts = 0;
  if (audited) for (const l of listings) { slices[l.id] = bondSlice(l, records.get(l.id)!); if (forumPost(records.get(l.id)!)) posts++; }
  return { firstListed, wrongPicks, slices, posts };
}
