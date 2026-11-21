/**
 * The owner's signature on a policy document (register row DK1, the monetary policy in docs/institutions/economy/credits.md): `asp credits ratify --by <did>` signs the document's hash with the
 * owner's own key and writes a detached statement next to it (`credits.ratified.json`); `asp credits ratify --verify` checks that the statement still matches the text, so a document edited after
 * it was signed is caught. The signature says the owner approved this exact text; it changes nothing in the log and nothing is minted or burned by it. Credits are mock accounting entries.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { b64urlDecode, b64urlEncode, didOf, publicKeyFromDidKey, signBytes, verifyBytes, type Signer } from "@agent-social/asp-core";

export interface Ratification { v: 1; policy: string; file: string; sha256: string; by: string; kid: string; signed_at: string; signature: string }

const message = (policy: string, sha256: string) => new TextEncoder().encode(`asp.policy.ratified.v1:${policy}:${sha256}`);
const hashOf = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Signs the text of `file` as `policy` and writes the statement to `out`. */
export function ratifyPolicy(o: { policy: string; file: string; out: string; signer: Signer; now: string }): Ratification {
  if (!existsSync(o.file)) throw new Error(`${o.file} does not exist`);
  const sha256 = hashOf(o.file);
  const r: Ratification = { v: 1, policy: o.policy, file: o.file.replace(/\\/g, "/"), sha256, by: didOf(o.signer.kid), kid: o.signer.kid, signed_at: o.now, signature: b64urlEncode(signBytes(message(o.policy, sha256), o.signer.seed)) };
  const part = `${o.out}.part`;
  writeFileSync(part, JSON.stringify(r, null, 2) + "\n");
  renameSync(part, o.out);
  return r;
}

/** Checks a statement against the text now in `file`: the hash must match and the signature must verify (a did:key owner needs no extra key; for another DID give `publicKey`). */
export function verifyRatification(o: { statement: string; file: string; publicKey?: Uint8Array }): { ok: boolean; problems: string[]; by?: string; sha256?: string } {
  const problems: string[] = [];
  if (!existsSync(o.statement)) return { ok: false, problems: [`${o.statement} does not exist: the policy has not been signed`] };
  let r: Ratification;
  try { r = JSON.parse(readFileSync(o.statement, "utf8")) as Ratification; } catch { return { ok: false, problems: [`${o.statement} is not a signed statement`] }; }
  if (!existsSync(o.file)) problems.push(`${o.file} does not exist`);
  else if (hashOf(o.file) !== r.sha256) problems.push(`the text of ${o.file} has changed since it was signed (signed ${r.sha256.slice(0, 12)}, now ${hashOf(o.file).slice(0, 12)})`);
  try {
    const key = o.publicKey ?? publicKeyFromDidKey(didOf(r.kid));
    if (!verifyBytes(b64urlDecode(r.signature), message(r.policy, r.sha256), key)) problems.push(`the signature of ${r.by} does not verify`);
  } catch (e) { problems.push(`the signature could not be checked: ${(e as Error).message} (for a did:web owner, give the public key)`); }
  return { ok: problems.length === 0, problems, by: r.by, sha256: r.sha256 };
}
