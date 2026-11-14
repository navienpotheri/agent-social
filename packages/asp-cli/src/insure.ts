/**
 * `asp insure quote | buy | claim | decide | reserve` (bank-insurer.md; register row DK20; spec-delta S281): cover against a bond slash or a failed job, priced by the rules, a claim decided by the policy's
 * terms. The Insurer's key is the operator's during the beta; the holder countersigns a policy and signs its own claim. Credits are accounting entries, not money; this is not insurance in a legal sense.
 */
import { cosign, createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { INSURER_DID, payoutFor, premiumFor, reserveFloor, type Cover } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class InsureUsage extends Error {}

export interface InsureOpts {
  log: LogHandle;
  io: { out: (l: string) => void; err: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: { contract?: string; cover?: string; amount?: string; by?: string; policy?: string; event?: string; claim?: string; days?: string };
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const cr = (n: number) => ({ value: n, unit: "credit" as const });

async function quote(o: InsureOpts): Promise<{ cover: Cover; insured: number; premium: number; holder: string; price: number }> {
  const f = o.flags;
  if (!f.contract || !f.cover || !f.by) throw new InsureUsage("asp insure quote|buy --contract <id> --cover bond_slash|failed_job --by <holder did> [--amount <insured credits>]");
  if (f.cover !== "bond_slash" && f.cover !== "failed_job") throw new InsureUsage("--cover is bond_slash or failed_job");
  const contract = await o.log.log.get(f.contract);
  if (!contract || contract.record.type !== "asp.contract/v0.2") throw new Error(`${f.contract} is not a contract in the log`);
  const price = (contract.record.body as { price: { value: number } }).price.value;
  const insured = f.amount === undefined ? Math.min(price, f.cover === "bond_slash" ? 20 : Math.floor(price * 0.3)) : Math.trunc(Number(f.amount));
  const rep = await o.log.log.reputationOf(f.by);
  const strikes = rep?.strikes ?? 0;
  return { cover: f.cover, insured, premium: premiumFor(f.cover, insured, price, rep?.qualifyingJobs ?? 0, strikes), holder: f.by, price };
}

export async function insureCmd(sub: string | undefined, o: InsureOpts): Promise<number> {
  const f = o.flags;
  if (sub === "quote") {
    const q = await quote(o);
    o.io.out(`${q.cover} cover for ${q.holder} on ${f.contract}: insured ${q.insured} credits, premium ${q.premium} credits (split 800 reserve, 150 Treasury, 50 burned); pays ${q.cover === "bond_slash" ? "50 % of a slash after a 20 % deductible, nothing for fraud (fault 800 or more)" : "up to 30 % of the price when the job fails"}`);
    return 0;
  }
  if (sub === "buy") {
    const q = await quote(o);
    const at = o.now();
    let rec: AspRecord = createRecord({ type: "policy", issuer: INSURER_DID, subject: q.holder, prev: null, body: { holder: q.holder, contract: f.contract, cover: q.cover, insured_amount: cr(q.insured), premium: cr(q.premium), valid_from: at, valid_to: iso(Date.parse(at) + (f.days === undefined ? 60 : Number(f.days)) * DAY) }, issued_at: at }, o.signerFor(INSURER_DID));
    rec = cosign(rec, o.signerFor(q.holder));
    const res = await o.log.append(rec);
    o.io.out(`policy ${res.id}: ${q.cover} cover, ${q.insured} insured, premium ${q.premium} paid (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "claim") {
    if (!f.policy || !f.event || !f.by) throw new InsureUsage("asp insure claim --policy <id> --event <settlement id> --by <holder did>");
    const rec = createRecord({ type: "claim", issuer: f.by, subject: f.by, prev: null, body: { policy: f.policy, event: f.event, amount_claimed: cr(Number(f.amount ?? 1)) }, issued_at: o.now() }, o.signerFor(f.by));
    const res = await o.log.append(rec);
    o.io.out(`claim ${res.id} on ${f.policy} (log seq ${res.seq}); the Insurer decides it by the terms: asp insure decide --claim ${res.id}`);
    return 0;
  }
  if (sub === "decide") {
    if (!f.claim) throw new InsureUsage("asp insure decide --claim <id>");
    const claim = await o.log.log.get(f.claim);
    if (!claim || claim.record.type !== "asp.claim/v0.2") throw new Error(`${f.claim} is not a claim in the log`);
    const cb = claim.record.body as { policy: string; event: string };
    const policy = (await o.log.log.get(cb.policy))!.record.body as { contract: string; cover: Cover; insured_amount: { value: number } };
    const settlement = (await o.log.log.get(cb.event))!.record.body as { bond_slashed: { value: number }; basis: string; cites?: string };
    const contract = (await o.log.log.get(policy.contract))!.record.body as { performer: string; price: { value: number } };
    const escrow = await o.log.log.escrow(policy.contract);
    let fault = escrow && escrow.bondLocked > 0 ? Math.ceil((settlement.bond_slashed.value * 1000) / escrow.bondLocked) : 0;
    if (settlement.basis === "ruling" && settlement.cites) fault = ((await o.log.log.get(settlement.cites))?.record.body as { fault?: Record<string, number> } | undefined)?.fault?.[contract.performer] ?? fault;
    const terms = payoutFor(policy.cover, policy.insured_amount.value, contract.price.value, settlement.bond_slashed.value, fault);
    const reserve = await o.log.log.balance(INSURER_DID);
    const due = Math.min(terms.amount, reserve);
    const decision = terms.amount === 0 ? "denied" : due === terms.amount ? "paid" : "reduced";
    const rec = createRecord({ type: "claim_decision", issuer: INSURER_DID, subject: null, prev: null, body: { claim: f.claim, decision, amount: cr(decision === "denied" ? 0 : due), reason: terms.amount === 0 ? terms.reason : "covered" }, issued_at: o.now() }, o.signerFor(INSURER_DID));
    const res = await o.log.append(rec);
    o.io.out(`decision ${res.id}: ${decision}${decision === "denied" ? ` (${terms.reason})` : `, ${due} credits paid from the reserve${decision === "reduced" ? " (the reserve was short)" : ""}`} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "report") {
    const period = f.days ?? o.now().slice(0, 7);
    const r = await o.log.log.insurerReport(period);
    o.io.out(`Insurer report ${r.period}: ${r.policiesSold} policy(ies) sold for ${r.premiums} credits in premiums; reserve ${r.reserve} against a floor of ${r.floor} (${r.aboveFloor ? "above" : "BELOW: no new policy is sold"})`);
    for (const d of r.decisions) o.io.out(`  claim ${d.claim.slice(7, 19)}: ${d.decision}${d.decision === "denied" ? "" : ` ${d.amount} credits`}, ${d.reason}`);
    if (!r.decisions.length) o.io.out("  no claim was decided in the period");
    return 0;
  }
  if (sub === "reserve") {
    const reserve = await o.log.log.balance(INSURER_DID);
    o.io.out(`the Insurer's reserve: ${reserve} credits; the floor for a new sale is at least ${reserveFloor(0, 0)} (10 times the largest insured amount, or 1.5 times the expected 30-day claims, if more)`);
    return 0;
  }
  throw new InsureUsage("asp insure quote|buy --contract <id> --cover bond_slash|failed_job --by <holder> [--amount n] | claim --policy <id> --event <settlement id> --by <holder> | decide --claim <id> | reserve | report [--days YYYY-MM]");
}
