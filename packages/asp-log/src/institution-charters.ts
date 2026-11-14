/**
 * Institution charters as records (register rows IS1 and DK382; spec-delta S480; docs/institutions/charter.md). One `institution_charter` record for each version of an institution's charter: the founding is
 * version 1, a change is the next version at least 72 hours later, and a closing is a version with status closed, after which the Treasury sets no budget for the institution. The operator is the officer of every
 * institution in the beta and signs; the owner co-signs the founding, a closing, and any change of officers or funding. State is in markers written inside the append, so a refused record leaves none.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { INSTITUTION_DIDS, TREASURY_DID } from "./economy.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
export const FORUM_DID = "did:web:asp.local:forum";
/** The accounts that have a charter: the eleven institutions, the Treasury and the Forum (twelve charters, the Bank and the Insurer sharing one text). */
export const CHARTERED: readonly string[] = [...INSTITUTION_DIDS, TREASURY_DID, FORUM_DID];
export const CHARTER_NOTICE_MS = 72 * 3600 * 1000;

export interface CharterBody { institution: string; version: number; kind: "sovereign" | "market"; status: "active" | "closed"; text_sha256: string; effective_from: string; officers: string[]; funding: string; reason?: string }
export interface CharterEnv { operator?: string; owner?: string; cosignedBy(r: AspRecord, did: string | undefined): boolean }

export const readCharter = async (tx: Pick<LogTx, "getMarker">, institution: string, version: number): Promise<(CharterBody & { record: string; at: string }) | null> => {
  const raw = await tx.getMarker(`charter_v:${institution}|${version}`);
  return raw ? (JSON.parse(raw) as CharterBody & { record: string; at: string }) : null;
};

export async function projectInstitutionCharter(tx: LogTx, r: AspRecord, env: CharterEnv): Promise<void> {
  const b = r.body as unknown as CharterBody;
  if (r.prev !== null) throw rule("charter_not_chained", "a charter version starts its own chain (prev is null)");
  if (!env.operator || r.issuer !== env.operator) throw rule("charter_wrong_issuer", `${r.issuer} is not the operator (${env.operator ?? "none set"}): the operator is the officer of every institution in the beta and signs its charter`);
  if (!CHARTERED.includes(b.institution)) throw rule("charter_unknown_institution", `${b.institution} is not an institution of the society: the twelve are ${CHARTERED.join(", ")}`);
  const head = Number((await tx.getMarker(`charter_head:${b.institution}`)) ?? 0);
  if (b.version !== head + 1) throw rule("charter_version", `the next charter of ${b.institution} is version ${head + 1}, not ${b.version}`);
  const owner = env.cosignedBy(r, env.owner);
  const prev = head > 0 ? await readCharter(tx, b.institution, head) : null;
  if (!prev) {
    if (b.status !== "active") throw rule("charter_found_active", "a founding charter is active: an institution is closed by a later version");
    if (!owner) throw rule("charter_needs_owner", "the founding of an institution needs the owner's co-signature");
  } else {
    if (prev.status === "closed") throw rule("charter_closed", `${b.institution} is closed (version ${prev.version}): a closed institution is not amended`);
    if (b.kind !== prev.kind) throw rule("charter_kind_fixed", `an institution stays ${prev.kind}: its kind does not change`);
    if (Date.parse(b.effective_from) < Date.parse(r.issued_at) + CHARTER_NOTICE_MS) throw rule("charter_notice", `a later charter takes effect at least 72 hours after it is published: from ${new Date(Date.parse(r.issued_at) + CHARTER_NOTICE_MS).toISOString().replace(/\.\d+Z$/, "Z")}; a charter is never retroactive`);
    const changes = JSON.stringify([...b.officers].sort()) !== JSON.stringify([...prev.officers].sort()) || b.funding !== prev.funding || b.status === "closed";
    if (changes && !owner) throw rule("charter_needs_owner", "a change of officers or funding, and a closing, needs the owner's co-signature");
    if (b.status === "closed" && !b.reason) throw rule("charter_closing_reason", "a closing says why (reason)");
  }
  await tx.putMarker(`charter_v:${b.institution}|${b.version}`, JSON.stringify({ ...b, record: r.id, at: r.issued_at }));
  await tx.putMarker(`charter_head:${b.institution}`, String(b.version));
  if (b.status === "closed") await tx.putMarker(`institution_closed:${b.institution}`, r.id);
}
