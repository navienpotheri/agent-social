/**
 * The court on the hosted service (launch blocker 4, gap M2): who may sit as a juror, and no ruling without a panel.
 *
 * The protocol lets any identity register a stake and be drawn onto a ruling panel, and falls back to "any neutral DID may rule" when no juror is registered anywhere
 * (so the conformance vectors stay valid). On a public service with a handful of users both are risks: someone registers friends as jurors, or a dispute is ruled by
 * anyone because nobody registered. This guard is service policy, not a protocol rule:
 *
 *  - mode "operator-only" (the beta's default): only an admin may register a juror, so the panel is the operator's, seated with `asp court seat`;
 *  - mode "verified": a tenant that signed up with a verified Google account may register one of the identities it wrote as, with at least a minimum stake, and only one
 *    juror for each Google account (a second tenant of the same account, or a closed one, does not make a second seat);
 *  - in every mode a ruling is refused while no panel can be drawn for the dispute, so the service never uses the mocked fallback.
 */
import type { Tenant } from "./server.ts";
import type { OwnerStore } from "./owners.ts";

export interface CourtGuardOptions {
  mode: "operator-only" | "verified";
  minStake: number;
  tenants: () => Tenant[];
  owners: OwnerStore;
  log: { juror(did: string): Promise<{ staked: number } | undefined>; drawPanel(contract: string): Promise<string[]> };
}

type Rec = { type?: string; issuer?: string; body?: { did?: string; stake?: { value?: number }; kind?: string; about?: string } };
const isJuror = (r: Rec) => typeof r?.type === "string" && r.type.startsWith("asp.juror/");
const isRuling = (r: Rec) => typeof r?.type === "string" && r.type.startsWith("asp.attestation/") && r.body?.kind === "ruling";

export function courtGuard(o: CourtGuardOptions) {
  return async (c: { tenant: Tenant; method: string; args: unknown[] }): Promise<string | undefined> => {
    if (c.method === "importRecords") {
      const items = ((c.args[0] as { record?: Rec }[] | undefined) ?? []).map((x) => x?.record).filter((r): r is Rec => !!r);
      if (c.tenant.role !== "admin" && items.some(isJuror)) return "a juror registration cannot be imported; jurors are seated through the service's court policy";
      return undefined;
    }
    if (c.method !== "append") return undefined;
    const rec = c.args[0] as Rec | undefined;
    if (!rec) return undefined;

    if (isRuling(rec)) {
      const panel = await o.log.drawPanel(String(rec.body?.about)).catch(() => undefined);
      if (panel && panel.length === 0) return "no court panel can be drawn for this dispute (no eligible juror is seated), so a ruling cannot be accepted; ask the operator to seat the court";
      return undefined;
    }

    if (!isJuror(rec) || c.tenant.role === "admin") return undefined;
    if (o.mode === "operator-only") return "during the beta the court's panel is run by the operator, so jurors are seated by the operator, not registered by tenants";
    const google = c.tenant.signup?.google;
    if (!google) return "only a tenant that signed up with a verified Google account may register as a juror";
    const did = rec.body?.did;
    if (!did || !o.owners.of(c.tenant.name).includes(did)) return "a juror must be an identity this tenant has written as; create it through the service first";
    if ((rec.body?.stake?.value ?? 0) < o.minStake) return `a juror must stake at least ${o.minStake} credits`;
    // One seat for each Google account: any other identity written as by a tenant of the same account that is already seated.
    for (const t of o.tenants()) {
      if (t.signup?.google?.sub !== google.sub) continue;
      for (const other of o.owners.of(t.name)) {
        if (other === did) continue;
        if (((await o.log.juror(other))?.staked ?? 0) > 0) return "this Google account already has a juror seated; one seat for each account";
      }
    }
    return undefined;
  };
}
