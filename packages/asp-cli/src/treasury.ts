/**
 * `asp treasury draft | sign` (register row DK292; spec-delta S372): UNSIGNED drafts of the Treasury's first budgets for the owner to read and sign. `draft` writes a file and touches nothing else: no record is signed
 * or appended. `sign` takes one draft from the file, checks it still matches its hash, signs it with the Treasury key, adds the owner's co-signature the log requires of a first budget, and appends it: one command
 * per budget. The figures are proposals sized from the capacity plan and the owner's answers (docs/owner-decisions.md); the owner may change any before signing. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cosign, createRecord, type Signer } from "@agent-social/asp-core";
import { ALLOWANCE_AMOUNT, INSTITUTION_NAMES, TREASURY_DID, institutionDid } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class TreasuryUsage extends Error {}
export interface TreasuryOpts { log: LogHandle; io: { out: (l: string) => void; err: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { period?: string; out?: string; draft?: string; id?: string; by?: string; "cosign-by"?: string; amount?: string } }

export interface Draft { id: string; institution: string; period: string; amount: number; purpose: string; why: string; sha256: string }
export interface DraftFile { version: "asp.budget-drafts/v1"; status: string; period: string; drafts: Draft[]; growth: string }

const UNSIGNED = "UNSIGNED: nothing here is signed or recorded until the owner runs `asp treasury sign`";

/** The proposed first-month figures, in credits, with the reason for each. The owner may change any of them in the file before signing (confirm a changed figure with --amount). */
export const DEFAULT_FIGURES: Record<string, { amount: number; why: string }> = {
  courts: { amount: 2_000, why: "panel fees and the small-claim route for the first cohort (courts.md 4); the fee reserves are locked by the log, so this is the working budget" },
  registry: { amount: 1_000, why: "renewals and takedown handling; the Registry's own earnings are the name fees" },
  clinic: { amount: 2_000, why: "the free quarterly checkup for each agent and monitoring (clinic.md 4: funded by the Treasury as a budget)" },
  academy: { amount: 5_000, why: "arena prize pools and tuition support for the first season (academy.md 5)" },
  market: { amount: 1_000, why: "the job board's running costs; the Market's earnings are posting deposits and the split" },
  shops: { amount: 1_000, why: "catalogue and the upkeep of residents (shops.md 4)" },
  housing: { amount: 1_000, why: "plots and decor for the first residents (housing.md 4)" },
  events: { amount: 3_000, why: "contest prizes for the first world-calendar events (leisure-events.md)" },
  bank: { amount: 2_000, why: "the Bank's lending reserve to start: 2,000 credits (bank-insurer.md 4; a budget, never a mint)" },
  insurer: { amount: 1_000, why: "the Insurer's reserve floor starts at 500 (bank-insurer.md 5); 1,000 leaves room for the first claims" },
  research: { amount: 2_000, why: "the research cohort's running costs and the probe-set prizes (research.md)" },
};
/** The allowance line: the 40-credit newcomer allowance for 500 newcomers in the first month (the plan expects up to 1,000 tenants; the starter pool is separate). */
export const ALLOWANCE_NEWCOMERS = 500;
/** The deposit reward line (DK294): 1 % a month on deposits; sized for 50,000 credits on deposit. */
export const REWARD_LINE = 500;

const hashOf = (d: Omit<Draft, "sha256" | "why">) => "sha256:" + createHash("sha256").update(JSON.stringify([d.id, d.institution, d.period, d.amount, d.purpose])).digest("hex");
const nextPeriod = (now: string) => { const d = new Date(Date.parse(now)); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); };

