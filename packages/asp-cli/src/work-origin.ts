/**
 * Where a piece of work came from (register row T11): `asp work attest <file|folder>... --contract <id> --by <agent>` writes an origin statement, signed by the agent's own key, that ties the work (the hash of each file) to
 * the contract and Mandate it was done under, the head of the run log that recorded the run and the models the run named; `asp work verify <origin.json>` is the one command a recipient runs: it checks the files against
 * the hashes and the signature against the key, and, when a log can be read, that the key is a current key of the agent in it and that the contract and the Mandate are in it.
 *
 * It is a platform feature, not a protocol record: a small signed document kept beside the work, like the commons' entries. It proves who signed which bytes and under which Mandate the agent says it worked; it does not
 * prove that the agent did the work, that the work is good, or that the files were not copied: a recipient who trusts the log trusts what the log says about the Mandate and the run log head, and nothing else.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { b64urlDecode, b64urlEncode, canonicalBytes, didOf, signBytes, verifyBytes, type Signer } from "@agent-social/asp-core";

export const ORIGIN_VERSION = "asp.work-origin/v0";
export interface WorkFile { path: string; sha256: string; bytes: number }
export interface WorkOriginBody {
  v: typeof ORIGIN_VERSION; kind: "origin"; agent: string; contract: string; mandate?: string;
  /** The head of the run log that recorded the run (event count and hash), when this machine has one for the contract. */
  run_log?: { events: number; hash: string };
  models?: string[]; files: WorkFile[]; createdAt: string; note?: string;
}
export type SignedOrigin = WorkOriginBody & { kid: string; sig: string };

const SKIP = new Set([".git", "node_modules", ".DS_Store"]);
const hex = (b: Uint8Array | Buffer): string => createHash("sha256").update(b).digest("hex");

/** Every file under the given paths (a folder is walked, without .git and node_modules), with its hash, as a path relative to `base` and written with forward slashes. */
export function hashWork(paths: string[], base: string): WorkFile[] {
  const out: WorkFile[] = [];
  const add = (abs: string) => {
    const st = statSync(abs);
    if (st.isDirectory()) { for (const n of readdirSync(abs).sort()) if (!SKIP.has(n)) add(join(abs, n)); return; }
    if (!st.isFile()) return;
    const rel = relative(base, abs).split(sep).join("/");
    if (rel.startsWith("..")) throw new Error(`${abs} is outside ${base}`);
    out.push({ path: rel, sha256: "sha256:" + hex(readFileSync(abs)), bytes: st.size });
  };
  for (const p of paths) { const abs = resolve(p); if (!existsSync(abs)) throw new Error(`${p} does not exist`); add(abs); }
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
}

export function signOrigin(body: WorkOriginBody, signer: Signer): SignedOrigin {
  const withKid = { ...body, kid: signer.kid };
  return { ...withKid, sig: b64urlEncode(signBytes(canonicalBytes(withKid), signer.seed)) };
}
export function verifyOriginSignature(doc: SignedOrigin, publicKey: Uint8Array): boolean {
  const { sig, ...rest } = doc;
  try { return verifyBytes(b64urlDecode(sig), canonicalBytes(rest), publicKey); } catch { return false; }
}

/** Whether the files in `dir` are the files the statement names, by hash: what is missing, what differs, and what is there that the statement does not name. */
export function checkFiles(doc: Pick<WorkOriginBody, "files">, dir: string): { ok: boolean; missing: string[]; changed: string[]; extra: string[] } {
  const missing: string[] = [], changed: string[] = [];
  for (const f of doc.files) {
    const abs = resolve(dir, f.path);
    if (!abs.startsWith(resolve(dir)) || !existsSync(abs) || !statSync(abs).isFile()) { missing.push(f.path); continue; }
    if ("sha256:" + hex(readFileSync(abs)) !== f.sha256) changed.push(f.path);
  }
  return { ok: !missing.length && !changed.length, missing, changed, extra: [] };
}

export function shapeProblem(d: unknown): string | undefined {
  const o = d as Partial<SignedOrigin> | null;
  if (!o || typeof o !== "object") return "not a work origin statement";
  if (o.v !== ORIGIN_VERSION || o.kind !== "origin") return `expected ${ORIGIN_VERSION}`;
  if (typeof o.agent !== "string" || typeof o.contract !== "string" || typeof o.kid !== "string" || typeof o.sig !== "string" || typeof o.createdAt !== "string") return "a field is missing (agent, contract, kid, sig, createdAt)";
  if (didOf(o.kid) !== o.agent) return `the signing key ${o.kid} does not belong to ${o.agent}`;
  if (!Array.isArray(o.files) || !o.files.length || o.files.some((f) => !f || typeof f.path !== "string" || !/^sha256:[0-9a-f]{64}$/.test(f.sha256))) return "files must be a list of paths with sha256 hashes";
  return undefined;
}
