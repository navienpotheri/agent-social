/**
 * The Insurer (docs/institutions/bank-insurer.md; register row DK20; spec-delta S281): a policy against a bond slash or a failed job, a premium priced by standing and strikes and split to the reserve, the
 * Treasury and the burn, a claim decided by the policy's terms (never by discretion), and a reserve that is never negative and below whose floor no policy is sold. A claim may be paid down to nothing but
 * never beyond the reserve. Credits are accounting entries, not money; nothing here is insurance in a legal sense.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { TREASURY_DID, BURN_DID, institutionDid, splitParts } from "./economy.ts";
import { effectiveClass, higherClass, type JobClass } from "./market.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

export const INSURER_DID = institutionDid("insurer");
/** Premium split (credits.md 3, class standard): reserve 800, Treasury 150, burn 50 permille. */
export const PREMIUM_SPLIT = { treasury_permille: 150, burn_permille: 50, payees: [{ account: INSURER_DID, permille: 800 }] };
/** Bond-slash cover: the premium rate in permille of the insured amount (8 % for a holder with fewer than 3 counted jobs, 4 % after), plus 10 % of it for each recent strike. */
export const BOND_SLASH_RATE = { newcomer: 80, established: 40 } as const;
/**
 * Failed-job cover: a share of the job price by the job's class (DK183; bank-insurer.md 5). The class is the intent's, raised by the Market and capped by what the price supports, as for standing;
 * a job with no class reads as routine, 6 %. A harder job fails more often and costs more to cover: skilled 8 %, critical 10 % (a design choice inside the row, proposal; the owner may tune it).
 */
export const FAILED_JOB_RATE_BY_CLASS: Record<JobClass, number> = { trivial: 60, routine: 60, skilled: 80, critical: 100 };
export const FAILED_JOB_RATE = FAILED_JOB_RATE_BY_CLASS.routine;
export const STRIKE_LOADING_PERMILLE = 100;
/** Cover formula (bank-insurer.md 5): 50 % of the slashed bond after a deductible of 20 % of the slashed amount; failed-job cover is at most 30 % of the price. */
export const COVER_SHARE_PERMILLE = 500;
export const DEDUCTIBLE_PERMILLE = 200;
export const FAILED_JOB_CAP_PERMILLE = 300;
/** No cover for a slash at this fault or above (fraud). */
export const FRAUD_FAULT_PERMILLE = 800;
export const CLAIM_WINDOW_MS = 14 * 86_400_000;
export const STRIKE_WINDOW_MS = 30 * 86_400_000;
/** Reserve floor (bank-insurer.md 5, proposal): the larger of 500, 10 times the largest insured amount and 1.5 times the expected 30-day claims (the last 90 days' claims divided by 3). */
export const FLOOR_MIN = 500;

export const reserveFloor = (largestInsured: number, claims90: number): number => Math.max(FLOOR_MIN, 10 * largestInsured, Math.ceil((1.5 * claims90) / 3));

export type Cover = "bond_slash" | "failed_job";

/** The premium the price list of this module sets for the cover (an integer number of credits, rounded up): by rate, plus 10 % of it per strike in the last 30 days. */
export function premiumFor(cover: Cover, insured: number, price: number, countedJobs: number, strikes: number, jobClass: JobClass = "routine"): number {
  const base = cover === "bond_slash" ? Math.ceil((insured * (countedJobs >= 3 ? BOND_SLASH_RATE.established : BOND_SLASH_RATE.newcomer)) / 1000) : Math.ceil((price * FAILED_JOB_RATE_BY_CLASS[jobClass]) / 1000);
  return base + Math.ceil((base * strikes * STRIKE_LOADING_PERMILLE) / 1000);
}

/** The payout the terms give, before the reserve limits it: null if the event is not covered, with the reason. */
export function payoutFor(cover: Cover, insured: number, price: number, slashed: number, faultPermille: number): { amount: number; reason?: string } {
  if (cover === "bond_slash") {
    if (slashed <= 0) return { amount: 0, reason: "no_slash" };
    if (faultPermille >= FRAUD_FAULT_PERMILLE) return { amount: 0, reason: "fraud" };
    const retained = slashed - Math.ceil((slashed * DEDUCTIBLE_PERMILLE) / 1000);
    const amount = Math.min(insured, Math.floor((retained * COVER_SHARE_PERMILLE) / 1000));
    return amount > 0 ? { amount } : { amount: 0, reason: "below_deductible" };
  }
  if (faultPermille <= 0) return { amount: 0, reason: "no_failure" };
  const gap = Math.max(0, price - slashed);
  const amount = Math.min(insured, Math.floor((price * FAILED_JOB_CAP_PERMILLE) / 1000), gap);
  return amount > 0 ? { amount } : { amount: 0, reason: "no_gap" };
}

