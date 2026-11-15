/**
 * `asp found propose | review | renew | merge | status` (register row DK397; spec-delta S505): founding a market institution. A person or an agent proposes one under an entry stake held in escrow; a quorum of
 * a drawn panel reviews; an approved institution is on probation for 90 days, then active for a year; the founder renews it in the last 60 days of a term; two founders merge one into the other. The charter
 * itself is an `institution_charter` record (kind market) signed by the founder.
 */
import { cosign, createRecord, type Signer } from "@agent-social/asp-core";
import { ENTRY_STAKE, MARKET_PREFIX } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class FoundUsage extends Error {}
export interface FoundOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { by?: string; institution?: string; name?: string; purpose?: string; proposal?: string; decision?: string; reasons?: string[]; successor?: string; cosign?: string[] } }

export async function foundCmd(sub: string | undefined, o: FoundOpts): Promise<number> {
  const f = o.flags;
  const send = async (by: string, body: Record<string, unknown>, extra: string[] = []) => {
    let rec = createRecord({ type: "founding_act", issuer: by, subject: null, prev: null, issued_at: o.now(), body }, o.signerFor(by));
    for (const c of extra) rec = cosign(rec, o.signerFor(c));
    return o.log.append(rec);
  };
  if (sub === "status") {
    if (!f.institution) throw new FoundUsage(`asp found status --institution ${MARKET_PREFIX}<name>`);
    const s = await (o.log as unknown as { log: { marketInstitution(d: string): Promise<{ name: string; founder: string; status: string; stake: number; probationUntil?: string; validUntil?: string; mergedInto?: string } | undefined> } }).log.marketInstitution(f.institution);
    if (!s) { o.io.out(`${f.institution} was not proposed through the founding route`); return 1; }
    o.io.out(`${s.name} (${f.institution}): ${s.status}; founder ${s.founder}; stake ${s.stake}${s.probationUntil ? `; probation until ${s.probationUntil}` : ""}${s.validUntil ? `; term until ${s.validUntil}` : ""}${s.mergedInto ? `; merged into ${s.mergedInto}` : ""}`);
    return 0;
  }
  if (sub === "propose") {
    if (!f.by || !f.institution || !f.name || !f.purpose) throw new FoundUsage(`asp found propose --by <founder did> --institution ${MARKET_PREFIX}<name> --name <text> --purpose <text>   (locks the entry stake of ${ENTRY_STAKE} credits)`);
    const res = await send(f.by, { act: "propose", institution: f.institution, name: f.name, purpose: f.purpose, stake: { value: ENTRY_STAKE, unit: "credit" } });
    o.io.out(`proposal ${res.id}: ${f.institution}; ${ENTRY_STAKE} credits are held until a panel decides or the institution closes (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "review") {
    if (!f.by || !f.proposal || !f.decision || !f.reasons?.length || (f.decision !== "approve" && f.decision !== "reject")) throw new FoundUsage("asp found review --proposal <id> --decision approve|reject --reasons <text> --by <juror did> [--cosign-by <juror did>]...");
    const res = await send(f.by, { act: "review", proposal: f.proposal, decision: f.decision, reasons: f.reasons }, f.cosign ?? []);
    o.io.out(`review ${res.id}: ${f.decision}${f.decision === "approve" ? "; the institution is on probation for 90 days" : "; the stake returns to the founder"} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "renew") {
    if (!f.by || !f.institution) throw new FoundUsage("asp found renew --institution <did> --by <founder did>");
    const res = await send(f.by, { act: "renew", institution: f.institution });
    o.io.out(`renewed ${f.institution} for a year (record ${res.id})`);
    return 0;
  }
  if (sub === "merge") {
    if (!f.by || !f.institution || !f.successor || !f.cosign?.length) throw new FoundUsage("asp found merge --institution <closing did> --successor <did> --by <closing founder> --cosign-by <successor founder>");
    const res = await send(f.by, { act: "merge", institution: f.institution, successor: f.successor }, f.cosign);
    o.io.out(`merged ${f.institution} into ${f.successor}; its stake returned to its founder (record ${res.id})`);
    return 0;
  }
  throw new FoundUsage("asp found propose | review | renew | merge | status");
}
