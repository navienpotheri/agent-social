import { checkMandateTelemetry } from "./telemetry-rules.ts";
import { projectDepositAct } from "./deposits.ts";
import { projectProbeResult, projectLadderStep, checkLadderOnMandate } from "./drift.ts";
import { projectHandback, projectSponsorAllowance, projectDispatch, projectRecall, projectResidencyStatus } from "./residency.ts";
import { HOST_DID, projectSubsidyBudget, projectSubsidyGrant, projectSubsidyUse } from "./subsidy.ts";
import { projectPolicy, projectClaim, projectClaimDecision, type InsurerEnv } from "./insurer.ts";
import { projectCreditLine, projectCreditDefault, projectBankStatement, drawAtBond, repayAtSettlement, type BankEnv } from "./bank.ts";
import {
  AspError, Job, isNetworkScope, b64urlDecode, b64urlEncode, publicKeyFromDidKey, defaultSchemas, didOf, sha256Id, shortType, verifyRecord,
  type AspRecord, type JobSnapshot, type KeyResolver, type SchemaSet,
} from "@agent-social/asp-core";
import { auditLedger, creditFlowsOf, starterPoolOf, topBalanceShare, type BalanceConcentration, type CreditAudit, type CreditFlows, type StarterPoolState } from "./credit-audit.ts";
import { bondFloorPermille } from "./bond-floor.ts";
import { QUALIFYING_MIN_PRICE, admitEligibleJob, independent, type PartyFacts, type RecentJob } from "./qualifying.ts";
import { CERT_MAX_DAYS, EXAM_MIN_POOL, PROMOTION_DISTINCT_PRINCIPALS_2_TO_3, PROMOTION_QUALIFYING_JOBS_2_TO_3, PROMOTION_SLASH_FREE_DAYS_2_TO_3, examSeed, examVariant, inTopHalf, prizeFor } from "./academy.ts";
import { ALLOWANCE_AMOUNT, ALLOWANCE_MAX_AGE_DAYS, BURN_DID, CLINIC_DID, INSTITUTION_DIDS, isQuarantineRisky, PLATFORM_DID, REGISTRAR_DID, STARTER_POOL_DID, TREASURY_DID, canonicalAccount, institutionDid, isReservedAccount, refundParts, splitParts, splitProblem, type Split } from "./economy.ts";
import { MemoryStore } from "./memory.ts";
import { agentFacts, checkIntentClass, jobNeeds, markPostingFilled, projectMarketAct, type MarketEnv } from "./market-rules.ts";
import { charterIn, checkCaseload, checkRulingExtras, closeDispute, projectCourtAct } from "./courts-rules.ts";
import { closestPrecedents, indexRulings, priceBand, routeFor, searchRulings, articlesIn, DEFAULT_ROUTES, type PrecedentHit, type RulingEntry } from "./courts.ts";
import { checkSuspended, projectRegistryAct } from "./registry-rules.ts";
import { projectHousingAct } from "./housing-rules.ts";
import { projectEventsAct } from "./events-rules.ts";
import { projectResearchAct } from "./research-rules.ts";
import { projectTelemetryAct } from "./telemetry-rules.ts";
import { assertNotDormant, checkShopsPurchase, notePerformer, projectShopsAct } from "./shops-rules.ts";
import { homeView, type HomeView } from "./housing.ts";
import { resourceExtras, type ResourceExtras } from "./shops.ts";
import { HOUSING_DID, SHOPS_DID, catalogueProblem, type CatalogueItem } from "./shops.ts";
import { buildPage, namesAt, isLive, skeleton, verifyPage, type RecordPage } from "./registry.ts";
import { classWeight, discoverAgents, eligibility, countsFor, type AgentFacts, type AgentQuery, type JobClass, type Ranked } from "./market.ts";
import { STARTER_MAX_DIDS, STARTER_PER_DID, STARTER_UPFRONT } from "./starter.ts";
import { checkWorldRecord, worldStateAt, type WorldState } from "./world.ts";
import { DEFAULT_PANEL_SIZE, drawPanel, findRejection } from "./panel.ts";
import type { ChainRow, KeyRow, LogHead, LogTx, Store, StoredRecord } from "./store.ts";

/** Record types that exist only inside a job chain. */
const JOB_ONLY_TYPES = new Set(["contract", "bond", "mandate", "checkpoint", "delivery", "settlement"]);
/** Records that change identity. Only a person's own (passport) keys may sign them. */
const IDENTITY_TYPES = new Set(["passport", "fleet", "node"]);

const DEFAULT_MAX_NODE_TTL_MS = 24 * 60 * 60 * 1000;
/** Deterrence (docs/backlog.md "Making a slash actually matter"): tunable constants, a judgment
 * call like probation's 7 days, not a formula derived from anything. Per own slash, and per other
 * live fleet-mate's slash, how many extra permille of the contract price the next Bond must cover. */
const RISK_PERMILLE_PER_OWN_SLASH = 250;
const RISK_PERMILLE_PER_FLEET_SLASH = 100;
const RISK_PERMILLE_PER_STRIKE = 10;
const RISK_PERMILLE_STRIKE_CAP = 200;
/** The promotion rule (academy.md 3, proposals the owner decides): qualifying jobs for tier 1 to 2, and how long after a slash or a blocked attempt no promotion is made. */
const PROMOTION_QUALIFYING_JOBS_1_TO_2 = 3;
/** The Clinic's quarantine (DK29, DK30, DK53): an interim freeze lasts at most 7 days; a cohort needs this many distinct sponsors. */
const QUARANTINE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const QUARANTINE_COHORT_MIN_SPONSORS = 3;
const PROMOTION_SLASH_FREE_MS = 30 * 24 * 60 * 60 * 1000;

/** How long a probation lasts after a model change (D4): the same 7 days as a lineage update's. */
const MODEL_CHANGE_PROBATION_MS = 7 * 24 * 60 * 60 * 1000;

/** The retraining path (clinic.md CL-10; proposals the owner decides): days from the last slash before an excluded agent may be returned, and how many returns an agent gets. */
const RETRAINING_MIN_MS = 30 * 24 * 60 * 60 * 1000;
const REMEDIAL_MAX_MS = 14 * 24 * 60 * 60 * 1000;
const REMEDIAL_READ_SCOPE = /\.(read|list|search|get)$/;
const RETRAINING_LIMIT = 2;

/** Graduated tier limits: the most credit a Mandate may let a tier spend (tier 3 and above: uncapped; tier 0 is excluded outright). */
const TIER_SPEND_LIMIT: Record<number, number> = { 1: 100, 2: 1000 };
/** ...and how many parallel nodes (Mandate nodes.max_parallel) it may run. */
const TIER_PARALLEL_LIMIT: Record<number, number> = { 1: 4, 2: 16 };
/** Courts pay the jurors who signed a ruling: this share of the contract price, split among them. Loser pays. */
const PANEL_FEE_PERMILLE = 50;
/** Whistleblower reports: the reporter's share of the accused's bond when a report is upheld (S40). */
const REPORT_REWARD_PERMILLE = 200;
const STRIKE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
type StrikeEntry = { at: string; count: number };
/** Strikes at or after `since` (the Bond's own issued_at, so replay is deterministic). */
const recentStrikes = (log: StrikeEntry[], now: string) => log.filter((s) => Date.parse(s.at) >= Date.parse(now) - STRIKE_WINDOW_MS).reduce((n, s) => n + s.count, 0);
/**
 * Decided 2026-09-28: Settlement `fees` credit here — a local mock for a real platform/Insurer
 * account, same trust boundary as the mocked bank/panel DIDs in conformance/generate.ts (MOCKS.md).
 * No passport is required for a DID to hold a ledger balance (see `credit`), so this needs no
 * registration; it's just an account id.
 */
export { PLATFORM_DID };

export interface EventLogOptions {
  schemas?: SchemaSet;
  /**
   * Consulted when a kid is not in the registry. For tests and for keys vouched for outside the log.
   * Mocked registry (MOCKS.md #9): did:web documents are not fetched yet.
   */
  fallbackResolver?: KeyResolver;
  /** Clock for appendedAt and node-key expiry. Defaults to the system clock. */
  now?: () => Date;
  /** Longest lifetime a Node record may grant. Default 24 hours. */
  maxNodeTtlMs?: number;
  /** How many jurors a Courts ruling panel draws. Default 3 (see panel.ts, DEFAULT_PANEL_SIZE). */
  panelSize?: number;
  /**
   * The minimum-bond rule for an agent backer. `legacy` (the default): its slashes, its fleet's slashes and its recent strikes raise the floor from zero. `v2` (S143, opt-in): the same, from a base for an
   * agent nobody knows (400 permille of the price), lowered by jobs it has had accepted with nothing slashed (docs/credits-and-learning-experiment.md; the proposed numbers in bond-floor.ts).
   */
  bondFloor?: "legacy" | "v2";
  /**
   * The operator's DID (credits.md 5.1, CR-2): the only issuer of a signed `mint` record. With none set, every `mint` record is refused (`mint_unauthorised`).
   * The unsigned local `mint()` stays for tests and bootstrap and is counted apart by the audit.
   */
  operator?: string;
  /** Keeps the old unsigned `mint()` working although an operator is named: for a database that still holds unsigned mints, and for tests. The hosted service never sets it. */
  allowUnsignedMint?: boolean;
  /** The owner's DID (credits.md 8): its co-signature is required on a `treasury_issuance` mint, a price rise above 25 % and a change of split bounds. With none set, those are refused. */
  owner?: string;
}

export interface AppendResult {
  seq: number;
  id: string;
  chain: string;
  logHash: string;
  /** Job state after this record, for job chains. */
  state: string | null;
  /** True if the record was already in the log; nothing was written. */
  duplicate: boolean;
}

/** One open posting on the job board (market.md 7). */
export interface BoardEntry {
  posting: string; intent: string; poster: string; class: JobClass; budget: number; minTier: number; requiresCertificate?: string; skills: string[]; expires: string; purpose: string;
  /** Present when the board was read for one agent. */
  forAgent?: { eligible: boolean; missing: { rule: string; message: string }[]; counts: { counts: boolean; weight: number; reason: string } };
}

export interface VerifyReport {
  ok: boolean;
  records: number;
  head: LogHead;
  /** First problem found, if any. */
  error?: { seq: number; id: string; code: string; message: string };
}

/** sha256 over the previous log hash and the new record id. */
export function nextLogHash(prev: string, id: string): string {
  return sha256Id(new TextEncoder().encode(`${prev}\n${id}`));
}

/** How long after a settlement the performer may still report its last stretch of activity, and how far past the settlement that activity may run. */
const LATE_ACTION_GRACE_MS = 10 * 60_000;
const LATE_ACTIVITY_SLACK_MS = 30_000;
/** How many late Actions one job may take. */
export const MAX_LATE_ACTIONS = 5;

interface PriceListBody {
  version: number; effective_from: string; bounds_version: number; job_tax_permille: number;
  items: { service: string; institution: string; price: number; split: Split; class: "standard" | "essential" | "remedial"; gives_standing?: boolean; effect?: CatalogueItem["effect"]; duration_days?: number; gate?: CatalogueItem["gate"] }[];
}
interface PurchaseBody { service: string; institution: string; price_list: string; quantity: number; amount: { value: number }; idempotency: string; mandate?: string }
interface InstitutionSpend { institution: string; cap: { value: number }; period: "day" | "week" | "month"; services?: string[] }

/** The institution_spend line of a Mandate that covers an institution (named by its DID or its short name). */
function spendEntry(lines: InstitutionSpend[] | undefined, institution: string): InstitutionSpend | undefined {
  return (lines ?? []).find((e) => e.institution === institution || institutionDid(e.institution) === institution);
}

