/**
 * The signed known-bad registry (docs/spec-deltas.md S178; register row DK54). A platform list, not a protocol record (S54): each entry and each review is a small signed item, so the list can be
 * public and copied from one service to another without trusting the service it came from.
 *
 *  - An entry names a shell-command fingerprint, the upheld report that justifies it and the signer. A review withdraws an entry that was wrong. Both are signed with Ed25519 over their canonical form.
 *  - A service or a home trusts a set of signer keys (`known-bad-trust.json`). An item whose signature does not verify against a trusted key is ignored, whoever sent it and wherever it came from.
 *  - A review is valid only from a trusted key other than the entry's signer (two people, not one), and an entry with a valid review is no longer enforced. Entries and reviews are kept, so the history is public.
 *  - A service can follow a peer (`startKnownBadSync`): it pulls the peer's items on a timer and keeps those its own trust file verifies. The time a command takes to reach a second service is at most the interval.
 */
import { b64urlDecode, b64urlEncode, canonicalBytes, didOf, publicKeyFromSeed, sha256Id, signBytes, verifyBytes, type Signer } from "@agent-social/asp-core";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchRetry } from "./http-retry.ts";

export interface SignedItem {
  kind: "entry" | "review";
  /** entry: {fingerprint, report, contract, addedAt, addedBy, note?}. review: {entry (an entry id), fingerprint, verdict: "remove", reason, reviewedAt, reviewedBy}. */
  body: Record<string, string>;
  kid: string;
  sig: string;
  /** sha256 of the canonical {kind, body}: an entry's id is what a review names. */
  id: string;
}

export interface Trust { keys: Record<string, string> }
export interface EffectiveEntry { fingerprint: string; report: string; contract: string; addedAt: string; addedBy: string; note?: string; signed: true; id: string }

const FINGERPRINT = /^asp:\/\/shell-command#sha256:[0-9a-f]{64}$/;
const view = (kind: string, body: Record<string, string>) => canonicalBytes({ kind, body });

export function signItem(kind: SignedItem["kind"], body: Record<string, string>, signer: Signer): SignedItem {
  const by = kind === "entry" ? body.addedBy : body.reviewedBy;
  if (didOf(signer.kid) !== by) throw new Error(`${signer.kid} does not belong to ${by}`);
  const bytes = view(kind, body);
  return { kind, body, kid: signer.kid, sig: b64urlEncode(signBytes(bytes, signer.seed)), id: sha256Id(bytes) };
}

/** Why an item is not acceptable on its own (shape, signer and signature), or undefined. Reviews also need their entry: see `addSigned`. */
export function itemProblem(item: SignedItem, trust: Trust): string | undefined {
  if (!item || (item.kind !== "entry" && item.kind !== "review") || typeof item.kid !== "string" || typeof item.sig !== "string" || !item.body || typeof item.body !== "object") return "not a signed item";
  for (const v of Object.values(item.body)) if (typeof v !== "string" || v.length > 1000) return "every field is a short string";
  const b = item.body;
  if (item.kind === "entry") {
    if (!FINGERPRINT.test(b.fingerprint ?? "") || !b.report || !b.contract || !b.addedAt || !b.addedBy) return "an entry needs a shell-command fingerprint, a report, a contract, a time and a signer";
    if (didOf(item.kid) !== b.addedBy) return "the key is not the signer's";
  } else {
    if (!b.entry || b.verdict !== "remove" || !b.reason || !b.reviewedAt || !b.reviewedBy) return "a review needs an entry, the verdict remove, a reason, a time and a reviewer";
    if (didOf(item.kid) !== b.reviewedBy) return "the key is not the reviewer's";
  }
  const key = trust.keys[item.kid];
  if (!key) return `${item.kid} is not a trusted key here`;
  const bytes = view(item.kind, item.body);
  if (item.id !== sha256Id(bytes)) return "the id does not match the content";
  let ok = false;
  try { ok = verifyBytes(b64urlDecode(item.sig), bytes, b64urlDecode(key)); } catch { ok = false; }
  return ok ? undefined : "the signature does not verify";
}

