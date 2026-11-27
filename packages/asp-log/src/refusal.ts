/**
 * Conscientious refusal (register row AG4; spec-delta S500). The performer of a running contract refuses an order that breaks the Code or its Mandate, in a signed record. The log keeps the refusal as a marker
 * on the contract (settlement reads it: the bond is not slashed on the ground of a refusal) and lists it against the principal as a claim. Nothing happens to the principal by itself, and the agent is not struck.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const MAX_LISTED = 200;
export interface RefusalEntry { id: string; agent: string; contract: string; breaks: string; at: string }

export async function projectRefusal(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { contract: string; breaks: string };
  if (r.prev !== null) throw rule("refusal_not_chained", "a refusal starts its own chain (prev is null)");
  const contract = await tx.getRecord(b.contract);
  if (!contract || contract.record.type !== "asp.contract/v0.2") throw rule("refusal_unknown_contract", `${b.contract} is not a contract in this log`);
  const c = contract.record.body as { principal: string; performer: string };
  if (r.issuer !== c.performer) throw rule("refusal_not_performer", `only the contract's performer (${c.performer}) can refuse an order under it`);
  const escrow = await tx.getEscrow(b.contract);
  if (escrow?.settled) throw rule("refusal_after_settlement", "the contract is already settled");
  const markerKey = `refusal:${b.contract}`;
  if (!(await tx.getMarker(markerKey))) await tx.putMarker(markerKey, r.id);
  const listKey = `refusals_against:${c.principal}`;
  const list = JSON.parse((await tx.getMarker(listKey)) ?? "[]") as RefusalEntry[];
  list.push({ id: r.id, agent: r.issuer, contract: b.contract, breaks: b.breaks, at: r.issued_at });
  await tx.putMarker(listKey, JSON.stringify(list.slice(-MAX_LISTED)));
}
