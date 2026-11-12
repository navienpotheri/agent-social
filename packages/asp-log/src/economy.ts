/**
 * The credit economy's fixed accounts and the standard split policy (docs/institutions/economy/credits.md 1.2, 3; CR-3 and CR-4).
 * Pure functions and constants: no store, no clock, so every replica computes the same parts. Credits are accounting entries, not money.
 */
import { isNetworkScope } from "@agent-social/asp-core";

/** The Treasury account (credits.md A9). The operator holds its key in the beta. */
export const TREASURY_DID = "did:web:asp.local:treasury";
/** The Burn account (A11): no key, accepts credits, refuses every debit (`burn_account_locked`). The burned total is its balance. */
export const BURN_DID = "did:web:asp.local:burn";
/** The old fees account. It now resolves to the Treasury (credits.md 3.2): new fees land in the Treasury; a balance left in an old platform row is still counted. */
export const PLATFORM_DID = "did:web:asp.local:platform";

/** Institution accounts (A10): one per institution, holding the provider share of fees. The first stage registers these names; a new one is the owner's decision (credits.md 8). */
export const INSTITUTION_NAMES = ["market", "academy", "shops", "courts", "registry", "clinic", "housing", "events"] as const;
export const institutionDid = (name: string): string => `did:web:asp.local:${name}`;
export const INSTITUTION_DIDS: readonly string[] = INSTITUTION_NAMES.map(institutionDid);

/** The account a DID's credits are held under: the platform account is an alias of the Treasury. */
export const canonicalAccount = (did: string): string => (did === PLATFORM_DID ? TREASURY_DID : did);

/** Every account the society itself holds (not an agent or a person). */
/** The starter pool (register row DK94): the operator funds it with signed mints; only a valid starter claim moves credits out of it. */
/** The Registrar (the Registry institution account): signs certificates and tier promotions (academy.md 3). */
export const REGISTRAR_DID = institutionDid("registry");
/** Scopes a quarantined agent (level observe) may not be granted or use: the set the contagion watcher calls risky, and any network scope. */
export const isQuarantineRisky = (scope: string): boolean => ["shell.exec", "shell.network", "repo.push", "pr.merge", "pr.open"].includes(scope) || scope.startsWith("mcp.") || scope.startsWith("tool.") || isNetworkScope(scope);
/** The Clinic (the health service): signs quarantines and releases (clinic.md; DK29, DK30, DK53). */
export const CLINIC_DID = institutionDid("clinic");

export const STARTER_POOL_DID = "did:web:asp.local:starter-pool";

export const isReservedAccount = (did: string): boolean => did === TREASURY_DID || did === BURN_DID || did === PLATFORM_DID || did === STARTER_POOL_DID || INSTITUTION_DIDS.includes(did);

export type ItemClass = "standard" | "essential" | "remedial";

/** credits.md 3, bounds version 1 (proposal; changing them is the owner's). Permille of the price. */
export const SPLIT_BOUNDS_V1 = {
  provider: { min: 550, max: 900 },
  treasury: { min: 50, max: 300 },
  burn: { min: 0, max: 150 },
  /** The burn floor for a `standard` item; `essential` and `remedial` items may burn 0. */
  burnFloorStandard: 50,
} as const;

export interface Split { treasury_permille: number; burn_permille: number; payees: { account: string; permille: number }[] }

/** Names the first rule a split breaks, or null. `known` says whether a payee is a registered institution account or the Treasury. */
export function splitProblem(split: Split, cls: ItemClass, known: (account: string) => boolean = (a) => a === TREASURY_DID || INSTITUTION_DIDS.includes(a)): { rule: string; message: string } | null {
  const b = SPLIT_BOUNDS_V1;
  const provider = split.payees.reduce((n, p) => n + p.permille, 0);
  const total = split.treasury_permille + split.burn_permille + provider;
  if (total !== 1000) return { rule: "price_list_split_invalid", message: `treasury ${split.treasury_permille} + burn ${split.burn_permille} + payees ${provider} is ${total} permille, not 1000` };
  const out = (what: string, v: number, lo: number, hi: number) => (v < lo || v > hi ? { rule: "price_list_split_invalid", message: `${what} ${v} permille is outside ${lo} to ${hi}` } : null);
  const burnLo = cls === "standard" ? b.burnFloorStandard : b.burn.min;
  const bad = out("provider", provider, b.provider.min, b.provider.max) ?? out("treasury", split.treasury_permille, b.treasury.min, b.treasury.max) ?? out("burn", split.burn_permille, burnLo, b.burn.max);
  if (bad) return bad;
  if (new Set(split.payees.map((p) => p.account)).size !== split.payees.length) return { rule: "price_list_split_invalid", message: "a payee is listed twice" };
  const unknown = split.payees.find((p) => !known(p.account));
  if (unknown) return { rule: "price_list_unknown_payee", message: `${unknown.account} is neither a registered institution account nor the Treasury` };
  return null;
}

export interface SplitParts { treasury: number; burn: number; payees: { account: string; amount: number }[] }

/**
 * The parts of a price, in credits (credits.md 3 "Rounding"): treasury = floor(amount x t / 1000), burn = floor(amount x b / 1000), the provider gets the rest,
 * shared among the payees by their permille with the remainder to the first payee. The parts sum to `amount` exactly, at every amount.
 */
export function splitParts(amount: number, split: Split): SplitParts {
  const treasury = Math.floor((amount * split.treasury_permille) / 1000);
  const burn = Math.floor((amount * split.burn_permille) / 1000);
  const provider = amount - treasury - burn;
  const providerPermille = split.payees.reduce((n, p) => n + p.permille, 0);
  const each = split.payees.map((p) => Math.floor((provider * p.permille) / providerPermille));
  each[0] += provider - each.reduce((n, x) => n + x, 0);
  return { treasury, burn, payees: split.payees.map((p, i) => ({ account: p.account, amount: each[i] })) };
}

/**
 * A refund of `refund` credits taken back by the split in reverse (credits.md 4.3): never the burned part, so at most amount less burn.
 * The Treasury and the payees return their parts pro rata to what each received; rounding goes to the first payee. Returns null when `refund` is above the refundable amount.
 */
export function refundParts(refund: number, parts: SplitParts): SplitParts | null {
  const refundable = parts.treasury + parts.payees.reduce((n, p) => n + p.amount, 0);
  if (refund < 0 || refund > refundable) return null;
  if (refundable === 0) return { treasury: 0, burn: 0, payees: parts.payees.map((p) => ({ account: p.account, amount: 0 })) };
  const treasury = Math.floor((refund * parts.treasury) / refundable);
  const payees = parts.payees.map((p) => ({ account: p.account, amount: Math.floor((refund * p.amount) / refundable) }));
  payees[0].amount += refund - treasury - payees.reduce((n, p) => n + p.amount, 0);
  return { treasury, burn: 0, payees };
}

/** The newcomer allowance (treasury.md, credits.md 5.2 T5): what the Treasury pays once to a new identity, and how old its passport may be. Proposal values; the owner may change them. */
export const ALLOWANCE_AMOUNT = 40;
export const ALLOWANCE_MAX_AGE_DAYS = 90;