export interface InsurerEnv {
  reputation(tx: LogTx, did: string): Promise<{ tier: number; qualifyingJobs: number; strikeLog: { at: string; count: number }[] } | null>;
  debit(tx: LogTx, did: string, amount: number): Promise<void>;
  credit(tx: LogTx, did: string, amount: number): Promise<void>;
}

/** The class a contract's job counts as: its intent's class (raised by the Market, never lowered), capped by the price; no class reads as routine. */
export async function jobClassOfContract(tx: Pick<LogTx, "getRecord" | "getMarker">, contract: AspRecord): Promise<JobClass> {
  const cb = contract.body as { price?: { value: number }; basis?: { intent?: string } };
  const intentId = cb.basis?.intent;
  const intent = intentId ? await tx.getRecord(intentId) : undefined;
  const declared = intent?.record.type === "asp.intent/v0.2" ? (intent.record.body as { class?: JobClass }).class : undefined;
  const raised = intentId ? ((await tx.getMarker(`class_raise:${intentId}`)) as JobClass | undefined) : undefined;
  return effectiveClass(raised && declared ? higherClass(raised, declared) : raised ?? declared, cb.price?.value ?? 0);
}

interface Policy { holder: string; contract: string; cover: Cover; insured: number; validTo: string; claim?: string }
const readPolicy = async (tx: Pick<LogTx, "getMarker">, id: string): Promise<Policy | undefined> => { const raw = await tx.getMarker(`policy:${id}`); return raw ? (JSON.parse(raw) as Policy) : undefined; };
const balanceOf = async (tx: Pick<LogTx, "getAccount">, did: string) => (await tx.getAccount(did))?.balance ?? 0;
const readClaims = async (tx: Pick<LogTx, "getMarker">): Promise<{ at: string; amount: number }[]> => JSON.parse((await tx.getMarker("insurer_claims")) ?? "[]");
const signedBy = (r: AspRecord, did: string) => r.issuer === did || (r.cosigs ?? []).some((c) => c.kid.startsWith(`${did}#`));

/** A policy (bank-insurer.md 3, 5): sold by the Insurer, countersigned by the holder, before the first Action, at the premium the rules set, only if the reserve stays at or above its floor. */
export async function projectPolicy(tx: LogTx, r: AspRecord, env: InsurerEnv): Promise<void> {
  const b = r.body as { holder: string; contract: string; cover: Cover; insured_amount: { value: number }; premium: { value: number }; valid_from: string; valid_to: string };
  if (r.prev !== null) throw rule("policy_not_chained", "a policy starts its own chain (prev is null)");
  if (r.issuer !== INSURER_DID) throw rule("policy_wrong_issuer", `${r.issuer} is not the Insurer (${INSURER_DID}): only the Insurer sells a policy`);
  if (!signedBy(r, b.holder)) throw rule("policy_needs_holder", "a policy is countersigned by its holder");
  if (b.holder === INSURER_DID) throw rule("policy_self_dealing", "the Insurer's account may not buy its own policies");
  if (Date.parse(b.valid_to) <= Date.parse(b.valid_from)) throw rule("policy_dates", "a policy ends after it starts");
  const contract = await tx.getRecord(b.contract);
  const cb = contract?.record.body as { principal?: string; performer?: string; price?: { value: number } } | undefined;
  if (!contract || contract.record.type !== "asp.contract/v0.2" || !cb?.performer || !cb.principal) throw rule("policy_contract_unknown", `${b.contract} is not a contract in this log`);
  const sponsor = (await tx.getPassport(cb.performer))?.sponsor;
  const isBacker = b.holder === cb.performer || b.holder === sponsor;
  if (b.cover === "bond_slash" ? !isBacker : b.holder !== cb.principal) throw rule("policy_holder_not_a_party", b.cover === "bond_slash" ? "bond-slash cover is bought by the one who backs the bond: the performer or its sponsor" : "failed-job cover is bought by the principal");
  if (await tx.getMarker(`acted:${b.contract}`)) throw rule("policy_after_first_action", "cover is bought before the job starts running: the contract already has an Action");
  if (await tx.getMarker(`policy_for:${b.contract}|${b.cover}`)) throw rule("policy_exists", `${b.contract} already has ${b.cover} cover: one policy per contract and cover`);
  const principalSponsor = (await tx.getPassport(cb.principal))?.sponsor;
  if (cb.principal === cb.performer || cb.principal === sponsor || (principalSponsor && principalSponsor === sponsor)) throw rule("policy_linked_parties", "no cover on a job between linked parties (the principal is, or shares a sponsor with, the performer): such a job does not count and could be staged for a claim");
  const price = cb.price?.value ?? 0;
  if (b.insured_amount.value <= 0 || b.insured_amount.value > price) throw rule("policy_insured_amount", `the insured amount is above 0 and at most the job's price (${price})`);
  const holderRep = await env.reputation(tx, b.holder);
  const strikes = (holderRep?.strikeLog ?? []).filter((s) => Date.parse(s.at) >= Date.parse(r.issued_at) - STRIKE_WINDOW_MS).reduce((n, s) => n + s.count, 0);
  const jobClass = await jobClassOfContract(tx, contract.record);
  const premium = premiumFor(b.cover, b.insured_amount.value, price, holderRep?.qualifyingJobs ?? 0, strikes, jobClass);
  if (b.premium.value !== premium) throw rule("premium_mismatch", `the premium for this cover is ${premium} credits (${strikes} recent strike(s) in it${b.cover === "failed_job" ? `, job class ${jobClass}` : ""}), not ${b.premium.value}`);
  const parts = splitParts(premium, PREMIUM_SPLIT);
  const reserveAfter = (await balanceOf(tx, INSURER_DID)) + parts.payees[0].amount;
  const largest = Math.max(Number((await tx.getMarker("insurer_largest")) ?? 0), b.insured_amount.value);
  const claims90 = (await readClaims(tx)).filter((c) => Date.parse(c.at) >= Date.parse(r.issued_at) - 90 * 86_400_000).reduce((n, c) => n + c.amount, 0);
  const floor = reserveFloor(largest, claims90);
  if (reserveAfter < floor) throw rule("reserve_below_floor", `after this sale the reserve would be ${reserveAfter}, below its floor of ${floor} (the larger of ${FLOOR_MIN}, 10 times the largest insured amount ${largest} and 1.5 times the expected 30-day claims): no new policy is sold until the reserve recovers`);
  await env.debit(tx, b.holder, premium);
  await env.credit(tx, INSURER_DID, parts.payees[0].amount);
  await env.credit(tx, TREASURY_DID, parts.treasury);
  await env.credit(tx, BURN_DID, parts.burn);
  await tx.putMarker("insurer_largest", String(largest));
  await tx.putMarker(`policy_for:${b.contract}|${b.cover}`, r.id);
  await tx.putMarker(`policy:${r.id}`, JSON.stringify({ holder: b.holder, contract: b.contract, cover: b.cover, insured: b.insured_amount.value, validTo: b.valid_to } satisfies Policy));
}