export function readTrust(file: string): Trust {
  if (!existsSync(file)) return { keys: {} };
  const t = JSON.parse(readFileSync(file, "utf8")) as Trust;
  return { keys: t && typeof t.keys === "object" && t.keys ? t.keys : {} };
}
export function addTrust(file: string, kid: string, publicKey: string): void {
  const t = readTrust(file);
  t.keys[kid] = publicKey;
  write(file, t);
}
export const publicKeyOf = (signer: Signer): string => b64urlEncode(publicKeyFromSeed(signer.seed));

function write(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + ".part", JSON.stringify(data, null, 2) + "\n");
  renameSync(file + ".part", file);
}

export function readSigned(file: string): SignedItem[] {
  if (!existsSync(file)) return [];
  const list = (JSON.parse(readFileSync(file, "utf8")) as { items?: SignedItem[] }).items;
  return Array.isArray(list) ? list : [];
}

/** Adds one item if it verifies against `trust` (a review also needs its entry here, and a reviewer other than the entry's signer). {created:false} if it is already held. Throws with the reason otherwise. */
export function addSigned(file: string, item: SignedItem, trust: Trust): { created: boolean } {
  const bad = itemProblem(item, trust);
  if (bad) throw new Error(bad);
  const items = readSigned(file);
  if (items.some((i) => i.id === item.id)) return { created: false };
  if (item.kind === "review") {
    const entry = items.find((i) => i.kind === "entry" && i.id === item.body.entry);
    if (!entry) throw new Error(`the entry ${item.body.entry} is not on this list`);
    if (entry.body.addedBy === item.body.reviewedBy) throw new Error("a review needs a reviewer other than the one who listed the entry");
    if (entry.body.fingerprint !== item.body.fingerprint) throw new Error("the review names a different fingerprint than the entry");
  }
  write(file, { items: [...items, item] });
  return { created: true };
}

/** The entries that are enforced: valid, and with no valid review from another trusted signer. */
export function effectiveEntries(items: SignedItem[], trust: Trust): EffectiveEntry[] {
  const removed = new Set<string>();
  const entries = new Map<string, SignedItem>();
  for (const i of items) if (i.kind === "entry" && !itemProblem(i, trust)) entries.set(i.id, i);
  for (const i of items) {
    if (i.kind !== "review" || itemProblem(i, trust)) continue;
    const e = entries.get(i.body.entry);
    if (e && e.body.addedBy !== i.body.reviewedBy) removed.add(e.id);
  }
  return [...entries.values()].filter((e) => !removed.has(e.id)).map((e) => ({
    fingerprint: e.body.fingerprint, report: e.body.report, contract: e.body.contract, addedAt: e.body.addedAt, addedBy: e.body.addedBy, ...(e.body.note ? { note: e.body.note } : {}), signed: true as const, id: e.id,
  }));
}

/** Pulls a peer's signed items and keeps those this side's trust verifies. Returns how many were new and how many were refused (untrusted or invalid). */
export async function syncKnownBad(peerUrl: string, signedFile: string, trustFile: string): Promise<{ added: number; refused: number }> {
  const res = await fetchRetry(new URL("known-bad/signed", peerUrl.endsWith("/") ? peerUrl : peerUrl + "/"), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`the peer answered ${res.status} for its signed known-bad list`);
  const items = ((await res.json()) as { items?: SignedItem[] }).items ?? [];
  const trust = readTrust(trustFile);
  let added = 0;
  let refused = 0;
  // Entries first, so a review that arrives in the same pull finds its entry.
  for (const i of [...items.filter((x) => x.kind === "entry"), ...items.filter((x) => x.kind === "review")]) {
    try { if (addSigned(signedFile, i, trust).created) added++; } catch { refused++; }
  }
  return { added, refused };
}

/** Follows a peer on a timer; the first pull is at once. Returns a function that stops it. */
export function startKnownBadSync(opts: { peer: string; signedFile: string; trustFile: string; everyMs: number; log?: (line: string) => void }): () => void {
  const pull = () => syncKnownBad(opts.peer, opts.signedFile, opts.trustFile).then((r) => { if (r.added || r.refused) opts.log?.(`known-bad sync from ${opts.peer}: ${r.added} new, ${r.refused} refused`); }).catch((e) => opts.log?.(`known-bad sync from ${opts.peer} failed: ${(e as Error).message}`));
  void pull();
  const t = setInterval(pull, opts.everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