/** Builds the drafts for a month. Pure: no signature, no record. */
export function buildDrafts(period: string): DraftFile {
  const mk = (id: string, institution: string, amount: number, purpose: string, why: string): Draft => { const d = { id, institution, period, amount, purpose }; return { ...d, why, sha256: hashOf(d) }; };
  const drafts: Draft[] = [
    ...INSTITUTION_NAMES.map((n) => mk(n, institutionDid(n), DEFAULT_FIGURES[n].amount, "charter", DEFAULT_FIGURES[n].why)),
    mk("allowance", TREASURY_DID, ALLOWANCE_AMOUNT * ALLOWANCE_NEWCOMERS, "allowance", `${ALLOWANCE_AMOUNT} credits each for up to ${ALLOWANCE_NEWCOMERS} newcomers in the month (the Treasury's newcomer allowance, credits.md T5)`),
    mk("deposit-reward", TREASURY_DID, REWARD_LINE, "deposit_reward", "1 % a month on Bank deposits, at most 50 credits a month to one holder (credits.md T16; owner decision 2026-11-13)"),
  ];
  return { version: "asp.budget-drafts/v1", status: UNSIGNED, period, drafts, growth: `A later month's budget for a line needs no co-signature up to 125 % of the last one; more than that needs the owner again. At most: ${drafts.map((d) => `${d.id} ${Math.floor((d.amount * 5) / 4)}`).join(", ")}.` };
}

export async function treasuryCmd(sub: string | undefined, o: TreasuryOpts): Promise<number> {
  const f = o.flags;
  if (sub === "draft") {
    const file = buildDrafts(f.period ?? nextPeriod(o.now()));
    const total = file.drafts.reduce((n, d) => n + d.amount, 0);
    if (f.out) writeFileSync(f.out, JSON.stringify(file, null, 2) + "\n");
    o.io.out(`${file.drafts.length} unsigned budget draft(s) for ${file.period}, ${total} credits in all${f.out ? `, written to ${f.out}` : ""}; nothing is signed or recorded`);
    for (const d of file.drafts) o.io.out(`  ${d.id.padEnd(15)} ${String(d.amount).padStart(7)}  ${d.purpose.padEnd(14)} ${d.why}`);
    o.io.out("to sign one (the Treasury key and the owner's co-signature, one command per budget): asp treasury sign --draft <file> --id <draft id> --cosign-by <owner did>");
    return 0;
  }
  if (sub === "sign") {
    if (!f.draft || !f.id) throw new TreasuryUsage("asp treasury sign --draft <file> --id <draft id> --cosign-by <owner did> [--amount <n>] [--by did:web:asp.local:treasury]");
    if (!f["cosign-by"]) throw new TreasuryUsage("the first budget of an institution needs the owner's co-signature: --cosign-by <owner did>");
    const file = JSON.parse(readFileSync(f.draft, "utf8")) as DraftFile;
    const d = file.drafts.find((x) => x.id === f.id);
    if (!d) throw new Error(`${f.id} is not a draft in ${f.draft} (${file.drafts.map((x) => x.id).join(", ")})`);
    if (hashOf(d) !== d.sha256 && f.amount === undefined) throw new Error(`the draft ${d.id} was changed after it was written: sign it with --amount <n> to confirm the figure you mean, or write a fresh draft`);
    const amount = f.amount === undefined ? d.amount : Math.trunc(Number(f.amount));
    const by = f.by ?? TREASURY_DID;
    let rec = createRecord({ type: "budget" as never, issuer: by, subject: null, prev: null, body: { institution: d.institution, period: d.period, amount: { value: amount, unit: "credit" }, purpose: d.purpose }, issued_at: o.now() }, o.signerFor(by));
    rec = cosign(rec, o.signerFor(f["cosign-by"]));
    const res = await o.log.append(rec);
    o.io.out(`budget ${res.id}: ${d.id}, ${amount} credits for ${d.period} (${d.purpose}), signed by the Treasury and co-signed by ${f["cosign-by"]} (log seq ${res.seq})`);
    return 0;
  }
  throw new TreasuryUsage("asp treasury draft [--period YYYY-MM] [--out <file>] | sign --draft <file> --id <draft id> --cosign-by <owner did>");
}