/** A claim (bank-insurer.md 3): the holder, on the policy's own contract, citing its settlement, within 14 days of it, once per policy. */
export async function projectClaim(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { policy: string; event: string; amount_claimed: { value: number } };
  if (r.prev !== null) throw rule("claim_not_chained", "a claim starts its own chain (prev is null)");
  const policy = await readPolicy(tx, b.policy);
  if (!policy) throw rule("claim_unknown_policy", `${b.policy} is not a policy in this log`);
  if (r.issuer !== policy.holder) throw rule("claim_not_the_holder", `only the holder (${policy.holder}) claims on its policy`);
  if (policy.claim) throw rule("claim_exists", "one claim per policy");
  const ev = await tx.getRecord(b.event);
  if (!ev || ev.record.type !== "asp.settlement/v0.2" || (ev.record.body as { contract: string }).contract !== policy.contract) throw rule("claim_event_not_the_contract", "the event is the settlement of the policy's own contract");
  if (Date.parse(r.issued_at) - Date.parse(ev.record.issued_at) > CLAIM_WINDOW_MS) throw rule("claim_too_late", "a claim is filed within 14 days of the settlement");
  if (Date.parse(ev.record.issued_at) > Date.parse(policy.validTo)) throw rule("claim_outside_cover", `the settlement is after the policy ended (${policy.validTo})`);
  await tx.putMarker(`policy:${b.policy}`, JSON.stringify({ ...policy, claim: r.id }));
  await tx.putMarker(`claim:${r.id}`, JSON.stringify({ policy: b.policy, event: b.event }));
}

/**
 * A claim decision (bank-insurer.md 3, 5): the Insurer decides by the terms, not by discretion. The log recomputes the payout from the settlement: a denial is allowed only for the reason the terms give, an
 * amount must be what the terms give, or less only because the reserve is short; the payment comes out of the reserve and never exceeds it.
 */
