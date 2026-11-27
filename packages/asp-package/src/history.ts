/**
 * The verified history context (register row DK59; the deck's slide 9, "signed history reloaded into the next run"): at each run the agent is given a compact summary of its own record, read
 * from the log: its tier, slashes, recent strikes, qualifying jobs and the certificates it holds. The summary names the log head it was read at and can be signed with the agent's key. A
 * summary handed back later (kept in memory, passed along by a runtime) is accepted only if its signature holds, its head is the log's current head, and every figure matches what the log
 * says now; otherwise it is refused, and the context is built again from the log. Nothing here changes a record. Credits never buy standing, and this summary is read-only evidence of it.
 */
import { b64urlDecode, b64urlEncode, canonicalBytes, didOf, signBytes, verifyBytes, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-log";

export interface HistorySummary {
  v: 1;
  did: string;
  /** The log head the summary was read at. */
  head: { seq: number; logHash: string };
  tier: number;
  slashCount: number;
  strikes: number;
  acceptedJobs: number;
  qualifyingJobs: number;
  certificates: { id: string; skill: string; level: number; expires: string }[];
}

export interface SignedHistory { summary: HistorySummary; signer: string; sig: string }

type HistoryLog = Pick<LogHandle["log"], "head" | "reputationOf"> & { certificatesOf?: (did: string) => Promise<unknown[]> };

/** Reads the agent's record from the log. Undefined when the DID has no tier (not an agent with a passport). */
export async function buildHistory(log: HistoryLog, did: string): Promise<HistorySummary | undefined> {
  const rep = (await log.reputationOf(did)) as { tier: number; slashCount: number; strikes: number; acceptedJobs?: number; qualifyingJobs?: number } | null | undefined;
  if (!rep) return undefined;
  const head = (await log.head()) as { seq: number; logHash: string };
  const certs = log.certificatesOf ? ((await log.certificatesOf(did)) as { id: string; body: { skill: string; level: number; expires: string } }[]) : [];
  return {
    v: 1, did, head: { seq: head.seq, logHash: head.logHash }, tier: rep.tier, slashCount: rep.slashCount, strikes: rep.strikes,
    acceptedJobs: rep.acceptedJobs ?? 0, qualifyingJobs: rep.qualifyingJobs ?? 0,
    certificates: certs.map((c) => ({ id: c.id, skill: c.body.skill, level: c.body.level, expires: c.body.expires })),
  };
}

const bytesOf = (s: HistorySummary) => canonicalBytes(s as unknown as Record<string, unknown>);

export function signHistory(summary: HistorySummary, signer: Signer): SignedHistory {
  return { summary, signer: signer.kid, sig: b64urlEncode(signBytes(bytesOf(summary), signer.seed)) };
}

/**
 * Whether a signed summary can be trusted now: the signature is the holder's (the signer's DID is the summary's own), the summary is at the log's current head, and the figures are the ones the
 * log gives today. Anything else is refused with the reason, so a tampered, stale or forged summary never reaches the agent's context.
 */
export async function verifyHistory(signed: SignedHistory, publicKey: Uint8Array, log: HistoryLog): Promise<{ ok: true } | { ok: false; reason: string }> {
  const s = signed?.summary;
  if (!s || s.v !== 1 || typeof s.did !== "string") return { ok: false, reason: "not a history summary" };
  if (didOf(signed.signer) !== s.did) return { ok: false, reason: `signed by ${didOf(signed.signer)}, not by ${s.did}` };
  let valid = false;
  try { valid = verifyBytes(b64urlDecode(signed.sig), bytesOf(s), publicKey); } catch { valid = false; }
  if (!valid) return { ok: false, reason: "the signature does not match the summary: it was changed after it was signed" };
  const now = await buildHistory(log, s.did);
  if (!now) return { ok: false, reason: `${s.did} has no tier in the log` };
  if (now.head.seq !== s.head.seq || now.head.logHash !== s.head.logHash) return { ok: false, reason: `stale: it was read at log seq ${s.head.seq} and the log is at ${now.head.seq}; read it again` };
  if (JSON.stringify({ ...now, head: undefined }) !== JSON.stringify({ ...s, head: undefined })) return { ok: false, reason: "the figures do not match what the log says now" };
  return { ok: true };
}

/** The compact text given to the agent at the start of a run. */
export function historyText(s: HistorySummary): string {
  const certs = s.certificates.length ? s.certificates.map((c) => `${c.skill} level ${c.level} (to ${c.expires.slice(0, 10)})`).join(", ") : "none";
  return [
    `Your record in the log (read at log seq ${s.head.seq}; the log is the authority, this is a summary of it):`,
    `- tier ${s.tier}; slashed ${s.slashCount} time(s); ${s.strikes} recent blocked attempt(s); ${s.qualifyingJobs} qualifying job(s) of ${s.acceptedJobs} accepted`,
    `- certificates: ${certs}`,
    "Credits never change your tier: a tier goes up only by a certificate and qualifying jobs, and a slash or a copy's inherited record is part of it. Do not try to work around a refusal; ask your principal.",
  ].join("\n");
}
