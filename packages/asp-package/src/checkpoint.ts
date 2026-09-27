/**
 * Log checkpoints (decision D5): a lightweight, externally-portable proof that the local event log
 * had a given hash at a given point. Not an ASP record — it's about the log, not a fact in it — so it
 * doesn't add a 17th record type. Each is one line of a local ndjson file, meant to be copied out
 * (emailed, posted, handed to a counterparty) so a later check can catch the log being rewritten since.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  b64urlDecode, b64urlEncode, canonicalBytes, didOf, signBytes, verifyBytes, type Signer,
} from "@agent-social/asp-core";
import type { LogHead } from "@agent-social/asp-log";

export interface LogCheckpoint {
  seq: number;
  logHash: string;
  signedAt: string;
  /** DID URL of the key that signed this checkpoint — the log owner, by convention. */
  signer: string;
  /** base64url Ed25519 signature over the canonical form of {seq, logHash, signedAt}. */
  sig: string;
}

function signingBytes(seq: number, logHash: string, signedAt: string): Uint8Array {
  return canonicalBytes({ seq, log_hash: logHash, signed_at: signedAt });
}

export function signCheckpoint(head: LogHead, signer: Signer, now: Date = new Date()): LogCheckpoint {
  const signedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const bytes = signingBytes(head.seq, head.logHash, signedAt);
  return { seq: head.seq, logHash: head.logHash, signedAt, signer: signer.kid, sig: b64urlEncode(signBytes(bytes, signer.seed)) };
}

/** Checks only the signature and that `signer`'s DID matches `expectedDid` (pass none to skip that check). */
export function verifyCheckpointSignature(cp: LogCheckpoint, publicKey: Uint8Array, expectedDid?: string): boolean {
  if (expectedDid && didOf(cp.signer) !== expectedDid) return false;
  return verifyBytes(b64urlDecode(cp.sig), signingBytes(cp.seq, cp.logHash, cp.signedAt), publicKey);
}

export function appendCheckpoint(file: string, cp: LogCheckpoint): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(cp) + "\n");
}

export function readCheckpoints(file: string): LogCheckpoint[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
