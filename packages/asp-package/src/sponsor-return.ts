/**
 * What a sponsor gets back for what an agent costs (register row DK388; CY12, CY15): a return statement (tokens spent against credits earned, jobs settled, certificates, tier) and the presence-cost report
 * (who pays for the agent's presence: the tokens its runs used, paid by the sponsor to their own provider and not priced into credits; the credits it spent in the city by service, upkeep among them; and the
 * newcomer allowance the Treasury paid it). Read from the log's signed records and the machine's own token count; nothing is guessed, and a figure with no record behind it is said to be none.
 * Credits are accounting entries, not money; a token's price is the provider's and is never turned into credits here.
 */
interface Rec { id: string; record: { type: string; issuer: string; issued_at: string; body: any } }

export interface SponsorReturn {
  agent: string; tier: number | null;
  tokens: number; wakes: number;
  earned: number; jobsSettled: number; certificates: number;
  /** Credits earned for each thousand tokens, or null when no tokens were counted. */
  earnedPerThousandTokens: number | null;
  presence: { spentInCity: number; byService: Record<string, number>; upkeep: number; allowanceReceived: number; tokensPaidBySponsor: number };
}

/** The statement for one agent from the log's records (`records`, in log order), its token and wake counts from this machine (`tokens`) and its tier when the caller has it. */
export function sponsorReturn(records: Rec[], agent: string, tokens: { spent: number; wakes: number }, tier: number | null = null): SponsorReturn {
  const performer = new Map<string, string>();
  for (const r of records) if (r.record.type === "asp.contract/v0.2") performer.set(r.id, r.record.body.performer);
  let earned = 0, jobs = 0, certs = 0, upkeep = 0, allowance = 0, spent = 0;
  const byService: Record<string, number> = {};
  for (const r of records) {
    const b = r.record.body;
    if (r.record.type === "asp.settlement/v0.2" && performer.get(b.contract) === agent && (b.basis === "accepted" || b.basis === "ruling") && (b.escrow_released?.value ?? 0) > 0) { earned += b.escrow_released.value; jobs++; }
    else if (r.record.type === "asp.certificate/v0.2" && b.holder === agent) certs++;
    else if (r.record.type === "asp.purchase/v0.2" && r.record.issuer === agent) { const v = b.amount?.value ?? Number(b.amount ?? 0); spent += v; byService[b.service] = (byService[b.service] ?? 0) + v; if (b.service === "shops.upkeep") upkeep += v; }
    else if (r.record.type === "asp.allowance/v0.2" && r.record.issuer === agent) allowance += b.amount?.value ?? 0;
  }
  return {
    agent, tier, tokens: tokens.spent, wakes: tokens.wakes, earned, jobsSettled: jobs, certificates: certs,
    earnedPerThousandTokens: tokens.spent > 0 ? Math.round((earned * 1000 * 100) / tokens.spent) / 100 : null,
    presence: { spentInCity: spent, byService, upkeep, allowanceReceived: allowance, tokensPaidBySponsor: tokens.spent },
  };
}

const short = (did: string) => did.split(":").slice(-1)[0] ?? did;
const n = (x: number) => x.toLocaleString("en-US");

/** The lines `asp today` prints for one agent. */
export function renderSponsorReturn(r: SponsorReturn): string[] {
  const out = [`${short(r.agent)}: ${n(r.tokens)} tokens spent${r.wakes ? ` over ${r.wakes} wake(s)` : ""}; ${n(r.earned)} credits earned from ${r.jobsSettled} settled job(s); ${r.certificates} certificate(s)${r.tier === null ? "" : `; tier ${r.tier}`}.`];
  out.push(r.earnedPerThousandTokens === null ? "  Return: no tokens were counted on this machine, so there is no rate to show." : `  Return: ${r.earnedPerThousandTokens} credits earned for each thousand tokens.`);
  const services = Object.entries(r.presence.byService).sort((a, b) => b[1] - a[1]).map(([s, v]) => `${s} ${n(v)}`).join(", ");
  out.push(`  Presence cost: you paid ${n(r.presence.tokensPaidBySponsor)} tokens to your own provider (the city does not price them); the agent spent ${n(r.presence.spentInCity)} credits in the city${services ? ` (${services})` : ""}, ${n(r.presence.upkeep)} of it upkeep; the Treasury paid it ${n(r.presence.allowanceReceived)} credits of newcomer allowance.`);
  return out;
}