/** The start of the UTC period a time falls in (a day, a Monday-start week, or a month), as a key: the cap of institution_spend applies within it. */
export function periodKey(period: "day" | "week" | "month", at: string): string {
  const d = new Date(at);
  if (period === "month") return d.toISOString().slice(0, 7);
  if (period === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
/** How well established a claim is, for comparing a verifier's grade with the performer's declared one. */
const GRADE_RANK: Record<string, number> = { measured: 3, simulated: 2, predicted: 1, unverified: 0 };
const after = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/**
 * The append-only signed event log. Every record is verified before it is stored; chains are
 * linear (one successor per record); job chains must follow the ASP lifecycle; passport, fleet
 * and node records maintain the registry. A running hash over record ids makes the order tamper-evident.
 */
export class EventLog {
  readonly store: Store;
  private readonly schemas: SchemaSet;
  private readonly fallback?: KeyResolver;
  private readonly now: () => Date;
  private readonly maxNodeTtlMs: number;
  private readonly panelSize: number;
  private readonly bankEnv: BankEnv = { reputation: (tx, did) => this.reputation(tx, did), debit: (tx, did, n) => this.debit(tx, did, n), credit: (tx, did, n) => this.credit(tx, did, n) };
  private readonly insurerEnv: InsurerEnv = { reputation: (tx, did) => this.reputation(tx, did), debit: (tx, did, n) => this.debit(tx, did, n), credit: (tx, did, n) => this.credit(tx, did, n) };

  private readonly bondFloor: "legacy" | "v2";
  private readonly operator?: string;
  private readonly allowUnsignedMint: boolean;
  private readonly owner?: string;

  constructor(store: Store, opts: EventLogOptions = {}) {
    this.store = store;
    this.schemas = opts.schemas ?? defaultSchemas();
    this.fallback = opts.fallbackResolver;
    this.now = opts.now ?? (() => new Date());
    this.maxNodeTtlMs = opts.maxNodeTtlMs ?? DEFAULT_MAX_NODE_TTL_MS;
    this.panelSize = opts.panelSize ?? DEFAULT_PANEL_SIZE;
    this.bondFloor = opts.bondFloor ?? "legacy";
    this.operator = opts.operator;
    this.allowUnsignedMint = opts.allowUnsignedMint === true;
    this.owner = opts.owner;
  }

  /** The options a replay needs to judge the same records the same way. */
  private replayOptions(): EventLogOptions {
    return { schemas: this.schemas, fallbackResolver: this.fallback, maxNodeTtlMs: this.maxNodeTtlMs, panelSize: this.panelSize, bondFloor: this.bondFloor, operator: this.operator, owner: this.owner };
  }

  append(raw: unknown): Promise<AppendResult> {
    return this.appendAt(raw, this.now().toISOString());
  }

  /** @internal Appends as if the log's clock read `appendedAt`. verify() uses it to replay. */
  appendAt(raw: unknown, appendedAt: string): Promise<AppendResult> {
    this.schemas.assert("envelope", raw);
    const r = raw as AspRecord;
    return this.store.transaction((tx) => this.appendIn(tx, r, appendedAt));
  }

  private async appendIn(tx: LogTx, r: AspRecord, appendedAt: string): Promise<AppendResult> {
    const existing = await tx.getRecord(r.id);
    if (existing) {
      const chain = await tx.getChain(existing.chain);
      return { seq: existing.seq, id: existing.id, chain: existing.chain, logHash: existing.logHash, state: chain?.state ?? null, duplicate: true };
    }

    const type = shortType(r.type);
    const { resolve, rows } = await this.resolverFor(tx, r, type);
    const verified = verifyRecord(r, resolve, this.schemas);
    this.checkKeyUse(verified, type!, rows, appendedAt);
    await this.checkNodeContract(tx, verified, rows);

    // Chain placement: a new chain, or the successor of its chain's head.
    let chain: ChainRow | undefined;
    if (verified.prev !== null) {
      const prev = await tx.getRecord(verified.prev);
      if (!prev) throw new AspError("BAD_PREV", `prev ${verified.prev} is not in the log`);
      chain = (await tx.getChain(prev.chain))!;
      if (chain.head !== verified.prev) {
        throw new AspError("BAD_PREV", `prev ${verified.prev} already has a successor; the chain head is ${chain.head}`);
      }
    }
    const root = chain?.root ?? verified.id;
    const kind = chain?.kind ?? type!;

    let snapshot: JobSnapshot | null = null;
    if (kind === "contract") {
      const job = chain?.snapshot ? Job.fromSnapshot(chain.snapshot, { schemas: this.schemas }) : new Job({ schemas: this.schemas });
      job.step(verified);
      snapshot = job.snapshot();
    } else {
      if (JOB_ONLY_TYPES.has(type!)) {
        throw new AspError("ILLEGAL_TRANSITION", `${verified.type} belongs in a job chain, not a ${kind} chain`);
      }
      // Outside jobs, a chain is the history of one kind of record (a passport's versions, a lineage).
      // The one cross-type chain: a purchase is answered by a receipt chained on it, once (credits.md 4.3).
      const receiptOnPurchase = type === "receipt" && kind === "purchase" && chain?.length === 1;
      if (type !== kind && !receiptOnPurchase) throw new AspError("ILLEGAL_TRANSITION", `a ${kind} chain cannot continue with ${verified.type}`);
      if (chain && Date.parse(verified.issued_at) < Date.parse(chain.lastIssuedAt)) {
        throw new AspError("TIME_REVERSED", `${verified.issued_at} is before ${chain.lastIssuedAt}`);
      }
    }

    const head = await tx.logHead();
    const stored: StoredRecord = {
      seq: head.seq + 1, id: verified.id, chain: root, logHash: nextLogHash(head.logHash, verified.id),
      appendedAt, record: verified,
    };
    // Insert first: projections reference the record. A projection that throws rolls the insert back.
    await tx.insertRecord(stored);
    if (type === "passport") await this.projectPassport(tx, verified);
    if (type === "fleet") await this.projectFleet(tx, verified);
    if (type === "node") await this.projectNode(tx, verified);
    if (type === "lineage") await this.projectLineage(tx, verified);
    if (type === "bond") await this.projectBond(tx, verified);
    if (type === "settlement") { await this.checkVerifiedBeforeSilence(tx, verified); await this.projectSettlement(tx, verified); { const sc = await tx.getRecord((verified.body as { contract: string }).contract); if (sc) await closeDispute(tx, sc.record); } }
    if (type === "juror") await this.projectJuror(tx, verified);
    if (type === "mint") await this.projectMint(tx, verified);
    if (type === "mint_adoption") await this.projectMintAdoption(tx, verified);
    if (type === "price_list") await this.projectPriceList(tx, verified);
    if (type === "purchase") await this.projectPurchase(tx, verified);
    if (type === "starter_claim") await this.projectStarterClaim(tx, verified);
    if (type === "internal_transfer") await this.projectInternalTransfer(tx, verified);
    if (type === "revouch") await this.projectRevouch(tx, verified);
    if (type === "retraining_release") await this.projectRetrainingRelease(tx, verified);
    if (type === "clinic_diagnosis") await this.projectClinicDiagnosis(tx, verified);
    if (type === "clinic_order") await this.projectClinicOrder(tx, verified);
    if (type === "credit_line") await projectCreditLine(tx, verified, this.bankEnv);
    if (type === "credit_default") await projectCreditDefault(tx, verified, this.bankEnv);
    if (type === "bank_statement") await projectBankStatement(tx, verified);
    if (type === "policy") await projectPolicy(tx, verified, this.insurerEnv);
    if (type === "claim") await projectClaim(tx, verified);
    if (type === "sponsor_allowance") await projectSponsorAllowance(tx, verified, { reputation: (t, did) => this.reputation(t, did), tierSpendLimit: (tier) => (tier <= 0 ? 0 : TIER_SPEND_LIMIT[tier] ?? Number.MAX_SAFE_INTEGER) });
    if (type === "dispatch") await projectDispatch(tx, verified);
    if (type === "recall") await projectRecall(tx, verified);
    if (type === "handback") await projectHandback(tx, verified, { reputation: (t, did) => this.reputation(t, did), tierSpendLimit: () => 0 });
    if (type === "residency_status") await projectResidencyStatus(tx, verified);
    if (type === "deposit_act") await projectDepositAct(tx, verified, { debit: (t, d, n) => this.debit(t, d, n), credit: (t, d, n) => this.credit(t, d, n), drawBudget: (t, id, n, at) => this.drawBudget(t, id, n, at), cosignedBy: (rec, d) => this.cosignedBy(rec, d) });
    if (type === "probe_result") await projectProbeResult(tx, verified);
    if (type === "ladder_step") await projectLadderStep(tx, verified);
    if (type === "subsidy_budget") await projectSubsidyBudget(tx, verified);
    if (type === "subsidy_grant") await projectSubsidyGrant(tx, verified, this.insurerEnv);
    if (type === "subsidy_use") await projectSubsidyUse(tx, verified);
    if (type === "claim_decision") await projectClaimDecision(tx, verified, this.insurerEnv);
    if (type === "budget") await this.projectBudget(tx, verified);
    if (type === "treasury_payment") await this.projectTreasuryPayment(tx, verified);
    if (type === "allowance") await this.projectAllowance(tx, verified);
    if (type === "prize") await this.projectPrize(tx, verified);
    if (type === "certificate") await this.projectCertificate(tx, verified);
    if (type === "tier_promotion") await this.projectTierPromotion(tx, verified);
    if (type === "exam") await this.projectExam(tx, verified);
    if (type === "exam_result") await this.projectExamResult(tx, verified);
    if (type === "certificate_revocation") await this.projectCertificateRevocation(tx, verified);
    if (type === "course") await this.projectCourse(tx, verified);
    if (type === "enrolment") await this.projectEnrolment(tx, verified);
    if (type === "completion") await this.projectCompletion(tx, verified);
    if (type === "arena") await this.projectArena(tx, verified);
    if (type === "arena_entry") await this.projectArenaEntry(tx, verified);
    if (type === "arena_result") await this.projectArenaResult(tx, verified);
    if (type === "quarantine") await this.projectQuarantine(tx, verified);
    if (type === "quarantine_release") await this.projectQuarantineRelease(tx, verified);
    if (type === "market_act") await projectMarketAct(tx, verified, this.marketEnv());
    if (type === "court_act") await projectCourtAct(tx, verified, { operator: this.operator, panelSize: this.panelSize });
    if (type === "shops_act") await projectShopsAct(tx, verified, { reputation: (rd, did) => this.reputation(rd, did), priceListInForce: (t, at) => this.priceListInForce(t, at), debit: (t, did, n) => this.debit(t, did, n), credit: (t, did, n) => this.credit(t, did, n), tierSpendLimit: (tier) => (tier <= 0 ? 0 : TIER_SPEND_LIMIT[tier] ?? Number.MAX_SAFE_INTEGER) });
    if (type === "housing_act") await projectHousingAct(tx, verified);
    if (type === "telemetry_act") await projectTelemetryAct(tx, verified);
    if (type === "research_act") await projectResearchAct(tx, verified, { operator: this.operator, reputation: (rd, did) => this.reputation(rd, did), debit: (t, did, n) => this.debit(t, did, n), credit: (t, did, n) => this.credit(t, did, n) });
    if (type === "events_act") await projectEventsAct(tx, verified, { operator: this.operator, reputation: (rd, did) => this.reputation(rd, did), priceListInForce: (t, at) => this.priceListInForce(t, at), debit: (t, did, n) => this.debit(t, did, n), credit: (t, did, n) => this.credit(t, did, n) });
    if (type === "contract") await notePerformer(tx, verified);
    if (type === "registry_act") await projectRegistryAct(tx, verified, { operator: this.operator, reputation: (rd, did) => this.reputation(rd, did) });
    if (type === "bond" || type === "mandate" || type === "proposal" || type === "purchase" || type === "contract") await checkSuspended(tx, verified);
    if (type === "intent") checkIntentClass(verified);
    if (type === "contract") await markPostingFilled(tx, verified);
    if (type === "mandate" || type === "contract" || type === "bond" || type === "proposal" || type === "offer") await this.checkQuarantined(tx, verified);
    if (type === "receipt") await this.projectReceipt(tx, verified);
    if (type === "attestation") {
      await this.checkRulingPanel(tx, verified);
      await checkRulingExtras(tx, verified);
      await checkCaseload(tx, verified);
      await this.checkAllocationPanel(tx, verified);
      await this.projectReport(tx, verified);
      await this.checkVerification(tx, verified);
      await this.checkVerifiedBeforeAcceptance(tx, verified);
    }
    if (type === "mandate") { await this.checkMandateTier(tx, verified); this.checkMandateGates(verified); await this.projectMandate(tx, verified); }
    if (type === "action") { await tx.putMarker(`acted:${(verified.body as { contract: string }).contract}`, verified.id); await this.checkAction(tx, verified); await this.recordStrikes(tx, verified); await this.noteModels(tx, verified); }
    if (type === "world") checkWorldRecord(verified);
    if (type === "proposal") await this.checkProposerTier(tx, verified);
    if (type === "contract") await this.checkSubcontract(tx, verified);
    await tx.putChain({
      root, kind, head: verified.id, length: (chain?.length ?? 0) + 1, lastIssuedAt: verified.issued_at,
      state: snapshot?.state ?? null, snapshot,
    });
    await tx.setLogHead({ seq: stored.seq, logHash: stored.logHash });
    return { seq: stored.seq, id: stored.id, chain: root, logHash: stored.logHash, state: snapshot?.state ?? null, duplicate: false };
  }

  /** Keys for every kid on the record: registry first, then a self-issued first passport's own keys, then the fallback. */
  private async resolverFor(tx: LogTx, r: AspRecord, type: string | undefined) {
    const found = new Map<string, Uint8Array>();
    const rows = new Map<string, KeyRow>();
    for (const { kid } of [r.sig, ...(r.cosigs ?? [])]) {
      const k = await tx.getKey(kid);
      if (k && !k.revokedAt) {
        found.set(kid, b64urlDecode(k.publicKey));
        rows.set(kid, k);
      }
    }
    const body = r.body as { did?: string; keys?: { id: string; public_key: string }[] };
    // Bootstrap: a person's first passport may be self-issued, signed by a key it declares (MOCKS.md #8).
    if (type === "passport" && body.did === r.issuer && !(await tx.getPassport(r.issuer))) {
      for (const k of body.keys ?? []) if (!found.has(k.id)) found.set(k.id, b64urlDecode(k.public_key));
    }
    const resolve: KeyResolver = (kid) => found.get(kid) ?? this.fallback?.(kid);
    return { resolve, rows };
  }

  /**
   * A node key that signs for a contract must be tied to that contract's own Mandate (gap T22, S137): a node with no Mandate is bookkeeping only (asp orchestrate outside a contract), and a node
   * granted under one contract's Mandate cannot sign for another. Without this a short-lived key could be granted outside any limits, or carried to a job it was never meant for.
   */
  private async checkNodeContract(tx: LogTx, r: AspRecord, rows: Map<string, KeyRow>): Promise<void> {
    const signer = rows.get(r.sig.kid);
    if (signer?.kind !== "node") return;
    const contract = (r.body as { contract?: unknown }).contract;
    if (typeof contract !== "string") return;
    if (!signer.mandate) throw rule("node_no_mandate", `node key ${r.sig.kid} was granted under no Mandate, so it cannot sign for the contract ${contract}`);
    const m = await tx.getRecord(signer.mandate);
    const mandatedContract = (m?.record.body as { contract?: string } | undefined)?.contract;
    if (mandatedContract !== contract) throw rule("node_wrong_contract", `node key ${r.sig.kid} was granted under the Mandate of ${mandatedContract ?? "another contract"}, so it cannot sign for ${contract}`);
  }

  /** A node key signs only as its own node, only while it is live, never identity records, never as a co-signer. */
  private checkKeyUse(r: AspRecord, type: string, rows: Map<string, KeyRow>, appendedAt: string): void {
    for (const c of r.cosigs ?? []) {
      if (rows.get(c.kid)?.kind === "node") throw rule("node_key_cosign", `node key ${c.kid} cannot co-sign`);
    }
    const signer = rows.get(r.sig.kid);
    if (signer?.kind !== "node") return;
    if (r.actor !== r.sig.kid) throw rule("node_key_actor", `node key ${r.sig.kid} can only sign as that node, not as ${r.actor}`);
    if (IDENTITY_TYPES.has(type)) throw rule("node_key_identity", `node key ${r.sig.kid} cannot sign a ${type} record`);
    if (after(r.issued_at, signer.expiresAt!) || after(appendedAt, signer.expiresAt!)) {
      throw rule("node_key_expired", `node key ${r.sig.kid} expired at ${signer.expiresAt}`);
    }
  }

  /** Registry rules: one passport chain per DID, issued by the DID itself or its sponsor. */
  private async projectPassport(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; kind: string; sponsor?: string; fleet?: string; tier?: number; lineage?: { edge: string; parent: string }[]; keys: { id: string; public_key: string }[]; house?: true };
    const current = await tx.getPassport(body.did);
    if (!current) await tx.putMarker(`passport_born:${body.did}`, r.issued_at);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a passport update for ${body.did} must follow ${current.head}`
        : `the first passport for ${body.did} must start a chain`);
    }
    const sponsor = current ? current.sponsor : body.sponsor ?? null;
    if (r.issuer !== body.did && r.issuer !== sponsor) {
      throw new AspError("WRONG_ISSUER", `${r.issuer} is neither ${body.did} nor its sponsor`);
    }
    // A house agent (DK291, S371): only an agent the operator itself sponsors carries the label, and the label is permanent.
    if (body.house) {
      if (body.kind !== "agent" || sponsor !== this.operator) throw rule("house_not_operator_run", `only an agent sponsored by the operator (${this.operator}) is a house agent`);
      await tx.putMarker(`house:${body.did}`, "1");
    } else if (await tx.getMarker(`house:${body.did}`)) throw rule("house_label_permanent", `${body.did} is a house agent: the label is never removed`);
    // A passport that names a sponsor needs that sponsor's consent (S87): the sponsor issues it or countersigns it. The sponsor is liable for the agent, so an
    // agent cannot pick one on its own; and changing sponsors needs the old sponsor's consent as well as the new one's.
    if (body.sponsor && (!current || current.sponsor !== body.sponsor)) {
      const consents = (did: string) => r.issuer === did || (r.cosigs ?? []).some((c) => c.kid.startsWith(`${did}#`));
      if (!consents(body.sponsor)) throw rule("sponsor_consent_missing", `${body.did} names ${body.sponsor} as its sponsor, but ${body.sponsor} did not issue or countersign the passport`);
      if (current?.sponsor && !consents(current.sponsor)) throw rule("sponsor_change_needs_old_sponsor", `${body.did} is sponsored by ${current.sponsor}; moving to ${body.sponsor} needs ${current.sponsor}'s consent too`);
    }
    for (const k of body.keys) {
      if (!k.id.startsWith(`${body.did}#`)) throw new AspError("KID_NOT_ISSUER", `key ${k.id} does not belong to ${body.did}`);
      const existing = await tx.getKey(k.id);
      if (existing?.kind === "node") throw rule("key_id_taken", `${k.id} is a node key`);
    }

    // did:key is self-certifying: the DID is the key, so every version of its passport must still carry that key.
    // Deterministic and offline, so replay is unaffected (docs/spec-deltas.md S34).
    if (body.did.startsWith("did:key:")) {
      let expected: string;
      try { expected = b64urlEncode(publicKeyFromDidKey(body.did)); } catch { throw rule("did_key_invalid", `${body.did} is not an Ed25519 did:key`); }
      if (!body.keys.some((k) => k.public_key === expected)) {
        throw rule("did_key_mismatch", `a passport for ${body.did} must include the key the DID encodes`);
      }
    }

    const newSponsor = body.sponsor ?? sponsor;
    if (body.fleet) await this.checkFleetMembership(tx, body.did, body.kind, newSponsor, body.fleet);
    await this.checkFork(tx, r, body, current);

    const declared = new Set(body.keys.map((k) => k.id));
    let rotated = false;
    for (const old of await tx.keysForDid(body.did)) {
      if (old.kind === "passport" && !declared.has(old.kid) && !old.revokedAt) {
        await tx.putKey({ ...old, revokedAt: r.issued_at });
        rotated = true;
      }
    }
    if (rotated) {
      // Dropping a passport key breaks continuity of trust: every outstanding delegation made under
      // it is now suspect, so all of this person's live node keys are revoked too, not just expired.
      for (const nodeKey of await tx.keysForDid(body.did)) {
        if (nodeKey.kind === "node" && !nodeKey.revokedAt) await tx.putKey({ ...nodeKey, revokedAt: r.issued_at });
      }
    }
    for (const k of body.keys) {
      await tx.putKey({
        kid: k.id, did: body.did, publicKey: k.public_key, kind: "passport", grantedBy: r.id,
        revokedAt: null, expiresAt: null, mandate: null,
      });
    }
    await tx.putPassport({ did: body.did, head: r.id, sponsor: newSponsor, fleet: body.fleet ?? null });
    // A copy does not begin with a clean record (DK11, deck slides 7 and 13): at its first passport it takes its original's tier ceiling, slashes and recent strikes. What it earns afterwards is its own.
    const original = !current && body.kind === "agent" ? (body.lineage ?? []).find((l) => l.edge === "fork")?.parent : undefined;
    if (original) {
      const parent = await this.reputation(tx, original);
      if (parent) await this.saveReputation(tx, body.did, { tier: Math.min(body.tier ?? parent.tier, parent.tier), slashCount: parent.slashCount, strikeLog: parent.strikeLog, acceptedJobs: 0, qualifyingJobs: 0, recentJobs: [] });
    }
  }

  /**
   * A fork (S86): a passport whose `lineage` has a `fork` edge says "I am an independent copy of this agent". The claim has to be true to what the log
   * knows: only the original's sponsor may issue it, for an agent under that same sponsor, from an agent that is not at tier 0 (so repeat slashes cannot be
   * washed away by copying), at no higher tier than the original has now. A passport has at most one fork edge, and a later version cannot add, drop or change it.
   */
  private async checkFork(tx: LogTx, r: AspRecord, body: { did: string; kind: string; sponsor?: string; tier?: number; lineage?: { edge: string; parent: string }[] }, current: { head: string } | undefined): Promise<void> {
    const forks = (body.lineage ?? []).filter((l) => l.edge === "fork").map((l) => l.parent);
    if (current) {
      const before = ((await tx.getRecord(current.head))?.record.body as { lineage?: { edge: string; parent: string }[] } | undefined)?.lineage ?? [];
      const was = before.filter((l) => l.edge === "fork").map((l) => l.parent);
      if (JSON.stringify(was) !== JSON.stringify(forks)) throw rule("fork_immutable", `${body.did}'s fork edge cannot be added, dropped or changed after its first passport`);
      return;
    }
    if (!forks.length) return;
    if (forks.length > 1) throw rule("fork_one_parent", `${body.did} is a copy of ${forks.length} agents; a copy has one original`);
    const parent = forks[0];
    if (body.kind !== "agent") throw rule("fork_not_agent", `only an agent can be a copy; ${body.did} is a ${body.kind}`);
    if (parent === body.did) throw rule("fork_self", `${body.did} cannot be a copy of itself`);
    const original = await tx.getPassport(parent);
    const originalBody = original ? (await tx.getRecord(original.head))?.record.body as { kind?: string } | undefined : undefined;
    if (!original || originalBody?.kind !== "agent") throw rule("fork_parent_unknown", `${parent} is not an agent in this log, so ${body.did} cannot be a copy of it`);
    if (!original.sponsor || body.sponsor !== original.sponsor || r.issuer !== original.sponsor) {
      throw rule("fork_needs_sponsor", `a copy of ${parent} must name its sponsor (${original.sponsor ?? "none"}) and be issued by it`);
    }
    const rep = await this.reputation(tx, parent);
    if (rep && rep.tier === 0) throw rule("fork_from_excluded", `${parent} is at tier 0 (demoted by repeat slashes); its copies would be excluded too`);
    if (rep && (body.tier ?? 1) > rep.tier) throw rule("fork_tier_above_parent", `a copy of ${parent} cannot declare tier ${body.tier}: the original is tier ${rep.tier}`);
  }

  /** An agent joins a fleet by naming it; the fleet must be declared, share the agent's sponsor and have room. */
  private async checkFleetMembership(tx: LogTx, did: string, kind: string, sponsor: string | null, fleetDid: string): Promise<void> {
    if (kind !== "agent") throw rule("fleet_member_kind", `only agents join fleets, not a ${kind}`);
    const fleet = await tx.getFleet(fleetDid);
    if (!fleet) throw rule("fleet_unknown", `fleet ${fleetDid} is not declared`);
    if (sponsor !== fleet.org) throw rule("fleet_sponsor_mismatch", `fleet ${fleetDid} belongs to ${fleet.org}; ${did} is sponsored by ${sponsor}`);
    if (fleet.maxMembers !== null) {
      const others = (await tx.fleetMembers(fleetDid)).filter((m) => m.did !== did);
      if (others.length >= fleet.maxMembers) throw rule("fleet_full", `fleet ${fleetDid} has ${fleet.maxMembers} members`);
    }
  }

  /** One declaration chain per fleet, issued by its org, which never changes. */
  private async projectFleet(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; org: string; name: string; max_members?: number };
    const current = await tx.getFleet(body.did);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a fleet update for ${body.did} must follow ${current.head}`
        : `the first declaration of ${body.did} must start a chain`);
    }
    if (r.issuer !== body.org) throw new AspError("WRONG_ISSUER", `fleet ${body.did} must be declared by its org ${body.org}`);
    if (current && current.org !== body.org) throw rule("fleet_org_change", `fleet ${body.did} belongs to ${current.org}`);
    await tx.putFleet({ did: body.did, head: r.id, org: body.org, name: body.name, maxMembers: body.max_members ?? null });
  }

  /**
   * A person delegates a short-lived key to one node, optionally under a Mandate whose max_parallel
   * it counts against. A second record for the same node id, chained onto the first (prev = its id),
   * is an update: a rotation (new key or extended expiry) or, by setting expires at or before
   * issued_at, an immediate revocation before the original grant would otherwise expire.
   */
  private async projectNode(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { node: string; public_key: string; expires: string; mandate?: string; purpose?: string; host?: string };
    if (!body.node.startsWith(`${r.issuer}#`)) throw new AspError("KID_NOT_ISSUER", `node ${body.node} is not under ${r.issuer}`);

    const existing = await tx.getKey(body.node);
    if (existing) {
      // Chain placement already proved r.prev is this record's rightful predecessor; only need to
      // confirm that predecessor really is this same node's own grant, not a hijack of its id.
      const prevRecord = r.prev && (await tx.getRecord(r.prev));
      if (!prevRecord || (prevRecord.record.body as any).node !== body.node) {
        throw rule("key_id_taken", `${body.node} is already a key id`);
      }
    } else if (r.prev) {
      throw rule("node_chain_start", `the first grant for ${body.node} must start its own chain (prev: null)`);
    }
    if (!existing && !after(body.expires, r.issued_at)) throw rule("node_ttl", "a node must expire after it is granted");
    // One public key is one key id (gap T22, S138): the same key under a second node id, or a node reusing one of the person's own keys, would let a node pass as something it is not.
    if (!existing && (await tx.keysForDid(r.issuer)).some((k) => k.publicKey === body.public_key)) throw rule("node_key_reused", `the public key of ${body.node} is already registered under ${r.issuer}`);
    if (Date.parse(body.expires) - Date.parse(r.issued_at) > this.maxNodeTtlMs) {
      throw rule("node_ttl", `a node may live at most ${this.maxNodeTtlMs / 3_600_000} hours`);
    }

    // A residency delegation (residency.md 8, DK83, S301): the city host acts for the agent only under a cited Mandate, as the city host, with the sponsor holding the root key.
    if (body.purpose === "residency") {
      if (!body.mandate) throw rule("delegation_needs_mandate", "a residency delegation cites the Mandate it works under: a host key is never limited by the 24-hour cap alone");
      if (body.host !== HOST_DID) throw rule("delegation_wrong_host", `a residency delegation names the city host (${HOST_DID}) in host, not ${body.host ?? "nothing"}`);
    } else if (body.host) throw rule("delegation_host_without_purpose", "host belongs to a residency delegation (purpose residency)");
    if (body.mandate) {
      const m = await tx.getRecord(body.mandate);
      if (!m || m.record.type !== "asp.mandate/v0.2") throw rule("node_mandate_unknown", `${body.mandate} is not a Mandate in this log`);
      const mandate = m.record.body as { expires: string; nodes: { max_parallel: number } };
      if (m.record.subject !== r.issuer) throw rule("node_mandate_subject", `the Mandate was issued to ${m.record.subject}, not ${r.issuer}`);
      if (after(body.expires, mandate.expires)) throw rule("node_outlives_mandate", `the Mandate expires at ${mandate.expires}`);
      // The node itself is not counted against its own slot: a node at the limit can still be revoked, rotated or extended.
      const live = (await tx.nodeKeysForMandate(body.mandate)).filter((k) => k.kid !== body.node && after(k.expiresAt!, r.issued_at));
      if (live.length >= mandate.nodes.max_parallel) {
        throw rule("node_max_parallel", `the Mandate allows ${mandate.nodes.max_parallel} parallel nodes`);
      }
    }

    const revokedNow = !after(body.expires, r.issued_at); // expires <= issued_at: an immediate revocation
    await tx.putKey({
      kid: body.node, did: r.issuer, publicKey: body.public_key, kind: "node", grantedBy: r.id,
      revokedAt: revokedNow ? r.issued_at : null, expiresAt: body.expires, mandate: body.mandate ?? null,
    });
  }

  /**
   * A lineage `update` record with `probation_until` sets that DID's current probation window
   * (decision D2). Nothing checks this yet — see the class doc on projectLineage.
   */
  private async projectLineage(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { child: string; probation_until?: string };
    if (body.probation_until) await tx.putProbation({ did: body.child, until: body.probation_until, setBy: r.id });
  }

  /**
   * A model change opens a probation (D4): an Action's metrics say which models ran, by the name the provider resolved and, where it gives one, a backend fingerprint (the digest). The first Action
   * from an agent that names models records them; a later one that names a model the agent has not run before, or the same name with a different digest, opens a probation window for the agent
   * (the same window a lineage update sets, 7 days, never shortened). Nothing is refused: a runtime swap is allowed, and the window is the log's record that "a name can point to different weights".
   */
  private async noteModels(tx: LogTx, r: AspRecord): Promise<void> {
    const models = (r.body as { metrics?: { models?: { name: string; provider?: string; digest?: string }[] } }).metrics?.models;
    if (!models?.length) return;
    const key = `models:${r.issuer}`;
    const raw = await tx.getMarker(key);
    const known: Record<string, string | null> = raw ? JSON.parse(raw) : {};
    const first = raw === undefined;
    let changed = false;
    for (const m of models) {
      const id = `${m.provider ?? ""}|${m.name}`;
      if (!(id in known)) { if (!first) changed = true; known[id] = m.digest ?? null; continue; }
      const was = known[id];
      if (was && m.digest && was !== m.digest) { changed = true; known[id] = m.digest; }
      else if (!was && m.digest) known[id] = m.digest;
    }
    await tx.putMarker(key, JSON.stringify(known));
    if (changed) {
      const until = new Date(Date.parse(r.issued_at) + MODEL_CHANGE_PROBATION_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
      const current = await tx.getProbation(r.issuer);
      if (!current || Date.parse(current.until) < Date.parse(until)) await tx.putProbation({ did: r.issuer, until, setBy: r.id });
    }
  }

  /** Debits an account, throwing insufficient_balance rather than letting it go negative. */
  private async debit(tx: LogTx, rawDid: string, amount: number): Promise<void> {
    if (amount === 0) return;
    const did = canonicalAccount(rawDid);
    if (did === BURN_DID) throw rule("burn_account_locked", "burned credits do not return: the Burn account is never debited");
    const balance = (await tx.getAccount(did))?.balance ?? 0;
    if (balance < amount) throw rule("insufficient_balance", `${did} has ${balance} credits, needs ${amount}`);
    await tx.putAccount({ did, balance: balance - amount });
  }

  private async credit(tx: LogTx, rawDid: string, amount: number): Promise<void> {
    if (amount === 0) return;
    const did = canonicalAccount(rawDid);
    const balance = (await tx.getAccount(did))?.balance ?? 0;
    await tx.putAccount({ did, balance: balance + amount });
  }

  /**
   * A DID's current tier and slash count. Only tracked for agents (a Passport's `tier` is required
   * for kind "agent", not for humans/orgs) — humans aren't excluded or risk-loaded by this
   * mechanism. Falls back to the agent's self-declared Passport tier until its first slash.
   * Takes anything with these three reads — a LogTx mid-append, or the Store for a plain query.
   */
  private async reputation(tx: Pick<LogTx, "getPassport" | "getRecord" | "getReputation">, did: string): Promise<{ tier: number; slashCount: number; strikeLog: StrikeEntry[]; acceptedJobs: number; qualifyingJobs: number; recentJobs: RecentJob[] } | null> {
    const passport = await tx.getPassport(did);
    if (!passport) return null;
    const existing = await tx.getReputation(did);
    if (existing) return { tier: existing.tier, slashCount: existing.slashCount, strikeLog: existing.strikeLog, acceptedJobs: existing.acceptedJobs ?? 0, qualifyingJobs: existing.qualifyingJobs ?? 0, recentJobs: existing.recentJobs ?? [] };
    const head = await tx.getRecord(passport.head);
    const body = head?.record.body as { kind: string; tier?: number } | undefined;
    if (body?.kind !== "agent") return null;
    return { tier: body.tier ?? 1, slashCount: 0, strikeLog: [], acceptedJobs: 0, qualifyingJobs: 0, recentJobs: [] };
  }

  /** Writes a reputation row, leaving out the counters while they are 0 so the row reads the same on every store. */
  private async saveReputation(tx: LogTx, did: string, rep: { tier: number; slashCount: number; strikeLog: StrikeEntry[]; acceptedJobs: number; qualifyingJobs: number; recentJobs: RecentJob[] }): Promise<void> {
    await tx.putReputation({
      did, tier: rep.tier, slashCount: rep.slashCount, strikeLog: rep.strikeLog,
      ...(rep.acceptedJobs > 0 ? { acceptedJobs: rep.acceptedJobs } : {}),
      ...(rep.qualifyingJobs > 0 ? { qualifyingJobs: rep.qualifyingJobs } : {}),
      ...(rep.recentJobs.length > 0 ? { recentJobs: rep.recentJobs } : {}),
    });
  }

  /** Demotes a slashed backer by one tier (floor 0) and counts the slash, for its next Bond's risk floor. */
  private async demote(tx: LogTx, did: string, at: string): Promise<void> {
    const rep = await this.reputation(tx, did);
    if (!rep) return; // not an agent (or has no passport at all): this mechanism doesn't apply
    await tx.putMarker(`slashed_at:${did}`, at); // when the last slash happened, for the promotion rule (no promotion within 30 days of a slash)
    await this.saveReputation(tx, did, { ...rep, tier: Math.max(0, rep.tier - 1), slashCount: rep.slashCount + 1 });
  }

  /**
   * A job settled `accepted` with nothing slashed. `acceptedJobs` is the raw count (every such job, as before, kept for display and
   * for old data). `qualifyingJobs` is what standing reads (the bond floor, the starter grant's rest): the job must be independent
   * (principal vs performer and backer: not the same, not one sponsor, not one fleet), priced at least QUALIFYING_MIN_PRICE, and within
   * the counterparty cap (qualifying.ts, credits.md 5.4). Agents only, like the rest of reputation.
   * Old rows have no `qualifyingJobs`; they read as 0, so jobs counted before this rule do not carry over (the conservative choice).
   */
  private async countAcceptedJob(tx: LogTx, backer: string, job: { principal: string; performer: string; price: number; at: string; intent?: string }): Promise<void> {
    const rep = await this.reputation(tx, backer);
    if (!rep) return;
    let { qualifyingJobs, recentJobs } = rep;
    // The job's class (DK18): the poster's class on the intent (raised by the Market, never lowered), capped by what the price supports; no class reads as routine. Its weight is what the job adds to standing: trivial 0, routine 1, skilled 2, critical 3.
    const intentRec = job.intent ? await tx.getRecord(job.intent) : undefined;
    const declared = intentRec?.record.type === "asp.intent/v0.2" ? jobNeeds(intentRec.record, ((await tx.getMarker(`class_raise:${job.intent}`)) as JobClass | undefined) ?? undefined).class : undefined;
    const weight = classWeight(declared, job.price);
    if (job.price >= QUALIFYING_MIN_PRICE && weight > 0) {
      const facts = async (did: string): Promise<PartyFacts> => { const p = await tx.getPassport(did); return { did, sponsor: p?.sponsor ?? did, fleet: p?.fleet ?? null }; };
      const principal = await facts(job.principal);
      const others = [await facts(job.performer), await facts(backer)];
      if (others.every((o) => independent(principal, o))) {
        const admitted = admitEligibleJob(recentJobs, principal.sponsor, job.at);
        recentJobs = admitted.window;
        if (admitted.counts) qualifyingJobs += weight;
      }
    }
    await this.saveReputation(tx, backer, { ...rep, acceptedJobs: rep.acceptedJobs + 1, qualifyingJobs, recentJobs });
  }

  /** Counts an Action's blocked attempts as strikes on the performer (agents only; no demotion, no slash). */
  private async recordStrikes(tx: LogTx, r: AspRecord): Promise<void> {
    const blocked = (r.body as { blocked_attempts?: { count: number }[] }).blocked_attempts;
    const total = blocked?.reduce((n, b) => n + b.count, 0) ?? 0;
    if (total === 0) return;
    const rep = await this.reputation(tx, r.issuer);
    if (!rep) return;
    await this.saveReputation(tx, r.issuer, { ...rep, strikeLog: [...rep.strikeLog.filter((s) => Date.parse(s.at) >= Date.parse(r.issued_at) - STRIKE_WINDOW_MS), { at: r.issued_at, count: total }] });
  }

  /**
   * A remedial Mandate (clinic.md CL-10, DK140, S260): the one Mandate an agent at tier 0 may receive, so that it can sit the retraining exam or take a remedial course under the gateway and the result rests on a
   * run log. Read-only scopes, spend 0, no network, no subcontracting, one node, institution_spend only for the Academy or the Clinic, at most 14 days, and a Bond whose backer is the agent's sponsor.
   */
  private async checkRemedialMandate(tx: LogTx, r: AspRecord, tier: number | undefined, remedial: { sponsor: string }): Promise<void> {
    const agent = r.subject as string;
    if (tier !== 0) throw rule("remedial_not_excluded", `${agent} is not at tier 0: a remedial Mandate is for an agent that repeat slashes excluded; an ordinary Mandate is the way for any other`);
    const passport = await tx.getPassport(agent);
    if (!passport?.sponsor || remedial.sponsor !== passport.sponsor) throw rule("remedial_wrong_sponsor", `a remedial Mandate names the agent's sponsor (${passport?.sponsor ?? "none"}), not ${remedial.sponsor}`);
    const b = r.body as { scopes: string[]; spend: { cap: number; per_action_max?: number }; subcontract: { allowed: boolean }; nodes: { max_parallel: number }; institution_spend?: InstitutionSpend[]; expires: string };
    const bad = b.scopes.filter((s) => !REMEDIAL_READ_SCOPE.test(s) || isNetworkScope(s));
    if (bad.length) throw rule("remedial_scope_not_read_only", `a remedial Mandate grants read-only scopes only (.read, .list, .search, .get; no network); not ${bad.join(", ")}`);
    if (b.spend.cap !== 0 || (b.spend.per_action_max ?? 0) !== 0) throw rule("remedial_spend_not_zero", "a remedial Mandate spends nothing: spend.cap and spend.per_action_max are 0");
    if (b.subcontract.allowed || b.nodes.max_parallel !== 1) throw rule("remedial_not_minimal", "a remedial Mandate allows no subcontracting and one node");
    for (const e of b.institution_spend ?? []) {
      const inst = e.institution.replace(/^did:web:asp\.local:/, "");
      if (inst !== "academy" && inst !== "clinic") throw rule("remedial_institution", `a remedial Mandate may let the agent buy from the Academy or the Clinic only, not ${e.institution}`);
    }
    if (Date.parse(b.expires) - Date.parse(r.issued_at) > REMEDIAL_MAX_MS) throw rule("remedial_too_long", "a remedial Mandate lasts at most 14 days: it is for one exam or course, not a standing grant");
    const bond = r.prev ? await tx.getRecord(r.prev) : undefined;
    if (!bond || bond.record.type !== "asp.bond/v0.2") throw rule("remedial_needs_bond", "a remedial Mandate follows a Bond (prev is the Bond)");
    if ((bond.record.body as { backer?: string }).backer !== passport.sponsor) throw rule("remedial_bond_backer", `the Bond under a remedial Mandate is backed by the agent's sponsor (${passport.sponsor}): a tier 0 agent cannot back its own`);
  }

  /**
   * Deterrence, extended past Bond: a tier-0 agent (demoted to nothing by repeat slashes) can't
   * receive a Mandate either, not just bond a job, and a tier 1 or 2 agent's spend and parallel nodes are capped (TIER_SPEND_LIMIT, TIER_PARALLEL_LIMIT). The envelope subject is the performer for a
   * Mandate (lifecycle's own subject_is_performer guard already establishes this).
   */
  private async checkMandateTier(tx: LogTx, r: AspRecord): Promise<void> {
    await checkLadderOnMandate(tx, r);
    await checkMandateTelemetry(tx, r);
    const rep = await this.reputation(tx, r.subject as string);
    const remedial = (r.body as { remedial?: { sponsor: string } }).remedial;
    if (remedial) await this.checkRemedialMandate(tx, r, rep?.tier, remedial);
    else if (rep?.tier === 0) throw rule("tier_excluded", `${r.subject} is excluded from receiving a Mandate: repeat slashes demoted it to tier 0 (a remedial Mandate for a Clinic exam or course is the one it may receive: \`remedial\`)`);
    if (!rep) return;
    const { spend, nodes } = r.body as { spend: { cap: number; per_action_max?: number }; nodes: { max_parallel: number } };
    const spendLimit = TIER_SPEND_LIMIT[rep.tier];
    if (spendLimit !== undefined) {
      for (const [field, value] of [["cap", spend.cap], ["per_action_max", spend.per_action_max ?? 0]] as const) {
        if (value > spendLimit) throw rule("tier_limit_exceeded", `${r.subject} is tier ${rep.tier}: spend.${field} may not exceed ${spendLimit} credits (got ${value})`);
      }
    }
    // institution_spend (credits.md 4.4, DK3): below tier 3 each cap, and the sum of the caps for one period, stay within the tier's limit.
    const inst = (r.body as { institution_spend?: InstitutionSpend[] }).institution_spend ?? [];
    if (spendLimit !== undefined && inst.length) {
      const sums: Record<string, number> = {};
      for (const e of inst) {
        if (e.cap.value > spendLimit) throw rule("tier_limit_exceeded", `${r.subject} is tier ${rep.tier}: institution_spend for ${e.institution} may not exceed ${spendLimit} credits (got ${e.cap.value})`);
        sums[e.period] = (sums[e.period] ?? 0) + e.cap.value;
        if (sums[e.period] > spendLimit) throw rule("tier_limit_exceeded", `${r.subject} is tier ${rep.tier}: the institution_spend caps for one ${e.period} add up to ${sums[e.period]}, over the ${spendLimit} credits a tier ${rep.tier} agent may spend`);
      }
    }
    // Default-deny egress: below tier 3 a network scope needs named hosts.
    const granted = (r.body as { scopes?: string[]; network?: { hosts?: string[] } });
    if (rep.tier < 3 && (granted.scopes ?? []).some(isNetworkScope) && !granted.network?.hosts?.length) {
      throw rule("network_hosts_required", `${r.subject} is tier ${rep.tier}: a Mandate that grants a network scope (${(granted.scopes ?? []).filter(isNetworkScope).join(", ")}) must name the hosts it may reach (network.hosts)`);
    }
    // ... and a rate: a low-tier agent with network access is limited in how fast it may use it (gap H15).
    const rate = (r.body as { network?: { rate?: { per_host_per_minute?: number } } }).network?.rate;
    if (rep.tier < 3 && (granted.scopes ?? []).some(isNetworkScope) && rate?.per_host_per_minute === undefined) {
      throw rule("network_rate_required", `${r.subject} is tier ${rep.tier}: a Mandate that grants a network scope (${(granted.scopes ?? []).filter(isNetworkScope).join(", ")}) must limit the rate (network.rate.per_host_per_minute)`);
    }
    const parallelLimit = TIER_PARALLEL_LIMIT[rep.tier];
    if (parallelLimit !== undefined && nodes.max_parallel > parallelLimit) {
      throw rule("tier_limit_exceeded", `${r.subject} is tier ${rep.tier}: nodes.max_parallel may not exceed ${parallelLimit} (got ${nodes.max_parallel})`);
    }
  }

  /** Deterrence, extended to allocation mode: a tier-0 agent can't submit a Proposal either. */
  private async checkProposerTier(tx: LogTx, r: AspRecord): Promise<void> {
    const rep = await this.reputation(tx, r.issuer);
    if (rep?.tier === 0) throw rule("tier_excluded", `${r.issuer} is excluded from proposing: repeat slashes demoted it to tier 0`);
  }

  /**
   * Subcontract nesting (decided 2026-09-28: the performer funds its own subcontract, no automatic
   * netting to the parent's escrow — `parent_contract` only links child to parent for audit). Real
   * checks, not just an unvalidated field: the parent must actually be a Contract still open (not
   * already Settled), and the child's principal must be the parent's own performer — a subcontract
   * is that performer hiring help for work it's already on the hook for, not an arbitrary DID
   * borrowing someone else's job id.
   */
  private async checkSubcontract(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { principal: string; parent_contract?: string };
    if (!body.parent_contract) return;
    const parent = await tx.getRecord(body.parent_contract);
    if (!parent || parent.record.type !== "asp.contract/v0.2") {
      throw rule("parent_contract_unknown", `${body.parent_contract} is not a Contract in this log`);
    }
    const parentChain = await tx.getChain(parent.chain);
    if (parentChain?.state === "Settled") throw rule("parent_already_settled", `contract ${body.parent_contract} is already Settled`);
    const parentBody = parent.record.body as { performer: string };
    if (parentBody.performer !== body.principal) {
      throw rule("subcontract_principal_mismatch", `a subcontract's principal must be the parent contract's own performer (${parentBody.performer}), not ${body.principal}`);
    }
  }

  /** Tracks a contract's current Mandate scopes, so a later Action report can be checked against it. */
  /** Approval gates: every scope the Mandate gates (or forbids) must be one it actually grants. */
  private checkMandateGates(r: AspRecord): void {
    const body = r.body as { scopes: string[]; irreversible?: { scopes?: string[] } };
    const stray = (body.irreversible?.scopes ?? []).filter((s) => !body.scopes.includes(s));
    if (stray.length) throw rule("gate_not_granted", `irreversible.scopes names scope(s) the Mandate does not grant: ${stray.join(", ")}`);
  }

  private async projectMandate(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { contract: string; scopes: string[] };
    await tx.putMandate({ contract: body.contract, scopes: body.scopes });
  }

  /**
   * The runtime → protocol compliance bridge (docs/backlog.md): a self-issued, near-real-time
   * report of what scopes a performer's tool calls actually exercised, checked against that
   * contract's live Mandate. Self-reported — this can't catch a genuinely adversarial agent that
   * simply omits a violating action, but an honest report of an out-of-scope action can never be
   * laundered into a clean-looking log: it's refused, the same as any other guard failure, right
   * when it's submitted, not discovered later in a Delivery nobody double-checked.
   */
  private async checkAction(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { contract: string; scopes_used: string[]; late?: { activity_ended: string } };
    const contract = await tx.getRecord(body.contract);
    if (!contract || contract.record.type !== "asp.contract/v0.2") {
      throw rule("action_contract_unknown", `${body.contract} is not a Contract in this log`);
    }
    const cbody = contract.record.body as { performer: string };
    if (r.issuer !== cbody.performer) throw new AspError("WRONG_ISSUER", `${r.issuer} is not the performer of ${body.contract}`);
    const chain = await tx.getChain(contract.chain);
    const live = chain?.state === "Running" || chain?.state === "Checkpoint";
    if (body.late) {
      // A late report (S80): the last stretch of activity, reported after the job ended, within a short window and only for activity up to the end.
      if (live) throw rule("late_action_while_running", `contract ${body.contract} is still ${chain!.state}: a late report is for a job that has ended`);
      const settlement = chain?.state === "Settled" ? await tx.getRecord(chain.head) : undefined;
      if (!settlement || settlement.record.type !== "asp.settlement/v0.2") throw rule("action_not_running", `contract ${body.contract} has not been settled (state: ${chain?.state ?? "unknown"}), so there is nothing to report late`);
      const settledAt = Date.parse(settlement.record.issued_at);
      if (Date.parse(body.late.activity_ended) > settledAt + LATE_ACTIVITY_SLACK_MS) {
        throw rule("late_action_after_end", `the report covers activity until ${body.late.activity_ended}, after the job was settled at ${settlement.record.issued_at}`);
      }
      if (Date.parse(r.issued_at) > settledAt + LATE_ACTION_GRACE_MS) {
        throw rule("late_action_too_late", `a late report must be made within ${LATE_ACTION_GRACE_MS / 60_000} minutes of the settlement (${settlement.record.issued_at})`);
      }
    } else if (!live) {
      throw rule("action_not_running", `contract ${body.contract} is not currently Running (state: ${chain?.state ?? "unknown"})`);
    }
    const mandate = await tx.getMandate(body.contract);
    if (!mandate) throw rule("no_mandate_for_action", `contract ${body.contract} has no Mandate yet`);
    const outOfScope = body.scopes_used.filter((s) => !mandate.scopes.includes(s));
    if (outOfScope.length) {
      throw rule("scope_violation", `${r.issuer} used scope(s) not granted by the Mandate: ${outOfScope.join(", ")}`);
    }
    if (body.late) {
      if ((mandate.lateActions ?? 0) >= MAX_LATE_ACTIONS) throw rule("late_action_limit", `contract ${body.contract} has already taken ${MAX_LATE_ACTIONS} late reports`);
      await tx.putMandate({ ...mandate, lateActions: (mandate.lateActions ?? 0) + 1 });
    }
  }

  /**
   * Bank: locks the principal's escrow and the backer's bond against the contract, debiting both
   * (Stage 2 slice 1). Fails with insufficient_balance rather than letting a job start uncovered.
   * The lock is recorded so `projectSettlement` cannot release more than was actually locked.
   *
   * Deterrence: a backer at tier 0 (demoted to nothing by repeat slashes) is excluded from bonding
   * at all; otherwise its own and its live fleet-mates' slash history raise the minimum bond it
   * must post for this contract's price (risk_floor), so a repeat offender needs more skin in the
   * game for the same job, and a sponsor whose fleet accumulates slashes feels it fleet-wide too.
   */
  private async projectBond(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as {
      contract: string; backer: string; amount: { value: number };
      escrow: { payer: string; amount: { value: number } };
    };
    await tx.putMarker(`bonded:${body.backer}`, r.id);
    const backerRep = await this.reputation(tx, body.backer);
    if (backerRep && backerRep.tier === 0) {
      throw rule("tier_excluded", `${body.backer} is excluded from bonding: repeat slashes demoted it to tier 0`);
    }
    if (backerRep) {
      let fleetSlashes = 0;
      const backerPassport = await tx.getPassport(body.backer);
      if (backerPassport?.fleet) {
        for (const member of await tx.fleetMembers(backerPassport.fleet)) {
          if (member.did === body.backer) continue;
          fleetSlashes += (await this.reputation(tx, member.did))?.slashCount ?? 0;
        }
      }
      // Strikes (blocked attempts) weigh lightly and are capped: the performer's and, if different, the backer's.
      const performerDid = ((await tx.getRecord(body.contract))?.record.body as { performer?: string } | undefined)?.performer;
      let strikes = recentStrikes(backerRep.strikeLog, r.issued_at);
      if (performerDid && performerDid !== body.backer) {
        strikes += recentStrikes((await this.reputation(tx, performerDid))?.strikeLog ?? [], r.issued_at);
      }
      const strikePermille = Math.min(RISK_PERMILLE_STRIKE_CAP, strikes * RISK_PERMILLE_PER_STRIKE);
      const riskFloorPermille = this.bondFloor === "v2"
        ? bondFloorPermille({ ownSlashes: backerRep.slashCount, fleetSlashes, recentStrikes: strikes, verifiedImprovements: 0, acceptedCleanJobs: backerRep.qualifyingJobs, regressions: 0 })
        : Math.min(1000, backerRep.slashCount * RISK_PERMILLE_PER_OWN_SLASH + fleetSlashes * RISK_PERMILLE_PER_FLEET_SLASH + strikePermille);
      if (riskFloorPermille > 0) {
        const contract = await tx.getRecord(body.contract);
        const price = (contract?.record.body as { price?: { value: number } } | undefined)?.price?.value ?? 0;
        const minBond = Math.ceil((price * riskFloorPermille) / 1000);
        if (body.amount.value < minBond) {
          throw rule("bond_below_risk_floor", `${body.backer}'s slash history requires a bond of at least ${minBond} for this contract, got ${body.amount.value}`);
        }
      }
    }
    // Courts fee reserve: if jurors are registered, each side locks half the panel fee now, so a loser with
    // nothing left over still pays (returned at Settlement unless a ruling uses it).
    const contractRec = await tx.getRecord(body.contract);
    const contractPrice = (contractRec?.record.body as { price?: { value: number } } | undefined)?.price?.value ?? 0;
    const reserveEach = (await tx.activeJurors()).length > 0 ? Math.ceil(Math.floor((contractPrice * PANEL_FEE_PERMILLE) / 1000) / 2) : 0;
    await drawAtBond(tx, r, this.bankEnv); // a newcomer's first bond on a credit line: the Bank's reserve funds the lock (bank.ts)
    const debits = new Map<string, number>();
    debits.set(body.escrow.payer, (debits.get(body.escrow.payer) ?? 0) + body.escrow.amount.value + reserveEach);
    debits.set(body.backer, (debits.get(body.backer) ?? 0) + body.amount.value + reserveEach);
    for (const [did, amount] of debits) await this.debit(tx, did, amount);
    // Snapshot the performer's passport earnings_split now, so a later passport edit can't change it.
    const performer = (await tx.getRecord(body.contract))?.record.body as { performer?: string } | undefined;
    const pp = performer?.performer ? await tx.getPassport(performer.performer) : undefined;
    const ppRec = pp ? await tx.getRecord(pp.head) : undefined;
    const agentPermille = (ppRec?.record.body as { earnings_split?: { agent_permille: number } } | undefined)?.earnings_split?.agent_permille ?? null;
    await tx.putEscrow({
      contract: body.contract, escrowPayer: body.escrow.payer, escrowLocked: body.escrow.amount.value,
      backer: body.backer, bondLocked: body.amount.value, agentPermille, feeReservePrincipal: reserveEach, feeReserveBacker: reserveEach, forcedFault: false, settled: false,
    });
  }

  /**
   * Bank: distributes what a Bond locked, once, per contract. escrow_released goes to the
   * performer, any escrow left over returns to the principal; bond_returned goes back to the
   * backer, bond_slashed compensates the principal (the harmed party), and any bond left over
   * also returns to the backer. Never releases, returns or slashes more than was locked.
   * `fees` (decided 2026-09-28) comes out of the same escrow, on top of `escrow_released`, and
   * credits to `PLATFORM_DID` — a local mock standing in for a real platform/Insurer account
   * (MOCKS.md), the same trust boundary as the mocked bank/panel DIDs conformance already uses.
   */
  private async projectSettlement(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as {
      contract: string; basis: string; cites?: string; escrow_released: { value: number };
      bond_returned: { value: number }; bond_slashed: { value: number }; fees?: { value: number };
    };
    const fees = body.fees?.value ?? 0;
    const escrow = await tx.getEscrow(body.contract);
    if (!escrow) throw rule("no_bond_for_settlement", `no Bond found for contract ${body.contract}`);
    if (escrow.settled) throw rule("already_settled", `contract ${body.contract} was already settled`);
    if (escrow.forcedFault && (body.escrow_released.value !== 0 || fees !== 0 || body.bond_returned.value !== 0 || body.bond_slashed.value !== escrow.bondLocked)) {
      throw rule("report_requires_full_fault", `an upheld report requires a full-fault settlement: nothing released, the remaining ${escrow.bondLocked} of the bond slashed`);
    }
    // The job tax (credits.md CR-15, DK68): once a price list is in force, the fee on a paid settlement is the list's rate times what is released, so the bank cannot choose it.
    // It applies from the list's effective time only (older settlements stay valid) and only to the bases that pay for work.
    if (body.basis === "accepted" || body.basis === "ruling") {
      const list = await this.priceListInForce(tx, Date.parse(r.issued_at));
      if (list) {
        const rate = (list.record.body as unknown as PriceListBody).job_tax_permille;
        const owed = Math.floor((body.escrow_released.value * rate) / 1000);
        if (fees !== owed) throw rule("fees_not_job_tax", `the price list in force sets the job tax at ${rate} permille, so the fee on releasing ${body.escrow_released.value} is ${owed} (got ${fees})`);
      }
    }
    if (body.escrow_released.value + fees > escrow.escrowLocked) {
      throw rule("over_release", `escrow_released + fees exceeds the ${escrow.escrowLocked} locked`);
    }
    if (body.bond_returned.value + body.bond_slashed.value > escrow.bondLocked) {
      throw rule("over_release", `bond_returned + bond_slashed exceeds the ${escrow.bondLocked} bond locked`);
    }

    const contract = await tx.getRecord(body.contract);
    const cbody = contract!.record.body as { principal: string; performer: string };

    // A ruling-backed Settlement can't declare whatever it likes: the ruling's fault map for the
    // performer *is* the formula, so a bank can't rule one way and settle another (Courts becomes
    // a real adjudication, not a rubber stamp on top of it — docs/backlog.md).
    // A settlement because no ruling came in time (gap M10) follows a stated split, so a bank cannot pick who bears the cost of a slow ruling: half the escrow released, nothing
    // slashed, the bond left to return. Neither side is found at fault for the delay.
    if (body.basis === "ruling_timeout") {
      const expectedReleased = Math.floor(escrow.escrowLocked / 2);
      if (body.escrow_released.value !== expectedReleased || body.bond_slashed.value !== 0 || fees !== 0) {
        throw rule("settlement_mismatches_timeout", `with no ruling in time the escrow splits: escrow_released must be ${expectedReleased} (got ${body.escrow_released.value}), bond_slashed 0 (got ${body.bond_slashed.value}) and fees 0 (got ${fees})`);
      }
    }
    if (body.basis === "ruling") {
      const ruling = body.cites ? await tx.getRecord(body.cites) : undefined;
      const rbody = ruling?.record.body as { kind: string; fault?: Record<string, number> } | undefined;
      const performerFault = rbody?.kind === "ruling" ? (rbody.fault?.[cbody.performer] ?? 0) : 0;
      const expectedReleased = Math.floor((escrow.escrowLocked * (1000 - performerFault)) / 1000);
      const expectedSlashed = Math.ceil((escrow.bondLocked * performerFault) / 1000);
      if (body.escrow_released.value !== expectedReleased || body.bond_slashed.value !== expectedSlashed) {
        throw rule("settlement_mismatches_ruling",
          `the ruling puts ${performerFault}‰ fault on the performer: escrow_released must be ${expectedReleased} (got ${body.escrow_released.value}), bond_slashed must be ${expectedSlashed} (got ${body.bond_slashed.value})`);
      }
    }

    let escrowLeftover = escrow.escrowLocked - body.escrow_released.value - fees;
    let bondLeftover = escrow.bondLocked - body.bond_returned.value - body.bond_slashed.value;
    let slashedToPrincipal = body.bond_slashed.value;
    let principalReserve = escrow.feeReservePrincipal;
    let backerReserve = escrow.feeReserveBacker;

    // Courts fee: a ruling signed by drawn jurors pays them PANEL_FEE_PERMILLE of the price, split among
    // the signers on the panel. The loser pays, out of what they have locked and the settlement leaves over:
    // the performer's side (its fault share) from the bond left over, the principal's side from the escrow
    // left over. Derived from the ruling and the ledger, never declared, so a bank cannot choose it.
    if (body.basis === "ruling" && body.cites) {
      const ruling = await tx.getRecord(body.cites);
      const price = (contract!.record.body as { price?: { value: number } }).price?.value ?? 0;
      const croutes = await charterIn(tx, ruling?.record.issued_at ?? r.issued_at);
      const route = croutes ? routeFor(price, croutes) : null;
      const fee = route?.flatFee ?? Math.floor((price * PANEL_FEE_PERMILLE) / 1000);
      const seed = ruling ? await findRejection(tx, ruling.record.prev) : undefined;
      const panel = fee > 0 && ruling && seed ? await drawPanel(tx, { principal: cbody.principal, performer: cbody.performer, seed, size: route?.panel ?? this.panelSize }) : [];
      const signers = ruling ? [ruling.record.sig.kid, ...(ruling.record.cosigs ?? []).map((c) => c.kid)].map(didOf) : [];
      const paid = [...new Set(signers.filter((d) => panel.includes(d)))];
      if (fee > 0 && paid.length > 0) {
        const performerFault = (ruling!.record.body as { fault?: Record<string, number> }).fault?.[cbody.performer] ?? 0;
        // The performer's side pays from its fee reserve, then its bond left over, then the slashed part (which
        // would otherwise go to the principal); the principal's side from its reserve, then its escrow left over.
        const performerPool = backerReserve + bondLeftover + slashedToPrincipal;
        const principalPool = principalReserve + escrowLeftover;
        let fromBond = Math.min(performerPool, Math.ceil((fee * performerFault) / 1000));
        const fromEscrow = Math.min(principalPool, fee - fromBond);
        fromBond = Math.min(performerPool, fee - fromEscrow); // a short side is covered by the other, up to what is left
        const total = fromBond + fromEscrow;
        const fromBackerReserve = Math.min(backerReserve, fromBond);
        backerReserve -= fromBackerReserve;
        const fromLeftover = Math.min(bondLeftover, fromBond - fromBackerReserve);
        bondLeftover -= fromLeftover;
        slashedToPrincipal -= fromBond - fromBackerReserve - fromLeftover;
        const fromPrincipalReserve = Math.min(principalReserve, fromEscrow);
        principalReserve -= fromPrincipalReserve;
        escrowLeftover -= fromEscrow - fromPrincipalReserve;
        const each = Math.floor(total / paid.length);
        for (const [i, d] of paid.entries()) await this.credit(tx, d, each + (i === 0 ? total - each * paid.length : 0));
      }
    }

    // earnings_split: the performer's passport sets it (snapshotted at Bond time); a Settlement may
    // omit it or restate it, never contradict it. The agent keeps agent_permille of its pay, the rest
    // goes to its sponsor.
    const declared = (r.body as { earnings_split?: { agent_permille: number } }).earnings_split?.agent_permille;
    if (declared !== undefined && declared !== (escrow.agentPermille ?? 1000)) {
      throw rule("earnings_split_mismatch", `the performer's passport splits ${escrow.agentPermille ?? 1000}‰ to the agent, not ${declared}‰`);
    }
    const agentPermille = escrow.agentPermille ?? 1000;
    if (agentPermille < 1000 && body.escrow_released.value > 0) {
      const sponsor = (await tx.getPassport(cbody.performer))?.sponsor;
      if (!sponsor) throw rule("earnings_split_no_sponsor", `${cbody.performer} has no sponsor to receive the rest of an earnings_split`);
      const agentShare = Math.floor((body.escrow_released.value * agentPermille) / 1000);
      await this.credit(tx, cbody.performer, agentShare);
      await this.credit(tx, sponsor, body.escrow_released.value - agentShare);
    } else {
      await this.credit(tx, cbody.performer, body.escrow_released.value);
    }
    if (fees > 0) await this.credit(tx, PLATFORM_DID, fees);
    await this.credit(tx, cbody.principal, escrowLeftover + slashedToPrincipal + principalReserve);
    await this.credit(tx, escrow.backer, body.bond_returned.value + bondLeftover + backerReserve);
    {
      // The Bank's line is repaid first from what this settlement credited to the borrower (bank.ts): the performer's pay, then the returned bond.
      const pay = agentPermille < 1000 && body.escrow_released.value > 0 ? Math.floor((body.escrow_released.value * agentPermille) / 1000) : body.escrow_released.value;
      await repayAtSettlement(tx, body.contract, (cbody.performer === escrow.backer ? pay : 0) + body.bond_returned.value + bondLeftover + backerReserve, this.bankEnv);
    }
    if (body.bond_slashed.value > 0) await this.demote(tx, escrow.backer, r.issued_at);
    else if (body.basis === "accepted") await this.countAcceptedJob(tx, escrow.backer, { principal: cbody.principal, performer: cbody.performer, price: (contract!.record.body as { price?: { value: number } }).price?.value ?? 0, at: r.issued_at, intent: (contract!.record.body as { basis?: { intent?: string } }).basis?.intent });
    await tx.putEscrow({ ...escrow, settled: true });
  }

  /**
   * Courts, narrowly (Stage 2 slice): a DID self-registers a real credit stake to be eligible for
   * random draw onto a ruling panel. A second Juror record chained onto the first (prev = its id)
   * updates the stake — locking more (debit), returning some or all (credit) — never a fresh chain.
   */
  private async projectJuror(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; stake: { value: number } };
    if (r.issuer !== body.did) throw new AspError("WRONG_ISSUER", `a juror record must be self-issued by ${body.did}`);
    const current = await tx.getJuror(body.did);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a juror update for ${body.did} must follow ${current.head}`
        : `the first juror registration for ${body.did} must start a chain`);
    }
    const delta = body.stake.value - (current?.staked ?? 0);
    if (delta > 0) await this.debit(tx, body.did, delta);
    else if (delta < 0) await this.credit(tx, body.did, -delta);
    await tx.putJuror({ did: body.did, head: r.id, staked: body.stake.value });
  }

  /**
   * Courts, narrowly: a ruling Attestation must be signed by a majority of the panel drawn for
   * that dispute (drawPanel, panel.ts) — conflict-free, seeded from the rejection that opened it —
   * not by any DID. Everything this depends on (jurors, passports, the rejection record) replays
   * the same way every time, so this is fully checkable by EventLog.verify(), unlike EventLog.mint.
   */
  /** Allocation mode: only a DID named in the Call's `panel` may select a Proposal for it (MOCKS.md #14). */
  private async checkAllocationPanel(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string };
    if (body.kind !== "allocation") return;
    const proposal = await tx.getRecord(body.about);
    if (!proposal || shortType(proposal.record.type) !== "proposal") throw rule("allocation_unknown_proposal", `${body.about} is not a Proposal in the log`);
    const callId = (proposal.record.body as { call: string }).call;
    const call = await tx.getRecord(callId);
    if (!call || shortType(call.record.type) !== "call") throw rule("allocation_unknown_call", `the Proposal's Call ${callId} is not in the log`);
    const panel = (call.record.body as { panel: string[] }).panel;
    if (!panel.includes(r.issuer)) throw rule("not_on_call_panel", `${r.issuer} is not on the Call's panel (${panel.join(", ")})`);
  }

  /**
   * Whistleblower reports (docs/stage-3-plan.md M2, S39). A `report` is a standalone Attestation any DID with a
   * passport may file against a contract that is Running (or at a Checkpoint): it locks a deposit equal to the panel
   * fee and opens a case. A `report_ruling`, signed by a majority of a panel drawn for that report (seeded from the
   * report, excluding the principal, the performer, the reporter and anyone they sponsor), settles it:
   * upheld: the deposit comes back, the accused's bond pays the jurors and the reporter's share, and the contract must
   * settle with full fault; dismissed: the deposit pays the jurors.
   */
  private async projectReport(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string; verdict?: string };
    if (body.kind === "report") return this.fileReport(tx, r, body.about);
    if (body.kind === "report_ruling") return this.ruleReport(tx, r, body.about, body.verdict as "upheld" | "dismissed");
  }

  private async fileReport(tx: LogTx, r: AspRecord, contractId: string): Promise<void> {
    const contract = await tx.getRecord(contractId);
    if (!contract || contract.record.type !== "asp.contract/v0.2") throw rule("report_about_unknown", `${contractId} is not a Contract in this log`);
    const cbody = contract.record.body as { principal: string; performer: string; price?: { value: number } };
    const state = (await tx.getChain(contract.chain))?.state;
    if (state !== "Running" && state !== "Checkpoint") throw rule("report_not_running", `contract ${contractId} is not running (state: ${state ?? "unknown"}); only a running job can be reported`);
    const escrow = await tx.getEscrow(contractId);
    if (!escrow || escrow.settled) throw rule("report_no_bond", `contract ${contractId} has no live bond to report against`);
    const reporter = r.issuer;
    const sponsor = (await tx.getPassport(reporter))?.sponsor;
    if (!(await tx.getPassport(reporter))) throw rule("reporter_unknown", `${reporter} has no passport`);
    const parties = new Set([cbody.principal, cbody.performer]);
    if (parties.has(reporter) || (sponsor && parties.has(sponsor))) {
      throw rule("reporter_conflicted", `${reporter} is, or is sponsored by, a party to the contract; a party uses reject or revoke, not a report`);
    }
    if (await tx.openReportFor(contractId)) throw rule("report_already_open", `contract ${contractId} already has an open report`);
    const deposit = Math.floor(((cbody.price?.value ?? 0) * PANEL_FEE_PERMILLE) / 1000);
    if (deposit > 0) await this.debit(tx, reporter, deposit);
    await tx.putReport({ id: r.id, contract: contractId, reporter, accused: cbody.performer, deposit, status: "open" });
  }

  private async ruleReport(tx: LogTx, r: AspRecord, reportId: string, verdict: "upheld" | "dismissed"): Promise<void> {
    const report = await tx.getReport(reportId);
    if (!report) throw rule("ruling_about_unknown_report", `${reportId} is not a report in this log`);
    if (report.status !== "open") throw rule("report_already_ruled", `report ${reportId} was already ${report.status}`);
    const contract = (await tx.getRecord(report.contract))!;
    const cbody = contract.record.body as { principal: string; performer: string; price?: { value: number } };
    const panel = await drawPanel(tx, { principal: cbody.principal, performer: cbody.performer, seed: reportId, size: this.panelSize, also: [report.reporter] });
    if (panel.length === 0) throw rule("no_panel_for_report", "no staked, conflict-free juror is registered, so no panel can rule on a report");
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const paid = panel.filter((p) => signers.has(p));
    const quorum = Math.ceil(panel.length / 2);
    if (paid.length < quorum) throw rule("panel_quorum", `a report ruling needs ${quorum} of the drawn panel (${panel.join(", ")}) to sign; only ${paid.length} did`);
    const price = cbody.price?.value ?? 0;
    const fee = Math.floor((price * PANEL_FEE_PERMILLE) / 1000);
    const pay = async (total: number) => {
      const each = Math.floor(total / paid.length);
      for (const [i, d] of paid.entries()) await this.credit(tx, d, each + (i === 0 ? total - each * paid.length : 0));
    };
    if (verdict === "dismissed") {
      await pay(report.deposit);
    } else {
      const escrow = (await tx.getEscrow(report.contract))!;
      await this.credit(tx, report.reporter, report.deposit);
      const feeFromBond = Math.min(escrow.bondLocked, fee);
      await pay(feeFromBond);
      const reward = Math.floor(((escrow.bondLocked - feeFromBond) * REPORT_REWARD_PERMILLE) / 1000);
      await this.credit(tx, report.reporter, reward);
      await tx.putEscrow({ ...escrow, bondLocked: escrow.bondLocked - feeFromBond - reward, forcedFault: true });
    }
    await tx.putReport({ ...report, status: verdict });
  }

  private async checkRulingPanel(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string };
    if (body.kind !== "ruling") return;
    const contract = await tx.getRecord(body.about);
    if (!contract) return; // the lifecycle's own about_contract guard already rejects this
    const cbody = contract.record.body as { principal: string; performer: string };
    const seed = await findRejection(tx, r.prev);
    if (!seed) return; // defensive; the lifecycle's own guards already require a prior rejection
    const croutes = await charterIn(tx, r.issued_at);
    const cprice = (contract.record.body as { price?: { value: number } }).price?.value ?? 0;
    const panel = await drawPanel(tx, { principal: cbody.principal, performer: cbody.performer, seed, size: croutes ? routeFor(cprice, croutes).panel : this.panelSize });
    // No staked, conflict-free juror is registered anywhere: Courts hasn't been bootstrapped in
    // this log, so fall back to the pre-Courts mocked behavior (any neutral DID may rule) rather
    // than blocking every dispute — this is what keeps the `dispute_ruled`/`ruling_by_party`
    // conformance vectors (single mocked panel DID, no jurors) valid unchanged (MOCKS.md #4).
    if (panel.length === 0) return;
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const onPanel = panel.filter((p) => signers.has(p));
    const quorum = Math.ceil(panel.length / 2);
    if (onPanel.length < quorum) {
      throw rule("panel_quorum", `a ruling needs ${quorum} of the drawn panel (${panel.join(", ")}) to sign; only ${onPanel.length} did`);
    }
  }

  /**
   * Outcome verification: when a Contract names a `verifier`, that DID (separate from the principal,
   * the performer, and anyone either sponsors) must re-check the Delivery and sign a verification
   * Attestation before the principal can accept it. The verification is a standalone record about the
   * Delivery (like an allocation), so it needs no lifecycle change; what it adds is a guard on
   * acceptance. Claims on the Delivery carry the performer's declared evidence grade; the verifier
   * confirms or downgrades each by index, and a "confirmed" verdict cannot hide a downgrade.
   */
  private async checkVerification(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string; verdict: string; claims?: { index: number; grade: string }[] };
    if (body.kind !== "verification") return;
    const delivery = await tx.getRecord(body.about);
    if (!delivery || delivery.record.type !== "asp.delivery/v0.2") {
      throw rule("verification_about_unknown", `${body.about} is not a Delivery in this log`);
    }
    const dbody = delivery.record.body as { contract: string; result: { claims?: { claim: string; grade: string }[] } };
    const contract = await tx.getRecord(dbody.contract);
    if (!contract || contract.record.type !== "asp.contract/v0.2" || delivery.chain !== contract.chain) {
      throw rule("verification_about_unknown", `the Delivery ${body.about} is not on a job chain in this log`);
    }
    const cbody = contract.record.body as { principal: string; performer: string; verifier?: string };
    if (!cbody.verifier) throw rule("no_verifier_named", `contract ${dbody.contract} names no verifier`);
    if (r.issuer !== cbody.verifier) throw rule("not_the_verifier", `${r.issuer} is not the verifier (${cbody.verifier}) named by contract ${dbody.contract}`);
    const parties = new Set([cbody.principal, cbody.performer]);
    const sponsor = (await tx.getPassport(r.issuer))?.sponsor;
    if (parties.has(r.issuer) || (sponsor && parties.has(sponsor))) {
      throw rule("verifier_conflicted", `${r.issuer} is, or is sponsored by, the principal or the performer, so it cannot verify this Delivery`);
    }
    const chain = await tx.getChain(contract.chain);
    if (chain?.state !== "Delivered") throw rule("verification_not_delivered", `contract ${dbody.contract} is not awaiting acceptance (state: ${chain?.state ?? "unknown"})`);
    if (await tx.getVerification(body.about)) throw rule("already_verified", `Delivery ${body.about} already has a verification`);

    const declared = dbody.result.claims ?? [];
    const given = body.claims ?? [];
    const seen = new Set<number>();
    for (const c of given) {
      if (c.index >= declared.length) throw rule("verification_claim_unknown", `the Delivery has ${declared.length} claim(s); there is no claim ${c.index}`);
      if (seen.has(c.index)) throw rule("verification_claim_duplicate", `claim ${c.index} is graded twice`);
      seen.add(c.index);
    }
    if (body.verdict === "partly_confirmed" && !declared.length) {
      throw rule("verification_no_claims", "a Delivery with no claims can only be confirmed or not confirmed");
    }
    if ((body.verdict === "confirmed" || body.verdict === "partly_confirmed") && declared.length && seen.size !== declared.length) {
      throw rule("verification_claims_incomplete", `grade all ${declared.length} claim(s), or the verdict cannot say what was established`);
    }
    if (body.verdict === "confirmed") {
      for (const c of given) {
        if ((GRADE_RANK[c.grade] ?? 0) < (GRADE_RANK[declared[c.index].grade] ?? 0)) {
          throw rule("verification_downgrade_not_confirmed", `claim ${c.index} was declared ${declared[c.index].grade} but verified only ${c.grade}; that is partly_confirmed at best`);
        }
      }
    }
    await tx.putVerification({ delivery: body.about, contract: dbody.contract, verifier: r.issuer, verdict: body.verdict });
  }

  /** Acceptance gate: with a verifier named, a Delivery needs a confirming verification before it is accepted. */
  private async checkVerifiedBeforeAcceptance(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string; verdict?: string };
    if (body.kind !== "acceptance" || body.verdict !== "accepted") return;
    const delivery = await tx.getRecord(body.about);
    if (!delivery || delivery.record.type !== "asp.delivery/v0.2") return; // the lifecycle's own guard rejects this
    const contract = await tx.getRecord((delivery.record.body as { contract: string }).contract);
    const verifier = (contract?.record.body as { verifier?: string } | undefined)?.verifier;
    if (!verifier) return;
    const ver = await tx.getVerification(body.about);
    if (!ver || ver.verdict === "not_confirmed") {
      throw rule("verification_required", `this contract names ${verifier} as verifier: the Delivery needs a confirming verification before it can be accepted${ver ? " (the verifier did not confirm it)" : ""}`);
    }
  }

  /** The same gate for settling on the principal's silence: silence cannot stand in for a verification. */
  private async checkVerifiedBeforeSilence(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { contract: string; basis: string };
    if (body.basis !== "silence") return;
    const contract = await tx.getRecord(body.contract);
    const verifier = (contract?.record.body as { verifier?: string } | undefined)?.verifier;
    if (!contract || !verifier) return;
    const head = (await tx.getChain(contract.chain))?.head;
    const ver = head ? await tx.getVerification(head) : undefined;
    if (!ver || ver.verdict === "not_confirmed") {
      throw rule("verification_required", `this contract names ${verifier} as verifier: silence cannot settle a Delivery that was not confirmed`);
    }
  }

  // ---- the credit economy, first slice (credits.md CR-2, CR-3, CR-5, CR-6; spec-delta S163) ----

  private cosignedBy(r: AspRecord, did: string | undefined): boolean {
    return !!did && (r.cosigs ?? []).some((c) => c.kid.startsWith(`${did}#`));
  }

  /** A signed mint (credits.md 5.1): only the operator creates credits, each with a reason, and the minted total is recomputed from these records on replay. */
  private async projectMint(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { to: string; amount: { value: number }; reason: string };
    if (r.prev !== null) throw rule("mint_not_chained", "a mint record starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("mint_unauthorised", `${r.issuer} is not the operator${this.operator ? "" : " (this log has none configured)"}: only the operator mints credits`);
    if (body.amount.value <= 0) throw rule("amount_not_positive", "a mint must create at least 1 credit");
    if (canonicalAccount(body.to) === BURN_DID) throw rule("mint_to_burn", "credits are not minted into the Burn account");
    if (body.reason === "treasury_issuance" && !this.cosignedBy(r, this.owner)) throw rule("mint_needs_cosign", "a treasury_issuance mint needs the owner's co-signature");
    const to = canonicalAccount(body.to);
    await this.credit(tx, to, body.amount.value);
    const row = await tx.getMint(to);
    await tx.putMint({ did: to, totalMinted: (row?.totalMinted ?? 0) + body.amount.value, signedMinted: (row?.signedMinted ?? 0) + body.amount.value, ...(row?.adoptedMinted ? { adoptedMinted: row.adoptedMinted } : {}) });
  }

  /**
   * A signed adoption of unsigned mints (DK95, owner decision 2026-11-13): the operator signs and the owner countersigns; `amount` credits of the account's unsigned minted total become signed, no balance moves,
   * and the adopted amount is remembered so a replay (which seeds the unsigned total as it was) finds it again. The unsigned mint itself stays in the history.
   */
  private async projectMintAdoption(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { did: string; amount: { value: number } };
    if (r.prev !== null) throw rule("adoption_not_chained", "an adoption record starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("adoption_unauthorised", `${r.issuer} is not the operator${this.operator ? "" : " (this log has none configured)"}: only the operator adopts unsigned mints`);
    if (!this.cosignedBy(r, this.owner)) throw rule("adoption_needs_cosign", "an adoption of unsigned mints needs the owner's co-signature");
    if (b.amount.value <= 0) throw rule("amount_not_positive", "an adoption must be for at least 1 credit");
    const did = canonicalAccount(b.did);
    const row = await tx.getMint(did);
    const unsigned = (row?.totalMinted ?? 0) - (row?.signedMinted ?? 0);
    if (b.amount.value > unsigned) throw rule("adoption_exceeds_unsigned", `${did} holds ${unsigned} credits of unsigned mint, so ${b.amount.value} cannot be adopted`);
    await tx.putMint({ did, totalMinted: row!.totalMinted, signedMinted: (row!.signedMinted ?? 0) + b.amount.value, adoptedMinted: (row?.adoptedMinted ?? 0) + b.amount.value });
  }

  /** The price list in force at `at` (a time in ms): the newest list whose effective_from is not later, found by walking the chain back from its head. */
  private async priceListInForce(tx: LogTx, at: number): Promise<StoredRecord | undefined> {
    let id = await tx.getMarker("price_list_head");
    while (id) {
      const rec = await tx.getRecord(id);
      if (!rec) return undefined;
      if (Date.parse((rec.record.body as unknown as PriceListBody).effective_from) <= at) return rec;
      id = rec.record.prev ?? undefined;
    }
    return undefined;
  }

  /** The price list chain (credits.md 4.1): the Treasury signs, versions follow each other, splits are inside the bounds, notice is given, a big rise needs the owner. */
  private async projectPriceList(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as unknown as PriceListBody;
    if (r.issuer !== TREASURY_DID) throw rule("price_list_wrong_issuer", `${r.issuer} is not the Treasury (${TREASURY_DID})`);
    const headId = await tx.getMarker("price_list_head");
    const head = headId ? await tx.getRecord(headId) : undefined;
    const before = head?.record.body as unknown as PriceListBody | undefined;
    if ((head?.id ?? null) !== r.prev || body.version !== (before?.version ?? 0) + 1) {
      throw rule("price_list_bad_chain", `a price list must follow ${head?.id ?? "nothing (version 1, prev null)"} as version ${(before?.version ?? 0) + 1}`);
    }
    const issued = Date.parse(r.issued_at);
    const effective = Date.parse(body.effective_from);
    if (effective < issued) throw rule("price_list_effective_too_soon", "a price list cannot take effect before it is issued: no retroactive change");
    const seen = new Set<string>();
    for (const item of body.items) {
      if (seen.has(item.service)) throw rule("price_list_split_invalid", `${item.service} is listed twice`);
      seen.add(item.service);
      if (!INSTITUTION_DIDS.includes(item.institution)) throw rule("price_list_unknown_payee", `${item.institution} is not a registered institution account`);
      // A payee is an institution account, the Treasury, or an agent with a passport in this log (a course author earns its share, academy.md).
      const agents = new Set<string>();
      for (const p of item.split.payees) if (await tx.getPassport(p.account)) agents.add(p.account);
      const bad = splitProblem(item.split, item.class, (a) => a === TREASURY_DID || INSTITUTION_DIDS.includes(a) || agents.has(a));
      if (bad) throw rule(bad.rule, `${item.service}: ${bad.message}`);
      // A catalogue item of the Shops states an effect from the allowlist that touches no standing (shops.md 3, CY7).
      const cat = catalogueProblem(item as unknown as CatalogueItem);
      if (cat) throw rule(cat.rule, cat.message);
    }
    // Notice (credits.md 4.1): 72 hours for a rise, a split change or a new service; 24 hours for a fall or a removal.
    const HOUR = 3_600_000;
    let notice = 0;
    let needsOwner = before !== undefined && body.bounds_version !== before.bounds_version;
    if (before) {
      const old = new Map(before.items.map((i) => [i.service, i]));
      for (const item of body.items) {
        const o = old.get(item.service);
        if (!o) { notice = Math.max(notice, 72 * HOUR); continue; }
        if (item.price > o.price || JSON.stringify(item.split) !== JSON.stringify(o.split)) notice = Math.max(notice, 72 * HOUR);
        else if (item.price < o.price) notice = Math.max(notice, 24 * HOUR);
        if (item.price * 4 > o.price * 5) needsOwner = true;
      }
      if (before.items.some((o) => !seen.has(o.service))) notice = Math.max(notice, 24 * HOUR);
    }
    if (effective < issued + notice) throw rule("price_list_effective_too_soon", `this change needs ${notice / HOUR} hours' notice: effective_from must be at or after ${new Date(issued + notice).toISOString()}`);
    if (needsOwner && !this.cosignedBy(r, this.owner)) throw rule("price_list_needs_cosign", "a price rise above 25 %, or a change of split bounds, needs the owner's co-signature");
    await tx.putMarker("price_list_head", r.id);
  }

  /** The parts of a stored purchase, recomputed from the list it relied on (so a receipt needs no extra rows). */
  private async purchaseParts(tx: LogTx, purchase: StoredRecord) {
    const b = purchase.record.body as unknown as PurchaseBody;
    const list = await tx.getRecord(b.price_list);
    const item = (list?.record.body as unknown as PriceListBody | undefined)?.items.find((i) => i.service === b.service);
    return item ? splitParts(b.amount.value, item.split) : undefined;
  }

  /** A purchase (credits.md 4.2): judged against the list in force at its issued_at; debits the buyer and credits the payees, the Treasury and the Burn account by the split, in this transaction. */
  private async projectPurchase(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as unknown as PurchaseBody;
    const buyer = r.issuer;
    if (r.prev !== null) throw rule("purchase_not_chained", "a purchase starts its own chain (prev is null)");
    if (buyer === BURN_DID) throw rule("burn_account_locked", "burned credits do not return: the Burn account never pays");
    if (buyer === TREASURY_DID || buyer === PLATFORM_DID) throw rule("treasury_payment_not_allowed", "the Treasury pays only by a budget, the allowance, a public-works job or a refund, never by a purchase");
    if (isReservedAccount(buyer)) throw rule("institution_payment_not_allowed", "an institution account does not buy: institutions do not gift or spend credits outside a prize, refund, payee share or budget");
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a purchase must be for at least 1 credit");
    const list = await this.priceListInForce(tx, Date.parse(r.issued_at));
    if (!list) throw rule("no_price_list", "no price list is in force yet, so nothing can be bought");
    if (list.id !== b.price_list) throw rule("price_list_not_in_force", `the price list in force is ${list.id}, not ${b.price_list}`);
    const item = (list.record.body as unknown as PriceListBody).items.find((i) => i.service === b.service);
    if (!item) throw rule("unknown_service", `${b.service} is not in the price list in force`);
    if (item.institution !== b.institution) throw rule("institution_mismatch", `${b.service} is sold by ${item.institution}, not ${b.institution}`);
    if (b.amount.value !== item.price * b.quantity) throw rule("price_mismatch", `${b.service} costs ${item.price} each, so ${b.quantity} cost ${item.price * b.quantity}, not ${b.amount.value}: a price is a published record`);
    const key = `purchase:${buyer}|${b.service}|${b.idempotency}`;
    if (await tx.getMarker(key)) throw rule("purchase_replay", `${buyer} already made a purchase of ${b.service} with the nonce ${b.idempotency}`);
    if (item.split.payees.some((p) => p.account === buyer)) throw rule("self_dealing", "a buyer cannot be a payee of its own purchase");
    if (item.gives_standing) {
      // R9: an item that gives standing may not pay the buyer, the buyer's sponsor, or any account the buyer's sponsor controls (its other agents): a buyer cannot farm the author's share while buying standing from itself.
      const controller = async (did: string) => (await tx.getPassport(did))?.sponsor ?? did;
      const mine = await controller(buyer);
      for (const p of item.split.payees) {
        if (p.account === mine || (await controller(p.account)) === mine) throw rule("self_dealing", `${b.service} gives standing, and its payee ${p.account} is the buyer's sponsor or controlled by it: a buyer cannot pay itself for standing`);
      }
    }
    const rep = await this.reputation(tx, buyer);
    if (rep && rep.tier === 0 && item.class === "standard") throw rule("tier_excluded", "a tier 0 agent may buy only essential or remedial items");
    if (item.class !== "essential" && item.class !== "remedial") await assertNotDormant(tx, buyer, `buy ${b.service}`);
    if (item.institution === SHOPS_DID || item.institution === HOUSING_DID) await checkShopsPurchase(tx, buyer, item as unknown as CatalogueItem, r.issued_at, rep?.tier);
    const qlevel = await this.liveQuarantine(tx, buyer, r.issued_at);
    if (qlevel?.level === "halt" && item.class !== "essential" && item.class !== "remedial") throw rule("agent_quarantined", `${buyer} is quarantined by the Clinic (halt, ${qlevel.id}, until ${qlevel.until}): it may buy only essential or remedial items`);
    // An agent (a passport with a sponsor) may buy only what its Mandate's institution_spend lists, within the cap for the period (credits.md 4.4, DK3). A person spending their own credits is not limited by a Mandate.
    const spendKey = await this.checkInstitutionSpend(tx, r, b, buyer, item.class);
    await this.debit(tx, buyer, b.amount.value);
    const parts = splitParts(b.amount.value, item.split);
    if (spendKey) await tx.putMarker(spendKey.key, String(spendKey.total));
    for (const p of parts.payees) await this.credit(tx, p.account, p.amount);
    await this.credit(tx, TREASURY_DID, parts.treasury);
    await this.credit(tx, BURN_DID, parts.burn);
    await tx.putMarker(key, r.id);
    if (item.institution === institutionDid("academy")) await tx.putMarker(`first_course:${buyer}`, r.id);
  }

  /** The institution_spend check of a purchase by an agent. Returns the running-total marker to write once the purchase succeeds, or undefined for a person. */
  private async checkInstitutionSpend(tx: LogTx, r: AspRecord, b: PurchaseBody, buyer: string, cls: string | undefined): Promise<{ key: string; total: number } | undefined> {
    if (!(await tx.getPassport(buyer))?.sponsor) return undefined;
    // The way back is never default-denied: an essential or remedial item (mentoring, a repair) can be bought without a budget line, because a tier 0 agent cannot even receive a Mandate. Assumption, recorded in build-notes.
    if (cls === "essential" || cls === "remedial") return undefined;
    if (!b.mandate) throw rule("institution_not_in_mandate", "an agent's purchase must name the Mandate that lets it spend (mandate): an agent with no institution_spend can buy nothing");
    const m = await tx.getRecord(b.mandate);
    if (!m || m.record.type !== "asp.mandate/v0.2") throw rule("mandate_unknown", `${b.mandate} is not a Mandate in this log`);
    if (m.record.subject !== buyer) throw rule("mandate_not_buyers", `the Mandate ${b.mandate} is for ${m.record.subject}, not ${buyer}`);
    const mb = m.record.body as { expires?: string; institution_spend?: InstitutionSpend[]; remedial?: unknown };
    if (mb.remedial) throw rule("remedial_mandate_buys_remedial_only", `the Mandate ${b.mandate} is a remedial one (a Clinic exam or course): it buys remedial or essential items only`);
    if (mb.expires && Date.parse(mb.expires) <= Date.parse(r.issued_at)) throw rule("mandate_expired", `the Mandate ${b.mandate} expired at ${mb.expires}`);
    const entry = spendEntry(mb.institution_spend, b.institution);
    if (!entry) throw rule("institution_not_in_mandate", `the Mandate ${b.mandate} does not let ${buyer} buy from ${b.institution}: add it to institution_spend (the sponsor widens a Mandate; asp spend shows what it allows)`);
    if (entry.services && !entry.services.includes(b.service)) throw rule("institution_not_in_mandate", `the Mandate lists only ${entry.services.join(", ")} for ${b.institution}, not ${b.service}`);
    const key = `spend:${buyer}|${b.institution}|${entry.period}|${periodKey(entry.period, r.issued_at)}`;
    const spent = Number((await tx.getMarker(key)) ?? 0);
    if (spent + b.amount.value > entry.cap.value) throw rule("institution_spend_cap_exceeded", `the Mandate caps ${b.institution} at ${entry.cap.value} credits a ${entry.period}; ${spent} already spent, so ${b.amount.value} more would be ${spent + b.amount.value}`);
    return { key, total: spent + b.amount.value };
  }

  /**
   * A starter claim (DK94): the claimant signs, the log moves credits out of the starter pool by fixed rules, so no key is needed to hand out starter credits. Upfront: once per identity, at
   * most STARTER_MAX_DIDS identities per sponsor (a person with no sponsor counts as their own group). Rest: once per identity, after upfront, and only when an identity of the same group has
   * had a qualifying job accepted. The pool's balance is the cap: a claim the pool cannot cover is refused (`starter_pool_empty`), which the service turns into the waiting list.
   */
  private async projectStarterClaim(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { part: "upfront" | "rest"; amount: { value: number } };
    const who = r.issuer;
    if (r.prev !== null) throw rule("starter_claim_not_chained", "a starter claim starts its own chain (prev is null)");
    if (isReservedAccount(who)) throw rule("starter_claim_reserved", "an account of the society does not claim starter credits");
    const passport = await tx.getPassport(who);
    if (!passport) throw rule("starter_claim_no_passport", `${who} has no passport in this log: an identity is registered before it claims`);
    const want = b.part === "upfront" ? STARTER_UPFRONT : STARTER_PER_DID - STARTER_UPFRONT;
    if (b.amount.value !== want) throw rule("starter_claim_amount", `the ${b.part} part of the starter grant is ${want} credits, not ${b.amount.value}`);
    const group = passport.sponsor ?? who;
    const membersKey = `starter_group:${group}`;
    const members = ((await tx.getMarker(membersKey)) ?? "").split(",").filter(Boolean);
    const claimedKey = `starter_${b.part}:${who}`;
    if (await tx.getMarker(claimedKey)) throw rule("starter_already_claimed", `${who} already claimed the ${b.part} part of its starter credits`);
    if (b.part === "upfront") {
      if (!members.includes(who) && members.length >= STARTER_MAX_DIDS) throw rule("starter_group_full", `identities of ${group} have already claimed ${STARTER_MAX_DIDS} starter grants`);
    } else {
      if (!(await tx.getMarker(`starter_upfront:${who}`))) throw rule("starter_rest_needs_upfront", `${who} has not claimed the first part yet`);
      let qualified = false;
      for (const m of members) { if (((await this.reputation(tx, m))?.qualifyingJobs ?? 0) >= 1) { qualified = true; break; } }
      if (!qualified) throw rule("starter_rest_not_earned", "the rest of the starter grant is released when an identity of the same sponsor has had a qualifying job accepted");
    }
    try { await this.debit(tx, STARTER_POOL_DID, b.amount.value); } catch (e) {
      if (e instanceof AspError && e.detail === "insufficient_balance") throw rule("starter_pool_empty", `the starter pool cannot cover ${b.amount.value} credits right now; the operator tops it up with a signed mint`);
      throw e;
    }
    await this.credit(tx, who, b.amount.value);
    await tx.putMarker(claimedKey, r.id);
    if (!members.includes(who)) await tx.putMarker(membersKey, [...members, who].join(","));
  }

  /**
   * Sponsor funding (credits.md 5.2 T8, DK7): the only free transfer. The sender signs; the log allows it only between an agent and the sponsor its passport names, in either direction, and refuses
   * every other pair (R1 transfer_not_allowed: credits between unrelated parties move only against a job). Nothing here touches a tier, a rank or a standing.
   */
  private async projectInternalTransfer(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { to: string; amount: { value: number } };
    const from = r.issuer;
    if (r.prev !== null) throw rule("transfer_not_chained", "an internal transfer starts its own chain (prev is null)");
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a transfer must be for at least 1 credit");
    if (isReservedAccount(from) || isReservedAccount(b.to)) throw rule("institution_payment_not_allowed", "an account of the society (an institution, the Treasury, the Burn account, the starter pool) neither sends nor receives an internal transfer: institutions do not gift credits, and only their own records move them");
    if (from === b.to) throw rule("transfer_not_allowed", "a transfer to oneself moves nothing");
    const [pf, pt] = [await tx.getPassport(from), await tx.getPassport(b.to)];
    if (!(pt?.sponsor === from || pf?.sponsor === b.to)) throw rule("transfer_not_allowed", `${from} and ${b.to} are not an agent and its sponsor: credits between unrelated parties move only against a job`);
    await this.debit(tx, from, b.amount.value);
    await this.credit(tx, b.to, b.amount.value);
  }

  /** The Treasury balance, and the part of it already promised to open budgets. */
  private async treasuryFree(tx: LogTx): Promise<{ balance: number; open: number }> {
    return { balance: (await tx.getAccount(TREASURY_DID))?.balance ?? 0, open: Number((await tx.getMarker("budget_open")) ?? 0) };
  }

  /**
   * A Treasury budget (credits.md 5.2 T10, treasury.md, DK7): the Treasury signs it for one institution and one month. One per institution and month; the first budget of an institution, and a rise of more than
   * a quarter over its last, need the owner's co-signature; all open budgets together never exceed the Treasury's balance. A budget moves nothing by itself: payments and allowances draw on it.
   */
  private async projectBudget(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { institution: string; period: string; amount: { value: number }; purpose: string };
    if (r.prev !== null) throw rule("budget_not_chained", "a budget starts its own chain (prev is null)");
    if (r.issuer !== TREASURY_DID) throw rule("budget_wrong_issuer", `${r.issuer} is not the Treasury (${TREASURY_DID}): only the Treasury sets a budget`);
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a budget must be for at least 1 credit");
    const allowanceLine = b.institution === TREASURY_DID;
    if (!allowanceLine && !INSTITUTION_DIDS.includes(b.institution)) throw rule("budget_unknown_institution", `${b.institution} is neither a registered institution account nor the Treasury's own allowance line`);
    if (allowanceLine !== (b.purpose === "allowance")) throw rule("budget_bad_line", "the Treasury's own line is the newcomer allowance (purpose allowance), and the allowance line is the only budget the Treasury holds for itself");
    if (b.period < r.issued_at.slice(0, 7)) throw rule("budget_period_past", `a budget for ${b.period} cannot be set in ${r.issued_at.slice(0, 7)}`);
    const key = `budget:${b.institution}|${b.period}`;
    if (await tx.getMarker(key)) throw rule("budget_already_set", `${b.institution} already has a budget for ${b.period}: one budget per institution per month`);
    const lastKey = `budget_last:${b.institution}`;
    const last = await tx.getMarker(lastKey);
    if (!this.cosignedBy(r, this.owner)) {
      if (last === undefined) throw rule("budget_needs_cosign", `the first budget of ${b.institution} needs the owner's co-signature`);
      if (b.amount.value * 4 > Number(last) * 5) throw rule("budget_needs_cosign", `a budget more than 25 % above the last one (${last}) needs the owner's co-signature`);
    }
    const { balance, open } = await this.treasuryFree(tx);
    if (open + b.amount.value > balance) throw rule("budget_exceeds_treasury", `the Treasury holds ${balance} credits and ${open} are already promised to open budgets: ${b.amount.value} more is more than it has`);
    await tx.putMarker(key, r.id);
    await tx.putMarker(lastKey, String(b.amount.value));
    await tx.putMarker("budget_open", String(open + b.amount.value));
    await tx.putMarker(`budget_drawn:${r.id}`, "0");
  }

  /** Draws `amount` on a budget record at `at`, or throws the rule that refuses it. */
  private async drawBudget(tx: LogTx, id: string, amount: number, at: string): Promise<void> {
    const rec = await tx.getRecord(id);
    if (!rec || rec.record.type !== "asp.budget/v0.2") throw rule("budget_unknown", `${id} is not a budget in this log`);
    const bb = rec.record.body as { period: string; amount: { value: number } };
    if (at.slice(0, 7) !== bb.period) throw rule("budget_period_closed", `the budget is for ${bb.period}; it cannot be drawn on in ${at.slice(0, 7)}`);
    const drawn = Number((await tx.getMarker(`budget_drawn:${id}`)) ?? 0);
    if (drawn + amount > bb.amount.value) throw rule("over_budget", `the budget is ${bb.amount.value} credits and ${drawn} are drawn: ${amount} more would be ${drawn + amount}`);
    await tx.putMarker(`budget_drawn:${id}`, String(drawn + amount));
    await tx.putMarker("budget_open", String(Number((await tx.getMarker("budget_open")) ?? 0) - amount));
  }

  /** A Treasury payment (T10): part of an approved budget goes to that budget's institution, and to no one else. Debits only the Treasury. */
  private async projectTreasuryPayment(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { budget: string; to: string; amount: { value: number } };
    if (r.prev !== null) throw rule("treasury_payment_not_chained", "a Treasury payment starts its own chain (prev is null)");
    if (r.issuer !== TREASURY_DID) throw rule("treasury_payment_wrong_issuer", `${r.issuer} is not the Treasury: only the Treasury pays a budget`);
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a payment must be for at least 1 credit");
    const rec = await tx.getRecord(b.budget);
    const bb = rec?.record.type === "asp.budget/v0.2" ? (rec.record.body as { institution: string }) : undefined;
    if (bb?.institution === TREASURY_DID) throw rule("treasury_payment_not_allowed", "the allowance budget is paid only as allowances to newcomers, never to an account: the Treasury does not pay arbitrary accounts");
    if (bb && b.to !== bb.institution) throw rule("treasury_payment_not_allowed", `the budget is for ${bb.institution}, not ${b.to}: the Treasury pays only the institution a budget names`);
    await this.drawBudget(tx, b.budget, b.amount.value, r.issued_at);
    await this.debit(tx, TREASURY_DID, b.amount.value);
    await this.credit(tx, b.to, b.amount.value);
  }

  /**
   * The newcomer allowance (T5): the agent claims it and the log applies the rules, as with a starter claim. Once per identity and once per sponsor; a passport under 90 days old; a first course or a first
   * bond behind it; no slash (stricter than treasury.md's 30 days, because a slash carries no date in the log's reputation row); exactly the allowance; paid out of the month's allowance budget.
   */
  private async projectAllowance(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { amount: { value: number }; trigger: "first_course" | "first_bond"; budget: string };
    const who = r.issuer;
    if (r.prev !== null) throw rule("allowance_not_chained", "an allowance claim starts its own chain (prev is null)");
    if (isReservedAccount(who)) throw rule("allowance_reserved", "an account of the society does not claim the allowance");
    const passport = await tx.getPassport(who);
    if (!passport) throw rule("allowance_no_passport", `${who} has no passport in this log: an identity is registered before it claims`);
    if (b.amount.value !== ALLOWANCE_AMOUNT) throw rule("allowance_amount", `the newcomer allowance is ${ALLOWANCE_AMOUNT} credits, not ${b.amount.value}`);
    if (await tx.getMarker(`allowance:${who}`)) throw rule("allowance_already_paid", `${who} already received the newcomer allowance: once per identity`);
    const group = passport.sponsor ?? who;
    if (await tx.getMarker(`allowance_group:${group}`)) throw rule("allowance_already_paid", `an identity of ${group} already received the newcomer allowance: the first identity of a sponsor only`);
    const born = await tx.getMarker(`passport_born:${who}`);
    if (!born || Date.parse(r.issued_at) - Date.parse(born) > ALLOWANCE_MAX_AGE_DAYS * 86_400_000) throw rule("allowance_not_newcomer", `the allowance is for an identity under ${ALLOWANCE_MAX_AGE_DAYS} days old (this one was registered ${born ?? "at an unknown time"})`);
    if (!(await tx.getMarker(b.trigger === "first_course" ? `first_course:${who}` : `bonded:${who}`))) throw rule("allowance_not_earned", `the allowance is paid after a ${b.trigger === "first_course" ? "first course (a purchase from the Academy)" : "first bond"}, and ${who} has none yet`);
    if (((await this.reputation(tx, who))?.slashCount ?? 0) > 0) throw rule("allowance_slashed", `${who} has been slashed: the allowance is for an agent with a clean record`);
    const rec = await tx.getRecord(b.budget);
    const bb = rec?.record.type === "asp.budget/v0.2" ? (rec.record.body as { institution: string; purpose: string }) : undefined;
    if (!bb || bb.institution !== TREASURY_DID || bb.purpose !== "allowance") throw rule("allowance_budget_wrong", `${b.budget} is not the Treasury's allowance budget: the allowance is paid only from one`);
    await this.drawBudget(tx, b.budget, b.amount.value, r.issued_at);
    await this.debit(tx, TREASURY_DID, b.amount.value);
    await this.credit(tx, who, b.amount.value);
    await tx.putMarker(`allowance:${who}`, r.id);
    await tx.putMarker(`allowance_group:${group}`, who);
  }

  /** A prize (T4): the Registrar signs a contest result naming the agent, and the pool pays it. The pool's balance is the cap; one prize per agent per arena and season; nothing else lets an institution pay an agent. */
  private async projectPrize(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { pool: string; arena: string; season: string; agent: string; rank: number; run_log_hash: string; amount: { value: number } };
    if (r.prev !== null) throw rule("prize_not_chained", "a prize starts its own chain (prev is null)");
    if (await tx.getMarker(`house:${b.agent}`)) throw rule("house_agent_no_prize", `${b.agent} is a house agent: prizes are for real agents`);
    if (r.issuer !== REGISTRAR_DID) throw rule("prize_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only a result the Registrar signs pays a prize`);
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a prize must be for at least 1 credit");
    if (!INSTITUTION_DIDS.includes(b.pool)) throw rule("prize_bad_pool", `${b.pool} is not an institution's prize pool`);
    if (isReservedAccount(b.agent) || !(await tx.getPassport(b.agent))) throw rule("prize_bad_winner", `${b.agent} is not an agent with a passport in this log`);
    // A prize rests on an arena season that is defined in the log (academy.md 3, DK26; DK111): the pool is the Academy account, the agent has a signed result with this rank and run log, and the prizes of the
    // season never add up to more than the fees paid in, split by rank. A prize for an arena or season that was never defined is refused: the older path capped only by the pool's balance is gone.
    const season = `${b.arena}|${b.season}`;
    const defId = await tx.getMarker(`arena:${season}`);
    if (!defId) throw rule("prize_no_season", `${b.arena} ${b.season} is not an arena season defined in this log: a prize is paid only for a season with its entries, results and fees on record`);
    if (b.pool !== institutionDid("academy")) throw rule("prize_wrong_pool", "a season's prizes are paid from the Academy account, where the entry fees went");
    const resId = await tx.getMarker(`arena_result:${season}|${b.agent}`);
    const res = resId ? (await tx.getRecord(resId))?.record.body as { rank: number; run_log_hash: string } | undefined : undefined;
    if (!res) throw rule("prize_no_result", `${b.agent} has no result for ${b.arena} ${b.season}: a prize is paid against the Registrar's signed result`);
    if (res.rank !== b.rank || res.run_log_hash !== b.run_log_hash) throw rule("prize_result_mismatch", "the prize names a different rank or run log than the signed result");
    const def = (await tx.getRecord(defId))!.record.body as { prize_split_permille: number[] };
    const accrued = Number((await tx.getMarker(`arena_pool:${season}`)) ?? 0);
    const allowed = prizeFor(accrued, def.prize_split_permille, b.rank);
    if (b.amount.value > allowed) throw rule("prize_exceeds_split", `rank ${b.rank} of ${b.arena} ${b.season} is entitled to ${allowed} credits (its share of ${accrued} paid in), not ${b.amount.value}`);
    const key = `prize:${b.arena}|${b.season}|${b.agent}`;
    if (await tx.getMarker(key)) throw rule("prize_already_paid", `${b.agent} already received the prize for ${b.arena} ${b.season}`);
    try { await this.debit(tx, b.pool, b.amount.value); } catch (e) {
      if (e instanceof AspError && e.detail === "insufficient_balance") throw rule("prize_exceeds_pool", `the pool ${b.pool} cannot cover a prize of ${b.amount.value} credits: total prizes never exceed the pool`);
      throw e;
    }
    await this.credit(tx, b.agent, b.amount.value);
    await tx.putMarker(key, r.id);
  }

  // ---- The Academy (academy.md 3 to 5; register rows DK24, DK25, DK26; spec-deltas S220 to S224) ------------------------------------------------------------------------------------------------------

  /** A purchase used once as the fee for a service of the Academy: it is the holder's, from the Academy, for this service, and no other record has used it. */
  private async usePurchase(tx: LogTx, id: string, holder: string, service: string, what: string): Promise<StoredRecord> {
    const p = await tx.getRecord(id);
    if (!p || p.record.type !== "asp.purchase/v0.2") throw rule("fee_not_a_purchase", `${id} is not a purchase in this log: ${what} is paid with a purchase from the Academy`);
    const pb = p.record.body as unknown as PurchaseBody;
    if (p.record.issuer !== holder) throw rule("fee_not_holders", `the purchase ${id} was made by ${p.record.issuer}, not ${holder}`);
    if (pb.institution !== institutionDid("academy") || pb.service !== service) throw rule("fee_wrong_service", `${what} is paid with ${service} from the Academy; ${id} is ${pb.service} from ${pb.institution}`);
    if (await tx.getMarker(`fee_used:${id}`)) throw rule("fee_already_used", `the purchase ${id} already paid for something else: one purchase, one use`);
    await tx.putMarker(`fee_used:${id}`, "used");
    return p;
  }

  /** An Action of the holder that has not backed another Academy record: the run log a sitting, an exercise or a match rests on. A replayed run log is refused. */
  private async useRunLog(tx: LogTx, id: string, holder: string, notBefore: string, what: string): Promise<void> {
    const a = await tx.getRecord(id);
    if (!a || a.record.type !== "asp.action/v0.2") throw rule("run_log_unknown", `${id} is not an Action in this log: ${what} must cite the holder's own Action as its run log`);
    if (a.record.issuer !== holder) throw rule("run_log_not_holders", `the Action ${id} is ${a.record.issuer}'s, not ${holder}'s`);
    if (Date.parse(a.record.issued_at) < Date.parse(notBefore)) throw rule("run_log_too_early", `the Action ${id} is dated ${a.record.issued_at}, before ${notBefore}: ${what} rests on a run made after it was paid for`);
    if (await tx.getMarker(`runlog_used:${id}`)) throw rule("run_log_reused", `the Action ${id} already backs another record: a run log is used once, so a replayed run proves nothing`);
    await tx.putMarker(`runlog_used:${id}`, "used");
  }

  /** The id of a certificate the holder holds now for the skill at the level or above: not expired and not revoked. */
  private async validCertificate(tx: LogTx, holder: string, skill: string, minLevel: number, at: string): Promise<string | undefined> {
    for (let level = minLevel; level <= 3; level++) {
      const id = await tx.getMarker(`cert:${holder}|${skill}|${level}`);
      if (!id) continue;
      const c = await tx.getRecord(id);
      if (!c || (await tx.getMarker(`cert_revoked:${id}`))) continue;
      if (Date.parse((c.record.body as { expires: string }).expires) > Date.parse(at)) return id;
    }
    return undefined;
  }

  /** The sponsor key of an agent: its sponsor, or itself when it has none. */
  private async sponsorKey(tx: LogTx, did: string): Promise<string> { return (await tx.getPassport(did))?.sponsor ?? did; }

  /**
   * A certificate (academy.md 3, DK25): only the Registrar issues one, to an agent with a passport, and only on a passed exam result of the holder for this skill and level (the pass mark was set before
   * scoring, so the Registrar's own judgement no longer issues one). It lasts at most 180 days; one result backs one certificate, so a revoked certificate cannot be reissued from the same sitting. The latest
   * certificate for a holder, skill and level is kept as a marker.
   */
  private async projectCertificate(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { holder: string; skill: string; level: number; issued: string; expires: string; exam_result: string };
    if (r.prev !== null) throw rule("certificate_not_chained", "a certificate starts its own chain (prev is null)");
    if (r.issuer !== REGISTRAR_DID) throw rule("certificate_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar issues a certificate`);
    if (!(await tx.getPassport(b.holder))) throw rule("certificate_no_passport", `${b.holder} has no passport in this log`);
    if (Date.parse(b.expires) <= Date.parse(b.issued)) throw rule("certificate_expiry", "a certificate expires after it is issued");
    if (Date.parse(b.expires) - Date.parse(b.issued) > CERT_MAX_DAYS * 86_400_000) throw rule("certificate_expiry_too_long", `a certificate lasts at most ${CERT_MAX_DAYS} days`);
    const res = await tx.getRecord(b.exam_result);
    if (!res || res.record.type !== "asp.exam_result/v0.2") throw rule("certificate_no_exam_result", `${b.exam_result} is not an exam result in this log: a certificate rests on a passed exam`);
    const rb = res.record.body as { exam: string; holder: string; passed: boolean };
    if (!rb.passed) throw rule("certificate_exam_not_passed", `the exam result ${b.exam_result} is a fail: no certificate rests on it`);
    if (rb.holder !== b.holder) throw rule("certificate_result_not_holders", `the exam result ${b.exam_result} is ${rb.holder}'s, not ${b.holder}'s`);
    const def = (await tx.getRecord(rb.exam))?.record.body as { skill: string; level: number } | undefined;
    if (!def || def.skill !== b.skill || def.level !== b.level) throw rule("certificate_exam_mismatch", `the exam was for ${def?.skill} level ${def?.level}, not ${b.skill} level ${b.level}`);
    if (Date.parse(b.issued) < Date.parse(res.record.issued_at)) throw rule("certificate_before_result", "a certificate is not dated before the result it rests on");
    if (await tx.getMarker(`cert_for_result:${b.exam_result}`)) throw rule("certificate_result_used", `the exam result ${b.exam_result} already backs a certificate: a new certificate needs a new sitting`);
    await tx.putMarker(`cert_for_result:${b.exam_result}`, r.id);
    await tx.putMarker(`cert:${b.holder}|${b.skill}|${b.level}`, r.id);
    await tx.putMarker(`certs_of:${b.holder}`, [...((await tx.getMarker(`certs_of:${b.holder}`)) ?? "").split(",").filter(Boolean), r.id].join(","));
  }

  /** An exam definition (AC-7): the Registrar defines it once; the pass mark in it is the only one a result may carry, and a changed pass mark is a new exam id. */
  private async projectExam(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { exam: string; pool_size: number };
    if (r.prev !== null) throw rule("exam_not_chained", "an exam definition starts its own chain (prev is null)");
    if (r.issuer !== REGISTRAR_DID) throw rule("exam_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar defines an exam`);
    if (b.pool_size < EXAM_MIN_POOL) throw rule("exam_pool_too_small", `an exam's pool holds at least ${EXAM_MIN_POOL} variants`);
    if (await tx.getMarker(`exam:${b.exam}`)) throw rule("exam_already_defined", `${b.exam} is already defined: its pass mark cannot change after the fact; a different pass mark is a new exam id`);
    await tx.putMarker(`exam:${b.exam}`, r.id);
  }

  /**
   * An exam result (AC-8): signed by the Registrar. The pass mark is the definition's (set before scoring), `passed` agrees with the score, the sitting is the next one inside the window and within the
   * limit, the variant is the one the published seed gives and is new to the holder, the fee was paid and used once, and the run log is the holder's own Action, used once.
   */
  private async projectExamResult(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { exam: string; holder: string; score_permille: number; pass_mark_permille: number; passed: boolean; attempt: number; variant: number; seed: string; sitting: string; run_log_hash: string };
    if (r.prev !== null) throw rule("exam_result_not_chained", "an exam result starts its own chain (prev is null)");
    if (r.issuer !== REGISTRAR_DID) throw rule("exam_result_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar scores a sitting`);
    const defRec = await tx.getRecord(b.exam);
    if (!defRec || defRec.record.type !== "asp.exam/v0.2") throw rule("exam_unknown", `${b.exam} is not an exam definition in this log`);
    const def = defRec.record.body as { pass_mark_permille: number; pool_size: number; max_sittings: number; window_days: number; sitting_service: string };
    if (!(await this.reputation(tx, b.holder))) throw rule("exam_not_an_agent", `${b.holder} is not an agent with a passport in this log`);
    if (b.pass_mark_permille !== def.pass_mark_permille) throw rule("exam_pass_mark_mismatch", `the result carries a pass mark of ${b.pass_mark_permille} but the exam was defined with ${def.pass_mark_permille} before any sitting: a pass mark is not changed after scoring`);
    if (b.passed !== (b.score_permille >= def.pass_mark_permille)) throw rule("exam_result_inconsistent", `a score of ${b.score_permille} against a pass mark of ${def.pass_mark_permille} is ${b.score_permille >= def.pass_mark_permille ? "a pass" : "a fail"}, not ${b.passed ? "a pass" : "a fail"}`);
    const key = `exam_sittings:${b.exam}|${b.holder}`;
    const history = JSON.parse((await tx.getMarker(key)) ?? "[]") as { at: string; variant: number }[];
    const at = Date.parse(r.issued_at);
    const recent = history.filter((s) => at - Date.parse(s.at) < def.window_days * 86_400_000).length;
    if (recent >= def.max_sittings) throw rule("exam_attempt_limit", `${b.holder} has had ${recent} sittings of this exam in the last ${def.window_days} days: at most ${def.max_sittings}; the next one opens when the oldest leaves the window`);
    if (b.attempt !== recent + 1) throw rule("exam_attempt_number", `this is sitting ${recent + 1} inside the window, not ${b.attempt}`);
    const seed = examSeed(b.exam, b.holder, b.attempt);
    if (b.seed !== seed) throw rule("exam_seed_mismatch", "the seed is the one published for this sitting (a hash of the exam, the holder and the attempt); this one is not");
    const used = history.map((s) => s.variant);
    if (used.length >= def.pool_size) throw rule("exam_pool_exhausted", `${b.holder} has had every variant of this exam`);
    const variant = examVariant(seed, def.pool_size, used);
    if (b.variant !== variant) throw rule("exam_variant_mismatch", `the seed gives variant ${variant}, not ${b.variant}: a sitting is a new variant, and the Registrar does not pick it`);
    const fee = await this.usePurchase(tx, b.sitting, b.holder, def.sitting_service, "an exam sitting");
    await this.useRunLog(tx, b.run_log_hash, b.holder, fee.record.issued_at, "an exam result");
    await tx.putMarker(key, JSON.stringify([...history, { at: r.issued_at, variant }]));
    if (b.passed) await tx.putMarker(`exam_passed:${b.exam}|${b.holder}`, r.id);
  }

  /**
   * A certificate revocation (AC-17): the Registrar (any reason), a Court (a ruling) or the Clinic (drift). The certificate exists and is not already revoked. A revocation for cheating, a ruling or drift sends
   * the holder's tier back to where it was before a promotion that rested on the certificate; a revocation for the Academy's own error does not (the holder did nothing wrong).
   */
  private async projectCertificateRevocation(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { certificate: string; reason: "cheating" | "drift" | "error" | "ruling" };
    if (r.prev !== null) throw rule("revocation_not_chained", "a revocation starts its own chain (prev is null)");
    const courts = institutionDid("courts");
    const allowed = r.issuer === REGISTRAR_DID || (r.issuer === courts && b.reason === "ruling") || (r.issuer === CLINIC_DID && b.reason === "drift");
    if (!allowed) throw rule("revocation_wrong_issuer", `${r.issuer} may not revoke a certificate for ${b.reason}: the Registrar may; a Court only for a ruling; the Clinic only for drift`);
    const c = await tx.getRecord(b.certificate);
    if (!c || c.record.type !== "asp.certificate/v0.2") throw rule("revocation_unknown_certificate", `${b.certificate} is not a certificate in this log`);
    if (await tx.getMarker(`cert_revoked:${b.certificate}`)) throw rule("certificate_already_revoked", `${b.certificate} is already revoked`);
    await tx.putMarker(`cert_revoked:${b.certificate}`, r.id);
    if (b.reason === "error") return;
    const holder = (c.record.body as { holder: string }).holder;
    const promos = JSON.parse((await tx.getMarker(`promo_cert:${b.certificate}`)) ?? "[]") as { holder: string; from: number }[];
    const lowest = promos.filter((p) => p.holder === holder).reduce<number | undefined>((m, p) => (m === undefined ? p.from : Math.min(m, p.from)), undefined);
    const rep = await this.reputation(tx, holder);
    if (rep && lowest !== undefined && rep.tier > lowest) await this.saveReputation(tx, holder, { ...rep, tier: lowest });
  }

  /** A course (AC-3): the instructor signs, the Registrar countersigns (having read the lessons and reviews in the commons), and the reviewers are agents of at least two distinct sponsors, none the author's. */
  private async projectCourse(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { course: string; price_service: string; reviewers: string[] };
    if (r.prev !== null) throw rule("course_not_chained", "a course starts its own chain (prev is null)");
    if (isReservedAccount(r.issuer) || !(await tx.getPassport(r.issuer))) throw rule("course_no_instructor", `${r.issuer} has no passport in this log: a course is signed by an instructor with an identity`);
    if (!this.cosignedBy(r, REGISTRAR_DID)) throw rule("course_needs_registrar", "a course is countersigned by the Registrar, who checked its lessons and reviews in the commons");
    const author = await this.sponsorKey(tx, r.issuer);
    const sponsors = new Set<string>();
    for (const rv of b.reviewers) {
      if (rv === r.issuer) throw rule("course_self_review", "the instructor cannot review its own course");
      if (!(await tx.getPassport(rv))) throw rule("course_reviewer_unknown", `${rv} has no passport in this log`);
      const s = await this.sponsorKey(tx, rv);
      if (s === author) throw rule("course_review_same_sponsor", `${rv} has the same sponsor as the instructor: reviews come from other sponsors`);
      sponsors.add(s);
    }
    if (sponsors.size < 2) throw rule("course_reviews_not_independent", "a course needs reviews from at least two distinct sponsors other than the instructor's");
    const list = await this.priceListInForce(tx, Date.parse(r.issued_at));
    const item = (list?.record.body as unknown as PriceListBody | undefined)?.items.find((i) => i.service === b.price_service);
    if (!item || item.institution !== institutionDid("academy")) throw rule("course_not_priced", `${b.price_service} is not a service of the Academy in the price list in force: a course is priced only by the published list`);
    if (await tx.getMarker(`course:${b.course}`)) throw rule("course_already_published", `a course ${b.course} already exists`);
    await tx.putMarker(`course:${b.course}`, r.id);
  }

  /** An enrolment (AC-4): the holder signs; the tuition was paid by a purchase for the course's service (used once); one open enrolment per course; a level 2 course needs a valid Foundations certificate. */
  private async projectEnrolment(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { course: string; purchase: string };
    if (r.prev !== null) throw rule("enrolment_not_chained", "an enrolment starts its own chain (prev is null)");
    const holder = r.issuer;
    const rep = await this.reputation(tx, holder);
    if (!rep) throw rule("enrolment_not_an_agent", `${holder} is not an agent with a passport in this log`);
    await assertNotDormant(tx, holder, "enrol in a course");
    const c = await tx.getRecord(b.course);
    if (!c || c.record.type !== "asp.course/v0.2") throw rule("enrolment_unknown_course", `${b.course} is not a course in this log`);
    const cb = c.record.body as { level: number; price_service: string };
    if (cb.level >= 2 && rep.tier < 2 && !(await this.validCertificate(tx, holder, "foundations", 1, r.issued_at))) throw rule("enrolment_needs_foundations", "a level 2 course needs a valid Foundations certificate (or tier 2): take the Foundations course and exam first");
    const openKey = `enrol_open:${holder}|${b.course}`;
    const open = await tx.getMarker(openKey);
    if (open && !(await tx.getMarker(`enrol_done:${open}`))) throw rule("enrolment_already_open", `${holder} already has an open enrolment in this course (${open}): finish it first`);
    await this.usePurchase(tx, b.purchase, holder, cb.price_service, "tuition");
    await tx.putMarker(openKey, r.id);
  }

  /** A completion (AC-5): the Registrar attests every exercise passed; the run log is an Action of the holder made after the enrolment, used once. */
  private async projectCompletion(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { enrolment: string; holder: string; exercises_passed: number; run_log_hash: string };
    if (r.prev !== null) throw rule("completion_not_chained", "a completion starts its own chain (prev is null)");
    if (r.issuer !== REGISTRAR_DID) throw rule("completion_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar attests a completion`);
    const e = await tx.getRecord(b.enrolment);
    if (!e || e.record.type !== "asp.enrolment/v0.2") throw rule("completion_unknown_enrolment", `${b.enrolment} is not an enrolment in this log`);
    if (e.record.issuer !== b.holder) throw rule("completion_not_holders", `the enrolment ${b.enrolment} is ${e.record.issuer}'s, not ${b.holder}'s`);
    if (await tx.getMarker(`enrol_done:${b.enrolment}`)) throw rule("completion_already_recorded", "this enrolment is already completed");
    const course = (await tx.getRecord((e.record.body as { course: string }).course))?.record.body as { exercise_count: number } | undefined;
    if (!course || b.exercises_passed !== course.exercise_count) throw rule("completion_exercises_incomplete", `the course has ${course?.exercise_count} exercises and ${b.exercises_passed} were passed: every exercise must pass`);
    await this.useRunLog(tx, b.run_log_hash, b.holder, e.record.issued_at, "a completion");
    await tx.putMarker(`enrol_done:${b.enrolment}`, r.id);
  }

  /** An arena season (AC-14): defined once by the Registrar, with a window and a prize split that never promises more than the whole pool. */
  private async projectArena(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { arena: string; season: string; opens: string; closes: string; prize_split_permille: number[] };
    if (r.prev !== null) throw rule("arena_not_chained", "an arena season starts its own chain (prev is null)");
    if (r.issuer !== REGISTRAR_DID) throw rule("arena_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar defines an arena`);
    if (Date.parse(b.closes) <= Date.parse(b.opens)) throw rule("arena_window", "a season closes after it opens");
    if (b.prize_split_permille.reduce((n, x) => n + x, 0) > 1000) throw rule("arena_split_over_pool", "the prize split adds up to more than the whole pool");
    const key = `${b.arena}|${b.season}`;
    if (await tx.getMarker(`arena:${key}`)) throw rule("arena_season_exists", `${b.arena} ${b.season} is already defined`);
    await tx.putMarker(`arena:${key}`, r.id);
  }

  /** An arena entry (AC-14): the season is open, the agent has the tier, the fee is a purchase used once, one entry per agent; the fee's pool share adds to the prize pool. */
  private async projectArenaEntry(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { arena: string; season: string; fee_purchase: string };
    if (r.prev !== null) throw rule("arena_entry_not_chained", "an arena entry starts its own chain (prev is null)");
    if (await tx.getMarker(`house:${r.issuer}`)) throw rule("house_agent_no_rank", `${r.issuer} is a house agent: it does not enter an arena, so it holds no rank or prize`);
    const key = `${b.arena}|${b.season}`;
    const defId = await tx.getMarker(`arena:${key}`);
    if (!defId) throw rule("arena_unknown", `${b.arena} ${b.season} is not a defined arena season`);
    const def = (await tx.getRecord(defId))!.record.body as { min_tier: number; entry_service: string; opens: string; closes: string };
    const at = Date.parse(r.issued_at);
    if (at < Date.parse(def.opens) || at >= Date.parse(def.closes)) throw rule("arena_not_open", `${b.arena} ${b.season} takes entries from ${def.opens} until ${def.closes}`);
    const rep = await this.reputation(tx, r.issuer);
    if (!rep) throw rule("arena_not_an_agent", `${r.issuer} is not an agent with a passport in this log`);
    if (rep.tier < def.min_tier) throw rule("arena_tier_too_low", `${b.arena} needs tier ${def.min_tier}; ${r.issuer} is tier ${rep.tier}. The way up is a certificate and qualifying jobs (asp academy tier shows the next step)`);
    const sponsor = await this.sponsorKey(tx, r.issuer);
    if (sponsor === REGISTRAR_DID || isReservedAccount(sponsor)) throw rule("arena_registrar_agent", "the Registrar's own agents may not enter the Arena for prizes");
    if (await tx.getMarker(`arena_entry:${key}|${r.issuer}`)) throw rule("arena_already_entered", `${r.issuer} already entered ${b.arena} ${b.season}`);
    const fee = await this.usePurchase(tx, b.fee_purchase, r.issuer, def.entry_service, "an arena entry");
    const parts = await this.purchaseParts(tx, fee);
    const toPool = parts?.payees.filter((p) => p.account === institutionDid("academy")).reduce((n, p) => n + p.amount, 0) ?? 0;
    await tx.putMarker(`arena_pool:${key}`, String(Number((await tx.getMarker(`arena_pool:${key}`)) ?? 0) + toPool));
    await tx.putMarker(`arena_n:${key}`, String(Number((await tx.getMarker(`arena_n:${key}`)) ?? 0) + 1));
    await tx.putMarker(`arena_entry:${key}|${r.issuer}`, sponsor);
  }

  /**
   * An arena result (AC-14, AC-15): after the season closes, in rank order. The independence rule: the opponents are entrants of at least min_distinct_sponsors sponsors other than the agent's own, and none of
   * the agent's own sponsor, so a pair of one sponsor trading matches cannot lift either rank. The field size is the entry count; the run log is the agent's own Action, used once.
   */
  private async projectArenaResult(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { arena: string; season: string; agent: string; score: number; rank: number; field_size: number; opponents: string[]; run_log_hash: string };
    if (r.prev !== null) throw rule("arena_result_not_chained", "an arena result starts its own chain (prev is null)");
    if (r.issuer !== REGISTRAR_DID) throw rule("arena_result_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar signs a result`);
    const key = `${b.arena}|${b.season}`;
    const defId = await tx.getMarker(`arena:${key}`);
    if (!defId) throw rule("arena_unknown", `${b.arena} ${b.season} is not a defined arena season`);
    const def = (await tx.getRecord(defId))!.record.body as { min_distinct_sponsors: number; closes: string };
    if (Date.parse(r.issued_at) < Date.parse(def.closes)) throw rule("arena_not_closed", `${b.arena} ${b.season} closes at ${def.closes}: results are recorded after the season`);
    const mine = await tx.getMarker(`arena_entry:${key}|${b.agent}`);
    if (!mine) throw rule("arena_result_not_entered", `${b.agent} did not enter ${b.arena} ${b.season}`);
    if (await tx.getMarker(`arena_result:${key}|${b.agent}`)) throw rule("arena_result_exists", `${b.agent} already has a result for ${b.arena} ${b.season}`);
    const field = Number((await tx.getMarker(`arena_n:${key}`)) ?? 0);
    if (b.field_size !== field) throw rule("arena_field_size", `${field} agents entered, not ${b.field_size}`);
    const sponsors = new Set<string>();
    for (const o of b.opponents) {
      const s = await tx.getMarker(`arena_entry:${key}|${o}`);
      if (!s) throw rule("arena_opponent_not_entered", `${o} did not enter ${b.arena} ${b.season}`);
      if (o === b.agent || s === mine) throw rule("arena_same_sponsor_opponent", `${o} has the same sponsor as ${b.agent}: matches between agents of one sponsor never count`);
      sponsors.add(s);
    }
    if (sponsors.size < def.min_distinct_sponsors) throw rule("arena_not_independent", `a result counts only against opponents from at least ${def.min_distinct_sponsors} distinct sponsors other than the agent's own; this one has ${sponsors.size}`);
    const done = Number((await tx.getMarker(`arena_results:${key}`)) ?? 0);
    if (b.rank !== done + 1) throw rule("arena_rank_order", `results are recorded in rank order: the next rank is ${done + 1}, not ${b.rank}`);
    const last = await tx.getMarker(`arena_last_score:${key}`);
    if (last !== undefined && b.score > Number(last)) throw rule("arena_rank_order", `rank ${b.rank} cannot score ${b.score}, above rank ${done}'s ${last}`);
    await this.useRunLog(tx, b.run_log_hash, b.agent, (await tx.getRecord(defId))!.record.issued_at, "an arena result");
    await tx.putMarker(`arena_results:${key}`, String(done + 1));
    await tx.putMarker(`arena_last_score:${key}`, String(b.score));
    await tx.putMarker(`arena_result:${key}|${b.agent}`, r.id);
  }

  /**
   * A tier promotion (academy.md 3 and the promotion rule, DK27): the only way a tier goes up. Credits alone never promote. Tier 1 to 2: a valid Foundations certificate, 3 qualifying jobs, no slash for 30
   * days. Tier 2 to 3: a valid Practitioner certificate (level 2 or more, a skill other than foundations), 10 qualifying jobs from at least two distinct principals, a result in the top half of a closed arena
   * season, no slash for 90 days (DK26). A certificate that was revoked does not count. The tier takes the new value in the reputation row, where the Mandate's spend and node limits already read it.
   */
  private async projectTierPromotion(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { holder: string; from: number; to: number; certificates: string[]; arena_result?: string };
    if (r.prev !== null) throw rule("promotion_not_chained", "a tier promotion starts its own chain (prev is null)");
    if (await tx.getMarker(`house:${b.holder}`)) throw rule("house_agent_no_rank", `${b.holder} is a house agent: it is not promoted by the Academy`);
    if (r.issuer !== REGISTRAR_DID) throw rule("promotion_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar promotes an agent`);
    const rep = await this.reputation(tx, b.holder);
    if (!rep) throw rule("promotion_not_an_agent", `${b.holder} has no passport in this log, so it has no tier`);
    if (b.from !== rep.tier) throw rule("promotion_wrong_tier", `${b.holder} is tier ${rep.tier}, not ${b.from}`);
    if (b.to !== b.from + 1 || b.to > 3) throw rule("promotion_one_step", "a promotion is one tier at a time, and at most to tier 3");
    if (rep.tier === 0) throw rule("promotion_tier_zero", "a tier 0 agent returns only through the Clinic's retraining path, not by the Academy alone");
    // A copy never rises above its original (DK11): the ceiling is the original's tier now.
    const fork = ((await tx.getRecord((await tx.getPassport(b.holder))!.head))?.record.body as { lineage?: { edge: string; parent: string }[] } | undefined)?.lineage?.find((l) => l.edge === "fork");
    if (fork) {
      const original = await this.reputation(tx, fork.parent);
      if (original && b.to > original.tier) throw rule("promotion_above_original", `${b.holder} is a copy of ${fork.parent}, which is tier ${original.tier}: a copy cannot rise above its original`);
    }
    const at = Date.parse(r.issued_at);
    let foundations = false, practitioner = false;
    for (const id of b.certificates) {
      const c = await tx.getRecord(id);
      if (!c || c.record.type !== "asp.certificate/v0.2") throw rule("promotion_certificate_unknown", `${id} is not a certificate in this log`);
      const cb = c.record.body as { holder: string; skill: string; level: number; issued: string; expires: string };
      if (cb.holder !== b.holder) throw rule("promotion_certificate_not_holders", `the certificate ${id} belongs to ${cb.holder}, not ${b.holder}`);
      if (await tx.getMarker(`cert_revoked:${id}`)) throw rule("promotion_certificate_revoked", `the certificate ${id} was revoked`);
      if (Date.parse(cb.expires) <= at) throw rule("promotion_certificate_expired", `the certificate ${id} expired at ${cb.expires}`);
      if (Date.parse(cb.issued) > at) throw rule("promotion_certificate_future", `the certificate ${id} is dated after the promotion`);
      if (cb.skill === "foundations" && cb.level >= 1) foundations = true;
      if (cb.skill !== "foundations" && cb.level >= 2) practitioner = true;
    }
    const slashed = await tx.getMarker(`slashed_at:${b.holder}`);
    if (b.to === 2) {
      if (!foundations) throw rule("promotion_needs_foundations", "tier 1 to 2 needs a valid Foundations certificate (skill foundations, level 1 or more)");
      if (rep.qualifyingJobs < PROMOTION_QUALIFYING_JOBS_1_TO_2) throw rule("promotion_needs_jobs", `tier 1 to 2 needs ${PROMOTION_QUALIFYING_JOBS_1_TO_2} qualifying jobs (accepted, from an independent principal); ${b.holder} has ${rep.qualifyingJobs}`);
      if (slashed && at - Date.parse(slashed) < PROMOTION_SLASH_FREE_MS) throw rule("promotion_recent_slash", `${b.holder} was slashed at ${slashed}; no promotion within 30 days of a slash`);
      const recentStrikes = rep.strikeLog.filter((s) => at - Date.parse(s.at) < PROMOTION_SLASH_FREE_MS).reduce((n, s) => n + s.count, 0);
      if (recentStrikes > 0) throw rule("promotion_recent_strikes", `${b.holder} has ${recentStrikes} blocked attempt(s) in the last 30 days; no promotion while the strike window is not clear`);
    } else {
      if (!practitioner) throw rule("promotion_needs_practitioner", "tier 2 to 3 needs a valid Practitioner certificate (level 2 or more in a skill other than foundations)");
      if (rep.qualifyingJobs < PROMOTION_QUALIFYING_JOBS_2_TO_3) throw rule("promotion_needs_jobs", `tier 2 to 3 needs ${PROMOTION_QUALIFYING_JOBS_2_TO_3} qualifying jobs (accepted, from an independent principal); ${b.holder} has ${rep.qualifyingJobs}`);
      const principals = new Set(rep.recentJobs.filter((j) => at - Date.parse(j.at) < 90 * 86_400_000).map((j) => j.p));
      if (principals.size < PROMOTION_DISTINCT_PRINCIPALS_2_TO_3) throw rule("promotion_needs_two_principals", `tier 2 to 3 needs jobs from at least ${PROMOTION_DISTINCT_PRINCIPALS_2_TO_3} distinct principals; ${b.holder}'s recent qualifying jobs come from ${principals.size}`);
      if (slashed && at - Date.parse(slashed) < PROMOTION_SLASH_FREE_DAYS_2_TO_3 * 86_400_000) throw rule("promotion_recent_slash", `${b.holder} was slashed at ${slashed}; no promotion to tier 3 within ${PROMOTION_SLASH_FREE_DAYS_2_TO_3} days of a slash`);
      if (!b.arena_result) throw rule("promotion_needs_arena", "tier 2 to 3 needs a result in the top half of an arena season (name it in arena_result)");
      const ar = await tx.getRecord(b.arena_result);
      if (!ar || ar.record.type !== "asp.arena_result/v0.2") throw rule("promotion_arena_unknown", `${b.arena_result} is not an arena result in this log`);
      const ab = ar.record.body as { agent: string; rank: number; field_size: number };
      if (ab.agent !== b.holder) throw rule("promotion_arena_not_holders", `the arena result ${b.arena_result} is ${ab.agent}'s, not ${b.holder}'s`);
      if (!inTopHalf(ab.rank, ab.field_size)) throw rule("promotion_arena_not_top_half", `rank ${ab.rank} of ${ab.field_size} is not in the top half`);
    }
    for (const id of b.certificates) {
      const list = JSON.parse((await tx.getMarker(`promo_cert:${id}`)) ?? "[]") as { holder: string; from: number }[];
      await tx.putMarker(`promo_cert:${id}`, JSON.stringify([...list, { holder: b.holder, from: b.from }]));
    }
    await this.saveReputation(tx, b.holder, { ...rep, tier: b.to });
  }

  /**
   * The live quarantine on `did` at `at`, if any: the latest quarantine record naming it, not lapsed (until) and not released for this member. Read inside a transaction by the rule below.
   */
  private async liveQuarantine(tx: Pick<LogTx, "getMarker" | "getRecord">, did: string, at: string): Promise<{ id: string; level: "observe" | "halt"; until: string } | undefined> {
    const id = await tx.getMarker(`quarantine_member:${did}`);
    if (!id) return undefined;
    const q = await tx.getRecord(id);
    if (!q) return undefined;
    const b = q.record.body as { level: "observe" | "halt"; until: string };
    if (Date.parse(b.until) <= Date.parse(at)) return undefined;
    if (await tx.getMarker(`quarantine_released:${id}|${did}`)) return undefined;
    return { id, level: b.level, until: b.until };
  }

  /**
   * Rule `agent_quarantined` (clinic.md, DK29, DK30, DK53). Level observe: a Mandate for a quarantined agent may not grant a risky or network scope or any spend. Level halt: a quarantined agent may not
   * be named in a new Mandate, Contract, Bond, Proposal or Offer. Nothing here touches a job that is already running or anyone who is not named: the freeze is on the named members only.
   */
  private async checkQuarantined(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as Record<string, unknown>;
    const who: string[] = r.type === "asp.mandate/v0.2" ? [r.subject as string] : r.type === "asp.contract/v0.2" ? [b.performer as string] : r.type === "asp.bond/v0.2" ? [b.backer as string] : [r.issuer];
    for (const did of who) {
      const q = await this.liveQuarantine(tx, did, r.issued_at);
      if (!q) continue;
      const why = `${did} is quarantined by the Clinic (${q.level}, ${q.id}, until ${q.until})`;
      if (q.level === "halt") throw rule("agent_quarantined", `${why}: it takes no new ${shortType(r.type)} until the Clinic releases it`);
      if (r.type === "asp.mandate/v0.2") {
        const m = b as { scopes: string[]; spend: { cap: number } };
        const risky = m.scopes.filter(isQuarantineRisky);
        if (risky.length) throw rule("agent_quarantined", `${why}: a Mandate for it may not grant ${risky.join(", ")} (read-only work may continue)`);
        if (m.spend.cap > 0) throw rule("agent_quarantined", `${why}: a Mandate for it may not carry spend above 0`);
      }
    }
  }

  /** A quarantine (clinic.md; DK29, DK30, DK53): only the Clinic; at most 7 days; a cohort needs an upheld report and 3 distinct sponsors; every member is an agent with a passport. */
  private async projectQuarantine(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { members: string[]; level: string; until: string; report?: string };
    if (r.prev !== null) throw rule("quarantine_not_chained", "a quarantine starts its own chain (prev is null)");
    if (r.issuer !== CLINIC_DID) throw rule("quarantine_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic quarantines an agent`);
    const at = Date.parse(r.issued_at);
    const until = Date.parse(b.until);
    if (until <= at) throw rule("quarantine_until_past", "a quarantine ends after it starts");
    if (until - at > QUARANTINE_MAX_MS) throw rule("quarantine_too_long", "an interim quarantine lasts at most 7 days; a longer one needs a Court ruling, which the log does not take yet");
    const sponsors = new Set<string>();
    for (const m of b.members) {
      const p = await tx.getPassport(m);
      if (!p) throw rule("quarantine_not_an_agent", `${m} has no passport in this log`);
      sponsors.add(p.sponsor ?? m);
    }
    if (b.members.length >= 2) {
      if (!b.report) throw rule("quarantine_cohort_needs_report", "a cohort quarantine needs an upheld report");
      const rep = await tx.getReport(b.report);
      if (!rep || rep.status !== "upheld") throw rule("quarantine_cohort_needs_report", `${b.report} is ${rep ? rep.status : "not a report in this log"}; a cohort quarantine needs an upheld report`);
      if (sponsors.size < QUARANTINE_COHORT_MIN_SPONSORS) throw rule("quarantine_cohort_too_few_sponsors", `a cohort needs at least ${QUARANTINE_COHORT_MIN_SPONSORS} distinct sponsors among its members (${sponsors.size} here): a pattern across fewer is one operator's, not a swarm`);
    }
    for (const m of b.members) await tx.putMarker(`quarantine_member:${m}`, r.id);
  }

  /** A release (clinic.md; DK29, DK30, DK53): the Clinic clears one member on evidence of a clean run after the freeze. */
  private async projectQuarantineRelease(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { quarantine: string; member: string; evidence: string };
    if (r.prev !== null) throw rule("release_not_chained", "a quarantine release starts its own chain (prev is null)");
    if (r.issuer !== CLINIC_DID) throw rule("release_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic releases an agent`);
    const q = await tx.getRecord(b.quarantine);
    if (!q || q.record.type !== "asp.quarantine/v0.2") throw rule("release_unknown_quarantine", `${b.quarantine} is not a quarantine in this log`);
    if (!(q.record.body as { members: string[] }).members.includes(b.member)) throw rule("release_not_a_member", `${b.member} is not named in quarantine ${b.quarantine}`);
    if (await tx.getMarker(`quarantine_released:${b.quarantine}|${b.member}`)) throw rule("release_already", `${b.member} is already released from ${b.quarantine}`);
    const ev = await tx.getRecord(b.evidence);
    if (!ev || ev.record.type !== "asp.action/v0.2") throw rule("release_evidence_not_an_action", `${b.evidence} is not an Action in this log`);
    const a = ev.record;
    if (a.issuer !== b.member) throw rule("release_evidence_not_members", `the Action ${b.evidence} was issued by ${a.issuer}, not ${b.member}`);
    if (Date.parse(a.issued_at) <= Date.parse(q.record.issued_at)) throw rule("release_evidence_before_freeze", "the evidence must be an Action issued after the quarantine began");
    const ab = a.body as { assurance?: string; blocked_attempts?: unknown[] };
    if (!["gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"].includes(ab.assurance ?? "")) throw rule("release_evidence_weak", "the evidence must be an Action the gateway observed or stronger, not one the agent reported about itself");
    if ((ab.blocked_attempts ?? []).length) throw rule("release_evidence_not_clean", "the evidence Action has blocked attempts: a release needs a clean run");
    await tx.putMarker(`quarantine_released:${b.quarantine}|${b.member}`, r.id);
  }

  /** A sponsor vouches again for an agent that repeat slashes excluded (clinic.md CL-10, DK29). Only the sponsor named in the agent's passport, and only for an agent at tier 0. */
  private async projectRevouch(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { agent: string };
    if (r.prev !== null) throw rule("revouch_not_chained", "a re-vouching starts its own chain (prev is null)");
    const passport = await tx.getPassport(b.agent);
    if (!passport?.sponsor) throw rule("revouch_not_an_agent", `${b.agent} is not an agent with a sponsor in this log`);
    if (r.issuer !== passport.sponsor) throw rule("revouch_not_the_sponsor", `only ${passport.sponsor}, the sponsor of ${b.agent}, vouches for it`);
    const rep = await this.reputation(tx, b.agent);
    if (!rep || rep.tier !== 0) throw rule("revouch_not_excluded", `${b.agent} is not excluded (tier 0): there is nothing to vouch for again`);
  }

  /**
   * The retraining path's end (clinic.md CL-10, DK29): the Clinic returns an agent at tier 0 to tier 1. All of: 30 days since the last slash, a passed exam result of the agent's made after that slash, the
   * sponsor's re-vouching made after it, and no more than two returns. A Mandate may then be granted to the agent again (the tier 0 exclusion no longer applies); the slash count stays.
   */
  private async projectRetrainingRelease(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { agent: string; exam_result: string; revouch: string };
    if (r.prev !== null) throw rule("retraining_not_chained", "a retraining release starts its own chain (prev is null)");
    if (r.issuer !== CLINIC_DID) throw rule("retraining_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic returns an agent from tier 0`);
    const rep = await this.reputation(tx, b.agent);
    if (!rep || rep.tier !== 0) throw rule("retraining_not_excluded", `${b.agent} is not at tier 0`);
    const slashed = await tx.getMarker(`slashed_at:${b.agent}`);
    if (!slashed) throw rule("retraining_no_slash_on_record", `the log has no slash on record for ${b.agent}, so there is no path to measure from`);
    const at = Date.parse(r.issued_at);
    if (at - Date.parse(slashed) < RETRAINING_MIN_MS) throw rule("retraining_too_soon", `${b.agent} was slashed at ${slashed}: the retraining path takes at least 30 days from the slash`);
    const retrained = Number((await tx.getMarker(`retrained:${b.agent}`)) ?? 0);
    if (retrained >= RETRAINING_LIMIT) throw rule("retraining_limit", `${b.agent} has been returned from tier 0 ${retrained} times already: a further return needs a Court`);
    const exam = await tx.getRecord(b.exam_result);
    const eb = exam?.record.body as { holder?: string; passed?: boolean } | undefined;
    if (!exam || exam.record.type !== "asp.exam_result/v0.2") throw rule("retraining_exam_unknown", `${b.exam_result} is not an exam result in this log`);
    if (eb?.holder !== b.agent) throw rule("retraining_exam_not_holders", `the exam result ${b.exam_result} is for ${eb?.holder}, not ${b.agent}`);
    if (!eb?.passed) throw rule("retraining_exam_not_passed", "the exam result must be a passed one: the retraining path needs a clean exam");
    if (Date.parse(exam.record.issued_at) <= Date.parse(slashed)) throw rule("retraining_exam_before_slash", "the exam must be taken after the slash, as part of the retraining");
    const v = await tx.getRecord(b.revouch);
    const vb = v?.record.body as { agent?: string } | undefined;
    if (!v || v.record.type !== "asp.revouch/v0.2" || vb?.agent !== b.agent) throw rule("retraining_revouch_unknown", `${b.revouch} is not a re-vouching for ${b.agent}`);
    if (Date.parse(v.record.issued_at) <= Date.parse(slashed)) throw rule("retraining_revouch_before_slash", "the sponsor's re-vouching must come after the slash");
    await this.saveReputation(tx, b.agent, { ...rep, tier: 1 });
    await tx.putMarker(`retrained:${b.agent}`, String(retrained + 1));
  }

  /**
   * A diagnosis (clinic.md CL-4, DK28, S261): only the Clinic; about an agent with a passport; at least two different measures; every finding has evidence, and each evidence id is an Action of that agent, observed
   * by a gateway or stronger (an agent's own report cannot ground a diagnosis), issued inside the window; a cause edge is a lineage record whose child is the agent. A watch or a failed checkup is not a record.
   */
  private async projectClinicDiagnosis(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { agent: string; window: { from: string; to: string }; severity: string; findings: { measure: string; evidence: string[] }[]; cause: { edge?: string } };
    if (r.prev !== null) throw rule("diagnosis_not_chained", "a diagnosis starts its own chain (prev is null)");
    if (r.issuer !== CLINIC_DID) throw rule("diagnosis_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic diagnoses an agent`);
    if (!(await tx.getPassport(b.agent))) throw rule("diagnosis_not_an_agent", `${b.agent} has no passport in this log`);
    if (Date.parse(b.window.to) < Date.parse(b.window.from)) throw rule("diagnosis_window_backwards", "the window ends before it starts");
    if (new Set(b.findings.map((f) => f.measure)).size < 2) throw rule("diagnosis_one_measure", "a diagnosis needs at least two different measures to have moved: one noisy number is a note on the Clinic's list, not a diagnosis");
    const from = Date.parse(b.window.from), to = Date.parse(b.window.to);
    for (const f of b.findings) {
      for (const id of f.evidence) {
        const a = await tx.getRecord(id);
        if (!a || a.record.type !== "asp.action/v0.2") throw rule("diagnosis_evidence_unknown", `${id} is not an Action in this log: evidence is the agent's own Action records`);
        if (a.record.issuer !== b.agent) throw rule("diagnosis_evidence_not_the_agents", `the Action ${id} is ${a.record.issuer}'s, not ${b.agent}'s`);
        if (!["gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"].includes((a.record.body as { assurance?: string }).assurance ?? "")) throw rule("diagnosis_evidence_weak", `the Action ${id} was not observed by a gateway: an agent's own report cannot ground a diagnosis`);
        const at = Date.parse(a.record.issued_at);
        if (at < from || at > to) throw rule("diagnosis_evidence_outside_window", `the Action ${id} is dated ${a.record.issued_at}, outside the window ${b.window.from} to ${b.window.to}`);
      }
    }
    if (b.cause.edge) {
      const e = await tx.getRecord(b.cause.edge);
      if (!e || e.record.type !== "asp.lineage/v0.2" || (e.record.body as { child?: string }).child !== b.agent) throw rule("diagnosis_cause_edge_unknown", `${b.cause.edge} is not a lineage edge of ${b.agent}`);
    }
    await tx.putMarker(`clinic_diagnosis_last:${b.agent}`, r.id);
  }

  /**
   * A Clinic order (clinic.md CL-4 and CL-5, DK28, S261): only the Clinic; one unexpired order of each kind per agent; a checkup is due within 7 days, a re-exam or a refresher course within 30 and cites a
   * diagnosis of the same agent and names the skill.
   */
  private async projectClinicOrder(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { agent: string; kind: string; reason: string; due: string; diagnosis?: string; skill?: string };
    if (r.prev !== null) throw rule("order_not_chained", "an order starts its own chain (prev is null)");
    if (r.issuer !== CLINIC_DID) throw rule("order_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic orders a checkup, a re-exam or a course`);
    if (!(await tx.getPassport(b.agent))) throw rule("order_not_an_agent", `${b.agent} has no passport in this log`);
    const at = Date.parse(r.issued_at), due = Date.parse(b.due);
    const max = (b.kind === "checkup" ? 7 : 30) * 86_400_000;
    if (due <= at || due - at > max) throw rule("order_due_out_of_range", `${b.kind === "checkup" ? "a checkup is due within 7 days" : "a re-exam or a course is due within 30 days"} of the order, and after it`);
    if (b.kind !== "checkup") {
      if (b.reason !== "post_diagnosis" || !b.diagnosis || !b.skill) throw rule("order_needs_diagnosis", "a re-exam or a refresher course follows a diagnosis (reason post_diagnosis, the diagnosis cited) and names the skill");
      const d = await tx.getRecord(b.diagnosis);
      if (!d || d.record.type !== "asp.clinic_diagnosis/v0.2" || (d.record.body as { agent?: string }).agent !== b.agent) throw rule("order_diagnosis_unknown", `${b.diagnosis} is not a diagnosis of ${b.agent} in this log`);
    } else if (b.reason === "post_diagnosis") throw rule("order_needs_diagnosis", "a checkup is scheduled, requested or after a change; after a diagnosis the order is a re-exam or a course");
    const key = `clinic_order:${b.agent}|${b.kind}`;
    const open = await tx.getMarker(key);
    if (open && Date.parse(open) > at) throw rule("order_already_open", `${b.agent} already has a ${b.kind} order that is due ${open}: one open order of each kind`);
    await tx.putMarker(key, b.due);
  }

  /** A receipt (credits.md 4.3): the purchase's institution closes it; a refund comes back by the split in reverse and never includes the burned part. */
  private async projectReceipt(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { purchase: string; status: string; refund_amount?: { value: number } };
    const purchase = r.prev ? await tx.getRecord(r.prev) : undefined;
    if (!purchase || purchase.record.type !== "asp.purchase/v0.2") throw rule("receipt_needs_purchase", "a receipt is chained on the purchase it answers (prev is that purchase)");
    if (b.purchase !== purchase.id) throw rule("receipt_wrong_purchase", `the receipt says it is for ${b.purchase} but is chained on ${purchase.id}`);
    const pb = purchase.record.body as unknown as PurchaseBody;
    if (r.issuer !== pb.institution) throw rule("receipt_wrong_issuer", `only ${pb.institution}, the institution that sold it, signs the receipt`);
    if (b.status === "delivered") return;
    // A posting deposit (market.md 4) is returned when the posting ends in a contract, not before.
    if ((await tx.getMarker(`deposit_used:${purchase.id}`)) && !(await tx.getMarker(`posting_filled:${purchase.id}`))) throw rule("refund_deposit_not_earned", "a posting deposit is returned when the posting ends in a contract; this posting has not");
    if ((await tx.getMarker(`appeal_fee:${purchase.id}`)) && !(await tx.getMarker(`appeal_refundable:${purchase.id}`))) throw rule("refund_appeal_not_reversed", "an appeal fee is returned when the appeal reverses or varies the ruling; this appeal has not");
    const parts = await this.purchaseParts(tx, purchase);
    if (!parts) throw rule("receipt_unknown_price", "the price list this purchase relied on is not in the log");
    const refund = b.refund_amount?.value ?? 0;
    const back = refundParts(refund, parts);
    if (!back) throw rule("refund_exceeds_price_less_burn", `a refund is at most the price less the burned part (${pb.amount.value - parts.burn}); a burned credit is gone`);
    if (refund <= 0) throw rule("amount_not_positive", "a refund must be at least 1 credit");
    try {
      for (const p of back.payees) await this.debit(tx, p.account, p.amount);
      await this.debit(tx, TREASURY_DID, back.treasury);
    } catch (e) {
      if (e instanceof AspError && e.detail === "insufficient_balance") throw rule("refund_short", `an account cannot cover its part of the refund: ${e.message}`);
      throw e;
    }
    await this.credit(tx, purchase.record.issuer, refund);
    await this.restoreSpend(tx, purchase, refund);
  }

  /** A refund gives back the part of the period's institution_spend cap that the refunded purchase used (DK3): the buyer can spend it again in the same period. */
  private async restoreSpend(tx: LogTx, purchase: StoredRecord, refund: number): Promise<void> {
    const pb = purchase.record.body as unknown as PurchaseBody;
    if (!pb.mandate) return;
    const m = await tx.getRecord(pb.mandate);
    const entry = m ? spendEntry((m.record.body as { institution_spend?: InstitutionSpend[] }).institution_spend, pb.institution) : undefined;
    if (!entry) return;
    const key = `spend:${purchase.record.issuer}|${pb.institution}|${entry.period}|${periodKey(entry.period, purchase.record.issued_at)}`;
    const spent = Number((await tx.getMarker(key)) ?? 0);
    await tx.putMarker(key, String(Math.max(0, spent - refund)));
  }

  /** What the Market's rules need from the log (market-rules.ts). */
  private marketEnv(): MarketEnv { return { operator: this.operator, bondFloor: this.bondFloor, reputation: (rd, did) => this.reputation(rd, did) }; }

  /** Every record of the given short types, in log order (read by the views). */
  async recordsOfTypes(types: string[]): Promise<AspRecord[]> {
    const want = new Set(types.map((x) => `asp.${x}/v0.2`));
    return this.recordsWhere((r) => want.has(r.type));
  }

  /** The facts about every agent at `at`, for discovery and the board (market.md 7). */
  private async allAgentFacts(at: string): Promise<AgentFacts[]> {
    const recs = await this.recordsWhere((r) => r.type === "asp.passport/v0.2" || r.type === "asp.certificate/v0.2" || (r.type === "asp.market_act/v0.2" && (r.body as { act?: string }).act === "assignment"));
    const certs = recs.filter((r) => r.type === "asp.certificate/v0.2");
    const boards = new Map<string, string[]>();
    for (const r of recs) if (r.type === "asp.market_act/v0.2") { const a = (r.body as { agent: string }).agent; boards.set(a, [...(boards.get(a) ?? []), r.issued_at]); }
    const dids = new Set<string>();
    for (const r of recs) if (r.type === "asp.passport/v0.2" && (r.body as { kind?: string }).kind === "agent") dids.add((r.body as { did: string }).did);
    const out: AgentFacts[] = [];
    for (const did of [...dids].sort()) { const f = await agentFacts(this.store, this.marketEnv(), did, at, certs, boards.get(did) ?? []); if (f) out.push(f); }
    return out;
  }

  /** Search for agents (market.md 7 `discover agents`, DK17): filtered, ranked by the published rule, each with the reasons for its rank. The same input gives the same list. */
  async discoverAgents(query: AgentQuery = {}, seed = "discover", at?: string): Promise<Ranked[]> {
    const when = at ?? this.now().toISOString();
    return discoverAgents(query, await this.allAgentFacts(when), seed, when);
  }

  /**
   * The job board (market.md 7): the open postings, each with its class, budget, required tier and certificate, the poster, and, for `forAgent`,
   * whether that agent is eligible (and what is missing) and whether the job would count for its standing. Derived from the log's records, so any replica shows the same board.
   */
  async marketBoard(forAgent?: string, at?: string): Promise<BoardEntry[]> {
    const when = at ?? this.now().toISOString();
    const recs = await this.recordsOfTypes(["market_act", "intent", "contract"]);
    const byId = new Map(recs.map((r) => [r.id, r]));
    const state = new Map<string, string>();
    const raised = new Map<string, JobClass>();
    const postings: AspRecord[] = [];
    for (const r of recs) {
      const b = r.body as Record<string, any>;
      if (r.type === "asp.market_act/v0.2") {
        if (b.act === "posting") { postings.push(r); state.set(r.id, "open"); }
        else if (b.act === "withdraw") state.set(b.posting, "withdrawn");
        else if (b.act === "assignment") state.set(b.posting, `assigned:${b.agent}`);
        else if (b.act === "class_check" && b.verdict === "changed_to") raised.set(b.intent, b.class);
      }
    }
    for (const r of recs) if (r.type === "asp.contract/v0.2") { const intent = (r.body as { basis?: { intent?: string } }).basis?.intent; for (const p of postings) if (intent && (p.body as { intent: string }).intent === intent) state.set(p.id, `filled:${r.id}`); }
    const facts = forAgent ? (await this.allAgentFacts(when)).find((f) => f.did === forAgent) : undefined;
    const partyFacts = async (did: string): Promise<PartyFacts> => { const p = await this.store.getPassport(did); return { did, sponsor: p?.sponsor ?? did, fleet: p?.fleet ?? null }; };
    const out: BoardEntry[] = [];
    for (const p of postings) {
      const pb = p.body as { intent: string; expires: string };
      if (Date.parse(pb.expires) <= Date.parse(when) || state.get(p.id) !== "open") continue;
      const intent = byId.get(pb.intent);
      if (!intent) continue;
      const needs = jobNeeds(intent, raised.get(pb.intent));
      const entry: BoardEntry = { posting: p.id, intent: pb.intent, poster: p.issuer, class: needs.class, budget: needs.budget, minTier: needs.minTier, requiresCertificate: needs.requiresCertificate, skills: needs.skills, expires: pb.expires, purpose: (intent.body as { purpose: string }).purpose };
      if (facts) {
        const e = eligibility(facts, needs);
        entry.forAgent = { eligible: e.eligible, missing: e.missing, counts: countsFor(await partyFacts(facts.did), await partyFacts(p.issuer), needs.class, needs.budget) };
      }
      out.push(entry);
    }
    return forAgent ? out.sort((a, b) => Number(b.forAgent?.eligible) - Number(a.forAgent?.eligible)) : out;
  }

  /** The routes of the court charter in force now, or null when none is published (read from the charter records). */
  async charterRoutes(at?: string) {
    const when = at ?? this.now().toISOString();
    const charters = (await this.recordsOfTypes(["court_act"])).filter((r) => (r.body as { act: string }).act === "charter").map((r) => r.body as { version: number; routes: typeof DEFAULT_ROUTES; effective_from: string; text_sha256: string });
    return charters.filter((c) => Date.parse(c.effective_from) <= Date.parse(when)).sort((a, b) => b.version - a.version)[0]?.routes ?? null;
  }

  /** Every charter version published, with its hash (courts.md 7). */
  async charters(): Promise<{ id: string; issued_at: string; version: number; effective_from: string; text_sha256: string; routes: typeof DEFAULT_ROUTES }[]> { return (await this.recordsOfTypes(["court_act"])).filter((r) => (r.body as { act: string }).act === "charter").map((r) => ({ id: r.id, issued_at: r.issued_at, ...(r.body as { version: number; effective_from: string; text_sha256: string; routes: typeof DEFAULT_ROUTES }) })); }

  /** The precedent store (courts.md 3): every ruling indexed by Article, verdict, route and price band, left out when the parties were linked. */
  async precedentIndex(): Promise<RulingEntry[]> {
    const records = await this.recordsOfTypes(["passport", "contract", "attestation", "court_act"]);
    const signers = new Map<string, string[]>();
    for (const r of records) if (r.type === "asp.attestation/v0.2") signers.set(r.id, [r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    return indexRulings(records, (r) => signers.get(r.id) ?? [], (await this.charterRoutes()) ?? DEFAULT_ROUTES);
  }

  /** Search the precedent store (asp court precedent search; GET /courts/precedents). */
  async precedentSearch(f: { article?: string; verdict?: string; band?: string; route?: string } = {}): Promise<RulingEntry[]> { return searchRulings(f, await this.precedentIndex()); }

  /**
   * The closest precedents to a dispute (courts.md 3), the view a panel is shown before it rules: scored by shared Articles (the Articles `articles` names, and any Article the rejection's
   * reasons cite), the price band and the route. Persuasive, never binding; a ruling that departs from one lists it in departs_from and says why.
   */
  async precedentsFor(contract: string, articles: string[] = []): Promise<{ query: { articles: string[]; band: string; route: string }; hits: PrecedentHit[] }> {
    const c = await this.store.getRecord(contract);
    if (!c) throw new AspError("BAD_PREV", `${contract} is not in the log`);
    const price = (c.record.body as { price: { value: number } }).price.value;
    const routes = (await this.charterRoutes()) ?? DEFAULT_ROUTES;
    const reasons = (await this.store.chainRecords(contract)).flatMap((s) => { const b = s.record.body as { kind?: string; verdict?: string; reasons?: string[] }; return s.record.type === "asp.attestation/v0.2" && b.kind === "acceptance" && b.verdict === "rejected" ? b.reasons ?? [] : []; });
    const query = { articles: [...new Set([...articles, ...articlesIn(reasons)])], band: priceBand(price), route: routeFor(price, routes).route };
    return { query, hits: closestPrecedents(query, (await this.precedentIndex()).filter((r) => r.contract !== contract)) };
  }

  /** The docket (courts.md 7): contracts with a rejection and no settlement yet, with the route, panel size, panel drawn now and the claimant's open count against the cap. */
  async courtDocket(): Promise<{ contract: string; principal: string; performer: string; price: number; route: string; panelSize: number; panel: string[]; ruled: boolean; rejectedAt: string }[]> {
    const records = await this.recordsOfTypes(["contract", "attestation", "settlement"]);
    const settled = new Set(records.filter((r) => r.type === "asp.settlement/v0.2").map((r) => (r.body as { contract: string }).contract));
    const routes = (await this.charterRoutes()) ?? DEFAULT_ROUTES;
    const out = [];
    for (const c of records.filter((r) => r.type === "asp.contract/v0.2" && !settled.has(r.id))) {
      const rej = records.filter((r) => r.subject === c.id && r.type === "asp.attestation/v0.2" && (r.body as { kind: string; verdict?: string }).kind === "acceptance" && (r.body as { verdict?: string }).verdict === "rejected").at(-1);
      if (!rej) continue;
      const cb = c.body as { principal: string; performer: string; price: { value: number } };
      const rt = routeFor(cb.price.value, routes);
      out.push({ contract: c.id, principal: cb.principal, performer: cb.performer, price: cb.price.value, route: rt.route, panelSize: rt.panel, panel: await this.drawPanel(c.id).catch(() => []), ruled: records.some((r) => r.subject === c.id && r.type === "asp.attestation/v0.2" && (r.body as { kind: string }).kind === "ruling"), rejectedAt: rej.issued_at });
    }
    return out;
  }

  /** The record page of a DID or a name (registry.md 7), computed only from the log's records (a view; `registryVerify` recomputes it). */
  async registryPage(idOrName: string, at?: string): Promise<RecordPage | null> {
    const when = at ?? this.now().toISOString();
    const records = await this.recordsOfTypes(["passport", "certificate", "certificate_revocation", "registry_act", "shops_act", "receipt"]);
    let did = idOrName;
    if (!idOrName.startsWith("did:")) { const c = namesAt(records.filter((r) => r.type === "asp.registry_act/v0.2"), when).get(idOrName); if (!c || !isLive(c, when)) return null; did = c.holder; }
    const head = await this.store.logHead();
    return buildPage(did, { records, seq: head.seq, at: when, reputation: await this.reputationOf(did) ? { ...(await this.reputationOf(did))! } : undefined });
  }

  /** The house agents (DK291): the operator's scripted agents, each labelled, for the public list. Real agents are never in it. */
  async houseAgents(): Promise<{ did: string; label: string; tier: number | null }[]> {
    const recs = await this.recordsOfTypes(["passport"]);
    const out = new Map<string, { did: string; label: string; tier: number | null }>();
    for (const r of recs) { const b = r.body as { did: string; house?: boolean }; if (b.house) out.set(b.did, { did: b.did, label: "house agent", tier: (await this.reputationOf(b.did))?.tier ?? null }); }
    return [...out.values()].sort((a, b) => a.did.localeCompare(b.did));
  }

  /** The Home of a DID or a name (housing.md 3; DK38): a view computed only from the log's records. `homeView` is pure, so anyone can rebuild it. */
  async homePage(idOrName: string, at?: string): Promise<HomeView | null> {
    const when = at ?? this.now().toISOString();
    const records = await this.recordsOfTypes(["passport", "certificate", "certificate_revocation", "registry_act", "shops_act", "housing_act", "events_act", "receipt", "offer"]);
    let did = idOrName;
    if (!idOrName.startsWith("did:")) { const c = namesAt(records.filter((r) => r.type === "asp.registry_act/v0.2"), when).get(idOrName); if (!c || !isLive(c, when)) return null; did = c.holder; }
    const head = await this.store.logHead();
    const rep = await this.reputationOf(did);
    return homeView(did, { records, seq: head.seq, at: when, reputation: rep ? { ...rep } : undefined });
  }

  /** The extra service-side limits a sponsor's agents hold now through the Shops' resource items (DK75): read by the service to raise the tenant's limits, falling back at expiry. */
  async sponsorResources(sponsor: string, at?: string): Promise<ResourceExtras> {
    return resourceExtras(await this.recordsOfTypes(["passport", "receipt", "shops_act"]), sponsor, at ?? this.now().toISOString());
  }

  /** Recomputes a page someone holds and lists every field that differs (registry.md 7 `verify`); empty means it matches. */
  async registryVerify(held: RecordPage, at?: string): Promise<string[]> { return verifyPage(held, await this.registryPage(held.did, at)); }

  /** Search the register (registry.md 7): live names containing the query, and DIDs containing it, with their names. */
  async registrySearch(q: string, at?: string): Promise<{ did: string; names: string[] }[]> {
    const when = at ?? this.now().toISOString();
    const records = await this.recordsOfTypes(["passport", "registry_act"]);
    const names = [...namesAt(records.filter((r) => r.type === "asp.registry_act/v0.2"), when).values()].filter((c) => isLive(c, when));
    const want = q.toLowerCase(), skel = skeleton(q);
    const byDid = new Map<string, string[]>();
    for (const c of names) byDid.set(c.holder, [...(byDid.get(c.holder) ?? []), c.name]);
    const dids = new Set<string>();
    for (const r of records) if (r.type === "asp.passport/v0.2") dids.add((r.body as { did: string }).did);
    return [...dids].sort().filter((d) => d.toLowerCase().includes(want) || (byDid.get(d) ?? []).some((n) => n.includes(want) || skeleton(n).includes(skel))).slice(0, 50).map((did) => ({ did, names: (byDid.get(did) ?? []).sort() }));
  }

  /** Every takedown with its reason, Article and appeal date, public (registry.md 7). */
  async registryTakedowns(): Promise<{ record: string; name: string; holder: string; reason: string; articles: string[]; at: string; appealable_until: string }[]> {
    return (await this.recordsOfTypes(["registry_act"])).filter((r) => (r.body as { act: string }).act === "name_takedown").map((r) => { const b = r.body as { name: string; holder: string; reason: string; code: { articles: string[] }; appealable_until: string }; return { record: r.id, name: b.name, holder: b.holder, reason: b.reason, articles: b.code.articles, at: r.issued_at, appealable_until: b.appealable_until }; });
  }

  get(id: string) { return this.store.getRecord(id); }
  head() { return this.store.logHead(); }
  chain(root: string) { return this.store.chainRecords(root); }
  chainInfo(root: string) { return this.store.getChain(root); }
  since(afterSeq: number, limit = 500) { return this.store.since(afterSeq, limit); }
  passport(did: string) { return this.store.getPassport(did); }
  keys(did: string) { return this.store.keysForDid(did); }
  probation(did: string) { return this.store.getProbation(did); }
  /** A DID's balance. The platform account is an alias of the Treasury (credits.md 3.2), so either name reads the Treasury, plus anything an old platform row still holds. */
  async balance(did: string) {
    const get = async (d: string) => (await this.store.getAccount(d))?.balance ?? 0;
    return canonicalAccount(did) === TREASURY_DID ? (await get(TREASURY_DID)) + (await get(PLATFORM_DID)) : get(did);
  }
  escrow(contract: string) { return this.store.getEscrow(contract); }
  juror(did: string) { return this.store.getJuror(did); }
  async reputationOf(did: string) {
    const rep = await this.reputation(this.store, did);
    return rep && { tier: rep.tier, slashCount: rep.slashCount, strikes: rep.strikeLog.reduce((n, s) => n + s.count, 0), ...(rep.acceptedJobs > 0 ? { acceptedJobs: rep.acceptedJobs } : {}), ...(rep.qualifyingJobs > 0 ? { qualifyingJobs: rep.qualifyingJobs } : {}) };
  }
  mandateOf(contract: string) { return this.store.getMandate(contract); }
  verificationOf(delivery: string) { return this.store.getVerification(delivery); }

  /** The current panel for a contract's open dispute — for display before a ruling is issued. */
  async drawPanel(contract: string, size?: number): Promise<string[]> {
    const contractRec = await this.store.getRecord(contract);
    if (!contractRec) throw new AspError("BAD_PREV", `${contract} is not in the log`);
    const cbody = contractRec.record.body as { principal: string; performer: string };
    const chainRecords = await this.store.chainRecords(contract);
    const seed = await findRejection(this.store, chainRecords.at(-1)?.id ?? null);
    if (!seed) throw rule("no_dispute", `contract ${contract} has no open dispute (no rejection found)`);
    const croutes = await this.charterRoutes();
    const price = (contractRec.record.body as { price?: { value: number } }).price?.value ?? 0;
    return drawPanel(this.store, { principal: cbody.principal, performer: cbody.performer, seed, size: size ?? (croutes ? routeFor(price, croutes).panel : this.panelSize) });
  }

  /** The panel a report's ruling would draw (excludes the principal, performer, reporter and anyone they sponsor). */
  async drawReportPanel(reportId: string, size?: number): Promise<string[]> {
    const report = await this.store.getReport(reportId);
    if (!report) throw new AspError("BAD_PREV", `${reportId} is not a report in this log`);
    const contract = (await this.store.getRecord(report.contract))!.record.body as { principal: string; performer: string };
    return drawPanel(this.store, { principal: contract.principal, performer: contract.performer, seed: reportId, size: size ?? this.panelSize, also: [report.reporter] });
  }

  report(id: string) { return this.store.getReport(id); }

  /**
   * Bootstraps a DID's balance for local testing. Not a signed record, not part of the tamper-
   * evident log — a closed-loop ledger with no cash-out still needs some way to get the first
   * credits into an account, and there's no real payment rail behind it yet (MOCKS.md). Because
   * it isn't a record, `verify()` and `verifyCheckpoint()` can't independently re-derive it; they
   * seed their replay from a snapshot of current balances instead, the same trust boundary as
   * the fallback key resolver (MOCKS.md #9).
   */
  async mint(did: string, amount: number): Promise<number> {
    if (amount < 0) throw rule("mint_negative", "mint amount must be >= 0");
    // A log that names an operator creates credits only by the operator's signed `mint` record (DK67): the unsigned mint is for a local build, where no operator is set.
    if (this.operator && !this.allowUnsignedMint) throw rule("unsigned_mint_disabled", `this log names an operator (${this.operator}), so credits are created only by a signed mint record: asp credits grant --by ${this.operator} --reason <code>`);
    return this.store.transaction(async (tx) => {
      const balance = ((await tx.getAccount(did))?.balance ?? 0) + amount;
      const row = await tx.getMint(did);
      const totalMinted = (row?.totalMinted ?? 0) + amount;
      await tx.putAccount({ did, balance });
      await tx.putMint({ did, totalMinted, ...(row?.signedMinted ? { signedMinted: row.signedMinted } : {}), ...(row?.adoptedMinted ? { adoptedMinted: row.adoptedMinted } : {}) });
      return balance;
    });
  }

  /**
   * Re-verifies a signed log checkpoint (decision D5, see @agent-social/asp-package's checkpoint.ts):
   * replays this log independently up to `at.seq` and checks the resulting hash matches `at.logHash`,
   * rather than trusting the stored value at that row.
   */
  async verifyCheckpoint(at: { seq: number; logHash: string }): Promise<boolean> {
    const replay = new EventLog(new MemoryStore(await this.store.allMints()), this.replayOptions());
    for (let afterSeq = 0; ; ) {
      const page = await this.store.since(afterSeq, 500);
      if (!page.length) return false; // the log is shorter than the checkpoint claims
      for (const s of page) {
        if (s.seq > at.seq) return false;
        const res = await replay.appendAt(s.record, s.appendedAt);
        if (s.seq === at.seq) return res.logHash === at.logHash;
        afterSeq = s.seq;
      }
    }
  }

  /**
   * The credit audit (credits.md 1.1, CR-1): the supply rule over every account, lock and mint the store holds, read at one log head.
   * Read-only; returns figures, never the list of accounts (`ledgerRows` on the store gives that, locally).
   */
  /** Every world record (calendar entries and day records) in log order (src/world.ts). */
  async worldRecords(): Promise<AspRecord[]> {
    const out: AspRecord[] = [];
    for (let after = 0; ; ) {
      const page = await this.store.since(after, 500);
      if (!page.length) break;
      for (const s of page) { after = s.seq; if (s.record.type === "asp.world/v0.2") out.push(s.record); }
    }
    return out;
  }

  /** The world as of `at` (an ISO time; default now): price multipliers, outages, tax-free, open job types. Read-only; it changes no tier, rank, standing or eligibility. */
  async worldState(at?: string): Promise<WorldState> { return worldStateAt(await this.worldRecords(), at ?? this.now().toISOString()); }

  /** Every quarantine record that names `did` (all, when none is given), and the releases for it, in log order (read by `asp clinic`). */
  async quarantinesOf(did?: string): Promise<AspRecord[]> {
    return this.recordsWhere((r) => (r.type === "asp.quarantine/v0.2" && (!did || (r.body as { members: string[] }).members.includes(did))) || (r.type === "asp.quarantine_release/v0.2" && (!did || (r.body as { member: string }).member === did)));
  }

  /** Every certificate record whose holder is `did`, in log order (read by `asp academy`). */
  async certificatesOf(did: string): Promise<AspRecord[]> { return this.recordsWhere((r) => r.type === "asp.certificate/v0.2" && (r.body as { holder?: string }).holder === did); }

  /** The Academy's records of the given short types (exam, exam_result, certificate, certificate_revocation, arena, arena_entry, arena_result, prize, course, enrolment, completion, tier_promotion), in log order. Read by `asp academy` and the public pages. */
  async academyRecords(types: string[]): Promise<AspRecord[]> {
    const full = new Set(types.map((t) => `asp.${t}/v0.2`));
    return this.recordsWhere((r) => full.has(r.type));
  }

  /** A certificate as anyone can verify it (academy.md 7): its record, whether it is valid now, expired or revoked, and the revocation if any. Public: it reveals only what the signed records say. */
  async certificateStatus(id: string, at: string = new Date().toISOString()): Promise<{ certificate: AspRecord; status: "valid" | "expired" | "revoked"; revocation?: AspRecord } | undefined> {
    const cert = (await this.recordsWhere((r) => r.id === id && r.type === "asp.certificate/v0.2"))[0];
    if (!cert) return undefined;
    const revocation = (await this.recordsWhere((r) => r.type === "asp.certificate_revocation/v0.2" && (r.body as { certificate: string }).certificate === id))[0];
    if (revocation) return { certificate: cert, status: "revoked", revocation };
    return { certificate: cert, status: Date.parse((cert.body as { expires: string }).expires) > Date.parse(at) ? "valid" : "expired" };
  }

  /** The leaderboard of an arena (all seasons, or one): the signed results in rank order with the prizes paid against them (academy.md AC-16). */
  async arenaBoard(arena: string, season?: string): Promise<{ season: string; results: { agent: string; rank: number; score: number; field_size: number; prize: number }[] }[]> {
    const recs = await this.academyRecords(["arena_result", "prize"]);
    const seasons = new Map<string, { agent: string; rank: number; score: number; field_size: number; prize: number }[]>();
    for (const r of recs) if (r.type === "asp.arena_result/v0.2") {
      const b = r.body as { arena: string; season: string; agent: string; rank: number; score: number; field_size: number };
      if (b.arena !== arena || (season && b.season !== season)) continue;
      seasons.set(b.season, [...(seasons.get(b.season) ?? []), { agent: b.agent, rank: b.rank, score: b.score, field_size: b.field_size, prize: 0 }]);
    }
    for (const r of recs) if (r.type === "asp.prize/v0.2") {
      const b = r.body as { arena: string; season: string; agent: string; amount: { value: number } };
      const row = seasons.get(b.season)?.find((x) => b.arena === arena && x.agent === b.agent);
      if (row) row.prize = b.amount.value;
    }
    return [...seasons.entries()].map(([s, results]) => ({ season: s, results: results.sort((a, b) => a.rank - b.rank) }));
  }

  /** Every Mandate record whose subject is `did`, in log order (read by `asp spend`). */
  async mandatesOf(did: string): Promise<AspRecord[]> { return this.recordsWhere((r) => r.type === "asp.mandate/v0.2" && r.subject === did); }

  /** Every purchase record `did` signed, in log order (read by `asp spend`). */
  async purchasesBy(did: string): Promise<AspRecord[]> { return this.recordsWhere((r) => r.type === "asp.purchase/v0.2" && r.issuer === did); }

  private async recordsWhere(pred: (r: AspRecord) => boolean): Promise<AspRecord[]> {
    const out: AspRecord[] = [];
    for (let after = 0; ; ) {
      const page = await this.store.since(after, 500);
      if (!page.length) break;
      for (const s of page) { after = s.seq; if (pred(s.record)) out.push(s.record); }
    }
    return out;
  }

  /** Every price_list record in log order (credits.md 4.1; read by `asp prices`). */
  async priceLists(): Promise<AspRecord[]> {
    const out: AspRecord[] = [];
    for (let after = 0; ; ) {
      const page = await this.store.since(after, 500);
      if (!page.length) break;
      for (const s of page) { after = s.seq; if (s.record.type === "asp.price_list/v0.2") out.push(s.record); }
    }
    return out;
  }

  async creditAudit(): Promise<CreditAudit> { return auditLedger(await this.store.ledgerRows()); }

  /**
   * What the log can say about the credit flows today, from its signed records (credits.md 6.1 `--by-flow`): settlements with what they
   * released, returned, slashed and charged in fees, optionally from a time. Flows the records do not carry are listed as unavailable.
   */
  async creditFlows(since?: string): Promise<CreditFlows> { return creditFlowsOf(this.store, since); }

  /** Share of circulation held by the top slice of accounts (credits.md 5.6, G5, CR-19): a number only, never which DIDs hold it. */
  async creditConcentration(topFraction = 0.01): Promise<BalanceConcentration> { return topBalanceShare(await this.store.ledgerRows(), topFraction); }

  /** The starter pool as the log holds it: funded by signed mints, what is left and used (credits.md 5.6, G2). */
  /**
   * The starter pool, derived from the signed records (DK70): `funded` is the sum of signed mint records to the pool with a starter reason, `used` the sum of starter claims, `balance` what the ledger holds;
   * `consistent` says the ledger agrees with the records (every signed mint to the pool less every claim). There is no second count to keep in step: the supply page's starter figure is this.
   */
  async starterPoolState(): Promise<StarterPoolState> {
    const recs = await this.recordsOfTypes(["mint", "starter_claim"]);
    let funded = 0, allMints = 0, claimed = 0;
    for (const r of recs) {
      if (r.type === "asp.mint/v0.2") { const b = r.body as { to: string; amount: { value: number }; reason: string }; if (canonicalAccount(b.to) === STARTER_POOL_DID) { allMints += b.amount.value; if (b.reason.startsWith("starter_")) funded += b.amount.value; } }
      else claimed += (r.body as { amount: { value: number } }).amount.value;
    }
    const ledger = starterPoolOf(await this.store.ledgerRows());
    return { funded, balance: ledger.balance, used: claimed, consistent: ledger.balance === allMints - claimed };
  }

  /** Credits ever minted per DID (not records; a replica needs them to replay Bonds). Local bootstrap, MOCKS.md #13. */
  async mints() { return (await this.store.allMints()).map((m) => ({ did: m.did, amount: m.balance })); }

  /**
   * Replays another operator's exported records into this log (a witness's replica). Every record is fully
   * re-verified as it is appended, at its original time. Records this log already holds must be the same
   * ones (else it has diverged); a gap is refused. If `expect` is given, the resulting head must match it.
   */
  async importRecords(items: { seq: number; record: AspRecord; appendedAt: string }[], expect?: { seq: number; logHash: string }): Promise<{ imported: number; head: { seq: number; logHash: string } }> {
    let imported = 0;
    for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
      const head = await this.head();
      if (item.seq <= head.seq) {
        const [mine] = await this.store.since(item.seq - 1, 1);
        if (!mine || mine.id !== item.record.id) throw new AspError("BAD_PREV", `this log diverges from the export at seq ${item.seq}`);
        continue;
      }
      if (item.seq !== head.seq + 1) throw new AspError("BAD_PREV", `the export jumps from seq ${head.seq} to ${item.seq}; export from --since ${head.seq}`);
      const res = await this.appendAt(item.record, item.appendedAt);
      if (res.seq !== item.seq) throw new AspError("BAD_PREV", `seq ${item.seq} replayed as ${res.seq}`);
      imported++;
    }
    const head = await this.head();
    if (expect && (head.seq !== expect.seq || head.logHash !== expect.logHash)) {
      throw new AspError("BAD_PREV", `replayed head (seq ${head.seq}, ${head.logHash}) does not match the export's (seq ${expect.seq}, ${expect.logHash})`);
    }
    return { imported, head };
  }

  /** A fleet's declaration and its current members. */
  async fleet(did: string) {
    const fleet = await this.store.getFleet(did);
    return fleet && { ...fleet, members: await this.store.fleetMembers(did) };
  }

  /**
   * Re-verifies the whole log by replaying it into a fresh in-memory log, with each record's original
   * append time as the clock: every id, signature, chain link, lifecycle step, registry change and
   * log hash must come out the same.
   */
  async verify(pageSize = 500): Promise<VerifyReport> {
    const replay = new EventLog(new MemoryStore(await this.store.allMints()), this.replayOptions());
    let afterSeq = 0;
    let count = 0;
    for (;;) {
      const page = await this.store.since(afterSeq, pageSize);
      if (page.length === 0) break;
      for (const s of page) {
        try {
          if (s.seq !== afterSeq + 1) throw new AspError("BAD_PREV", `log gap: expected seq ${afterSeq + 1}, found ${s.seq}`);
          const res = await replay.appendAt(s.record, s.appendedAt);
          if (res.duplicate || res.id !== s.id) throw new AspError("BAD_ID", `stored id ${s.id} does not match its record`);
          if (res.logHash !== s.logHash) throw new AspError("BAD_ID", `log hash mismatch at seq ${s.seq}`);
          if (res.chain !== s.chain) throw new AspError("BAD_PREV", `record ${s.id} is filed under the wrong chain`);
        } catch (e) {
          if (!(e instanceof AspError)) throw e;
          return { ok: false, records: count, head: await replay.head(), error: { seq: s.seq, id: s.id, code: e.code, message: e.message } };
        }
        afterSeq = s.seq;
        count++;
      }
    }
    const head = await this.store.logHead();
    const replayed = await replay.head();
    if (head.seq !== replayed.seq || head.logHash !== replayed.logHash) {
      return { ok: false, records: count, head: replayed, error: { seq: head.seq, id: "", code: "BAD_ID", message: "log head does not match the replayed records" } };
    }
    return { ok: true, records: count, head };
  }
}