export async function projectClaimDecision(tx: LogTx, r: AspRecord, env: InsurerEnv): Promise<void> {
  const b = r.body as { claim: string; decision: "paid" | "reduced" | "denied"; amount: { value: number }; reason: string };
  if (r.prev !== null) throw rule("decision_not_chained", "a decision starts its own chain (prev is null)");
  if (r.issuer !== INSURER_DID) throw rule("decision_wrong_issuer", `${r.issuer} is not the Insurer (${INSURER_DID}): only the Insurer decides a claim`);
  const raw = await tx.getMarker(`claim:${b.claim}`);
  if (!raw) throw rule("decision_unknown_claim", `${b.claim} is not a claim in this log`);
  const owed = Number((await tx.getMarker(`claim_owed:${b.claim}`)) ?? 0);
  if (await tx.getMarker(`claim_decided:${b.claim}`)) {
    // A claim the reserve could not pay in full was `reduced`, and the rest is owed: the Insurer pays it as the reserve recovers, in later decisions, never beyond what is owed or what the reserve holds (DK183).
    if (owed <= 0) throw rule("decision_exists", "a claim is decided once (a reduced claim may be paid further while an amount is owed)");
    if (b.decision === "denied") throw rule("decision_wrongly_denied", `the claim was reduced and ${owed} credits are owed: a later decision pays the rest, it does not deny it`);
    const reserveNow = await balanceOf(tx, INSURER_DID);
    const dueNow = Math.min(owed, reserveNow);
    if (dueNow <= 0) throw rule("decision_reserve_empty", `${owed} credits are owed on this claim and the reserve holds ${reserveNow}: it is paid when the reserve recovers`);
    if (b.amount.value !== dueNow) throw rule("decision_amount_mismatch", `${owed} are owed and the reserve holds ${reserveNow}: the payment is ${dueNow}, not ${b.amount.value}`);
    if ((b.decision === "paid") !== (dueNow === owed)) throw rule("decision_kind_mismatch", dueNow === owed ? "the last of what is owed is `paid`" : "less than is owed, because the reserve is short, is `reduced` again");
    const policyNow = JSON.parse(raw) as { policy: string };
    await env.debit(tx, INSURER_DID, dueNow);
    await env.credit(tx, (await readPolicy(tx, policyNow.policy))!.holder, dueNow);
    await tx.putMarker("insurer_claims", JSON.stringify([...(await readClaims(tx)), { at: r.issued_at, amount: dueNow }]));
    await tx.putMarker(`claim_owed:${b.claim}`, String(owed - dueNow));
    return;
  }
  const { policy: policyId, event } = JSON.parse(raw) as { policy: string; event: string };
  const policy = (await readPolicy(tx, policyId))!;
  const settlement = (await tx.getRecord(event))!;
  const sb = settlement.record.body as { bond_slashed: { value: number }; basis: string; cites?: string };
  const escrow = await tx.getEscrow(policy.contract);
  const contract = (await tx.getRecord(policy.contract))!.record.body as { performer: string; price: { value: number } };
  const slashed = sb.bond_slashed.value;
  let fault = escrow && escrow.bondLocked > 0 ? Math.ceil((slashed * 1000) / escrow.bondLocked) : 0;
  if (sb.basis === "ruling" && sb.cites) {
    const ruling = await tx.getRecord(sb.cites);
    fault = (ruling?.record.body as { fault?: Record<string, number> } | undefined)?.fault?.[contract.performer] ?? fault;
  }
  const terms = payoutFor(policy.cover, policy.insured, contract.price.value, slashed, fault);
  const reserve = await balanceOf(tx, INSURER_DID);
  const due = Math.min(terms.amount, reserve);
  if (b.decision === "denied") {
    if (terms.amount > 0) throw rule("decision_wrongly_denied", `the terms pay ${terms.amount} on this settlement: a covered event is not denied`);
    if (b.amount.value !== 0) throw rule("decision_amount_mismatch", "a denial pays nothing");
    if (b.reason !== terms.reason) throw rule("decision_wrong_reason", `the terms deny this claim for ${terms.reason}, not ${b.reason}`);
  } else {
    if (terms.amount === 0) throw rule("decision_not_covered", `the terms pay nothing on this settlement (${terms.reason}): the decision is a denial`);
    if (b.amount.value !== due) throw rule("decision_amount_mismatch", `the terms and the reserve give ${due} (terms ${terms.amount}, reserve ${reserve}), not ${b.amount.value}`);
    if ((b.decision === "paid") !== (due === terms.amount)) throw rule("decision_kind_mismatch", due === terms.amount ? "the full amount is `paid`" : "less than the terms give, because the reserve is short, is `reduced`");
    await env.debit(tx, INSURER_DID, due);
    await env.credit(tx, policy.holder, due);
    await tx.putMarker("insurer_claims", JSON.stringify([...(await readClaims(tx)), { at: r.issued_at, amount: due }]));
    if (due < terms.amount) await tx.putMarker(`claim_owed:${b.claim}`, String(terms.amount - due));
  }
  await tx.putMarker(`claim_decided:${b.claim}`, r.id);
}
