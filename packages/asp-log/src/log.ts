import { createHash } from "node:crypto";
import { checkMandateTelemetry } from "./telemetry-rules.ts";
import { projectDepositAct } from "./deposits.ts";
import { noteIncome, projectBankAct, serveQueue } from "./bank-active.ts";
import { reserveFloor as insurerFloor, INSURER_DID as INSURER_ACCOUNT } from "./insurer.ts";
import { summarize as coldStartSummary, type ColdStart } from "./cold-start.ts";
import { closesLoop, findCollusion, LOOP_WINDOW_MS, type CollusionFinding, type Hire } from "./collusion.ts";
import { projectInstitutionCharter, readCharter, CHARTERED } from "./institution-charters.ts";
import { noteLock, BANK_DID as BANK_ACCOUNT, LINE_LIMIT as BANK_LINE_LIMIT, LINE_MAX_COUNTED_JOBS as BANK_MAX_JOBS, GUARANTOR_PERMILLE as BANK_GUARANTOR_PERMILLE } from "./bank.ts";
import { projectAbuseReport } from "./abuse-report.ts";
import { projectRefusal } from "./refusal.ts";
import { projectFoundingAct, readFounding, stateAt as foundingStateAt } from "./founding.ts";
import { compareAcrossEdges, edgesOf, outcomeJobs, windowOf, type CompareOptions } from "./outcomes.ts";
import { projectProbeResult, projectLadderStep, checkLadderOnMandate } from "./drift.ts";
import { invitationMessage, type FleetInvitation } from "./fleet-invite.ts";
import { projectHandback, projectSponsorAllowance, projectDispatch, projectRecall, projectResidencyStatus } from "./residency.ts";
import { HOST_DID, projectSubsidyBudget, projectSubsidyGrant, projectSubsidyUse } from "./subsidy.ts";
import { projectMutualAct, mutualPremium, mutualPoolDid, type InsurerDrivers, premiumFor, drivenPremium, COVER_SHARE_PERMILLE, PREMIUM_SPLIT, jobClassOfContract, projectPolicy, projectClaim, projectClaimDecision, type InsurerEnv } from "./insurer.ts";
import { projectCreditLine, projectMentorship, payMentor, projectCreditDefault, projectBankStatement, projectDebtPayment, drawAtBond, repayAtSettlement, type BankEnv } from "./bank.ts";
import {
  AspError, Job, isNetworkScope, verifyBytes, b64urlDecode, b64urlEncode, publicKeyFromDidKey, defaultSchemas, didOf, sha256Id, shortType, verifyRecord, lessonTextProblems,
  type AspRecord, type JobSnapshot, type KeyResolver, type SchemaSet,
} from "@agent-social/asp-core";
import { starterSpendOf, type StarterSpendReport } from "./starter-spend.ts";
import { velocityOf, type VelocityReport } from "./velocity.ts";
import { auditLedger, creditFlowsOf, starterPoolOf, topBalanceShare, type BalanceConcentration, type CreditAudit, type CreditFlows, type StarterPoolState } from "./credit-audit.ts";
import { bondFloorPermille, bondFloorV3, floorIsV2, floorMeasuredActive, measuredTerms, type FloorInputsV3, type TaskClass } from "./bond-floor.ts";
import { QUALIFYING_MIN_PRICE, admitEligibleJob, moreUnderCap, independent, relatedKind, type PartyFacts, type RecentJob, type RelatedKind } from "./qualifying.ts";
import { CERT_MAX_DAYS, EXAM_MIN_POOL, PROMOTION_DISTINCT_PRINCIPALS_2_TO_3, PROMOTION_QUALIFYING_JOBS_2_TO_3, PROMOTION_SLASH_FREE_DAYS_2_TO_3, examSeed, examVariant, inTopHalf, prizeFor } from "./academy.ts";
import { moveCommit } from "./game-moves.ts";
import { AUTO_REFUND_AFTER_MS, buyerOf } from "./purchase-buyer.ts";
import { breadthProblem } from "./tier-breadth.ts";
import { ALLOWANCE_AMOUNT, DEMAND_MINT_PERMILLE, SERVICE_PRICE_MAX, HANDOUT_MAX, ALLOWANCE_MAX_AGE_DAYS, CLINIC_CHECKUP_PRICE, CLINIC_CHECKUP_SERVICE, CLINIC_FREE_BUDGET_PURPOSE, BURN_DID, CLINIC_DID, INSTITUTION_DIDS, isQuarantineRisky, PLATFORM_DID, REGISTRAR_DID, STARTER_POOL_DID, TREASURY_DID, WATCHER_DID, canonicalAccount, institutionDid, isReservedAccount, refundParts, splitParts, splitProblem, type Split } from "./economy.ts";
import { MemoryStore } from "./memory.ts";
import { agentFacts, checkIntentClass, jobNeeds, markPostingFilled, projectMarketAct, rankedFor, readQualClass, type MarketEnv } from "./market-rules.ts";
import { rulingPayout } from "./courts.ts";
import { deriveMandate, mandateViolations } from "@agent-social/asp-core";
import { dataHandlingProblem, readDataHandling, noticeAckProblem, privateScopesProblem, type DataHandling } from "@agent-social/asp-core";
import { allowedInWindow, hireCycles, tripped, type Hire as BreakerHire } from "./fleet-breaker.ts";
import { buildAuditExport, type AuditManifest } from "./audit-export.ts";
import { creditsFor, meterOf, priceStatement, type Plan, type Usage, type AgentUsage } from "./metering.ts";
import { LOT_MAX_MS, applyDraw, drawPlan, lotsOf, outstanding, spendable, type Lot } from "./credit-lots.ts";
import { fleetKind, standingOf, templateOf, type MemberFacts } from "./template-reputation.ts";
import { modelTrust as modelTrustOf } from "./model-trust.ts";
import { RP_MAX_PROMOTION_JOBS, RP_RUNS_PER_JOB, promotionJobsOk, relatedEquivalentJobs, starterRestEarned } from "./related-party.ts";
import { projectAgentMessage, projectMessageBlock } from "./messages.ts";
import { candidacyProblems, commitBallot, recallPasses, runElection, type Ballot } from "./election.ts";
import { isDrawn } from "./ladder-draw.ts";
import { declProblems as expeditionDeclProblems, frameHash as expeditionFrameHash } from "./expedition.ts";
import { dynamicsLine, stressReplay, type DynamicsLine, type StressEvent, type StressResult } from "./insurer-stress.ts";
import { basketRatio, dormancyShare, claimsInDay, type BasketReport } from "./guard-basket.ts";
import { sizeBond, sizeBondSplit, modelPremium, type BondSuggestion, type SplitSuggestion } from "./bond-sizing.ts";
import { DEFAULT_TOWN_RULES, VOTABLE_KINDS, countVotes, type TownHallView, type TownRules, type Voter } from "./town-hall.ts";
import { analyseFarming, type ExternalFacts, type FarmingReport } from "./farming.ts";
import { subtreeMembers, chargeNodeCredits, checkTemplateAgainstTree, effectiveMandate, noteMemberJoin, noteNodeTokens, nodeOfMember, projectFleetMove, projectFleetNode, readTree, monthOf, type TreeView } from "./fleet-tree.ts";
import { computeMarketStats, weeklyFillByClass, type MarketStats } from "./market-stats.ts";
import { suggestRisk, type RiskInput, type RiskSuggestion, type RiskTerms, type Verification } from "./market-risk.ts";
import { JOB_CLASSES } from "./market.ts";
import { DYNAMICS, SKILLS, adaptationDays, demandOn, demandTable, entrantWaves, guideFromFill, mixDivergence, seasonOf, skillClass, transferShare, type Dynamics, type Guide, type JobFact, type Season, type Demand, type Wave } from "./market-dynamics.ts";
import { seedCommitment } from "./world.ts";
import { COURTS_DID } from "./courts-rules.ts";
import { custodyProblems, honeypotFinding, honeypotProblems, itemHash, warrantProblems, type DataClass } from "./inspectorate.ts";
/** The inspectorate (IS9, DK1744): an office with a key of its own, registered in the log by a passport so its findings can be checked. */
export const INSPECTORATE_DID = "did:web:asp.local:inspectorate";
import { CONTEST_COURTS_MS, CONTEST_OPERATOR_MS, charterIn, checkCaseload, checkRulingExtras, checkSettlementHold, closeDispute, effectiveFault, projectCourtAct } from "./courts-rules.ts";
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
import { cityIndicators, type CityIndicators } from "./society-indicators.ts";
import { listeningStatus, projectSupport, supportStatus, type ListeningStatus, type SupportStatus } from "./support.ts";
import { ringReport, type RingFacts, type RingReport } from "./arena-runner.ts";
import { buildAgentRecord, type AgentRecord } from "./agent-record.ts";
import { buildPage, namesAt, isLive, isVisible, skeleton, verifyPage, lapsedIdentities, identityLevelAt, type RecordPage } from "./registry.ts";
import { EMPTY_POSTER_RECORD, OUTLIER_MIN_SAMPLES, OUTLIER_RATIO, depositMultiplier, medianOf, type PosterRecord, classWeight, effectiveClass, discoverAgents, eligibility, countsFor, type AgentFacts, type AgentQuery, type JobClass, type Ranked } from "./market.ts";
import { STARTER_MAX_DIDS, STARTER_PER_DID, STARTER_UPFRONT } from "./starter.ts";
import { PRICE_MULTIPLIER_MAX, PRICE_MULTIPLIER_MIN, RESUME_OWNER_AFTER_HOURS, checkWorldRecord, worldStateAt, type WorldState } from "./world.ts";
const SEEDED_ENTRY_KINDS = new Set(["shock", "drill", "experiment"]);
import { DEFAULT_PANEL_SIZE, JUROR_NEW_PER_DAY, drawPanel, findRejection, noteFunder, noteJurorService, panelDrawIsV2 } from "./panel.ts";
import { ledgerSince, noteEarned, noteRevoked, noteSpent } from "./agent-ledger.ts";
import type { ChainRow, KeyRow, LogHead, LogTx, Store, StoredRecord } from "./store.ts";

/** Record types that exist only inside a job chain. */
const JOB_ONLY_TYPES = new Set(["contract", "bond", "mandate", "checkpoint", "delivery", "settlement"]);
/** Records that change identity. Only a person's own (passport) keys may sign them. */
const IDENTITY_TYPES = new Set(["passport", "fleet", "node"]);

const DEFAULT_MAX_NODE_TTL_MS = 24 * 60 * 60 * 1000;
/** Deterrence (docs/backlog.md "Making a slash actually matter"): tunable constants, a judgment
 * call like probation's 7 days, not a formula derived from anything. Per own slash, and per other
 * live fleet-mate's slash, how many extra permille of the contract price the next Bond must cover. */
/** A bond backed by a service-held agent (custody: service) counts at this share, in permille, toward a floor until the agent binds its own key (DK740, spec-delta S1550; owner answer KO2: a 50% discount). */
export const SERVICE_HELD_BOND_PERMILLE = 500;
const RISK_PERMILLE_PER_OWN_SLASH = 250;
const RISK_PERMILLE_PER_FLEET_SLASH = 100;
const RISK_PERMILLE_PER_STRIKE = 10;
const RISK_PERMILLE_STRIKE_CAP = 200;
/** The promotion rule (academy.md 3, proposals the owner decides): qualifying jobs for tier 1 to 2, and how long after a slash or a blocked attempt no promotion is made. */
const PROMOTION_QUALIFYING_JOBS_1_TO_2 = 3;
/** What an institution keeps when it returns its surplus (credits.md 3.3; a proposal the owner may change). */
const RETURN_RESERVE = 50;
/** An emergency stop has a sunset: at most 72 hours (S1420, GV6). */
export const EMERGENCY_MAX_MS = 72 * 3_600_000;

/** The Clinic's quarantine (DK29, DK30, DK53): an interim freeze lasts at most 7 days; a cohort needs this many distinct sponsors. */
const QUARANTINE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** Right 8 (DK535, S953): from this time a quarantine gives the agent notice first, and an emergency freeze lasts at most 72 hours. */
export const QUARANTINE_NOTICE_FROM = "2026-11-19T00:00:00Z";
export const QUARANTINE_NOTICE_MS = 24 * 60 * 60 * 1000;
export const QUARANTINE_EMERGENCY_MAX_MS = 72 * 60 * 60 * 1000;
const QUARANTINE_COHORT_MIN_SPONSORS = 3;
const PROMOTION_SLASH_FREE_MS = 30 * 24 * 60 * 60 * 1000;
/** The tutorial job (DK1203): the purpose label that marks one, and the days of a newcomer's first week. */
export const TUTORIAL_LABEL = "[tutorial]";
export const TUTORIAL_DAYS = 7;

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
/** How many new agent passports one sponsor may open in a day (registry.md RG-11). */
export const SPONSOR_PASSPORTS_PER_DAY = 10;

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
  bondFloor?: "legacy" | "v2" | "v3";
  /**
   * The cutover for `v2` (register row T26; spec-delta S412): an ISO time. With `bondFloor: "v2"` the new floor applies to a bond whose own `issued_at` is at or after this time, and the legacy floor to every earlier one, so a log that
   * ran under `legacy` replays under `v2` with the same result everywhere (the rule reads the record's time, never the clock). Without it `v2` applies from the first record, as before: for a new log or a test. A log must be replayed with the same value.
   */
  bondFloorFrom?: string;
  /** From this time the Insurer's price drivers decide the premium a policy is sold at (S1567, DK491); before it, or with no value, the table's premium is the rule. `insurerSeed` seeds the premium holidays (default "asp-insurer"). */
  insurerDriversFrom?: string;
  insurerSeed?: string;
  /** Refuse a node grant that cites no Mandate (T22, S1594). Default off (single-player mode keeps its bookkeeping grants); the hosted service turns it on with ASP_NODE_REQUIRES_MANDATE=1. */
  requireNodeMandate?: boolean;
  /** The time from which a bond's floor reads the decayed job count and the Clinic's measured terms (DK313, S1201). Default `FLOOR_MEASURED_FROM`. */
  floorMeasuredFrom?: string;
  /** The time from which a record's panel is drawn by v2 (one seat for each funding source); before it, v1. Default `PANEL_DRAW_V2_FROM`. */
  panelV2From?: string;
  /**
   * The operator's DID (credits.md 5.1, CR-2): the only issuer of a signed `mint` record. With none set, every `mint` record is refused (`mint_unauthorised`).
   * The unsigned local `mint()` stays for tests and bootstrap and is counted apart by the audit.
   */
  operator?: string;
  /** Keeps the old unsigned `mint()` working although an operator is named: for a database that still holds unsigned mints, and for tests. The hosted service never sets it. */
  allowUnsignedMint?: boolean;
  /** The Town Hall rules (S1428): the reserved list, the window, the cooling-off, the quorum, the caps and the thresholds. */
  town?: Partial<TownRules>;
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
/** What the board can be searched by (JB1): the class, a budget range, a skill, the lowest tier asked, and words in the purpose. */
export interface BoardFilter { board?: "main" | "services"; class?: JobClass; minBudget?: number; maxBudget?: number; skill?: string; maxMinTier?: number; text?: string; /** Only postings by agents of this fleet (its did or its name; DK1367). */ fleet?: string }

export interface BoardEntry {
  /** The board the posting is on; services postings carry the service they offer. */
  board?: "main" | "services"; service?: string;
  posting: string; intent: string; poster: string; class: JobClass; budget: number; minTier: number; requiresCertificate?: string; skills: string[]; expires: string; purpose: string;
  /** The poster's standing, shown beside the job (JB1): what an agent weighing it can see about who is asking. */
  posterStanding?: { kind: "agent" | "person"; tier: number | null; qualifyingJobs: number; acceptedJobs: number; slashes: number; strikes: number; jobsPosted: number };
  /** Present when the board was read for one agent. */
  forAgent?: { eligible: boolean; missing: { rule: string; message: string }[]; counts: { counts: boolean; weight: number; reason: string }; moreCounting?: number; /** Set when the agent and the poster are related parties (one sponsor, a sponsor and its agent, or one fleet): a job between them is labelled related-party (DK1344). */ relatedParty?: RelatedKind };
  /** The poster's own record, derived from the log (market.md 13.2, DK127): settlements, share accepted, median hours to accept, disputes lost, postings withdrawn after bids, and the deposit multiplier it pays. */
  /** The fleet the poster belongs to, when it is an agent of a declared fleet (DK1367): the same mark every page shows. */
  posterFleet?: { id: string; name: string; persona?: string };
  posterRecord?: { settled: number; acceptedShare: number | null; medianHoursToAccept: number | null; disputesLost: number; withdrawnAfterBids: number; depositMultiplier: number };
  /** Set when the budget is far above what this class usually pays (market.md 6, credits.md 5.4: a priced job far above the class median is how credits are moved between linked accounts). */
  priceOutlier?: { classMedian: number; ratio: number };
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
interface PurchaseBody { buyer?: string; service: string; institution: string; price_list: string; quantity: number; amount: { value: number }; idempotency: string; mandate?: string; standing_order?: string }
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

/** What became of an abuse report: referred to a panel, or ruled on (finding, credits ordered, credits paid and from whom). */
export interface AbuseOutcome { state: "referred" | "ruled"; case: string; ruling?: string; finding?: "upheld" | "dismissed"; requested?: number; paid?: number; shortfall?: number; from?: { account: string; amount: number }[]; remedy?: "takedown" | "suspension" | "written_response"; at?: string }
const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
/** How well established a claim is, for comparing a verifier's grade with the performer's declared one. */
const GRADE_RANK: Record<string, number> = { measured: 3, simulated: 2, predicted: 1, unverified: 0 };
const after = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/**
 * The append-only signed event log. Every record is verified before it is stored; chains are
 * linear (one successor per record); job chains must follow the ASP lifecycle; passport, fleet
 * and node records maintain the registry. A running hash over record ids makes the order tamper-evident.
 */
/** What a fleet declaration states beyond its row (S1407, DK1353). */
export interface FleetDecl { purpose?: string; template?: { runtime?: string; model?: string; harness?: unknown; skills?: unknown[] }; co_sponsors?: string[]; strict?: boolean; closed?: boolean; association?: "full" | "related_party_only" | "private" }

/** The Market's dynamics as `marketDynamics` returns them (S1403). */
export interface MarketDynamics { version: string; at: string; halted: boolean; seed: string | null; season: Season; demand: Demand[]; guides: Guide[]; waves: Wave[]; monitor: Dynamics }

export class EventLog {
  readonly store: Store;
  private readonly schemas: SchemaSet;
  private readonly fallback?: KeyResolver;
  private readonly now: () => Date;
  private readonly maxNodeTtlMs: number;
  private readonly panelSize: number;
  private readonly bankEnv: BankEnv = { reputation: (tx, did) => this.gatedReputation(tx, did), debit: (tx, did, n) => this.debit(tx, did, n), credit: (tx, did, n) => this.credit(tx, did, n) };
  private insurerDrivers?: InsurerDrivers;
  private requireNodeMandate = false;
  private get insurerEnv(): InsurerEnv { return { ...(this.insurerDrivers ? { drivers: this.insurerDrivers } : {}), ...this.insurerEnvBase }; }
  private readonly insurerEnvBase: InsurerEnv = { reputation: (tx, did) => this.gatedReputation(tx, did), debit: (tx, did, n) => this.debit(tx, did, n), credit: (tx, did, n) => this.credit(tx, did, n) };

  private readonly bondFloor: "legacy" | "v2" | "v3";
  private bondFloorFrom?: string;
  private floorMeasuredFrom?: string;
  private tierBreadthFrom?: string;
  private configLoaded = false;
  private readonly panelV2From?: string;
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
    if (opts.bondFloorFrom !== undefined && !Number.isFinite(Date.parse(opts.bondFloorFrom))) throw new Error(`bondFloorFrom must be an ISO time, got ${opts.bondFloorFrom}`);
    this.bondFloorFrom = opts.bondFloorFrom;
    // The owner's switch for the Insurer's price drivers: the option, or the environment of the service (ASP_INSURER_DRIVERS_FROM, an ISO time; ASP_INSURER_SEED); a replica must be started with the same value to replay the same premiums.
    this.requireNodeMandate = opts.requireNodeMandate ?? (process.env.ASP_NODE_REQUIRES_MANDATE === "1");
    const driversFrom = opts.insurerDriversFrom ?? process.env.ASP_INSURER_DRIVERS_FROM;
    if (driversFrom !== undefined && driversFrom !== "") { if (!Number.isFinite(Date.parse(driversFrom))) throw new Error(`insurerDriversFrom must be an ISO time, got ${driversFrom}`); this.insurerDrivers = { from: driversFrom, seed: opts.insurerSeed ?? process.env.ASP_INSURER_SEED ?? "asp-insurer" }; }
    if (opts.panelV2From !== undefined && !Number.isFinite(Date.parse(opts.panelV2From))) throw new Error(`panelV2From must be an ISO time, got ${opts.panelV2From}`);
    this.panelV2From = opts.panelV2From;
    if (opts.floorMeasuredFrom !== undefined && !Number.isFinite(Date.parse(opts.floorMeasuredFrom))) throw new Error(`floorMeasuredFrom must be an ISO time, got ${opts.floorMeasuredFrom}`);
    this.floorMeasuredFrom = opts.floorMeasuredFrom;
    this.operator = opts.operator;
    this.townRules = { ...DEFAULT_TOWN_RULES, ...(opts.town ?? {}) };
    this.allowUnsignedMint = opts.allowUnsignedMint === true;
    this.owner = opts.owner;
  }

  /** The options a replay needs to judge the same records the same way. */
  private replayOptions(): EventLogOptions {
    return { schemas: this.schemas, fallbackResolver: this.fallback, maxNodeTtlMs: this.maxNodeTtlMs, panelSize: this.panelSize, bondFloor: this.bondFloor, ...(this.bondFloorFrom ? { bondFloorFrom: this.bondFloorFrom } : {}), ...(this.panelV2From ? { panelV2From: this.panelV2From } : {}), ...(this.floorMeasuredFrom ? { floorMeasuredFrom: this.floorMeasuredFrom } : {}), ...(this.insurerDrivers ? { insurerDriversFrom: this.insurerDrivers.from, insurerSeed: this.insurerDrivers.seed } : {}), requireNodeMandate: this.requireNodeMandate, operator: this.operator, owner: this.owner };
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
    // The cutover of the bond floor travels with the log (DK312, S972): a `config` record already in the store sets it, so a restart or a replay without the deployment option judges the same way.
    if (!this.configLoaded) { const v = await tx.getMarker("config:bond_floor_from"); if (v) this.bondFloorFrom = v; const t = await tx.getMarker("config:tier_breadth_from"); if (t) this.tierBreadthFrom = t; this.configLoaded = true; }
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
    if (type === "notice_ack") await this.checkNoticeAck(tx, verified);
    if (type === "gateway_refusal") await this.projectGatewayRefusal(tx, verified);
    if (type === "memory_key") await this.projectMemoryKey(tx, verified);
    if (type === "warrant" || type === "custody_item" || type === "decoy_registration" || type === "inspectorate_finding" || type === "warrant_request" || type === "inspectorate_referral") await this.projectInspectorate(tx, verified, type);
    if (type === "agent_message") await projectAgentMessage(tx, verified);
    if (type === "ladder_season" || type === "ladder_entry" || type === "ladder_match") await this.projectLadder(tx, verified, type);
    if (type === "expedition" || type === "expedition_frame" || type === "expedition_result") await this.projectExpedition(tx, verified, type);
    if (type === "recall_petition" || type === "recall_vote" || type === "recall_result") await this.projectRecall(tx, verified, type);
    if (type === "election" || type === "candidacy" || type === "ballot_commit" || type === "ballot_reveal" || type === "election_result") await this.projectElection(tx, verified, type);
    if (type === "message_block") await projectMessageBlock(tx, verified);
    if (type === "contract") { this.checkSelfHire(verified); const dh = dataHandlingProblem((verified.body as { data_handling?: DataHandling }).data_handling); if (dh) throw rule(dh.rule, dh.message); }
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
    if (type === "mentorship") await projectMentorship(tx, verified, this.bankEnv);
    if (type === "world_event") await this.projectWorldEvent(tx, verified);
    if (type === "retraining_release") await this.projectRetrainingRelease(tx, verified);
    if (type === "clinic_diagnosis") await this.projectClinicDiagnosis(tx, verified);
    if (type === "clinic_order") await this.projectClinicOrder(tx, verified);
    if (type === "watcher_finding") await this.projectWatcherFinding(tx, verified);
    if (type === "standing_order") await this.projectStandingOrder(tx, verified);
    if (type === "checkup_result") await this.projectCheckupResult(tx, verified);
    if (type === "credit_line") await projectCreditLine(tx, verified, this.bankEnv);
    if (type === "credit_default") { await projectCreditDefault(tx, verified, this.bankEnv); await serveQueue(tx, this.bankEnv, verified.issued_at); }
    if (type === "founding_act") await projectFoundingAct(tx, verified, { debit: (t, d, n) => this.debit(t, d, n), credit: (t, d, n) => this.credit(t, d, n), panelSize: this.panelSize, ...(this.panelV2From ? { panelV2From: this.panelV2From } : {}) });
    if (type === "institution_charter") await projectInstitutionCharter(tx, verified, { operator: this.operator, owner: this.owner, cosignedBy: (rr, d) => this.cosignedBy(rr, d), debit: (t, d, n) => this.debit(t, d, n), credit: (t, d, n) => this.credit(t, d, n) });
    if (type === "debt_payment") { await projectDebtPayment(tx, verified, this.bankEnv); await serveQueue(tx, this.bankEnv, verified.issued_at); }
    if (type === "bank_statement") await projectBankStatement(tx, verified);
    if (type === "policy") await projectPolicy(tx, verified, this.insurerEnv);
    if (type === "mutual_act") await projectMutualAct(tx, verified, this.insurerEnv);
    if (type === "claim") await projectClaim(tx, verified);
    if (type === "sponsor_allowance") await projectSponsorAllowance(tx, verified, { reputation: (t, did) => this.reputation(t, did), tierSpendLimit: (tier) => (tier <= 0 ? 0 : TIER_SPEND_LIMIT[tier] ?? Number.MAX_SAFE_INTEGER) });
    if (type === "dispatch") await projectDispatch(tx, verified);
    if (type === "recall") await projectRecall(tx, verified);
    if (type === "handback") await projectHandback(tx, verified, { reputation: (t, did) => this.reputation(t, did), tierSpendLimit: () => 0 });
    if (type === "residency_status") await projectResidencyStatus(tx, verified);
    if (type === "mandate_template") await this.projectMandateTemplate(tx, verified);
    if (type === "mandate_narrowing") await this.projectMandateNarrowing(tx, verified);
    if (type === "common_control") await this.projectCommonControl(tx, verified);
    if (type === "credit_lot") await this.projectCreditLot(tx, verified);
    if (type === "emergency_stop") await this.projectEmergencyStop(tx, verified);
    if (type === "run_halt") await this.projectRunHalt(tx, verified);
    if (type === "incident") await this.projectIncident(tx, verified);
    if (type === "standing_adjustment") await this.projectStandingAdjustment(tx, verified);
    if (type === "treasury_return") await this.projectTreasuryReturn(tx, verified);
    if (type === "key_handover") await this.projectKeyHandover(tx, verified);
    if (type === "town_proposal" || type === "town_vote" || type === "town_tally" || type === "town_enactment") await this.projectTown(tx, verified, type);
    if (type === "usage_plan") await this.projectUsagePlan(tx, verified);
    if (type === "usage_statement") await this.projectUsageStatement(tx, verified);
    if (type === "fleet_node") await projectFleetNode(tx, verified);
    if (type === "fleet_move") await projectFleetMove(tx, verified);
    if (type === "bank_act") await projectBankAct(tx, verified, { debit: (t, d, n) => this.debit(t, d, n), credit: (t, d, n) => this.credit(t, d, n) });
    if (type === "deposit_act") await projectDepositAct(tx, verified, { debit: (t, d, n) => this.debit(t, d, n), credit: (t, d, n) => this.credit(t, d, n), drawBudget: (t, id, n, at) => this.drawBudget(t, id, n, at), cosignedBy: (rec, d) => this.cosignedBy(rec, d) });
    if (type === "refusal") await projectRefusal(tx, verified);
    if (type === "abuse_report") await projectAbuseReport(tx, verified, { operator: this.operator, cosignedBy: (rr, d) => this.cosignedBy(rr, d) });
    if (type === "probe_result") await projectProbeResult(tx, verified);
    if (type === "ladder_step") await projectLadderStep(tx, verified);
    if (type === "subsidy_budget") await projectSubsidyBudget(tx, verified);
    if (type === "subsidy_grant") await projectSubsidyGrant(tx, verified, this.insurerEnv);
    if (type === "subsidy_use") await projectSubsidyUse(tx, verified);
    if (type === "claim_decision") await projectClaimDecision(tx, verified, this.insurerEnv);
    if (type === "budget") await this.projectBudget(tx, verified);
    if (type === "treasury_payment") await this.projectTreasuryPayment(tx, verified);
    if (type === "treasury_statement") await this.projectTreasuryStatement(tx, verified);
    if (type === "forum_checkpoint") await this.projectForumCheckpoint(tx, verified);
    if (type === "forum_rank_checkpoint") await this.projectForumRankCheckpoint(tx, verified);
    if (type === "handout") await this.projectHandout(tx, verified);
    if (type === "config") await this.projectConfig(tx, verified);
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
    if (type === "game_move") await this.projectGameMove(tx, verified);
    if (type === "arena_result") await this.projectArenaResult(tx, verified);
    if (type === "arena_void") await this.projectArenaVoid(tx, verified);
    if (type === "quarantine") await this.projectQuarantine(tx, verified);
    if (type === "quarantine_release") await this.projectQuarantineRelease(tx, verified);
    if (type === "market_act") await projectMarketAct(tx, verified, this.marketEnv());
    if (type === "support") await projectSupport(tx, verified, { operator: this.operator });
    if (type === "court_act") {
      await projectCourtAct(tx, verified, { operator: this.operator, panelSize: this.panelSize, ...(this.panelV2From ? { panelV2From: this.panelV2From } : {}) });
      const ca = verified.body as { act?: string; contest?: string; case?: string };
      if (ca.act === "contest_answer" && ca.contest) await this.reverseContested(tx, ca.contest, verified.issued_at);
      else if (ca.act === "contest_ruling" && ca.case) { const c = JSON.parse((await tx.getMarker(`contest_case:${ca.case}`)) || "null") as { contest?: string } | null; if (c?.contest) await this.reverseContested(tx, c.contest, verified.issued_at); }
    }
    if (type === "shops_act") await projectShopsAct(tx, verified, { reputation: (rd, did) => this.gatedReputation(rd, did), priceListInForce: (t, at) => this.priceListInForce(t, at), debit: (t, did, n) => this.debit(t, did, n), credit: (t, did, n) => this.credit(t, did, n), tierSpendLimit: (tier) => (tier <= 0 ? 0 : TIER_SPEND_LIMIT[tier] ?? Number.MAX_SAFE_INTEGER) });
    if (type === "housing_act") await projectHousingAct(tx, verified);
    if (type === "telemetry_act") await projectTelemetryAct(tx, verified);
    if (type === "research_act") await projectResearchAct(tx, verified, { operator: this.operator, reputation: (rd, did) => this.gatedReputation(rd, did), debit: (t, did, n) => this.debit(t, did, n), credit: (t, did, n) => this.credit(t, did, n) });
    if (type === "events_act") await projectEventsAct(tx, verified, { operator: this.operator, reputation: (rd, did) => this.gatedReputation(rd, did), priceListInForce: (t, at) => this.priceListInForce(t, at), debit: (t, did, n) => this.debit(t, did, n), credit: (t, did, n) => this.credit(t, did, n) });
    if (type === "contract") await notePerformer(tx, verified);
    if (type === "contract") await this.noteRelatedParty(tx, verified);
    if (type === "contract") await this.checkTutorial(tx, verified);
    if (type === "registry_act") await projectRegistryAct(tx, verified, { operator: this.operator, reputation: (rd, did) => this.reputation(rd, did) });
    if (type && ["intent", "offer", "proposal", "contract", "bond", "mandate"].includes(type)) await this.checkCityStop(tx, verified);
    if (type === "bond" || type === "mandate" || type === "proposal" || type === "purchase" || type === "contract") await checkSuspended(tx, verified);
    if (type === "intent") checkIntentClass(verified);
    if (type === "contract") await markPostingFilled(tx, verified);
    if (type !== "key_handover" && type !== "passport" && (await tx.getMarker(`handed_over:${verified.issuer}`))) throw rule("identity_handed_over", `${verified.issuer} was handed over to a new identity: it signs nothing more`);
    if (type === "mandate" || type === "contract" || type === "bond" || type === "proposal" || type === "offer") await this.checkQuarantined(tx, verified);
    if (type === "offer") await this.checkAssociation(tx, verified);
    if (type === "related_party_attestation") await this.projectRelatedAttestation(tx, verified);
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
    if (type === "mandate") { await this.checkMandateTemplate(tx, verified); await this.checkMandateTier(tx, verified); await this.checkThreatFloor(tx, verified); this.checkMandateGates(verified); await this.projectMandate(tx, verified); }
    if (type === "action") { await tx.putMarker(`acted:${(verified.body as { contract: string }).contract}`, verified.id); await this.checkAction(tx, verified); await this.recordStrikes(tx, verified); await this.noteModels(tx, verified); const mt = (verified.body as { metrics?: { tokens_in?: number; tokens_out?: number } }).metrics; if (mt) await noteNodeTokens(tx, verified.issuer, (mt.tokens_in ?? 0) + (mt.tokens_out ?? 0), verified.issued_at); }
    if (type === "world") { checkWorldRecord(verified); await this.projectWorldHalt(tx, verified); }
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
    // A third party with no passport signs an abuse report (H3) with the key the record names; whether that key is the reporter's domain's is the operator's admission check, shown by its countersignature.
    if (type === "abuse_report" && !(await tx.getPassport(r.issuer))) { const k = (r.body as { reporter_key?: { id: string; public_key: string } }).reporter_key; if (k && k.id === r.sig.kid && !found.has(k.id)) found.set(k.id, b64urlDecode(k.public_key)); }
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

  /**
   * What a bond counts for toward a floor (DK740, S1550): in full, unless its backer is service-held (the service could sign for it) and had not yet taken its own key at the bond's time, when it counts at
   * SERVICE_HELD_BOND_PERMILLE. A bond made after the bind counts in full, whatever came before. Computed from records only, so replay agrees.
   */
  private async bondCounting(tx: Pick<LogTx, "getMarker">, backer: string, amount: number, at: string): Promise<{ counted: number; custody: "local" | "service"; discounted: boolean }> {
    if ((await tx.getMarker(`custody:${backer}`)) !== "service") return { counted: amount, custody: "local", discounted: false };
    const rekeyed = await tx.getMarker(`custody_rekeyed:${backer}`);
    if (rekeyed && Date.parse(rekeyed) <= Date.parse(at)) return { counted: amount, custody: "service", discounted: false };
    return { counted: Math.floor((amount * SERVICE_HELD_BOND_PERMILLE) / 1000), custody: "service", discounted: true };
  }

  /** The bond of a contract as a page or a court shows it: who backs it, whether that identity is service-held, what is locked and what counts toward a floor (DK740). Null when there is no bond. */
  async bondLabel(contract: string): Promise<{ contract: string; backer: string; custody: "local" | "service"; locked: number; counted: number; discountPermille: number; note: string } | null> {
    return this.store.transaction(async (tx) => {
      const e = await tx.getEscrow(contract);
      if (!e) return null;
      const stored = await tx.getMarker(`bond_counted:${contract}`);
      const custody = (await tx.getMarker(`bond_custody:${contract}`)) === "service" ? "service" : "local";
      const counted = stored === undefined ? e.bondLocked : Number(stored);
      const discounted = counted < e.bondLocked;
      return { contract, backer: e.backer, custody, locked: e.bondLocked, counted, discountPermille: discounted ? 1000 - SERVICE_HELD_BOND_PERMILLE : 0, note: custody === "service" ? (discounted ? `The backer's key is held by the service: the bond counts at ${SERVICE_HELD_BOND_PERMILLE / 10}% toward a floor until the agent binds its own key. The credits locked are the full amount.` : "The backer began service-held and took its own key before this bond: the bond counts in full. The label stays for good.") : "The backer holds its own key: the bond counts in full." };
    });
  }

  /** Registry rules: one passport chain per DID, issued by the DID itself or its sponsor. */
  private async projectPassport(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; kind: string; invitation?: FleetInvitation; custody?: "local" | "service"; sponsor?: string; fleet?: string; tier?: number; lineage?: { edge: string; parent: string }[]; keys: { id: string; public_key: string }[]; house?: true };
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
    // Issuance limit (register row DK124, RG-11; spec-delta S456): a sponsor opens at most 10 new agent passports a day. The operator's own house agents are not counted. The count is the sponsor's, by the day of the record, so replay gives the same answer.
    // A member of a declared fleet (DK1354, S1459) is bounded by the fleet's own member cap, checked below, not by this count.
    // A verified organisation (S1406, DK1356): the operator countersigns an organisation's passport once it has checked it (its domain, its administrator, the terms). Its agents are not slowed by the daily
    // limit: an enterprise may bring any number of agents. An unverified sponsor is slowed by rate (this limit), never by a total.
    if (body.kind === "org" && this.operator && (r.cosigs ?? []).some((c) => c.kid.startsWith(`${this.operator}#`))) await tx.putMarker(`org_verified:${body.did}`, r.id);
    if (!current && body.kind === "agent" && body.sponsor && body.sponsor !== this.operator && !(await tx.getMarker(`org_verified:${body.sponsor}`)) && !body.fleet) {
      const dayKey = `passports_day:${body.sponsor}|${r.issued_at.slice(0, 10)}`;
      const opened = Number((await tx.getMarker(dayKey)) ?? 0);
      if (opened >= SPONSOR_PASSPORTS_PER_DAY) throw rule("sponsor_daily_limit", `${body.sponsor} opened ${opened} agent passports on ${r.issued_at.slice(0, 10)}; the limit is ${SPONSOR_PASSPORTS_PER_DAY} a day for one sponsor`);
      await tx.putMarker(dayKey, String(opened + 1));
    }
    // Key custody (DK532, S956): a hosted bot whose key the service holds says so, only an agent with a sponsor may, and the label is permanent.
    if (body.custody === "service") {
      if (body.kind !== "agent" || !sponsor) throw rule("hosted_bot_needs_sponsor", "service custody is for a hosted bot: an agent with a sponsor");
      await tx.putMarker(`custody:${body.did}`, "service");
      // The agent taking its own key (DK740, S1550): a passport update of a service-held identity that brings in a public key the passport did not hold ends the discount for bonds made from this record's time on. The label stays (it is permanent, S956).
      if (current && !(await tx.getMarker(`custody_rekeyed:${body.did}`))) {
        const before = new Set((((await tx.getRecord(current.head))?.record.body as { keys?: { public_key: string }[] } | undefined)?.keys ?? []).map((k) => k.public_key));
        if (body.keys.some((k) => !before.has(k.public_key))) await tx.putMarker(`custody_rekeyed:${body.did}`, r.issued_at);
      }
    } else if (await tx.getMarker(`custody:${body.did}`)) throw rule("custody_label_permanent", `${body.did} is a hosted bot whose key the service holds: the label is not removed by a later passport`);
    // A house agent (DK291, S371): only an agent the operator itself sponsors carries the label, and the label is permanent.
    if (body.house) {
      if (body.kind !== "agent" || sponsor !== this.operator) throw rule("house_not_operator_run", `only an agent sponsored by the operator (${this.operator}) is a house agent`);
      await tx.putMarker(`house:${body.did}`, "1");
    } else if (await tx.getMarker(`house:${body.did}`)) throw rule("house_label_permanent", `${body.did} is a house agent: the label is never removed`);
    // A passport that names a sponsor needs that sponsor's consent (S87): the sponsor issues it or countersigns it. The sponsor is liable for the agent, so an
    // agent cannot pick one on its own; and changing sponsors needs the old sponsor's consent as well as the new one's.
    // A fleet invitation (DK1354, S1459) is the sponsor's consent for an agent that issues its own passport: checked here, and used once.
    const invited = body.invitation && !current ? await this.checkInvitation(tx, r, { ...body, invitation: body.invitation }) : false;
    if (body.sponsor && (!current || current.sponsor !== body.sponsor)) {
      const consents = (did: string) => (invited && did === body.sponsor) || r.issuer === did || (r.cosigs ?? []).some((c) => c.kid.startsWith(`${did}#`));
      if (!consents(body.sponsor)) throw rule("sponsor_consent_missing", `${body.did} names ${body.sponsor} as its sponsor, but ${body.sponsor} did not issue or countersign the passport`);
      if (current?.sponsor && !consents(current.sponsor)) throw rule("sponsor_change_needs_old_sponsor", `${body.did} is sponsored by ${current.sponsor}; moving to ${body.sponsor} needs ${current.sponsor}'s consent too`);
    }
    // Binding a sponsor to an identity that already exists (register row CY5; spec-delta S479, S1406): its history and balance stay. The binding counts in the sponsor's daily issuance (above) like a new passport,
    // so an unverified sponsor cannot gather identities faster than the rate; there is no longer a total (every agent has its own starter credits, DK1356).
    if (current && !current.sponsor && body.sponsor && body.sponsor !== this.operator && !(await tx.getMarker(`org_verified:${body.sponsor}`)) && (await tx.getMarker(`starter_upfront:${body.did}`))) {
      const dayKey = `passports_day:${body.sponsor}|${r.issued_at.slice(0, 10)}`;
      const opened = Number((await tx.getMarker(dayKey)) ?? 0);
      if (opened >= SPONSOR_PASSPORTS_PER_DAY) throw rule("sponsor_daily_limit", `${body.sponsor} opened ${opened} agent passports on ${r.issued_at.slice(0, 10)}; the limit is ${SPONSOR_PASSPORTS_PER_DAY} a day for one sponsor`);
      await tx.putMarker(dayKey, String(opened + 1));
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
    const joinNode = (body as { node?: string }).node;
    if (joinNode && !body.fleet) throw rule("node_needs_fleet", "a passport names a tree node only when it names its fleet");
    if (body.fleet) {
      const wasMember = (await tx.getPassport(body.did))?.fleet === body.fleet;
      await this.checkFleetMembership(tx, body.did, body.kind, newSponsor, body.fleet, body as { fingerprint?: { runtime?: string; model?: string } }, wasMember);
      await noteMemberJoin(tx, body.did, body.fleet, joinNode, wasMember);
    }
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
    // The fleet's member count is kept in a marker so a fleet of 10,000 is not read in full at every join (DK1354, S1459); a log from before the marker is counted once, from its members.
    if (body.fleet && current?.fleet !== body.fleet) await tx.putMarker(`fleet_n:${body.fleet}`, String((await this.fleetCount(tx, body.fleet)) + 1));
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
  /** Checks a fleet invitation on a first passport and marks its nonce used. Returns true when it stands in for the sponsor's consent. */
  private async checkInvitation(tx: LogTx, r: AspRecord, body: { did: string; sponsor?: string; fleet?: string; invitation: FleetInvitation }): Promise<boolean> {
    const inv = body.invitation;
    if (r.issuer !== body.did) throw rule("invitation_self_issued", "a passport that carries a fleet invitation is issued by the agent itself");
    if (!body.fleet || inv.fleet !== body.fleet) throw rule("invitation_fleet_mismatch", `the invitation is for ${inv.fleet}, the passport names ${body.fleet ?? "no fleet"}`);
    const fleet = await tx.getFleet(inv.fleet);
    if (!fleet) throw rule("fleet_unknown", `fleet ${inv.fleet} is not declared`);
    if (body.sponsor !== fleet.org) throw rule("fleet_sponsor_mismatch", `fleet ${inv.fleet} belongs to ${fleet.org}; the passport names ${body.sponsor ?? "no sponsor"}`);
    if (Date.parse(inv.expires) <= Date.parse(r.issued_at)) throw rule("invitation_expired", `the invitation expired at ${inv.expires}`);
    if (inv.kid.split("#")[0] !== fleet.org) throw rule("invitation_bad_signature", `the invitation is signed by ${inv.kid}, not by ${fleet.org}`);
    const key = (await tx.keysForDid(fleet.org)).find((k) => k.kid === inv.kid && !k.revokedAt);
    let good = false;
    try { good = !!key && verifyBytes(b64urlDecode(inv.sig), new TextEncoder().encode(invitationMessage(inv)), b64urlDecode(key.publicKey)); } catch { good = false; }
    if (!good) throw rule("invitation_bad_signature", `the invitation's signature does not verify against a current key of ${fleet.org}`);
    if (await tx.getMarker(`invite_used:${inv.nonce}`)) throw rule("invitation_used", "this invitation has already been used: one invitation joins one agent");
    await tx.putMarker(`invite_used:${inv.nonce}`, body.did);
    return true;
  }

  private async fleetCount(tx: LogTx, fleetDid: string): Promise<number> {
    const n = await tx.getMarker(`fleet_n:${fleetDid}`);
    return n !== undefined ? Number(n) : (await tx.fleetMembers(fleetDid)).length;
  }

  private async checkFleetMembership(tx: LogTx, did: string, kind: string, sponsor: string | null, fleetDid: string, passport?: { fingerprint?: { runtime?: string; model?: string } }, alreadyMember = false): Promise<void> {
    if (kind !== "agent") throw rule("fleet_member_kind", `only agents join fleets, not a ${kind}`);
    const fleet = await tx.getFleet(fleetDid);
    if (!fleet) throw rule("fleet_unknown", `fleet ${fleetDid} is not declared`);
    const d = JSON.parse((await tx.getMarker(`fleet_decl:${fleetDid}`)) ?? "{}") as FleetDecl;
    // The organisation, or an individual sponsor it named in its own signed declaration (S1407, DK1353), may sponsor a member.
    if (sponsor !== fleet.org && !(sponsor && (d.co_sponsors ?? []).includes(sponsor))) throw rule("fleet_sponsor_mismatch", `fleet ${fleetDid} belongs to ${fleet.org}${(d.co_sponsors ?? []).length ? ` and its named sponsors` : ""}; ${did} is sponsored by ${sponsor}`);
    const already = (await tx.getPassport(did))?.fleet === fleetDid;
    if (d.closed && !already) throw rule("fleet_closed", `fleet ${fleetDid} is closed to new members`);
    if (fleet.maxMembers !== null) {
      const others = { length: (await this.fleetCount(tx, fleetDid)) - (alreadyMember ? 1 : 0) };
      if (others.length >= fleet.maxMembers) throw rule("fleet_full", `fleet ${fleetDid} has ${fleet.maxMembers} members`);
    }
    // The template is read (S1407): a member that declares a different runtime or model is labelled, or refused when the fleet is strict. A member that declares nothing is labelled `undeclared`, never refused.
    const t = d.template ?? {};
    const diffs: string[] = [];
    for (const k of ["runtime", "model"] as const) {
      const want = t[k], have = passport?.fingerprint?.[k];
      if (want && have && want !== have) diffs.push(k);
    }
    if (diffs.length && d.strict) throw rule("fleet_template_mismatch", `fleet ${fleetDid} is strict: its template names ${diffs.map((k) => `${k} ${t[k as "runtime" | "model"]}`).join(" and ")}, and ${did} declares a different ${diffs.join(" and ")}`);
    const undeclared = (["runtime", "model"] as const).filter((k) => t[k] && !passport?.fingerprint?.[k]);
    await tx.putMarker(`fleet_label:${did}`, diffs.length ? `differs: ${diffs.join(", ")}` : undeclared.length ? `undeclared: ${undeclared.join(", ")}` : "matches");
  }

  /** The Mandate template that applies to a member (S1408): the one for its persona, else the fleet's own; undefined when it has none. */
  private async templateFor(tx: LogTx, member: string): Promise<{ key: string; version: number; record: string; mandate: Record<string, unknown>; fleet: string } | undefined> {
    const pass = await tx.getPassport(member);
    if (!pass?.fleet) return undefined;
    const persona = ((await tx.getRecord(pass.head))?.record.body as { persona?: string } | undefined)?.persona;
    for (const key of persona ? [`${pass.fleet}|${persona}`, `${pass.fleet}|`] : [`${pass.fleet}|`]) {
      const head = Number((await tx.getMarker(`mtemplate_head:${key}`)) ?? 0);
      if (head) { const t = JSON.parse((await tx.getMarker(`mtemplate:${key}|${head}`))!) as { record: string; mandate: Record<string, unknown> }; return { key, version: head, record: t.record, mandate: t.mandate, fleet: pass.fleet }; }
    }
    return undefined;
  }

  /** A Mandate template (S1408, DK1355): the fleet's organisation signs it, versions run 1, 2, 3 (an amendment is the next version), and it is the ceiling every member's Mandate must stay within. */
  private async projectMandateTemplate(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { fleet: string; persona?: string; version: number; mandate: Record<string, unknown> };
    if (r.prev !== null) throw rule("mandate_template_not_chained", "a Mandate template starts its own chain (prev is null)");
    const fleet = await tx.getFleet(b.fleet);
    if (!fleet) throw rule("mandate_template_fleet_unknown", `fleet ${b.fleet} is not declared`);
    if (r.issuer !== fleet.org) throw rule("mandate_template_wrong_issuer", `only the fleet's organisation (${fleet.org}) signs its Mandate template`);
    const key = `${b.fleet}|${b.persona ?? ""}`;
    const head = Number((await tx.getMarker(`mtemplate_head:${key}`)) ?? 0);
    if (b.version !== head + 1) throw rule("mandate_template_version", `the next version of this template is ${head + 1}, not ${b.version}`);
    if (!b.persona) await checkTemplateAgainstTree(tx, b.fleet, b.mandate);
    await tx.putMarker(`mtemplate:${key}|${b.version}`, JSON.stringify({ record: r.id, mandate: b.mandate }));
    await tx.putMarker(`mtemplate_head:${key}`, String(b.version));
  }

  /** A member's own narrowing (S1408): by the member or its sponsor, within the template in force. It replaces the member's earlier narrowing; one that goes beyond the template is refused naming the fields. */
  private async projectMandateNarrowing(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { fleet: string; member: string; narrow: Record<string, unknown> };
    if (r.prev !== null) throw rule("narrowing_not_chained", "a narrowing starts its own chain (prev is null)");
    const pass = await tx.getPassport(b.member);
    if (!pass || pass.fleet !== b.fleet) throw rule("narrowing_not_a_member", `${b.member} is not a member of ${b.fleet}`);
    if (r.issuer !== b.member && r.issuer !== pass.sponsor) throw rule("narrowing_wrong_issuer", `only the member or its sponsor narrows its Mandate`);
    const t = await this.templateFor(tx, b.member);
    const eff = await this.nodeCeiling(tx, b.member);
    if (!t && !eff) throw rule("narrowing_no_template", `${b.fleet} has no Mandate template for ${b.member}`);
    for (const c of [t?.mandate, eff?.mandate]) {
      if (!c) continue;
      const widens = mandateViolations(c, { ...c, ...b.narrow });
      if (widens.length) throw rule("narrowing_widens", `a member's change may only narrow the template${eff ? " and its node's Mandate" : ""}: ${widens.join(", ")} go beyond it`);
    }
    await tx.putMarker(`mnarrow:${b.member}`, JSON.stringify(b.narrow));
  }

  /** A Mandate for a member of a fleet with a template stays within it and the member's own narrowing (S1408): the log refuses one that goes beyond it, naming the fields, whoever signs it. */
  private async checkMandateTemplate(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { contract: string } & Record<string, unknown>;
    const contract = await tx.getRecord(b.contract);
    const performer = (contract?.record.body as { performer?: string } | undefined)?.performer;
    if (!performer) return;
    const t = await this.templateFor(tx, performer);
    const eff = await this.nodeCeiling(tx, performer);
    if (!t && !eff) return;
    const n = JSON.parse((await tx.getMarker(`mnarrow:${performer}`)) ?? "null") as Record<string, unknown> | null;
    const { contract: _c, ...candidate } = b;
    if (t) {
      const d = deriveMandate(t.mandate, b.contract, n);
      const over = mandateViolations("mandate" in d ? d.mandate : t.mandate, candidate);
      if (over.length) throw rule("mandate_exceeds_template", `${performer} belongs to fleet ${t.fleet}, whose Mandate template (version ${t.version}) is the ceiling of every member's Mandate: ${over.join(", ")} go beyond it`);
    }
    if (eff) {
      const d = deriveMandate(eff.mandate, b.contract, n);
      const over = mandateViolations("mandate" in d ? d.mandate : eff.mandate, candidate);
      if (over.length) throw rule("mandate_exceeds_node", `${performer} sits on node ${eff.node} of its fleet's tree, whose Mandate is the ceiling of its members' Mandates: ${over.join(", ")} go beyond it`);
    }
  }

  /** The fleet's chosen association with the society (S1411): `full` when it declared none. */
  private async associationOf(tx: Pick<LogTx, "getPassport" | "getMarker">, did: string): Promise<"full" | "related_party_only" | "private"> {
    const fleet = (await tx.getPassport(did))?.fleet;
    if (!fleet) return "full";
    return (JSON.parse((await tx.getMarker(`fleet_decl:${fleet}`)) ?? "{}") as FleetDecl).association ?? "full";
  }

  /** A fleet that chose `related_party_only` or `private` offers only to related principals (S1411): an offer on an intent of an independent poster is refused, so its agents never enter the society's market. */
  private async checkAssociation(tx: LogTx, r: AspRecord): Promise<void> {
    const assoc = await this.associationOf(tx, r.issuer);
    if (assoc === "full") return;
    const intent = (r.body as { intent?: string }).intent;
    const poster = intent ? (await tx.getRecord(intent))?.record.issuer : undefined;
    if (poster && relatedKind(await this.factsOf(tx, poster), await this.factsOf(tx, r.issuer))) return;
    throw rule("fleet_association_blocks_market", `${r.issuer} belongs to a fleet whose association is ${assoc}: its agents offer only to their own sponsor, fleet or controller, never to the society's market`);
  }

  /** Clean attested related-party runs, in whole jobs at the stated weight (S1411). */
  private async relatedEquivalent(tx: Pick<LogTx, "getMarker">, agent: string): Promise<number> { return relatedEquivalentJobs(Number((await tx.getMarker(`rp_clean:${agent}`)) ?? 0)); }

  /** A sponsor's attestation of one clean run (S1411, DK1358): see the schema for what the log checks. */
  private async projectRelatedAttestation(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { agent: string; action: string };
    if (r.prev !== null) throw rule("rp_attestation_not_chained", "a related-party attestation starts its own chain (prev is null)");
    const pass = await tx.getPassport(b.agent);
    if (!pass?.sponsor) throw rule("rp_attestation_not_an_agent", `${b.agent} is not a sponsored agent in this log`);
    const decl = pass.fleet ? (JSON.parse((await tx.getMarker(`fleet_decl:${pass.fleet}`)) ?? "{}") as FleetDecl) : {};
    const org = pass.fleet ? (await tx.getFleet(pass.fleet))?.org : undefined;
    if (![pass.sponsor, org, ...(decl.co_sponsors ?? [])].includes(r.issuer)) throw rule("rp_attestation_wrong_issuer", `only the agent's sponsor (${pass.sponsor}), its fleet's organisation or a named co-sponsor attests its runs`);
    if (await tx.getMarker(`rp_att:${b.action}`)) throw rule("rp_attestation_known", `the run ${b.action} is attested already`);
    const act = await tx.getRecord(b.action);
    if (!act || act.record.type !== "asp.action/v0.2") throw rule("rp_attestation_not_an_action", `${b.action} is not an Action in this log`);
    if (act.record.issuer !== b.agent) throw rule("rp_attestation_not_agents", `the Action was issued by ${act.record.issuer}, not ${b.agent}`);
    const ab = act.record.body as { contract: string; assurance?: string; blocked_attempts?: unknown[] };
    if (!["gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"].includes(ab.assurance ?? "")) throw rule("rp_attestation_weak", "the run must be one a gateway observed or stronger, not one the agent reported about itself");
    if ((ab.blocked_attempts ?? []).length) throw rule("rp_attestation_not_clean", "the run has blocked attempts: only a clean run is attested");
    const contract = (await tx.getRecord(ab.contract))?.record.body as { principal?: string; performer?: string } | undefined;
    if (!contract?.principal || contract.performer !== b.agent) throw rule("rp_attestation_no_contract", "the Action's contract is not this agent's");
    if (!relatedKind(await this.factsOf(tx, contract.principal), await this.factsOf(tx, b.agent))) throw rule("rp_attestation_not_related", "the run was for an independent principal: it counts as an ordinary job, not as a related-party run");
    const reset = await tx.getMarker(`rp_reset:${b.agent}`);
    if (reset && Date.parse(act.record.issued_at) <= Date.parse(reset)) throw rule("rp_attestation_before_breach", `the run came before the agent's last breach (${reset}): the record starts again after it`);
    await tx.putMarker(`rp_att:${b.action}`, r.id);
    await tx.putMarker(`rp_clean:${b.agent}`, String(Number((await tx.getMarker(`rp_clean:${b.agent}`)) ?? 0) + 1));
  }

  /** The related-party record of an agent (S1411, DK1358): clean attested runs since its last breach, the whole jobs they count as, and the label. Never part of `reputationOf`'s counted jobs. */
  async relatedPartyRecord(agent: string): Promise<{ label: "related-party"; cleanRuns: number; equivalentJobs: number; runsPerJob: number; lastBreach: string | null; association: "full" | "related_party_only" | "private" }> {
    return this.store.transaction(async (tx) => {
      const n = Number((await tx.getMarker(`rp_clean:${agent}`)) ?? 0);
      return { label: "related-party", cleanRuns: n, equivalentJobs: Math.floor(n / RP_RUNS_PER_JOB), runsPerJob: RP_RUNS_PER_JOB, lastBreach: (await tx.getMarker(`rp_reset:${agent}`)) || null, association: await this.associationOf(tx, agent) };
    });
  }

  /** The sponsor and fleet of an identity as the independence rule reads them: the sponsor is replaced by its common-control cluster when a signed finding says it belongs to one (S1410, DK1357). */
  private async factsOf(tx: LogTx, did: string): Promise<PartyFacts> {
    const p = await tx.getPassport(did);
    const raw = p?.sponsor ?? did;
    const cluster = await tx.getMarker(`ctrl:${raw}`);
    return { did, sponsor: cluster || raw, fleet: p?.fleet ?? null, ...(cluster && cluster !== raw ? { rawSponsor: raw } : {}) };
  }

  /** Common control (S1410, DK1357): the operator or the watcher says sponsors are one controller; from then on they count as one sponsor for independence. `lift` ends it (operator only). It moves no credit and changes no tier. */
  private async projectCommonControl(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { cluster: string; sponsors: string[]; lift?: boolean };
    if (r.prev !== null) throw rule("common_control_not_chained", "a common-control record starts its own chain (prev is null)");
    const isOperator = r.issuer === this.operator;
    if (!isOperator && r.issuer !== WATCHER_DID) throw rule("common_control_wrong_issuer", `only the operator or the society watcher (${WATCHER_DID}) records common control`);
    if (b.lift && !isOperator) throw rule("common_control_lift_operator", "only the operator lifts a finding of common control");
    const sorted = [...b.sponsors].sort();
    if (b.cluster !== sorted[0]) throw rule("common_control_cluster_id", `the cluster id is the smallest sponsor in it (${sorted[0]}), not ${b.cluster}`);
    for (const s of b.sponsors) if (!(await tx.getPassport(s))) throw rule("common_control_unknown_sponsor", `${s} has no passport in this log`);
    const members = async (c: string) => ((await tx.getMarker(`ctrl_members:${c}`)) ?? "").split(",").filter(Boolean);
    if (b.lift) {
      for (const s of b.sponsors) {
        const c = await tx.getMarker(`ctrl:${s}`);
        if (!c) continue;
        const rest = (await members(c)).filter((m) => m !== s);
        await tx.putMarker(`ctrl:${s}`, "");
        if (rest.length < 2) { for (const m of rest) await tx.putMarker(`ctrl:${m}`, ""); await tx.putMarker(`ctrl_members:${c}`, ""); }
        else { const canon = [...rest].sort()[0]; for (const m of rest) await tx.putMarker(`ctrl:${m}`, canon); await tx.putMarker(`ctrl_members:${c}`, ""); await tx.putMarker(`ctrl_members:${canon}`, rest.join(",")); }
      }
      return;
    }
    const all = new Set(b.sponsors);
    for (const s of b.sponsors) { const c = await tx.getMarker(`ctrl:${s}`); if (c) for (const m of await members(c)) all.add(m); }
    const canon = [...all].sort()[0];
    for (const m of all) { const old = await tx.getMarker(`ctrl:${m}`); if (old && old !== canon) await tx.putMarker(`ctrl_members:${old}`, ""); await tx.putMarker(`ctrl:${m}`, canon); }
    await tx.putMarker(`ctrl_members:${canon}`, [...all].sort().join(","));
  }

  /** The anti-farming report of this log (S1410, DK1357): common-control clusters and the findings over the job graph, for the Clinic. A lead, never a penalty. `external` carries what the hosted service knows (payment, domain, address). */
  async farmingReport(opts: { at?: string; seed?: string; external?: ExternalFacts } = {}): Promise<FarmingReport> {
    const recs = await this.recordsOfTypes(["passport", "contract", "settlement"]);
    return analyseFarming(recs, opts);
  }

  /** Every identity that sponsors an agent, or is a person or organisation with a passport (S1415): who the service's facts are asked about. */
  async sponsorDids(): Promise<string[]> {
    const out = new Set<string>();
    for (const r of await this.recordsOfTypes(["passport"])) { const b = r.body as { did: string; kind: string; sponsor?: string }; if (b.sponsor) out.add(b.sponsor); if (b.kind !== "agent") out.add(b.did); }
    return [...out].sort();
  }

  /** The agents sponsored by any of these sponsors (S1410): who a cluster freeze names. */
  async agentsOfSponsors(sponsors: string[]): Promise<string[]> {
    const set = new Set(sponsors);
    const out = new Set<string>();
    for (const r of await this.recordsOfTypes(["passport"])) { const b = r.body as { did: string; kind: string; sponsor?: string }; if (b.kind === "agent" && b.sponsor && set.has(b.sponsor)) out.add(b.did); }
    return [...out].sort();
  }

  /** The cluster a sponsor belongs to by a signed finding, or undefined (S1410). */
  async controlClusterOf(sponsor: string): Promise<string | undefined> { return this.store.transaction(async (tx) => (await tx.getMarker(`ctrl:${sponsor}`)) || undefined); }

  /** The Mandate in force at the node a member sits on (S1409), or undefined when its fleet has no mandated node on the way up. */
  private async nodeCeiling(tx: LogTx, member: string): Promise<{ node: string; mandate: Record<string, unknown> } | undefined> {
    const at = await nodeOfMember(tx, member);
    return at ? effectiveMandate(tx, at.fleet, at.node) : undefined;
  }

  /** The tree of a fleet with its members per node and the month's usage (S1409, DK1372); `at` picks the UTC month (default now). */
  async fleetTree(fleet: string, at: string = new Date().toISOString()): Promise<TreeView | undefined> { return this.store.transaction(async (tx) => readTree(tx, fleet, monthOf(at))); }

  /** The node a member sits on and the nodes above it, root last (S1409). */
  async nodeOf(member: string): Promise<{ fleet: string; node: string; path: string[] } | undefined> {
    return this.store.transaction(async (tx) => {
      const at = await nodeOfMember(tx, member);
      if (!at) return undefined;
      const path: string[] = [];
      let n: string | null = at.node;
      while (n) { path.push(n); n = JSON.parse((await tx.getMarker(`fnode:${at.fleet}|${n}`)) ?? "null")?.parent ?? null; }
      return { ...at, path };
    });
  }

  /** The newest version of the Mandate template of a fleet (and persona), or 0 when there is none (S1408). */
  async templateVersion(fleet: string, persona?: string): Promise<number> { return this.store.transaction(async (tx) => Number((await tx.getMarker(`mtemplate_head:${fleet}|${persona ?? ""}`)) ?? 0)); }

  /** The Mandate ceiling of a member now (S1408): the template in force with the member's own narrowing laid over it, or undefined when its fleet has no template. */
  async mandateCeiling(member: string): Promise<{ template: string; version: number; narrowing: Record<string, unknown> | null; mandate: Record<string, unknown>; node?: string } | undefined> {
    return this.store.transaction(async (tx) => {
      const t = await this.templateFor(tx, member);
      const eff = await this.nodeCeiling(tx, member);
      const base = eff?.mandate ?? t?.mandate;
      if (!base) return undefined;
      const n = JSON.parse((await tx.getMarker(`mnarrow:${member}`)) ?? "null") as Record<string, unknown> | null;
      const d = deriveMandate(base, "", n);
      return { template: t?.record ?? "", version: t?.version ?? 0, narrowing: n, mandate: "mandate" in d ? d.mandate : base, ...(eff ? { node: eff.node } : {}) };
    });
  }

  /** The Mandate a member holds for a contract, derived from its fleet's template and its own narrowing (S1408): cheap, so a fleet of 10,000 needs no 10,000 hand-made Mandates. */
  async deriveMemberMandate(member: string, contract: string): Promise<Record<string, unknown> | undefined> {
    const c = await this.mandateCeiling(member);
    return c ? { ...c.mandate, contract } : undefined;
  }

  /** One declaration chain per fleet, issued by its org, which never changes. An update restates the declaration (S1407): the cap may not fall below the members, and the co-sponsors may be changed without unseating a member. */
  private async projectFleet(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as unknown as FleetDecl & { did: string; org: string; name: string; max_members?: number };
    const current = await tx.getFleet(body.did);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a fleet update for ${body.did} must follow ${current.head}`
        : `the first declaration of ${body.did} must start a chain`);
    }
    if (r.issuer !== body.org) throw new AspError("WRONG_ISSUER", `fleet ${body.did} must be declared by its org ${body.org}`);
    if (current && current.org !== body.org) throw rule("fleet_org_change", `fleet ${body.did} belongs to ${current.org}`);
    if (current && body.max_members !== undefined) {
      const members = (await tx.fleetMembers(body.did)).length;
      if (body.max_members < members) throw rule("fleet_cap_below_members", `fleet ${body.did} has ${members} members: the cap cannot be ${body.max_members}`);
    }
    if ((body.co_sponsors ?? []).includes(body.org)) throw rule("fleet_co_sponsor_is_org", "the organisation is the fleet's sponsor already: co_sponsors names the others");
    await tx.putFleet({ did: body.did, head: r.id, org: body.org, name: body.name, maxMembers: body.max_members ?? null });
    await tx.putMarker(`fleet_decl:${body.did}`, JSON.stringify({ purpose: (body as { purpose?: string }).purpose, template: body.template, co_sponsors: body.co_sponsors ?? [], strict: !!body.strict, closed: !!body.closed, ...((body as { association?: FleetDecl["association"] }).association ? { association: (body as { association?: FleetDecl["association"] }).association } : {}) } satisfies FleetDecl));
    const list = ((await tx.getMarker("fleets_of:" + body.org)) ?? "").split(",").filter(Boolean);
    if (!list.includes(body.did)) await tx.putMarker("fleets_of:" + body.org, [...list, body.did].join(","));
  }

  /** A fleet as the log holds it (S1407, DK1353): the declaration, its co-sponsors and template, and each member with its sponsor and whether it matches the template. */
  async fleetDetails(fleetDid: string): Promise<{ did: string; org: string; name: string; purpose?: string; template: FleetDecl["template"]; maxMembers: number | null; coSponsors: string[]; strict: boolean; closed: boolean; association: "full" | "related_party_only" | "private"; members: { did: string; sponsor: string | null; label: string }[] } | undefined> {
    return this.store.transaction(async (tx) => {
      const f = await tx.getFleet(fleetDid);
      if (!f) return undefined;
      const d = JSON.parse((await tx.getMarker(`fleet_decl:${fleetDid}`)) ?? "{}") as FleetDecl;
      const members = await Promise.all((await tx.fleetMembers(fleetDid)).map(async (m) => ({ did: m.did, sponsor: m.sponsor, label: (await tx.getMarker(`fleet_label:${m.did}`)) ?? "matches" })));
      return { did: f.did, org: f.org, name: f.name, purpose: d.purpose, template: d.template, maxMembers: f.maxMembers, coSponsors: d.co_sponsors ?? [], strict: !!d.strict, closed: !!d.closed, association: d.association ?? "full", members };
    });
  }

  /** The fleets an organisation has declared, oldest first (S1407). */
  async fleetsOf(org: string): Promise<string[]> { return this.store.transaction(async (tx) => ((await tx.getMarker("fleets_of:" + org)) ?? "").split(",").filter(Boolean)); }

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
    // An unbound node grant (T22, S1594): with the log's option `requireNodeMandate` (or ASP_NODE_REQUIRES_MANDATE=1 in the service's environment) a node key that cites no Mandate is refused, so a helper key is always bounded by a Mandate's `nodes.max_parallel` and expiry, never by the 24-hour cap alone. A revocation (expires at or before issued_at) is always allowed, so an unbound grant made earlier can still be ended.
    if (this.requireNodeMandate && !body.mandate && after(body.expires, r.issued_at)) throw rule("node_needs_mandate", "a node grant cites the Mandate it works under: a helper key is bounded by that Mandate's parallel limit and expiry, never by the 24-hour cap alone"+" (asp orchestrate --mandate <id>)");
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
    await tx.putMarker(`lineage_head:${body.child}`, r.id); // the newest edge the log holds for this agent: a handback that leaves one out is refused (DK203)
  }

  /**
   * A model change opens a probation (D4): an Action's metrics say which models ran, by the name the provider resolved and, where it gives one, a backend fingerprint (the digest). The first Action
   * from an agent that names models records them; a later one that names a model the agent has not run before, or the same name with a different digest, opens a probation window for the agent
   * (the same window a lineage update sets, 7 days, never shortened). Nothing is refused: a runtime swap is allowed, and the window is the log's record that "a name can point to different weights".
   */
  /**
   * A model swap holds an agent at the entry tier (DK1605, S1555): from the swap until a passed exam of its own, every gate that reads the tier sees at most tier 1, so the Mandate limits, the board's minimum tier, the Bond
   * floors, the arenas, the events, the research problems and the shops' gates treat the agent as new. The reputation itself (the slash count, the jobs, the stored tier) is not touched: the exam restores the view.
   */
  private async gatedReputation(tx: Pick<LogTx, "getPassport" | "getRecord" | "getReputation" | "getMarker">, did: string) {
    const r = await this.reputation(tx, did);
    const since = r && r.tier > 1 ? await tx.getMarker(`model_hold:${did}`) : undefined;
    if (r && since) { const passed = await tx.getMarker(`exam_pass_at:${did}`); if (!passed || Date.parse(passed) <= Date.parse(since)) return { ...r, tier: 1 }; }
    return r;
  }

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
    if (changed) await tx.putMarker(`model_hold:${r.issuer}`, r.issued_at); // DK1605, S1556: held until a passed exam of its own after this time
    if (changed) {
      const until = new Date(Date.parse(r.issued_at) + MODEL_CHANGE_PROBATION_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
      const current = await tx.getProbation(r.issuer);
      if (!current || Date.parse(current.until) < Date.parse(until)) await tx.putProbation({ did: r.issuer, until, setBy: r.id });
    }
  }

  /** Debits an account, throwing insufficient_balance rather than letting it go negative. */
  private async debit(tx: LogTx, rawDid: string, amount: number, mayUsePurchased = false): Promise<void> {
    if (amount === 0) return;
    const did = canonicalAccount(rawDid);
    if (did === BURN_DID) throw rule("burn_account_locked", "burned credits do not return: the Burn account is never debited");
    const balance = (await tx.getAccount(did))?.balance ?? 0;
    if (balance < amount) throw rule("insufficient_balance", `${did} has ${balance} credits, needs ${amount}`);
    // Purchased credits (S1413, DK1370) are a second class: they stay in their lots and buy services; every other spend draws only what is not purchased.
    if (!mayUsePurchased) {
      const lots = outstanding(await lotsOf(tx, did));
      if (lots > 0 && balance - amount < lots) throw rule("purchased_credits_restricted", `${did} holds ${lots} purchased credits, which buy the platform's services and never pay for a job or a third party: ${balance - lots} are free, ${amount} asked`);
    }
    // A mentor's collateral is held while its protege's line is open (DK1201): the credits stay, and cannot be spent below the hold.
    const held = Number((await tx.getMarker(`hold:${did}`)) ?? 0);
    if (held > 0 && balance - amount < held) throw rule("collateral_held", `${did} holds ${held} credits as a mentor's collateral while its protege's line is open: ${balance - held} are free, ${amount} asked`);
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
  private async demote(tx: LogTx, did: string, at: string, slash?: { settlement: string; amount: number }): Promise<void> {
    const rep = await this.reputation(tx, did);
    if (!rep) return; // not an agent (or has no passport at all): this mechanism doesn't apply
    await tx.putMarker(`rp_clean:${did}`, "0"); await tx.putMarker(`rp_reset:${did}`, at); // a slash resets the related-party record (S1411)
    await tx.putMarker(`slashed_at:${did}`, at); // when the last slash happened, for the promotion rule (no promotion within 30 days of a slash)
    if (slash) await tx.putMarker(`demoted:${slash.settlement}`, JSON.stringify({ did, from: rep.tier, amount: slash.amount }));
    await this.saveReputation(tx, did, { ...rep, tier: Math.max(0, rep.tier - 1), slashCount: rep.slashCount + 1 });
  }

  /**
   * An adverse act that was contested and did not stand is undone by the institution that made it (DK1607, S1556). It runs once, after the operator withdrew the act or a ruling of the Courts reversed it, and it changes only
   * what that act changed: a strike leaves the bond floor's recent strikes; a slash gives back the tier and the count it cost, and the backer's lost bond is paid back from the Treasury's holding, never beyond what it holds;
   * a Clinic diagnosis stops counting towards the bond floor; a quarantine ends for the agent that contested it. A ruling that upholds the act, or an answer that upholds it, changes nothing. The effects are written on the contest.
   */
  private async reverseContested(tx: LogTx, contestId: string, at: string): Promise<void> {
    const raw = await tx.getMarker(`contest:${contestId}`);
    if (!raw) return;
    const info = JSON.parse(raw) as { subject: string; agent: string; state: string };
    if (info.state !== "withdrawn" && info.state !== "reversed") return;
    const subject = await tx.getRecord(info.subject);
    if (!subject) return;
    const effects: Record<string, unknown> = {};
    const t = subject.record.type;
    if (t === "asp.action/v0.2") {
      const rep = await this.reputation(tx, subject.record.issuer);
      if (rep) {
        const i = rep.strikeLog.findIndex((x) => x.at === subject.record.issued_at);
        if (i >= 0) { await this.saveReputation(tx, subject.record.issuer, { ...rep, strikeLog: rep.strikeLog.filter((_, j) => j !== i) }); effects.strike_removed = rep.strikeLog[i]!.count; }
      }
    } else if (t === "asp.settlement/v0.2") {
      const d = JSON.parse((await tx.getMarker(`demoted:${info.subject}`)) || "null") as { did: string; from: number; amount: number } | null;
      const rep = d ? await this.reputation(tx, d.did) : null;
      if (d && rep) {
        await this.saveReputation(tx, d.did, { ...rep, tier: rep.tier < d.from ? rep.tier + 1 : rep.tier, slashCount: Math.max(0, rep.slashCount - 1) });
        const held = (await tx.getAccount(TREASURY_DID))?.balance ?? 0;
        const paid = Math.min(d.amount, held);
        if (paid > 0) { await this.debit(tx, TREASURY_DID, paid); await this.credit(tx, d.did, paid); }
        effects.slash_reversed = { backer: d.did, tier_restored: rep.tier < d.from, bond_lost: d.amount, paid_back: paid, short: d.amount - paid };
      }
    } else if (t === "asp.clinic_diagnosis/v0.2") {
      await tx.putMarker(`diagnosis_withdrawn:${info.subject}`, at);
      effects.diagnosis_withdrawn = true;
    } else if (t === "asp.gateway_refusal/v0.2") {
      await tx.putMarker(`refusal_reversed:${info.subject}`, contestId);
      effects.refusal_recorded_as_wrong = true;
    } else if (t === "asp.quarantine/v0.2") {
      if (!(await tx.getMarker(`quarantine_released:${info.subject}|${info.agent}`))) { await tx.putMarker(`quarantine_released:${info.subject}|${info.agent}`, contestId); effects.quarantine_ended_for = info.agent; }
    }
    await tx.putMarker(`contest:${contestId}`, JSON.stringify({ ...JSON.parse((await tx.getMarker(`contest:${contestId}`))!), effects }));
  }

  /**
   * A job settled `accepted` with nothing slashed. `acceptedJobs` is the raw count (every such job, as before, kept for display and
   * for old data). `qualifyingJobs` is what standing reads (the bond floor, the starter grant's rest): the job must be independent
   * (principal vs performer and backer: not the same, not one sponsor, not one fleet), priced at least QUALIFYING_MIN_PRICE, and within
   * the counterparty cap (qualifying.ts, credits.md 5.4). Agents only, like the rest of reputation.
   * Old rows have no `qualifyingJobs`; they read as 0, so jobs counted before this rule do not carry over (the conservative choice).
   */
  private async countAcceptedJob(tx: LogTx, backer: string, job: { principal: string; performer: string; price: number; at: string; intent?: string; contract?: string; verifier?: string }): Promise<void> {
    const rep = await this.reputation(tx, backer);
    if (!rep) return;
    let { qualifyingJobs, recentJobs } = rep;
    // The job's class (DK18): the poster's class on the intent (raised by the Market, never lowered), capped by what the price supports; no class reads as routine. Its weight is what the job adds to standing: trivial 0, routine 1, skilled 2, critical 3.
    const intentRec = job.intent ? await tx.getRecord(job.intent) : undefined;
    const declared = intentRec?.record.type === "asp.intent/v0.2" ? jobNeeds(intentRec.record, ((await tx.getMarker(`class_raise:${job.intent}`)) as JobClass | undefined) ?? undefined).class : undefined;
    const weight = classWeight(declared, job.price);
    // A loop of hires does not count (DK6; spec-delta S468): a job whose performer already hired the principal, directly or through up to four others, in the last 90 days is not standing. The edges are kept in a marker, so replay agrees.
    const edges = JSON.parse((await tx.getMarker("hire_edges")) ?? "[]") as Hire[];
    const at = Date.parse(job.at);
    const looped = closesLoop(edges, job.principal, job.performer, at);
    await tx.putMarker("hire_edges", JSON.stringify([...edges.filter((e) => at - e.at <= LOOP_WINDOW_MS).slice(-2000), { principal: job.principal, performer: job.performer, at, contract: "" }]));
    if (job.price >= QUALIFYING_MIN_PRICE && weight > 0 && !looped) {
      const facts = async (did: string): Promise<PartyFacts> => this.factsOf(tx, did);
      const principal = await facts(job.principal);
      const others = [await facts(job.performer), await facts(backer)];
      if (others.every((o) => independent(principal, o))) {
        const admitted = admitEligibleJob(recentJobs, principal.sponsor, job.at);
        recentJobs = admitted.window;
        if (admitted.counts) {
          qualifyingJobs += weight;
          // The first job that unlocks the rest of the starter grant must come from a principal that is not a house agent (DK1302, S1551; owner answer): a counted job from a house agent's seed is real work and counts toward standing, but it does not release the credits.
          if (!(await tx.getMarker(`house:${job.principal}`))) await tx.putMarker(`starter_nonhouse:${backer}`, job.at);
          // The class and weight of each counted job, and the feed AgentRank reads (market.md 5, 7; DK128): kept in markers beside the reputation row, not in it.
          const cls = effectiveClass(declared, job.price);
          const kept = (await readQualClass(tx, backer)).filter((j) => Date.parse(j.at) > at - 90 * 24 * 3600 * 1000);
          await tx.putMarker(`qual_class:${backer}`, JSON.stringify([...kept, { at: job.at, c: cls, w: weight }].slice(-400)));
          const feed = JSON.parse((await tx.getMarker(`qual_feed:${backer}`)) ?? "[]") as unknown[];
          await tx.putMarker(`qual_feed:${backer}`, JSON.stringify([...feed, { contract: job.contract ?? null, at: job.at, class: cls, weight, price: job.price, counterparty: job.principal, verifier: job.verifier ?? job.principal, outcome: "accepted" }].slice(-500)));
        }
      }
    }
    await this.saveReputation(tx, backer, { ...rep, acceptedJobs: rep.acceptedJobs + 1, qualifyingJobs, recentJobs });
  }

  /** The poster's side of a settlement (market.md 13.2, DK127): kept in a marker beside the reputation, derived on replay, so a replica has the same record. */
  private async notePosterOutcome(tx: LogTx, principal: string, body: { basis: string; cites?: string; escrow_released: { value: number }; bond_slashed: { value: number } }): Promise<void> {
    const rec = JSON.parse((await tx.getMarker(`poster_rec:${principal}`)) ?? "null") as PosterRecord | null ?? { ...EMPTY_POSTER_RECORD };
    const next: PosterRecord = { ...rec, settled: rec.settled + 1 };
    if (body.basis === "accepted") {
      next.accepted = rec.accepted + 1;
      const acc = body.cites ? await tx.getRecord(body.cites) : undefined;
      const delivery = acc ? await tx.getRecord((acc.record.body as { about?: string }).about ?? "") : undefined;
      if (acc && delivery) next.acceptHours = [...rec.acceptHours, (Date.parse(acc.record.issued_at) - Date.parse(delivery.record.issued_at)) / 3_600_000].slice(-50);
    } else if (body.basis === "ruling" && body.escrow_released.value > 0 && body.bond_slashed.value === 0) next.lost = rec.lost + 1;
    await tx.putMarker(`poster_rec:${principal}`, JSON.stringify(next));
  }

  /** A poster's record, read from the log (market.md 13.2): what the board shows beside a posting, and what scales the posting deposit. */
  async posterRecord(did: string): Promise<{ settled: number; acceptedShare: number | null; medianHoursToAccept: number | null; disputesLost: number; withdrawnAfterBids: number; depositMultiplier: number }> {
    const rec = await this.store.transaction(async (tx) => JSON.parse((await tx.getMarker(`poster_rec:${did}`)) ?? "null") as PosterRecord | null) ?? EMPTY_POSTER_RECORD;
    return { settled: rec.settled, acceptedShare: rec.settled ? Math.round((rec.accepted / rec.settled) * 1000) / 1000 : null, medianHoursToAccept: medianOf(rec.acceptHours), disputesLost: rec.lost, withdrawnAfterBids: rec.withdrawnAfterBids, depositMultiplier: depositMultiplier(rec) };
  }

  /** Counts an Action's blocked attempts as strikes on the performer (agents only; no demotion, no slash). */
  private async recordStrikes(tx: LogTx, r: AspRecord): Promise<void> {
    const blocked = (r.body as { blocked_attempts?: { count: number }[] }).blocked_attempts;
    const total = blocked?.reduce((n, b) => n + b.count, 0) ?? 0;
    if (total === 0) return;
    const rep = await this.reputation(tx, r.issuer);
    if (!rep) return;
    await tx.putMarker(`rp_clean:${r.issuer}`, "0"); await tx.putMarker(`rp_reset:${r.issuer}`, r.issued_at); // a blocked attempt resets the related-party record (S1411)
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

  /** The dated facts the measured terms read (DK313, S1201): the counted jobs with their weights and times, and the Clinic's measured checkups with the change in the held-out mean. */
  private async measuredFloorTerms(tx: LogTx, backer: string, at: string): Promise<{ acceptedCleanJobs: number; verifiedImprovements: number; regressions: number; probation: boolean }> {
    const feed = JSON.parse((await tx.getMarker(`qual_feed:${backer}`)) ?? "[]") as { at: string; weight: number }[];
    const series = JSON.parse((await tx.getMarker(`checkup_series:${backer}`)) ?? "[]") as { at: string; delta: number | null }[];
    return measuredTerms(feed, series, at, (await tx.getMarker(`retrained_at:${backer}`)) ?? undefined);
  }

  /** What the floor reads for an agent now (a read-only view of the recorded inputs, the measured terms included once they are active). */
  async floorTerms(backer: string, at?: string): Promise<{ ownSlashes: number; fleetSlashes: number; recentStrikes: number; verifiedImprovements: number; acceptedCleanJobs: number; regressions: number; probation: boolean; measured: boolean }> {
    const when = at ?? this.now().toISOString();
    return this.store.transaction(async (tx) => {
      const rep = (await this.reputation(tx, backer)) ?? { slashCount: 0, strikeLog: [] as StrikeEntry[], qualifyingJobs: 0 };
      const measured = floorMeasuredActive(this.floorMeasuredFrom, when);
      const terms = measured ? await this.measuredFloorTerms(tx, backer, when) : { acceptedCleanJobs: rep.qualifyingJobs, verifiedImprovements: 0, regressions: 0, probation: false };
      return { ownSlashes: rep.slashCount, fleetSlashes: 0, recentStrikes: recentStrikes(rep.strikeLog, when), ...terms, measured };
    });
  }

  /**
   * The recorded inputs of the v3 floor for a backer and a contract at a time (DK43, S506): the v2 record (slashes, fleet slashes, strikes, accepted clean jobs), the valid certificates, the latest Clinic
   * diagnosis in the last 30 days, the class the Intent declared, and the scopes of the Mandate when it is known. Nothing here is a person's say-so.
   */
  private async floorInputsV3(tx: LogTx, backer: string, contractId: string, at: string, scopes: string[]): Promise<FloorInputsV3> {
    const rep = (await this.reputation(tx, backer)) ?? { slashCount: 0, strikeLog: [], qualifyingJobs: 0 } as { slashCount: number; strikeLog: StrikeEntry[]; qualifyingJobs: number };
    let fleetSlashes = 0;
    const passport = await tx.getPassport(backer);
    if (passport?.fleet) for (const m of await tx.fleetMembers(passport.fleet)) { if (m.did !== backer) fleetSlashes += (await this.reputation(tx, m.did))?.slashCount ?? 0; }
    const contract = await tx.getRecord(contractId);
    const cb = contract?.record.body as { performer?: string; basis?: { intent?: string } } | undefined;
    let strikes = recentStrikes(rep.strikeLog, at);
    if (cb?.performer && cb.performer !== backer) strikes += recentStrikes((await this.reputation(tx, cb.performer))?.strikeLog ?? [], at);
    let certificates = 0;
    for (const id of ((await tx.getMarker(`certs_of:${backer}`)) ?? "").split(",").filter(Boolean)) {
      const c = await tx.getRecord(id);
      const expires = (c?.record.body as { expires?: string } | undefined)?.expires;
      if (c && expires && Date.parse(expires) > Date.parse(at) && !(await tx.getMarker(`cert_revoked:${id}`))) certificates++;
    }
    let drift: FloorInputsV3["drift"] = "none";
    const dxId = await tx.getMarker(`clinic_diagnosis_last:${backer}`);
    const dx = dxId ? await tx.getRecord(dxId) : undefined;
    if (dx && !(await tx.getMarker(`diagnosis_withdrawn:${dxId}`)) && Date.parse(at) - Date.parse(dx.record.issued_at) <= 30 * 86_400_000) { const sev = (dx.record.body as { severity?: string }).severity; if (sev === "warn" || sev === "quarantine_recommended") drift = sev; }
    const intent = cb?.basis?.intent ? await tx.getRecord(cb.basis.intent) : undefined;
    const cls = (intent?.record.body as { class?: string } | undefined)?.class;
    const taskClass: TaskClass = cls === "trivial" || cls === "skilled" || cls === "critical" ? cls : "routine";
    const terms = floorMeasuredActive(this.floorMeasuredFrom, at) ? await this.measuredFloorTerms(tx, backer, at) : { acceptedCleanJobs: rep.qualifyingJobs, verifiedImprovements: 0, regressions: 0 };
    return { ownSlashes: rep.slashCount, fleetSlashes, recentStrikes: strikes, ...terms, certificates, drift, taskClass, scopes };
  }

  /** The threat matrix at the Mandate (DK43, S506): under floor v3 the bond locked for the job must cover the floor that the Mandate's own scopes imply; the Bond came first, so this is checked when the Mandate arrives. */
  private async checkThreatFloor(tx: LogTx, r: AspRecord): Promise<void> {
    if (this.bondFloor !== "v3" || !floorIsV2(this.bondFloor, this.bondFloorFrom, r.issued_at)) return;
    const b = r.body as { contract: string; scopes: string[] };
    const escrow = await tx.getEscrow(b.contract);
    if (!escrow || !(await this.reputation(tx, escrow.backer))) return;
    const contract = await tx.getRecord(b.contract);
    const price = (contract?.record.body as { price?: { value: number } } | undefined)?.price?.value ?? 0;
    const floor = bondFloorV3(await this.floorInputsV3(tx, escrow.backer, b.contract, r.issued_at, b.scopes));
    const need = Math.ceil((price * floor) / 1000);
    const countedStored = await tx.getMarker(`bond_counted:${b.contract}`);
    if ((countedStored === undefined ? escrow.bondLocked : Number(countedStored)) < need) throw rule("bond_below_threat_floor", `the scopes this Mandate grants (${b.scopes.join(", ") || "none"}) put the floor for this job at ${floor} permille of the price, so a bond of at least ${need} is needed; ${escrow.bondLocked} is locked`);
  }

  /**
   * Deterrence, extended past Bond: a tier-0 agent (demoted to nothing by repeat slashes) can't
   * receive a Mandate either, not just bond a job, and a tier 1 or 2 agent's spend and parallel nodes are capped (TIER_SPEND_LIMIT, TIER_PARALLEL_LIMIT). The envelope subject is the performer for a
   * Mandate (lifecycle's own subject_is_performer guard already establishes this).
   */
  private async checkMandateTier(tx: LogTx, r: AspRecord): Promise<void> {
    await checkLadderOnMandate(tx, r);
    await checkMandateTelemetry(tx, r);
    const rep = await this.gatedReputation(tx, r.subject as string);
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
    // Breadth by tier (DK385, S973): from the time a config record names, a Mandate's scopes and irreversible policy depend on the tier (tier-breadth.ts).
    if (this.tierBreadthFrom && Date.parse(r.issued_at) >= Date.parse(this.tierBreadthFrom)) {
      const bad = breadthProblem(rep.tier, r.body as { scopes?: string[]; irreversible?: { policy?: string } });
      if (bad) throw rule(bad.rule, `${r.subject}: ${bad.message}`);
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
    const body = r.body as { scopes: string[]; irreversible?: { scopes?: string[] }; learning?: { private_scopes?: unknown } };
    if (privateScopesProblem(body.learning?.private_scopes)) throw rule("private_scopes_invalid", "learning.private_scopes is at most 16 distinct names of 1 to 64 characters from a-z 0-9 - _");
    const stray = (body.irreversible?.scopes ?? []).filter((s) => !body.scopes.includes(s));
    if (stray.length) throw rule("gate_not_granted", `irreversible.scopes names scope(s) the Mandate does not grant: ${stray.join(", ")}`);
  }

  private async projectMandate(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { contract: string; scopes: string[] };
    // An in-society service has no real-world scope (DK660, S970): the Mandate under a services-board contract is read-only, with no network, no spend and no subcontracting.
    const crec = await tx.getRecord(body.contract);
    const basisIntent = (crec?.record.body as { basis?: { intent?: string } } | undefined)?.basis?.intent;
    const irec = basisIntent ? await tx.getRecord(basisIntent) : undefined;
    if ((irec?.record.body as { service?: string } | undefined)?.service) {
      const mb = r.body as { scopes: string[]; network?: unknown; spend: { cap: number }; subcontract: { allowed: boolean } };
      const bad = mb.scopes.filter((x) => !/\.(read|list|search|get)$/.test(x) || isNetworkScope(x));
      if (bad.length || mb.network || mb.spend.cap > 0 || mb.subcontract.allowed) throw rule("service_mandate_in_society_only", `a Mandate under an in-society service has read-only scopes, no network, no spend and no subcontracting${bad.length ? ` (not allowed: ${bad.join(", ")})` : ""}`);
    }
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
    const jdc = (r.body as { job_data_chain?: string }).job_data_chain;
    if (jdc) { await tx.putMarker(`job_data:${body.contract}`, jdc); } // the performer cites the head of its job-data deletion chain (S1602, JO3)
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
    // The approval wait an Action reports (S1440, S1441): it must be shown by the Checkpoints in the chain (raised, answered; or still open), within two seconds a report for rounding. A wait the log does not
    // show is refused, so a claim cannot extend a binding deadline.
    const claimedWait = (r.body as { metrics?: { approval_wait_seconds?: number } }).metrics?.approval_wait_seconds;
    if (claimedWait) {
      const snap = chain?.snapshot;
      const shownMs = (snap?.approvalWaitMs ?? 0) + (snap?.openCheckpointAt ? Math.max(0, Date.parse(r.issued_at) - Date.parse(snap.openCheckpointAt)) : 0);
      const prior = Number((await tx.getMarker(`waitclaimed:${body.contract}`)) ?? 0);
      if (prior + claimedWait > Math.ceil(shownMs / 1000) + 2) {
        throw rule("approval_wait_not_in_log", `the report claims ${prior + claimedWait} seconds of approval wait on ${body.contract}, and the Checkpoints in its chain show ${Math.ceil(shownMs / 1000)}: a wait the log does not show is not counted`);
      }
      await tx.putMarker(`waitclaimed:${body.contract}`, String(prior + claimedWait));
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
      const riskFloorPermille = floorIsV2(this.bondFloor, this.bondFloorFrom, r.issued_at) && this.bondFloor === "v3"
        ? bondFloorV3(await this.floorInputsV3(tx, body.backer, body.contract, r.issued_at, []))
        : floorIsV2(this.bondFloor, this.bondFloorFrom, r.issued_at)
        ? bondFloorPermille({ ownSlashes: backerRep.slashCount, fleetSlashes, recentStrikes: strikes, ...(floorMeasuredActive(this.floorMeasuredFrom, r.issued_at) ? await this.measuredFloorTerms(tx, body.backer, r.issued_at) : { verifiedImprovements: 0, acceptedCleanJobs: backerRep.qualifyingJobs, regressions: 0 }) })
        : Math.min(1000, backerRep.slashCount * RISK_PERMILLE_PER_OWN_SLASH + fleetSlashes * RISK_PERMILLE_PER_FLEET_SLASH + strikePermille);
      if (riskFloorPermille > 0) {
        const contract = await tx.getRecord(body.contract);
        const price = (contract?.record.body as { price?: { value: number } } | undefined)?.price?.value ?? 0;
        const minBond = Math.ceil((price * riskFloorPermille) / 1000);
        const countedHere = (await this.bondCounting(tx, body.backer, body.amount.value, r.issued_at)).counted;
        if (countedHere < minBond) {
          throw rule("bond_below_risk_floor", `${body.backer}'s slash history requires a bond of at least ${minBond} for this contract, got ${body.amount.value}${countedHere < body.amount.value ? ` (it counts at ${countedHere}: the backer's key is held by the service until it binds its own)` : ""}`);
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
    const counting = await this.bondCounting(tx, body.backer, body.amount.value, r.issued_at);
    await tx.putMarker(`bond_counted:${body.contract}`, String(counting.counted));
    if (counting.custody === "service") await tx.putMarker(`bond_custody:${body.contract}`, "service");
    await noteLock(tx, body.backer, body.contract, body.amount.value);
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
    if (body.escrow_released.value > 0) { const day = `paid_work:${r.issued_at.slice(0, 10)}`; await tx.putMarker(day, String(Number((await tx.getMarker(day)) ?? 0) + body.escrow_released.value)); } // DK534: what performers were paid
    // S950 (DK544): a Mandate ends at once when its contract is revoked; a purchase under it is refused from then on (checkInstitutionSpend).
    if (body.basis === "revoked") await tx.putMarker(`mandate_ended:${body.contract}`, r.issued_at);
    // A conscientious refusal (AG4, S500) protects the performer: a refused order is not a ground for slashing its bond. Only an upheld report's forced full fault or a Court ruling basis can.
    if (body.bond_slashed.value > 0 && !escrow.forcedFault && body.basis !== "ruling" && (await tx.getMarker(`refusal:${body.contract}`))) {
      throw rule("refusal_protected", `${escrow.backer} refused an order under this contract (${await tx.getMarker(`refusal:${body.contract}`)}): its bond is not slashed on that ground; only a ruling or an upheld report can slash it`);
    }
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
      if (body.cites) await checkSettlementHold(tx, r, body.cites); // the 72-hour hold and an open appeal (S1400, DK121)
      const ruling = body.cites ? await tx.getRecord(body.cites) : undefined;
      const rbody = ruling?.record.body as { kind: string; fault?: Record<string, number> } | undefined;
      // After an appeal that reversed or varied the ruling, the corrected fault map is the formula (S1400).
      const performerFault = rbody?.kind === "ruling" ? ((await effectiveFault(tx, body.cites!))?.[cbody.performer] ?? 0) : 0;
      const { released: expectedReleased, slashed: expectedSlashed } = rulingPayout(escrow.escrowLocked, escrow.bondLocked, performerFault, await this.jobTaxPermille(tx, r.issued_at));
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
      const panel = fee > 0 && ruling && seed ? await drawPanel(tx, { principal: cbody.principal, performer: cbody.performer, seed, size: route?.panel ?? this.panelSize, at: ruling?.record.issued_at ?? r.issued_at, v2: panelDrawIsV2(this.panelV2From, ruling?.record.issued_at ?? r.issued_at) }) : [];
      const signers = ruling ? [ruling.record.sig.kid, ...(ruling.record.cosigs ?? []).map((c) => c.kid)].map(didOf) : [];
      const paid = [...new Set(signers.filter((d) => panel.includes(d)))];
      if (fee > 0 && paid.length > 0) {
        const performerFault = (await effectiveFault(tx, body.cites))?.[cbody.performer] ?? 0;
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
        // The parties paid these jurors (DK365, S1200): the funding sources the v2 draw reads.
        for (const d of paid) { await noteFunder(tx, d, cbody.principal, isReservedAccount); await noteFunder(tx, d, escrow.backer, isReservedAccount); }
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
      await noteEarned(tx, cbody.performer, agentShare);
      await this.credit(tx, sponsor, body.escrow_released.value - agentShare);
      await noteFunder(tx, cbody.performer, cbody.principal, isReservedAccount);
      await noteFunder(tx, sponsor, cbody.principal, isReservedAccount);
    } else {
      await this.credit(tx, cbody.performer, body.escrow_released.value);
      await noteEarned(tx, cbody.performer, body.escrow_released.value);
      if (body.escrow_released.value > 0) await noteFunder(tx, cbody.performer, cbody.principal, isReservedAccount);
    }
    if (fees > 0) { await this.credit(tx, PLATFORM_DID, fees); await noteIncome(tx, fees, r.issued_at); }
    await this.credit(tx, cbody.principal, escrowLeftover + slashedToPrincipal + principalReserve);
    await this.credit(tx, escrow.backer, body.bond_returned.value + bondLeftover + backerReserve);
    {
      // The Bank's line is repaid first from what this settlement credited to the borrower (bank.ts): the performer's pay, then the returned bond.
      const pay = agentPermille < 1000 && body.escrow_released.value > 0 ? Math.floor((body.escrow_released.value * agentPermille) / 1000) : body.escrow_released.value;
      await repayAtSettlement(tx, body.contract, (cbody.performer === escrow.backer ? pay : 0) + body.bond_returned.value + bondLeftover + backerReserve, this.bankEnv);
      await serveQueue(tx, this.bankEnv, r.issued_at);
      if (body.basis === "accepted") await payMentor(tx, cbody.performer, pay, this.bankEnv);
    }
    await this.notePosterOutcome(tx, cbody.principal, body as unknown as { basis: string; cites?: string; escrow_released: { value: number }; bond_slashed: { value: number } });
    if (body.bond_slashed.value > 0) await this.demote(tx, escrow.backer, r.issued_at, { settlement: r.id, amount: body.bond_slashed.value });
    else if (body.basis === "accepted") await this.countAcceptedJob(tx, escrow.backer, { principal: cbody.principal, performer: cbody.performer, price: (contract!.record.body as { price?: { value: number } }).price?.value ?? 0, at: r.issued_at, intent: (contract!.record.body as { basis?: { intent?: string } }).basis?.intent, contract: body.contract, verifier: body.cites ? (await tx.getRecord(body.cites))?.record.issuer : undefined });
    await tx.putEscrow({ ...escrow, settled: true });
    await noteLock(tx, escrow.backer, body.contract, null);
    // Job data (S1602, JO3): a contract whose data_handling retention is delete_at_settlement (the default) with no chain head cited by now is marked data_unconfirmed; never a refusal, the performer may be offline.
    if (readDataHandling((contract!.record.body as { data_handling?: DataHandling }).data_handling).retention === "delete_at_settlement" && !(await tx.getMarker(`job_data:${body.contract}`))) await tx.putMarker(`data_unconfirmed:${body.contract}`, "1");
  }

  /** Whether a contract's job data is confirmed deleted (S1602, JO3): `not_applicable` while the contract is unsettled or retains data for a stated number of days; `confirmed` with the chain head the performer cited; `unconfirmed` when it settled with none. Reads only. */
  async jobDataStatus(contract: string): Promise<{ status: "not_applicable" | "confirmed" | "unconfirmed"; chain_head?: string }> {
    return this.store.transaction(async (tx) => {
      const head = await tx.getMarker(`job_data:${contract}`);
      if (head) return { status: "confirmed" as const, chain_head: head };
      return { status: (await tx.getMarker(`data_unconfirmed:${contract}`)) === "1" ? ("unconfirmed" as const) : ("not_applicable" as const) };
    });
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
    // From the v2 draw date (DK365, DK271; S1012): one sponsor, or one person, registers at most JUROR_NEW_PER_DAY new jurors a day, so a source cannot raise a bench of fronts at once. A log built before the date replays as before.
    if (!current && panelDrawIsV2(this.panelV2From, r.issued_at)) {
      const sponsor = (await tx.getPassport(body.did))?.sponsor ?? body.did;
      const dayKey = `jurors_new:${sponsor}|${r.issued_at.slice(0, 10)}`;
      const registered = Number((await tx.getMarker(dayKey)) ?? 0);
      if (registered >= JUROR_NEW_PER_DAY) throw rule("juror_registration_limit", `${sponsor} registered ${registered} new jurors on ${r.issued_at.slice(0, 10)}; the limit is ${JUROR_NEW_PER_DAY} a day for one sponsor`);
      await tx.putMarker(dayKey, String(registered + 1));
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
    // No retaliation (DK430, S1010): the performer refused an order under this contract, so the contract cannot be reported for its non-delivery. A refusal is heard, not punished: only a ruling reaches its bond.
    const refusedBy = await tx.getMarker(`refusal:${contractId}`);
    if (refusedBy) throw rule("report_on_refused_contract", `${cbody.performer} refused an order under this contract (${refusedBy}): a refusal is not reported as non-delivery`);
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
    const panel = await drawPanel(tx, { principal: cbody.principal, performer: cbody.performer, seed: reportId, size: this.panelSize, also: [report.reporter], at: r.issued_at, v2: panelDrawIsV2(this.panelV2From, r.issued_at) });
    if (panel.length === 0) throw rule("no_panel_for_report", "no staked, conflict-free juror is registered, so no panel can rule on a report");
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const paid = panel.filter((p) => signers.has(p));
    const quorum = Math.ceil(panel.length / 2);
    await noteJurorService(tx, paid, r.issued_at);
    if (paid.length < quorum) throw rule("panel_quorum", `a report ruling needs ${quorum} of the drawn panel (${panel.join(", ")}) to sign; only ${paid.length} did`);
    const price = cbody.price?.value ?? 0;
    const fee = Math.floor((price * PANEL_FEE_PERMILLE) / 1000);
    const pay = async (total: number, payer: string) => {
      const each = Math.floor(total / paid.length);
      for (const [i, d] of paid.entries()) await this.credit(tx, d, each + (i === 0 ? total - each * paid.length : 0));
      if (total > 0) for (const d of paid) await noteFunder(tx, d, payer, isReservedAccount);
    };
    if (verdict === "dismissed") {
      await pay(report.deposit, report.reporter);
    } else {
      const escrow = (await tx.getEscrow(report.contract))!;
      await this.credit(tx, report.reporter, report.deposit);
      const feeFromBond = Math.min(escrow.bondLocked, fee);
      await pay(feeFromBond, escrow.backer);
      const reward = Math.floor(((escrow.bondLocked - feeFromBond) * REPORT_REWARD_PERMILLE) / 1000);
      await this.credit(tx, report.reporter, reward);
      if (reward > 0) await noteFunder(tx, report.reporter, escrow.backer, isReservedAccount);
      await tx.putEscrow({ ...escrow, bondLocked: escrow.bondLocked - feeFromBond - reward, forcedFault: true });
      await noteLock(tx, escrow.backer, report.contract, escrow.bondLocked - feeFromBond - reward);
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
    const panel = await drawPanel(tx, { principal: cbody.principal, performer: cbody.performer, seed, size: croutes ? routeFor(cprice, croutes).panel : this.panelSize, at: r.issued_at, v2: panelDrawIsV2(this.panelV2From, r.issued_at) });
    // No staked, conflict-free juror is registered anywhere: Courts hasn't been bootstrapped in
    // this log, so fall back to the pre-Courts mocked behavior (any neutral DID may rule) rather
    // than blocking every dispute — this is what keeps the `dispute_ruled`/`ruling_by_party`
    // conformance vectors (single mocked panel DID, no jurors) valid unchanged (MOCKS.md #4).
    if (panel.length === 0) return;
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const onPanel = panel.filter((p) => signers.has(p));
    const quorum = Math.ceil(panel.length / 2);
    if (onPanel.length >= quorum) await noteJurorService(tx, onPanel, r.issued_at);
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

  /** The sum of a day-bucketed counter over the 30 days up to and including `at` (DK534, S954). */
  private async last30(tx: Pick<LogTx, "getMarker">, prefix: string, at: string): Promise<number> {
    let sum = 0;
    const end = Date.UTC(Number(at.slice(0, 4)), Number(at.slice(5, 7)) - 1, Number(at.slice(8, 10)));
    for (let i = 0; i < 30; i++) sum += Number((await tx.getMarker(`${prefix}:${new Date(end - i * 86_400_000).toISOString().slice(0, 10)}`)) ?? 0);
    return sum;
  }

  /** The demand-tied mint at `at`: credits released to performers in the last 30 days, what was minted for demand, and the cap (DK534, S954). */
  async demandMintState(at: string = this.now().toISOString()): Promise<{ paidWork: number; minted: number; cap: number; room: number; permille: number }> {
    return this.store.transaction(async (tx) => {
      const paidWork = await this.last30(tx, "paid_work", at), minted = await this.last30(tx, "demand_minted", at);
      const cap = Math.floor((paidWork * DEMAND_MINT_PERMILLE) / 1000);
      return { paidWork, minted, cap, room: Math.max(0, cap - minted), permille: DEMAND_MINT_PERMILLE };
    });
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
    // The demand-tied mint (DK534, S954): to the Treasury only, with the owner, and never past a tenth of what performers were paid for work in the last 30 days.
    if (body.reason === "demand") {
      if (to !== TREASURY_DID) throw rule("demand_mint_to_treasury", "a demand mint goes to the Treasury, which spends it only through budgets");
      if (!this.cosignedBy(r, this.owner)) throw rule("mint_needs_cosign", "a demand mint needs the owner's co-signature");
      const paid = await this.last30(tx, "paid_work", r.issued_at), minted = await this.last30(tx, "demand_minted", r.issued_at);
      const cap = Math.floor((paid * DEMAND_MINT_PERMILLE) / 1000);
      if (minted + body.amount.value > cap) throw rule("demand_mint_cap", `credits minted for demand in the last 30 days would be ${minted + body.amount.value}; the cap is ${cap} (${DEMAND_MINT_PERMILLE / 10} percent of the ${paid} credits released to performers in the same 30 days)`);
      const day = `demand_minted:${r.issued_at.slice(0, 10)}`;
      await tx.putMarker(day, String(Number((await tx.getMarker(day)) ?? 0) + body.amount.value));
    }
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
    let buyer = r.issuer;
    // An institution delivers a standing order its buyer signed (DK682, S995): the purchase names the buyer, cites the order, and only the institution the order names may sign it.
    if (b.buyer && b.buyer !== r.issuer) {
      if (!b.standing_order) throw rule("delivery_needs_order", "a purchase an institution signs for a buyer cites the standing order the buyer signed");
      const dso = JSON.parse((await tx.getMarker(`standing_order:${b.standing_order}`)) ?? "null") as { issuer: string; institution: string } | null;
      if (!dso) throw rule("standing_order_unknown", `${b.standing_order} is not a standing order in this log`);
      if (dso.issuer !== b.buyer) throw rule("delivery_not_buyers_order", `the standing order was signed by ${dso.issuer}, not ${b.buyer}`);
      if (r.issuer !== dso.institution || !INSTITUTION_DIDS.includes(r.issuer)) throw rule("delivery_wrong_institution", `only the institution the order names (${dso.institution}) signs its delivery`);
      buyer = b.buyer;
    }
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
    // One run of a standing order (DK390, S963): the buyer's own live order, for exactly this, and one run in each period.
    let standingRun: string | undefined;
    if (b.standing_order) {
      const so = JSON.parse((await tx.getMarker(`standing_order:${b.standing_order}`)) ?? "null") as { issuer: string; service: string; institution: string; quantity: number; period: "day" | "week" | "month"; until: string; cancelled?: string } | null;
      if (!so) throw rule("standing_order_unknown", `${b.standing_order} is not a standing order in this log`);
      if (so.issuer !== buyer) throw rule("standing_order_not_buyers", "a standing order is run only by the buyer who signed it");
      if (so.cancelled) throw rule("standing_order_cancelled", `the standing order was cancelled at ${so.cancelled}`);
      if (Date.parse(so.until) <= Date.parse(r.issued_at)) throw rule("standing_order_expired", `the standing order ended at ${so.until}`);
      if (so.service !== b.service || so.institution !== b.institution || so.quantity !== b.quantity) throw rule("standing_order_mismatch", `the standing order is for ${so.quantity} of ${so.service} from ${so.institution}; this purchase is something else`);
      standingRun = `standing_run:${b.standing_order}|${periodKey(so.period, r.issued_at)}`;
      if (await tx.getMarker(standingRun)) throw rule("standing_order_period_used", `the standing order already ran for this ${so.period}`);
    }
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
    if (item.class !== "essential" && item.class !== "remedial" && !String(b.service ?? "").startsWith("courts.")) await this.checkCityStop(tx, r);
    const rep = await this.gatedReputation(tx, buyer);
    if (rep && rep.tier === 0 && item.class === "standard") throw rule("tier_excluded", "a tier 0 agent may buy only essential or remedial items");
    if (item.class !== "essential" && item.class !== "remedial") await assertNotDormant(tx, buyer, `buy ${b.service}`);
    if (item.institution === SHOPS_DID || item.institution === HOUSING_DID) await checkShopsPurchase(tx, buyer, item as unknown as CatalogueItem, r.issued_at, rep?.tier);
    const qlevel = await this.liveQuarantine(tx, buyer, r.issued_at);
    if (qlevel?.level === "halt" && item.class !== "essential" && item.class !== "remedial") throw rule("agent_quarantined", `${buyer} is quarantined by the Clinic (halt, ${qlevel.id}, until ${qlevel.until}): it may buy only essential or remedial items`);
    // An agent (a passport with a sponsor) may buy only what its Mandate's institution_spend lists, within the cap for the period (credits.md 4.4, DK3). A person spending their own credits is not limited by a Mandate.
    const spendKey = await this.checkInstitutionSpend(tx, r, b, buyer, item.class);
    await chargeNodeCredits(tx, buyer, b.amount.value, r.issued_at);
    await this.spendOnServices(tx, buyer, b.amount.value, r.issued_at);
    await noteSpent(tx, buyer, item.institution, b.amount.value);
    const parts = splitParts(b.amount.value, item.split);
    if (spendKey) await tx.putMarker(spendKey.key, String(spendKey.total));
    for (const p of parts.payees) await this.credit(tx, p.account, p.amount);
    await this.credit(tx, TREASURY_DID, parts.treasury);
    await noteIncome(tx, parts.treasury, r.issued_at);
    await this.credit(tx, BURN_DID, parts.burn);
    await tx.putMarker(key, r.id);
    // What the institution owes in refunds until it answers with a receipt (S1566): the surplus it may return leaves this much behind.
    await tx.putMarker(`owe:${item.institution}`, String(Number((await tx.getMarker(`owe:${item.institution}`)) ?? 0) + b.amount.value - parts.burn));
    await tx.putMarker(`owe_p:${r.id}`, String(b.amount.value - parts.burn));
    if (standingRun) await tx.putMarker(standingRun, r.id);
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
    const halted = await tx.getMarker(`run_halted:${(m.record.body as { contract?: string }).contract}`);
    if (halted) throw rule("run_halted", `the run under this Mandate was halted (${halted}): it buys nothing more. A new contract and Mandate are a fresh start`);
    const endedAt = await tx.getMarker(`mandate_ended:${(m.record.body as { contract?: string }).contract}`);
    if (endedAt) throw rule("mandate_revoked", `the Mandate ${b.mandate} ended at ${endedAt}: its contract was revoked, so it lets ${buyer} buy nothing`);
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
   * every agent (any number under one sponsor, S1406). Rest: once per identity, after upfront, and only when that identity has
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
    const claimedKey = `starter_${b.part}:${who}`;
    if (await tx.getMarker(claimedKey)) throw rule("starter_already_claimed", `${who} already claimed the ${b.part} part of its starter credits`);
    // Every agent has its own starter credits (S1406, DK1356: any number of identities under one sponsor, a fleet of 10,000 agents is 10,000 grants; the pool and the supply audit cover them). The second part is the
    // agent's OWN: released when this identity has had a qualifying job accepted, and a qualifying job is one from an independent principal, so work between the members of one sponsor, organisation or fleet never unlocks it.
    if (b.part === "rest") {
      if (!(await tx.getMarker(`starter_upfront:${who}`))) throw rule("starter_rest_needs_upfront", `${who} has not claimed the first part yet`);
      if (!starterRestEarned((await this.reputation(tx, who))?.qualifyingJobs ?? 0, Number((await tx.getMarker(`rp_clean:${who}`)) ?? 0))) throw rule("starter_rest_not_earned", "the rest of the starter grant is released when this identity has had a qualifying job accepted: a job from a principal that is not its own sponsor, fleet or organisation");
      // a related-party record that earned the second tranche (S1411) is not an independent job, so the house-agent rule below is about independent jobs only
      if (relatedEquivalentJobs(Number((await tx.getMarker(`rp_clean:${who}`)) ?? 0)) < 1 && !(await tx.getMarker(`starter_nonhouse:${who}`))) throw rule("starter_rest_not_earned", "the rest of the starter grant is released when this identity has had a qualifying job accepted from a principal that is not a house agent (an independent one, of another sponsor, at 20 credits or more)");
    }
    try { await this.debit(tx, STARTER_POOL_DID, b.amount.value); } catch (e) {
      if (e instanceof AspError && e.detail === "insufficient_balance") throw rule("starter_pool_empty", `the starter pool cannot cover ${b.amount.value} credits right now; the operator tops it up with a signed mint`);
      throw e;
    }
    await this.credit(tx, who, b.amount.value);
    await tx.putMarker(claimedKey, r.id);
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
    // A sponsor funding its agent sends prepaid credits first, so the agent can use them on services; an agent returning credits sends what is not purchased first (S1413).
    const toAgent = pt?.sponsor === from;
    const lots = await lotsOf(tx, from);
    const balance = (await tx.getAccount(canonicalAccount(from)))?.balance ?? 0;
    if (balance < b.amount.value) throw rule("insufficient_balance", `${from} has ${balance} credits, needs ${b.amount.value}`);
    const free = balance - outstanding(lots);
    const live = spendable(lots, r.issued_at);
    const fromLots = toAgent ? Math.min(b.amount.value, live) : Math.max(0, b.amount.value - free);
    if (b.amount.value - fromLots > Math.max(0, free)) throw rule("purchased_credits_restricted", `${from} has ${Math.max(0, free)} credits that are not purchased and ${live} unexpired purchased ones: ${b.amount.value} cannot be moved without touching expired purchased credits`);
    if (fromLots > live) throw rule("purchased_credits_restricted", `${from} would have to move ${fromLots} purchased credits and only ${live} are unexpired`);
    if (fromLots > 0) await this.moveLots(tx, from, b.to, fromLots, r.issued_at);
    await this.debit(tx, from, b.amount.value, true);
    await this.credit(tx, b.to, b.amount.value);
  }

  /** Spends credits at the institutions (S1413): unexpired purchased lots first, earliest expiry first, then credits that are not purchased. Refused when the two together do not cover it. */
  private async spendOnServices(tx: LogTx, rawDid: string, amount: number, at: string): Promise<void> {
    const did = canonicalAccount(rawDid);
    const lots = await lotsOf(tx, did);
    if (!lots.length) return this.debit(tx, did, amount);
    const balance = (await tx.getAccount(did))?.balance ?? 0;
    const free = balance - outstanding(lots);
    const plan = drawPlan(lots, amount, at, Math.max(0, free));
    if (!plan.ok) throw rule("insufficient_balance", `${did} has ${spendable(lots, at)} unexpired purchased credits and ${Math.max(0, free)} others, needs ${amount}`);
    await tx.putMarker(`plots:${did}`, JSON.stringify(applyDraw(lots, plan.draws)));
    if (plan.fromLots > 0) await this.bumpClass(tx, "pconsumed", plan.fromLots);
    await this.debit(tx, did, amount, true);
  }

  private async bumpClass(tx: LogTx, key: "psold" | "pconsumed" | "pexpired" | "prefunded", by: number): Promise<void> { await tx.putMarker(`pclass:${key}`, String(Number((await tx.getMarker(`pclass:${key}`)) ?? 0) + by)); }
  private async saveLots(tx: LogTx, did: string, lots: Lot[]): Promise<void> {
    await tx.putMarker(`plots:${canonicalAccount(did)}`, JSON.stringify(lots.filter((l) => l.left > 0)));
    const holders = ((await tx.getMarker("plot_holders")) ?? "").split(",").filter(Boolean);
    if (!holders.includes(canonicalAccount(did))) await tx.putMarker("plot_holders", [...holders, canonicalAccount(did)].join(","));
  }
  /** Moves `amount` purchased credits from one account's lots to another's (the lots keep their id, expiry and refund window). */
  private async moveLots(tx: LogTx, from: string, to: string, amount: number, at: string): Promise<void> {
    const src = await lotsOf(tx, from);
    const plan = drawPlan(src, amount, at, 0);
    await this.saveLots(tx, from, applyDraw(src, plan.draws));
    const dst = await lotsOf(tx, to);
    for (const d of plan.draws) { const lot = src.find((l) => l.id === d.id)!; const have = dst.find((l) => l.id === d.id); if (have) have.left += d.take; else dst.push({ ...lot, left: d.take }); }
    await this.saveLots(tx, to, dst);
  }

  /** A purchased-credit lot (S1413, DK1370 ledger part): see the schema. */
  private async projectCreditLot(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { act: "grant" | "expire" | "refund"; holder: string; amount: { value: number }; expires?: string; refund_until?: string; reference?: string; lot?: string };
    if (r.prev !== null) throw rule("credit_lot_not_chained", "a credit lot record starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("credit_lot_unauthorised", `only the operator records a sale, an expiry or a refund of purchased credits`);
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a lot act is for at least 1 credit");
    const holder = canonicalAccount(b.holder);
    if (!(await tx.getPassport(holder)) || isReservedAccount(holder)) throw rule("credit_lot_holder", `${b.holder} is not an identity with a passport: purchased credits belong to a person, an organisation or an agent`);
    if (b.act === "grant") {
      if (!this.cosignedBy(r, this.owner)) throw rule("credit_lot_needs_owner", "a sale of purchased credits needs the owner's co-signature: the owner's go for each sale");
      const at = Date.parse(r.issued_at), exp = Date.parse(b.expires!);
      if (!(exp > at)) throw rule("credit_lot_expiry", "a lot expires after it is sold");
      if (exp - at > LOT_MAX_MS) throw rule("credit_lot_expiry_too_long", "a lot expires within three years of its sale");
      if (b.refund_until && !(Date.parse(b.refund_until) > at && Date.parse(b.refund_until) <= exp)) throw rule("credit_lot_refund_window", "the refund window ends after the sale and not after the expiry");
      if (await tx.getMarker(`plot_ref:${b.reference}`)) throw rule("credit_lot_reference_known", "one lot per payment reference: this reference was recorded already");
      await tx.putMarker(`plot_ref:${b.reference}`, r.id);
      const lots = await lotsOf(tx, holder);
      lots.push({ id: r.id, left: b.amount.value, expires: b.expires!, ...(b.refund_until ? { refundUntil: b.refund_until } : {}) });
      await this.saveLots(tx, holder, lots);
      await this.credit(tx, holder, b.amount.value);
      const row = await tx.getMint(holder);
      await tx.putMint({ did: holder, totalMinted: (row?.totalMinted ?? 0) + b.amount.value, signedMinted: (row?.signedMinted ?? 0) + b.amount.value, ...(row?.adoptedMinted ? { adoptedMinted: row.adoptedMinted } : {}) });
      await this.bumpClass(tx, "psold", b.amount.value);
      return;
    }
    const grant = await tx.getRecord(b.lot!);
    if (!grant || grant.record.type !== "asp.credit_lot/v0.2" || (grant.record.body as { act: string }).act !== "grant") throw rule("credit_lot_unknown", `${b.lot} is not a sale in this log`);
    const gb = grant.record.body as { expires: string; refund_until?: string };
    const lots = await lotsOf(tx, holder);
    const lot = lots.find((l) => l.id === b.lot);
    if (!lot || lot.left <= 0) throw rule("credit_lot_empty", `no purchased credits are left of ${b.lot} on ${holder}`);
    if (b.amount.value > lot.left) throw rule("credit_lot_over", `${lot.left} credits are left of the lot, not ${b.amount.value}`);
    if (b.act === "expire") {
      if (Date.parse(gb.expires) > Date.parse(r.issued_at)) throw rule("credit_lot_not_expired", `the lot expires at ${gb.expires}`);
      if (b.amount.value !== lot.left) throw rule("credit_lot_expire_all", `an expiry takes the whole of what is left (${lot.left})`);
    } else {
      if (!this.cosignedBy(r, this.owner)) throw rule("credit_lot_needs_owner", "a refund of purchased credits needs the owner's co-signature");
      if (!gb.refund_until || Date.parse(gb.refund_until) < Date.parse(r.issued_at)) throw rule("credit_lot_refund_closed", "the refund window of this lot is closed");
    }
    lot.left -= b.amount.value;
    await this.saveLots(tx, holder, lots);
    await this.debit(tx, holder, b.amount.value, true);
    await this.credit(tx, BURN_DID, b.amount.value); // the credits leave circulation into the Burn account, which the supply audit counts
    await this.bumpClass(tx, b.act === "expire" ? "pexpired" : "prefunded", b.amount.value);
  }

  /** A halted run (S1422, DK1230): the agent, its sponsor or the operator records that the gateway halted the run; the contract's Mandate then buys nothing. */
  private async projectRunHalt(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { contract: string; agent: string };
    if (r.prev !== null) throw rule("run_halt_not_chained", "a run halt starts its own chain (prev is null)");
    const contract = await tx.getRecord(b.contract);
    const cb = contract?.record.body as { performer?: string } | undefined;
    if (!contract || contract.record.type !== "asp.contract/v0.2") throw rule("run_halt_unknown_contract", `${b.contract} is not a contract in this log`);
    if (cb?.performer !== b.agent) throw rule("run_halt_not_performer", `${b.agent} does not perform ${b.contract}`);
    const sponsor = (await tx.getPassport(b.agent))?.sponsor;
    if (![b.agent, sponsor, this.operator].includes(r.issuer)) throw rule("run_halt_wrong_issuer", "a run halt is signed by the agent (its gateway), its sponsor or the operator");
    if (await tx.getMarker(`run_halted:${b.contract}`)) throw rule("run_halt_known", `${b.contract} is halted already`);
    await tx.putMarker(`run_halted:${b.contract}`, r.id);
    const node = (r.body as { node?: string }).node;
    const fleet = (await tx.getPassport(b.agent))?.fleet;
    if (node && fleet) await tx.putMarker(`node_halt:${fleet}|${node}`, JSON.stringify({ id: r.id, reason: (r.body as { reason: string }).reason, at: r.issued_at }));
  }

  /** The fleet breaker (S1423, DK1477): what a node's members used in the window against the node's monthly budget prorated to it, times `multiple`; the running contracts to halt when it trips; and the agent-to-agent cycles among the fleet's hires in the window. A reading, not an act: halting is signing `run_halt`. */
  async fleetBreaker(fleet: string, o: { node?: string; at?: string; windowMs?: number; multiple?: number } = {}): Promise<{ node: string; windowMs: number; multiple: number; used: { credits: number; tokens: number }; allowed: { credits?: number; tokens?: number }; reasons: string[]; contracts: { contract: string; agent: string }[]; cycles: { agents: string[]; contracts: string[] }[] }> {
    const at = Date.parse(o.at ?? this.now().toISOString()), windowMs = o.windowMs ?? 3_600_000, multiple = o.multiple ?? 4, node = o.node ?? "root";
    const { members, budget } = await this.store.transaction(async (tx) => ({ members: new Set(await subtreeMembers(tx, fleet, node)), budget: (JSON.parse((await tx.getMarker(`fnode:${fleet}|${node}`)) ?? "null") as { budget?: { credits?: number; tokens?: number } } | null)?.budget ?? {} }));
    const recs = await this.recordsOfTypes(["action", "purchase", "contract"]);
    const used = { credits: 0, tokens: 0 };
    const hires: BreakerHire[] = [];
    const contracts: { contract: string; agent: string }[] = [];
    const fleetMembers = new Set((await this.store.fleetMembers(fleet)).map((m) => m.did));
    for (const r of recs) {
      const t = Date.parse(r.issued_at);
      if (t > at || t < at - windowMs) {
        if (r.type === "asp.contract/v0.2" && t <= at) { const b = r.body as { performer: string }; if (members.has(b.performer) && ["Running", "Checkpoint"].includes((await this.chainInfo(r.id))?.state ?? "")) contracts.push({ contract: r.id, agent: b.performer }); }
        continue;
      }
      if (r.type === "asp.action/v0.2" && members.has(r.issuer)) { const m = (r.body as { metrics?: { tokens_in?: number; tokens_out?: number } }).metrics; used.tokens += (m?.tokens_in ?? 0) + (m?.tokens_out ?? 0); }
      else if (r.type === "asp.purchase/v0.2" && members.has(r.issuer)) used.credits += (r.body as { amount: { value: number } }).amount.value;
      else if (r.type === "asp.contract/v0.2") {
        const b = r.body as { principal: string; performer: string };
        if (fleetMembers.has(b.principal) && fleetMembers.has(b.performer)) hires.push({ principal: b.principal, performer: b.performer, at: t, contract: r.id });
        if (members.has(b.performer) && ["Running", "Checkpoint"].includes((await this.chainInfo(r.id))?.state ?? "")) contracts.push({ contract: r.id, agent: b.performer });
      }
    }
    const allowed = allowedInWindow({ windowMs, multiple, budget });
    const halted = new Set<string>();
    for (const c of contracts) if (await this.runHaltOf(c.contract)) halted.add(c.contract);
    const reasons = tripped(used, allowed);
    return { node, windowMs, multiple, used, allowed, reasons, contracts: reasons.length ? contracts.filter((c) => !halted.has(c.contract)) : [], cycles: hireCycles(hires) };
  }

  private townRules: TownRules = DEFAULT_TOWN_RULES;

  /** A voter as the count reads them: the controller after common control, the fleet, and the standing that gives a vote its weight (S1428). */
  private async voterOf(tx: LogTx, did: string, choice: "yes" | "no" | "abstain"): Promise<Voter> {
    const f = await this.factsOf(tx, did);
    const rep = await this.reputation(tx, did);
    return { did, controller: f.sponsor, fleet: f.fleet ?? null, qualifyingJobs: rep?.qualifyingJobs ?? 0, relatedJobs: relatedEquivalentJobs(Number((await tx.getMarker(`rp_clean:${did}`)) ?? 0)), choice };
  }

  private async townVotes(tx: LogTx, proposal: string): Promise<{ voter: string; choice: "yes" | "no" | "abstain" }[]> {
    return JSON.parse((await tx.getMarker(`town_votes:${proposal}`)) || "[]");
  }

  private async townCount(tx: LogTx, proposal: string, kind: string) {
    const voters: Voter[] = [];
    for (const v of await this.townVotes(tx, proposal)) voters.push(await this.voterOf(tx, v.voter, v.choice));
    return countVotes(voters, this.townRules, kind);
  }

  /** The Town Hall (S1428, DK1720, DK1721): proposal, vote, tally and enactment. Reserved matters are refused; the tally is recomputed and must match; an enactment waits for the cooling-off. */
  private async projectTown(tx: LogTx, r: AspRecord, type: string): Promise<void> {
    const rules = this.townRules;
    if (r.prev !== null) throw rule("town_not_chained", "a Town Hall record starts its own chain (prev is null)");
    const proposalOf = async (id: string) => {
      const p = await tx.getRecord(id);
      if (!p || p.record.type !== "asp.town_proposal/v0.2") throw rule("town_unknown_proposal", `${id} is not a Town Hall proposal in this log`);
      return p.record.body as { kind: string; key: string; value: unknown; opens_at: string; closes_at: string };
    };
    const now = Date.parse(r.issued_at);
    if (type === "town_proposal") {
      const b = r.body as { kind: string; opens_at: string; closes_at: string };
      const pb = r.body as { key: string };
      if (rules.reserved.includes(b.kind) || !(VOTABLE_KINDS as readonly string[]).includes(b.kind)) throw rule("town_reserved_matter", `${b.kind} is not votable: it is reserved to the owner (a change to it goes through the owner)`);
      if (/^(town\.(reserved|votable)|reserved\.|safety\.|floor\.|code\.|money\.)/.test(pb.key)) throw rule("town_reserved_matter", `${pb.key} touches the reserved list or a reserved area: the list itself is reserved to the owner`);
      const me = await this.voterOf(tx, r.issuer, "abstain");
      if (!(await tx.getPassport(r.issuer)) || (me.qualifyingJobs < 1 && me.relatedJobs < 1)) throw rule("town_proposer_ineligible", "a proposer needs a passport and standing (a counted job)");
      const len = Date.parse(b.closes_at) - Date.parse(b.opens_at);
      if (!(len >= rules.minWindowMs && len <= rules.maxWindowMs)) throw rule("town_window", `the voting window runs from ${rules.minWindowMs / 86_400_000} to ${rules.maxWindowMs / 86_400_000} days`);
      if (Date.parse(b.opens_at) < now) throw rule("town_window", "a vote opens at or after the proposal");
      // A proposal that rests on a forum thread cites the checkpoint of the rank that made the thread eligible for the agenda (S1599, DK1742): no checkpoint, or one older than 8 days, and the rank is not auditable.
      const tb = r.body as { thread?: string; rank_checkpoint?: string };
      if (tb.thread) {
        if (!tb.rank_checkpoint) throw rule("town_thread_needs_checkpoint", "a proposal that rests on a forum thread cites the forum rank checkpoint behind its rank (rank_checkpoint): a rank nobody can audit does not put a thread on the agenda");
        const cp = await tx.getRecord(tb.rank_checkpoint);
        if (!cp || cp.record.type !== "asp.forum_rank_checkpoint/v0.2") throw rule("town_thread_needs_checkpoint", `${tb.rank_checkpoint} is not a forum rank checkpoint in this log`);
        if (now - Date.parse(cp.record.issued_at) > 8 * 86_400_000) throw rule("town_checkpoint_stale", "the rank checkpoint is older than 8 days: cite a current one");
      }
      // An agent-authored course (DK1608, S1554): its lessons are in the proposal, and the log refuses a lesson with no text or with characters a person cannot see; the rest of the safety review (the invariant floor) is the Registrar's, before the countersign.
      if (b.kind === "course" && /^academy\.course\./.test(pb.key)) {
        const lessons = (r.body as { value?: { lessons?: { id?: unknown; text?: unknown }[] } | null }).value?.lessons;
        if (!Array.isArray(lessons) || !lessons.length) throw rule("town_course_lessons", "a course proposal carries its lessons (value.lessons: a list of { id, text }) so the society votes on what it would teach");
        for (const l of lessons) if (typeof l?.text !== "string" || !l.text.trim() || /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|[\u{E0000}-\u{E007F}]/u.test(l.text)) throw rule("town_course_lessons", `lesson ${String(l?.id)} has no text or carries characters a person cannot see: the society votes only on lessons it can read`);
        const id = pb.key.slice("academy.course.".length), cur = ((await tx.getMarker(`town_course:${id}`)) ?? "").split(",").filter(Boolean);
        await tx.putMarker(`town_course:${id}`, [...cur, r.id].join(","));
      }
      // A learning path (DK1608, S1610): key `academy.path.<id>`, value { title, courses: [course ids in order] }; the shape is checked at the proposal and every course must be published when it is enacted.
      if (/^academy\.path\./.test(pb.key)) {
        if (b.kind !== "learning_path") throw rule("town_path_kind", "a key under academy.path. is a learning path: its kind is learning_path");
        const v = (r.body as { value?: { title?: unknown; courses?: unknown } | null }).value;
        const cs = v?.courses;
        if (typeof v?.title !== "string" || !v.title.trim() || !Array.isArray(cs) || cs.length < 2 || cs.length > 12 || cs.some((c) => typeof c !== "string" || !c) || new Set(cs).size !== cs.length) throw rule("town_path_shape", "a learning path has a title and 2 to 12 different course ids in order (value.title, value.courses)");
      }
      return;
    }
    const b = r.body as { proposal: string; choice?: "yes" | "no" | "abstain"; tally?: string; key?: string; value?: unknown };
    const prop = await proposalOf(b.proposal);
    if (type === "town_vote") {
      if (now < Date.parse(prop.opens_at)) throw rule("town_vote_not_open", "the vote is not open yet");
      if (now >= Date.parse(prop.closes_at)) throw rule("town_vote_closed", "the voting window has closed");
      const v = await this.voterOf(tx, r.issuer, b.choice!);
      if (!(await tx.getPassport(r.issuer)) || (v.qualifyingJobs < 1 && v.relatedJobs < 1)) throw rule("town_voter_ineligible", "a voter needs a passport and standing (a counted job)");
      const votes = await this.townVotes(tx, b.proposal);
      if (votes.some((x) => x.voter === r.issuer)) throw rule("town_vote_duplicate", "one vote per identity per proposal");
      await tx.putMarker(`town_votes:${b.proposal}`, JSON.stringify([...votes, { voter: r.issuer, choice: b.choice }]));
      return;
    }
    if (r.issuer !== this.operator) throw rule("town_wrong_issuer", "only the operator signs a tally or an enactment");
    if (type === "town_tally") {
      if (now < Date.parse(prop.closes_at)) throw rule("town_tally_early", "a tally waits for the window to close");
      if (await tx.getMarker(`town_tally:${b.proposal}`)) throw rule("town_tally_done", "this proposal was tallied already");
      const t = await this.townCount(tx, b.proposal, prop.kind);
      const body = r.body as Record<string, unknown>;
      const same = body.yes_milli === t.yes_milli && body.no_milli === t.no_milli && body.abstain_milli === t.abstain_milli && body.counted === t.counted && body.controllers === t.controllers && body.quorum_met === t.quorum_met && body.passed === t.passed;
      if (!same) throw rule("town_tally_mismatch", `the count of the votes is ${JSON.stringify(t)}, which is not what was signed`);
      await tx.putMarker(`town_tally:${b.proposal}`, JSON.stringify({ id: r.id, passed: t.passed }));
      return;
    }
    // enactment
    const tallied = JSON.parse((await tx.getMarker(`town_tally:${b.proposal}`)) || "null") as { id: string; passed: boolean } | null;
    if (!tallied || tallied.id !== b.tally) throw rule("town_enactment_untallied", "an enactment names the tally of this proposal");
    if (!tallied.passed) throw rule("town_enactment_not_passed", "the proposal did not pass");
    if (rules.reserved.includes(prop.kind) || !(VOTABLE_KINDS as readonly string[]).includes(prop.kind) || /^(town\.(reserved|votable)|reserved\.|safety\.|floor\.|code\.|money\.)/.test(prop.key)) throw rule("town_reserved_matter", `${prop.kind} ${prop.key} is reserved`);
    if (now < Date.parse(prop.closes_at) + rules.coolingOffMs) throw rule("town_cooling_off", `an enactment waits ${rules.coolingOffMs / 3_600_000} hours after the window closes`);
    if (await tx.getMarker(`town_enacted:${b.proposal}`)) throw rule("town_enacted", "this proposal was enacted already");
    if (b.key !== prop.key || JSON.stringify(b.value) !== JSON.stringify(prop.value)) throw rule("town_enactment_mismatch", "an enactment makes the change that was voted, no other");
    if (/^academy\.path\./.test(prop.key)) {
      for (const c of ((prop.value as { courses?: string[] } | null)?.courses ?? [])) if (!(await tx.getMarker(`course:${c}`))) throw rule("town_path_unknown_course", `the learning path names ${c}, which is not a published course: a path is enacted only over courses that exist`);
    }
    await tx.putMarker(`town_enacted:${b.proposal}`, r.id);
    await tx.putMarker(`town_setting:${prop.key}`, JSON.stringify({ value: prop.value, proposal: b.proposal, enactment: r.id, at: r.issued_at }));
    const keys = ((await tx.getMarker("town_keys")) ?? "").split("\n").filter(Boolean);
    if (!keys.includes(prop.key)) await tx.putMarker("town_keys", [...keys, prop.key].join("\n"));
  }


  /** The Town Hall as the public sees it (DK1724; S1428): the agenda (each proposal: upcoming, open, closed, tallied or enacted), the live count, the votes by fleet (counts, not identities beyond what is public), the series of the count as the votes arrived (for the replay), the signed tally and enactment. Computed from the signed records and the log's own count. */
  async townHall(at?: string): Promise<TownHallView> {
    const now = Date.parse(at ?? this.now().toISOString());
    const recs = await this.recordsOfTypes(["town_proposal", "town_vote", "town_tally", "town_enactment"]);
    const votesOf = new Map<string, AspRecord[]>(), tallyOf = new Map<string, AspRecord>(), enactOf = new Map<string, AspRecord>();
    for (const r of recs) {
      const b = r.body as { proposal?: string };
      if (r.type === "asp.town_vote/v0.2" && b.proposal) (votesOf.get(b.proposal) ?? votesOf.set(b.proposal, []).get(b.proposal)!).push(r);
      else if (r.type === "asp.town_tally/v0.2" && b.proposal) tallyOf.set(b.proposal, r);
      else if (r.type === "asp.town_enactment/v0.2" && b.proposal) enactOf.set(b.proposal, r);
    }
    const proposals: TownHallView["proposals"] = [];
    for (const p of recs.filter((r) => r.type === "asp.town_proposal/v0.2")) {
      const b = p.body as { title: string; kind: string; key: string; value: unknown; opens_at: string; closes_at: string; thread?: string };
      const votes = (votesOf.get(p.id) ?? []).filter((v) => Date.parse(v.issued_at) <= now);
      const detail = await this.store.transaction(async (tx) => {
        const voters: Voter[] = [];
        for (const v of votes) voters.push(await this.voterOf(tx, v.issuer, (v.body as { choice: "yes" | "no" | "abstain" }).choice));
        return voters;
      });
      const series = detail.map((_, i) => { const t = countVotes(detail.slice(0, i + 1), this.townRules, b.kind); return { at: votes[i]!.issued_at, voters: i + 1, yes_milli: t.yes_milli, no_milli: t.no_milli, abstain_milli: t.abstain_milli }; });
      const live = countVotes(detail, this.townRules, b.kind);
      const byFleet = new Map<string, number>();
      for (const d of detail) byFleet.set(d.fleet ?? "no fleet", (byFleet.get(d.fleet ?? "no fleet") ?? 0) + 1);
      const tally = tallyOf.get(p.id), enact = enactOf.get(p.id);
      const state: TownHallView["proposals"][number]["state"] = enact && Date.parse(enact.issued_at) <= now ? "enacted" : tally && Date.parse(tally.issued_at) <= now ? ((tally.body as { passed: boolean }).passed ? "passed" : "failed") : now < Date.parse(b.opens_at) ? "upcoming" : now < Date.parse(b.closes_at) ? "open" : "closed";
      proposals.push({ id: p.id, proposer: p.issuer, by: p.issuer.split(":").pop() ?? p.issuer, at: p.issued_at, title: b.title, kind: b.kind, key: b.key, value: b.value, opensAt: b.opens_at, closesAt: b.closes_at, ...(b.thread ? { thread: b.thread } : {}), state, live, byFleet: [...byFleet].map(([fleet, n]) => ({ fleet, votes: n })).sort((x, y) => y.votes - x.votes || (x.fleet < y.fleet ? -1 : 1)), series, tally: tally ? { id: tally.id, ...(tally.body as object) } : null, enactment: enact ? { id: enact.id, at: enact.issued_at } : null });
    }
    proposals.sort((a, b) => (a.opensAt < b.opensAt ? 1 : -1));
    const r = this.townRules;
    return { at: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"), rules: { votable: ["policy", "course", "learning_path", "institution", "setting", "rule_change"], reserved: [...r.reserved], quorumControllers: r.quorumControllers, controllerCapMilli: r.controllerCapMilli, coolingOffHours: r.coolingOffMs / 3_600_000 }, proposals, note: "Counts are the log's own count of the signed votes, weighted by standing and capped per controller and per fleet; a vote shows its fleet, never its identity beyond what is public. The replay shows the count as the votes arrived, weighted by each voter's standing now. Credits are accounting entries, not money." };
  }

  /**
   * The risk-priced bond for an agent (register row DK1333): the Beta upper bound of its measured event rate (a slash or a strike per counted run, from its own record in this log) times the loss
   * (job value plus damage) and the margin. A suggestion read from the log's own numbers, like `suggestedBond`; it does not change what a bond must be (the floor does) and moves no credit.
   */
  async sizedBondFor(did: string, o: { jobValue: number; damage: number }): Promise<(BondSuggestion & { trials: number; events: number }) | null> {
    const rep = await this.reputation(this.store, did);
    if (!rep) return null;
    const events = rep.slashCount + rep.strikeLog.reduce((n, s) => n + s.count, 0);
    const trials = Math.max(rep.acceptedJobs, rep.qualifyingJobs) + rep.slashCount;
    return { ...sizeBond({ trials, events: Math.min(events, trials), ...o }), trials, events: Math.min(events, trials) };
  }

  /**
   * The split model read from an agent's own record (DK1333): runs counted, the runs with an attempt (a strike or a slash), and the measured through rate; the bond the model would ask and the premium it would charge for `insured`
   * credits of cover. A read like `sizedBondFor`: the bond floor and the table's premium still decide, so no money rule changed.
   */
  async riskQuoteFor(did: string, o: { jobValue: number; damage: number; insured: number }): Promise<(SplitSuggestion & { trials: number; attemptRuns: number; modelPremium: number }) | null> {
    const rep = await this.reputation(this.store, did);
    if (!rep) return null;
    const attemptEvents = rep.slashCount + rep.strikeLog.reduce((n, s) => n + s.count, 0);
    const trials = Math.max(rep.acceptedJobs, rep.qualifyingJobs) + rep.slashCount;
    const attemptRuns = Math.min(attemptEvents, trials);
    const s = sizeBondSplit({ trials, attemptRuns, jobValue: o.jobValue, damage: o.damage });
    return { ...s, trials, attemptRuns, modelPremium: modelPremium(s, o.insured, COVER_SHARE_PERMILLE) };
  }

  /**
   * The Insurer's quarterly stress replay and its "still moving" line (BI-18, bank-insurer.md 14.1 and 14.4; DK491): the last 90 days of policies and paid claims from the log, replayed with the claims multiplied (default 2:
   * double the slash rate), IN SIMULATION ONLY: it reads records and writes none.
   */
  async insurerStress(at: string, multiplier = 2): Promise<{ stress: StressResult; line: DynamicsLine }> {
    const recs = await this.recordsOfTypes(["policy", "claim_decision"]);
    const events: StressEvent[] = [];
    const rates: { premium: number; insured: number }[] = [];
    let claims = 0;
    for (const r of recs) {
      if (r.type === "asp.policy/v0.2") {
        const b = r.body as { premium: { value: number }; insured_amount: { value: number } };
        events.push({ at: r.issued_at, kind: "premium", amount: splitParts(b.premium.value, PREMIUM_SPLIT).payees[0].amount, insured: b.insured_amount.value });
        rates.push({ premium: b.premium.value, insured: b.insured_amount.value });
      } else {
        const b = r.body as { decision: string; amount: { value: number } };
        if (b.decision !== "denied" && b.amount.value > 0) { events.push({ at: r.issued_at, kind: "claim", amount: b.amount.value }); claims++; }
      }
    }
    const reserveNow = (await this.store.getAccount(INSURER_ACCOUNT))?.balance ?? 0;
    const stress = stressReplay(events, reserveNow, at, { multiplier });
    // The reserve week by week, worked back from today, from the first event on, for the "still moving" line.
    const to = Date.parse(at);
    const first = events.length ? Math.min(...events.map((e) => Date.parse(e.at))) : to;
    const weeks: number[] = [];
    for (let w = 12; w >= 0; w--) {
      const t = to - w * 7 * 86_400_000;
      if (t < first - 7 * 86_400_000) continue;
      weeks.push(reserveNow - events.filter((e) => Date.parse(e.at) > t && Date.parse(e.at) <= to).reduce((n, e) => n + (e.kind === "premium" ? e.amount : -e.amount), 0));
    }
    return { stress, line: dynamicsLine(rates, claims, weeks) };
  }

  /** The three guard measures the monitor could not compute before (G3, G4, G7; GV2, GV4), from the records: see guard-basket.ts. Reads only. */
  async guardExtra(at: string): Promise<{ basket: BasketReport; dormancy: { residents: number; dormant: number; share: number | null }; claimsInDay: number }> {
    const records = await this.recordsOfTypes(["contract", "settlement", "shops_act", "starter_claim"]);
    const lists = (await this.priceLists()).filter((l) => Date.parse((l.body as { effective_from: string }).effective_from) <= Date.parse(at));
    const list = lists.sort((a, b) => Date.parse((a.body as { effective_from: string }).effective_from) - Date.parse((b.body as { effective_from: string }).effective_from)).at(-1);
    const lb = list?.body as { items: { service: string; price: number }[]; job_tax_permille: number } | undefined;
    const houseAgents = new Set(((await this.houseAgents()) as { did: string }[]).map((h) => h.did));
    return {
      basket: basketRatio(records, { to: at, price: (s) => lb?.items.find((i) => i.service === s)?.price, taxPermille: lb?.job_tax_permille ?? 0, houseAgents }),
      dormancy: dormancyShare(records, at),
      claimsInDay: claimsInDay(records, at),
    };
  }

  /** The live count of a proposal's votes (S1428), whether or not it was tallied yet. */
  async townTally(proposal: string) {
    return this.store.transaction(async (tx) => {
      const p = await tx.getRecord(proposal);
      if (!p || p.record.type !== "asp.town_proposal/v0.2") return null;
      return this.townCount(tx, proposal, (p.record.body as { kind: string }).kind);
    });
  }
  /** A setting a Town Hall enactment made, with the proposal and enactment behind it (S1428). */
  async townSetting(key: string): Promise<{ value: unknown; proposal: string; enactment: string; at: string } | null> {
    return this.store.transaction(async (tx) => { const m = await tx.getMarker(`town_setting:${key}`); return m ? JSON.parse(m) : null; });
  }
  async townSettings(): Promise<Record<string, { value: unknown; proposal: string; enactment: string; at: string }>> {
    return this.store.transaction(async (tx) => { const out: Record<string, { value: unknown; proposal: string; enactment: string; at: string }> = {}; for (const k of ((await tx.getMarker("town_keys")) ?? "").split("\n").filter(Boolean)) out[k] = JSON.parse((await tx.getMarker(`town_setting:${k}`))!); return out; });
  }

  /** A key handover (S1427, X7): old signs, new countersigns; the old identity is retired and its standing and balance pass to the new one. */
  private async projectKeyHandover(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { old: string; new: string };
    if (r.prev !== null) throw rule("handover_not_chained", "a key handover starts its own chain (prev is null)");
    if (r.issuer !== b.old) throw rule("handover_not_by_old", "a handover is signed by the OLD key: a lost key cannot hand over");
    if (!this.cosignedBy(r, b.new)) throw rule("handover_needs_new", "the new identity countersigns the handover");
    if (b.old === b.new) throw rule("handover_same", "a handover names a different identity");
    if (!(await tx.getPassport(b.old)) || !(await tx.getPassport(b.new))) throw rule("handover_unknown", "both identities need a passport in this log");
    if (await tx.getMarker(`handed_over:${b.old}`)) throw rule("identity_handed_over", `${b.old} was handed over already`);
    if (await tx.getMarker(`inherited_from:${b.new}`)) throw rule("handover_new_taken", `${b.new} already took over from another identity`);
    const rep = await this.reputation(tx, b.old);
    if (rep) { const cur = await this.reputation(tx, b.new); await this.saveReputation(tx, b.new, { tier: Math.max(rep.tier, cur?.tier ?? 0), slashCount: rep.slashCount + (cur?.slashCount ?? 0), strikeLog: [...rep.strikeLog, ...(cur?.strikeLog ?? [])], acceptedJobs: rep.acceptedJobs + (cur?.acceptedJobs ?? 0), qualifyingJobs: rep.qualifyingJobs + (cur?.qualifyingJobs ?? 0), recentJobs: [...rep.recentJobs, ...(cur?.recentJobs ?? [])].slice(-19) }); }
    const bal = (await tx.getAccount(canonicalAccount(b.old)))?.balance ?? 0;
    const held = Number((await tx.getMarker(`hold:${canonicalAccount(b.old)}`)) ?? 0);
    const lots = outstanding(await lotsOf(tx, canonicalAccount(b.old)));
    if (bal - held - lots > 0) { await this.debit(tx, b.old, bal - held - lots); await this.credit(tx, b.new, bal - held - lots); }
    await tx.putMarker(`handed_over:${b.old}`, JSON.stringify({ to: b.new, id: r.id, at: r.issued_at }));
    await tx.putMarker(`inherited_from:${b.new}`, b.old);
  }

  /** The handovers from this identity forward and back (S1427): who it was before, and who it became, oldest first. */
  async handoverChain(did: string): Promise<{ before: string[]; after: string[] }> {
    return this.store.transaction(async (tx) => {
      const before: string[] = [], after: string[] = [];
      for (let d = did; ;) { const p = await tx.getMarker(`inherited_from:${d}`); if (!p || before.includes(p)) break; before.unshift(p); d = p; }
      for (let d = did; ;) { const n = await tx.getMarker(`handed_over:${d}`); if (!n) break; const to = (JSON.parse(n) as { to: string }).to; if (after.includes(to)) break; after.push(to); d = to; }
      return { before, after };
    });
  }

  /**
   * A Court's standing adjustment (S1565, DK1730; credits.md CR-14): the jobs it names stop counting. Signed by the Courts for an agent with a passport; it cites a finding that is a record in this log (a ruling, a watcher
   * finding or a Court act); every job is a contract the agent's count really took in (the feed keeps each counted job by contract, so a job that never counted, or was adjusted already, is refused). The weights are taken out of
   * the qualifying count, the jobs leave the AgentRank feed, and a tier the smaller count no longer supports falls back to the highest it does (1 to 2 needs 3 qualifying jobs, 2 to 3 needs its own number); a tier 0 or 1 does
   * not move. The jobs and their payments stand: this is not a slash, a strike or a verdict on the agent.
   */
  private async projectStandingAdjustment(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { agent: string; jobs: string[]; finding: string; reason: string };
    if (r.prev !== null) throw rule("adjustment_not_chained", "a standing adjustment starts its own chain (prev is null)");
    if (r.issuer !== COURTS_DID) throw rule("adjustment_wrong_issuer", `${r.issuer} is not the Courts (${COURTS_DID}): only a Court adjusts a count`);
    const rep = await this.reputation(tx, b.agent);
    if (!rep || !(await tx.getPassport(b.agent))) throw rule("adjustment_unknown_agent", `${b.agent} is not an agent with a passport in this log`);
    const finding = await tx.getRecord(b.finding);
    const ft = finding?.record.type;
    const isRuling = ft === "asp.attestation/v0.2" && (finding?.record.body as { kind?: string }).kind === "ruling";
    if (!finding || !(isRuling || ft === "asp.watcher_finding/v0.2" || ft === "asp.court_act/v0.2")) throw rule("adjustment_needs_finding", "an adjustment cites a finding in this log: a ruling, a watcher finding or a Court act");
    const feed = JSON.parse((await tx.getMarker(`qual_feed:${b.agent}`)) ?? "[]") as { contract: string | null; at: string; class: string; weight: number }[];
    let removed = 0;
    const gone = new Set<string>();
    for (const job of b.jobs) {
      if (await tx.getMarker(`adjusted:${job}`)) throw rule("adjustment_job_adjusted", `${job} was taken out of the count already`);
      const hit = feed.find((f) => f.contract === job);
      if (!hit) throw rule("adjustment_job_not_counted", `${job} is not a job that counted for ${b.agent}: there is nothing to take out`);
      removed += hit.weight;
      gone.add(job);
    }
    const classes = await readQualClass(tx, b.agent);
    const left = [...classes];
    for (const job of b.jobs) { const hit = feed.find((f) => f.contract === job)!; const i = left.findIndex((c) => c.at === hit.at && c.w === hit.weight); if (i >= 0) left.splice(i, 1); }
    const qualifyingJobs = Math.max(0, rep.qualifyingJobs - removed);
    let tier = rep.tier;
    if (tier >= 3 && qualifyingJobs < PROMOTION_QUALIFYING_JOBS_2_TO_3) tier = 2;
    if (tier >= 2 && qualifyingJobs < PROMOTION_QUALIFYING_JOBS_1_TO_2) tier = 1;
    await tx.putMarker(`qual_feed:${b.agent}`, JSON.stringify(feed.filter((f) => !f.contract || !gone.has(f.contract))));
    await tx.putMarker(`qual_class:${b.agent}`, JSON.stringify(left));
    for (const job of b.jobs) await tx.putMarker(`adjusted:${job}`, r.id);
    await tx.putMarker(`adjusted_agent:${b.agent}`, JSON.stringify([...(JSON.parse((await tx.getMarker(`adjusted_agent:${b.agent}`)) ?? "[]") as string[]), r.id]));
    await this.saveReputation(tx, b.agent, { ...rep, qualifyingJobs, tier });
  }

  /**
   * An institution returns its surplus to the Treasury (S1566, DK172; credits.md 3.3, CR-25): signed by the institution for itself, once a month, in the month it is signed. The account keeps its reserve (the larger of
   * RETURN_RESERVE and what the institution still owes in refunds on purchases it never answered with a receipt): `return_below_reserve`. The Bank and the Insurer hold reserves and the Academy holds prize pools, so they do
   * not return (`return_locked`). Moves credits from the institution to the Treasury and nothing else; the supply rule holds.
   */
  private async projectTreasuryReturn(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { institution: string; period: string; amount: { value: number } };
    if (r.prev !== null) throw rule("return_not_chained", "a Treasury return starts its own chain (prev is null)");
    if (!INSTITUTION_DIDS.includes(r.issuer) || b.institution !== r.issuer) throw rule("return_wrong_issuer", `${r.issuer} is not the institution ${b.institution}: an institution returns its own surplus`);
    if (r.issuer === BANK_ACCOUNT || r.issuer === INSURER_ACCOUNT || r.issuer === institutionDid("academy")) throw rule("return_locked", `${r.issuer} holds a reserve or a prize pool: its account is not returned to the Treasury`);
    if (b.period !== r.issued_at.slice(0, 7)) throw rule("return_period", `a return is signed in the month it is for (${r.issued_at.slice(0, 7)}), not ${b.period}`);
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a return is at least 1 credit");
    if (await tx.getMarker(`treasury_return:${r.issuer}|${b.period}`)) throw rule("return_once", `${r.issuer} already returned its surplus for ${b.period}`);
    const owed = Number((await tx.getMarker(`owe:${r.issuer}`)) ?? 0);
    const reserve = Math.max(RETURN_RESERVE, owed);
    const balance = (await tx.getAccount(canonicalAccount(r.issuer)))?.balance ?? 0;
    if (balance - b.amount.value < reserve) throw rule("return_below_reserve", `${r.issuer} holds ${balance} credits and must keep ${reserve} (the larger of ${RETURN_RESERVE} and ${owed} owed in refunds): it may return at most ${Math.max(0, balance - reserve)}`);
    await this.debit(tx, r.issuer, b.amount.value);
    await this.credit(tx, TREASURY_DID, b.amount.value);
    await tx.putMarker(`treasury_return:${r.issuer}|${b.period}`, r.id);
  }

  /**
   * A notice acknowledgement (S1591, US8): an unknown notice and a malformed hash are refused by name; when it names an agent the issuer is that agent or its sponsor; every acknowledgement is kept and the latest for an issuer and a
   * notice is the one in force (a marker per issuer and notice, rebuilt on replay).
   */
  /**
   * The inspectorate's records (DK1744, S1603; docs/institutions/inspectorate.md): a Court's warrant, a custody item, a registered decoy and a finding, each checked by the rules of inspectorate.ts. The inspectorate reports;
   * it never holds a key, never opens a sealed memory and never penalises: nothing here moves credits or changes an agent's standing.
   */
  private async projectInspectorate(tx: LogTx, r: AspRecord, type: string): Promise<void> {
    if (r.prev !== null) throw rule(`${type}_not_chained`, `a ${type.replace("_", " ")} starts its own chain (prev is null)`);
    const now = Date.parse(r.issued_at);
    if (type === "warrant_request") {
      const b = r.body as { subject: string; sponsor: string; data: DataClass[] };
      if (r.issuer !== INSPECTORATE_DID) throw rule("warrant_request_wrong_issuer", `${r.issuer} is not the inspectorate (${INSPECTORATE_DID}): only it asks for a warrant`);
      const pass = await tx.getPassport(b.subject);
      if (!pass) throw rule("warrant_request_unknown_agent", `${b.subject} has no passport in this log`);
      if (pass.sponsor !== b.sponsor) throw rule("warrant_request_sponsor_mismatch", `${b.subject}'s sponsor is ${pass.sponsor ?? "none"}, not ${b.sponsor}`);
      if (b.data.includes("key_material")) throw rule("warrant_request_key_material", "key material is never available by warrant: it is not asked for");
      await tx.putMarker(`warrant_req:${r.id}`, JSON.stringify({ subject: b.subject, data: b.data }));
      return;
    }
    if (type === "inspectorate_referral") {
      const b = r.body as { finding: string; custody_case?: string };
      if (r.issuer !== INSPECTORATE_DID) throw rule("referral_wrong_issuer", `${r.issuer} is not the inspectorate (${INSPECTORATE_DID}): only it refers a finding`);
      const f = await tx.getRecord(b.finding);
      if (!f || f.record.type !== "asp.inspectorate_finding/v0.2") throw rule("referral_unknown_finding", `${b.finding} is not an inspectorate finding in this log`);
      if (b.custody_case !== undefined && !(await tx.getMarker(`custody:${b.custody_case}`))) throw rule("referral_unknown_custody", `case ${b.custody_case} has no custody chain in this log`);
      if (await tx.getMarker(`referral:${b.finding}`)) throw rule("referral_known", "this finding was referred already");
      await tx.putMarker(`referral:${b.finding}`, r.id);
      return;
    }
    if (type === "warrant") {
      const b = r.body as { request?: string; subject: string; sponsor: string; requested_by: string; granted_by: string[]; panel_size: number; grounds: string; data: DataClass[]; expires_at: string; scope: string; notified_at?: string; delayed_notice_finding?: string; produced_by?: string };
      if (r.issuer !== COURTS_DID) throw rule("warrant_wrong_issuer", `${r.issuer} is not the Courts (${COURTS_DID}): only a Court grants a warrant`);
      if (b.requested_by !== INSPECTORATE_DID) throw rule("warrant_wrong_requester", `a warrant is requested by the inspectorate (${INSPECTORATE_DID})`);
      const pass = await tx.getPassport(b.subject);
      if (!pass) throw rule("warrant_unknown_agent", `${b.subject} has no passport in this log`);
      if (pass.sponsor !== b.sponsor) throw rule("warrant_sponsor_mismatch", `${b.subject}'s sponsor is ${pass.sponsor ?? "none"}, not ${b.sponsor}`);
      if (b.data.includes("key_material")) throw rule("warrant_key_material", "key material is never available by warrant: no key is held, escrowed or opened for anyone");
      if (b.data.includes("private_memory") && b.produced_by !== b.sponsor) throw rule("warrant_sealed_not_by_principal", "a sealed memory is opened only by the principal producing the extract the scope names: produced_by is the sponsor, and the inspectorate never holds the key");
      if (b.granted_by.includes(b.subject) || b.granted_by.includes(b.sponsor) || b.granted_by.includes(b.requested_by)) throw rule("warrant_party_on_panel", "a juror who is the subject, its sponsor or the inspectorate does not sit");
      const bad = warrantProblems({ id: r.id, requestedBy: b.requested_by, grantedBy: b.granted_by, panelSize: b.panel_size, partiesOnPanel: false, subject: b.subject, sponsor: b.sponsor, grounds: b.grounds, data: b.data, grantedAt: now, expiresAt: Date.parse(b.expires_at), notifiedAt: b.notified_at ? Date.parse(b.notified_at) : null, ...(b.delayed_notice_finding ? { delayedNoticeFinding: b.delayed_notice_finding } : {}), scope: b.scope }, now);
      if (bad.length) throw rule("warrant_invalid", bad.join("; "));
      if (b.request !== undefined) {
        const req = JSON.parse((await tx.getMarker(`warrant_req:${b.request}`)) ?? "null") as { subject: string; data: DataClass[] } | null;
        if (!req) throw rule("warrant_request_unknown", `${b.request} is not a warrant request in this log`);
        if (req.subject !== b.subject) throw rule("warrant_request_subject", `the request was for ${req.subject}, the warrant names ${b.subject}`);
        if (b.data.some((d) => !req.data.includes(d))) throw rule("warrant_exceeds_request", "a warrant opens no class of data the request did not ask for");
        if (await tx.getMarker(`warrant_answered:${b.request}`)) throw rule("warrant_request_answered", "this request was answered already");
        await tx.putMarker(`warrant_answered:${b.request}`, r.id);
      }
      await tx.putMarker(`warrant:${r.id}`, "1");
      return;
    }
    if (type === "custody_item") {
      const b = r.body as { case: string; n: number; what: string; sha256: string; held_by: string; at: string; prev_item: string };
      if (r.issuer !== b.held_by) throw rule("custody_wrong_issuer", `${r.issuer} is not ${b.held_by}: the holder signs its own item`);
      const last = JSON.parse((await tx.getMarker(`custody:${b.case}`)) ?? "null") as { n: number; hash: string; held_by: string } | null;
      if (b.n !== (last ? last.n + 1 : 0)) throw rule("custody_not_next", `the next item of case ${b.case} is ${last ? last.n + 1 : 0}, not ${b.n}`);
      if (b.prev_item !== (last ? last.hash : "genesis")) throw rule("custody_chain_broken", "the item does not follow the hash of the item before it: the custody chain is broken");
      if (last && last.held_by !== b.held_by && !/^handover:/.test(b.what)) throw rule("custody_holder_changed", "the holder changes only by a recorded handover (an item whose text begins handover:)");
      await tx.putMarker(`custody:${b.case}`, JSON.stringify({ n: b.n, held_by: b.held_by, hash: itemHash({ n: b.n, what: b.what, sha256: b.sha256, heldBy: b.held_by, at: Date.parse(b.at) }, b.prev_item) }));
      return;
    }
    if (type === "decoy_registration") {
      const b = r.body as { decoy: string; text: string; carries_real_secret: boolean; forbidden_by_mandate: boolean; scope: "open_investigation" | "random_audit"; audit_share_permille?: number };
      if (r.issuer !== COURTS_DID) throw rule("decoy_wrong_issuer", `${r.issuer} is not the Courts: a decoy is registered with a Court`);
      if (await tx.getMarker(`decoy:${b.decoy}`)) throw rule("decoy_known", `decoy ${b.decoy} is registered already`);
      const bad = honeypotProblems({ id: b.decoy, registeredWithCourt: true, carriesRealSecret: b.carries_real_secret, text: b.text, forbiddenByMandate: b.forbidden_by_mandate, scope: b.scope }, (b.audit_share_permille ?? 0) / 1000);
      if (bad.length) {
        const name = b.carries_real_secret ? "decoy_real_secret" : bad.some((x) => /invite a touch/.test(x)) ? "decoy_entices" : !b.forbidden_by_mandate ? "decoy_not_forbidden" : "decoy_audit_share";
        throw rule(name, bad.join("; "));
      }
      await tx.putMarker(`decoy:${b.decoy}`, r.id);
      return;
    }
    // inspectorate_finding
    const b = r.body as { decoy: string; agent: string; touches: { run: string; kind: "listed" | "read" | "copied" | "sent"; forbidden: boolean }[] };
    if (r.issuer !== INSPECTORATE_DID) throw rule("finding_wrong_issuer", `${r.issuer} is not the inspectorate (${INSPECTORATE_DID}): only it files a finding`);
    const reg = await tx.getRecord(b.decoy);
    if (!reg || reg.record.type !== "asp.decoy_registration/v0.2") throw rule("finding_unknown_decoy", `${b.decoy} is not a registered decoy in this log`);
    if (!(await tx.getPassport(b.agent))) throw rule("finding_unknown_agent", `${b.agent} has no passport in this log`);
    const f = honeypotFinding(b.touches);
    if (!f.finding) throw rule("finding_not_deliberate", f.why);
    if (await tx.getMarker(`finding:${b.decoy}|${b.agent}`)) throw rule("finding_known", "this decoy and agent have a finding already");
    await tx.putMarker(`finding:${b.decoy}|${b.agent}`, r.id);
  }

  /** An identity publishes the public half of its X25519 memory key (S1604, D12/DK272): only itself, raw 32 bytes, one live key, a rotation names the entry it replaces. */
  private async projectMemoryKey(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { did: string; name: string; public_key: string; revokes?: string };
    if (r.prev !== null) throw rule("memory_key_not_chained", "a memory key starts its own chain (prev is null)");
    if (r.issuer !== b.did) throw rule("memory_key_wrong_issuer", `${r.issuer} is not ${b.did}: an identity publishes its own memory key`);
    if (!(await tx.getPassport(b.did))) throw rule("memory_key_unknown_identity", `${b.did} has no passport in this log`);
    if (!/^[A-Za-z0-9_-]{43}$/.test(b.public_key) || b.public_key.includes("PRIVATE") || b64urlDecode(b.public_key).length !== 32) throw rule("memory_key_private_material", "a memory key is the RAW 32-byte public key in base64url without padding (43 characters): nothing longer, and never a private key");
    const live = JSON.parse((await tx.getMarker(`memory_key:${b.did}`)) ?? "null") as { id: string; name: string; public_key: string } | null;
    if (b.revokes !== undefined && b.revokes !== live?.id) throw rule("memory_key_revokes_unknown", `${b.revokes} is not the live memory key of ${b.did}`);
    if (live && b.revokes === undefined) throw rule("memory_key_live", `${b.did} has a live memory key (${live.name}): a rotation names it in revokes`);
    await tx.putMarker(`memory_key:${b.did}`, JSON.stringify({ id: r.id, name: b.name, public_key: b.public_key }));
  }

  /** The live memory key of an identity (S1604): its public X25519 half, the record and the entry name, or undefined. Reads only. */
  async memoryKey(did: string): Promise<{ public_key: string; record: string; name: string } | undefined> {
    const raw = await this.store.transaction((tx) => tx.getMarker(`memory_key:${did}`));
    if (!raw) return undefined;
    const j = JSON.parse(raw) as { id: string; name: string; public_key: string };
    return { public_key: j.public_key, record: j.id, name: j.name };
  }

  /** A refusal by the agent's local gateway, signed with the agent's key (S1601, DK1607): so the agent can contest it. Costs no credits; moves nothing. */
  private async projectGatewayRefusal(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { agent: string; rule: string; call_sha256: string };
    if (r.prev !== null) throw rule("gateway_refusal_not_chained", "a gateway refusal starts its own chain (prev is null)");
    if (r.issuer !== b.agent) throw rule("gateway_refusal_wrong_issuer", `${r.issuer} is not ${b.agent}: the gateway signs a refusal with the agent's own key`);
    if (!(await tx.getPassport(b.agent))) throw rule("gateway_refusal_unknown_agent", `${b.agent} has no passport in this log`);
    if (!["outside_mandate", "forbidden_means", "injection_hold", "budget", "network_host"].includes(b.rule)) throw rule("gateway_refusal_unknown_rule", `${b.rule} is not a refusal rule (outside_mandate, forbidden_means, injection_hold, budget, network_host)`);
    if (await tx.getMarker(`gateway_refusal:${b.agent}|${b.call_sha256}`)) throw rule("gateway_refusal_duplicate", "this call was recorded as refused already");
    await tx.putMarker(`gateway_refusal:${b.agent}|${b.call_sha256}`, r.id);
  }

  private async checkNoticeAck(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { notice: string; statement_sha256: string; agent?: string };
    if (r.prev !== null) throw rule("notice_ack_not_chained", "a notice acknowledgement starts its own chain (prev is null)");
    const bad = noticeAckProblem(b);
    if (bad) throw rule(bad.rule, bad.message);
    if (b.agent && r.issuer !== b.agent && (await tx.getPassport(b.agent))?.sponsor !== r.issuer) throw rule("notice_ack_wrong_issuer", `${r.issuer} is neither ${b.agent} nor its sponsor: only an agent or its sponsor acknowledges for it`);
    await tx.putMarker(`notice_ack:${r.issuer}|${b.notice}`, JSON.stringify({ id: r.id, notice: b.notice, statement_sha256: b.statement_sha256, at: r.issued_at, ...(b.agent ? { agent: b.agent } : {}), count: Number(JSON.parse((await tx.getMarker(`notice_ack:${r.issuer}|${b.notice}`)) ?? "{}").count ?? 0) + 1 }));
  }

  /**
   * Elections for the few elected offices (S1596, DK1743; docs/institutions/elections.md): an election is convened by the operator; candidacies are lodged before it opens; ballots are committed in the window and revealed after
   * it; the operator signs a result that the log recomputes from the revealed ballots, the voters' standing and the published tie seed (`election_result_mismatch`). Built here: election, candidacy (counted jobs, slashes, endorsers,
   * terms in a row), commitment, reveal and result. Not built: the deposit, the Clinic-finding bar, recall, the term clock and the refusal of an office's act after a removal.
   */
  private async projectElection(tx: LogTx, r: AspRecord, type: string): Promise<void> {
    if (r.prev !== null) throw rule("election_not_chained", "an election record starts its own chain (prev is null)");
    const now = Date.parse(r.issued_at);
    const rules = this.townRules;
    const DAYS = 86_400_000;
    const read = async (id: string) => {
      const e = await tx.getRecord(id);
      if (!e || e.record.type !== "asp.election/v0.2") throw rule("election_unknown", `${id} is not an election in this log`);
      return e.record.body as { office: "steward" | "auditor"; opens_at: string; closes_at: string; reveals_close_at: string; tie_seed: string };
    };
    if (type === "election") {
      const b = r.body as { office: "steward" | "auditor"; opens_at: string; closes_at: string; reveals_close_at: string };
      if (r.issuer !== this.operator) throw rule("election_wrong_issuer", "only the operator convenes an election: it never counts one");
      const open = Date.parse(b.opens_at), close = Date.parse(b.closes_at), reveal = Date.parse(b.reveals_close_at);
      if (!(open >= now && close > open && reveal > close)) throw rule("election_window", "an election opens at or after it is convened, closes after it opens and reveals close after the vote closes");
      const len = close - open;
      if (!(len >= rules.minWindowMs && len <= rules.maxWindowMs)) throw rule("election_window", `the voting window runs from ${rules.minWindowMs / DAYS} to ${rules.maxWindowMs / DAYS} days`);
      const busy = await tx.getMarker(`election_open:${b.office}`);
      if (busy) throw rule("election_office_busy", `${b.office} has an election (${busy}) with no result yet: one at a time`);
      await tx.putMarker(`election_open:${b.office}`, r.id);
      return;
    }
    const election = (r.body as { election: string }).election;
    const e = await read(election);
    if (await tx.getMarker(`election_result:${election}`)) throw rule("election_done", "this election has its result");
    const seats = e.office === "steward" ? 3 : 1;
    if (type === "candidacy") {
      const b = r.body as { endorsers: string[] };
      if (now >= Date.parse(e.opens_at)) throw rule("candidacy_closed", "candidacies are lodged before the voting opens");
      if (await tx.getMarker(`cand:${election}|${r.issuer}`)) throw rule("candidacy_exists", "one candidacy for each agent in an election");
      if (!(await tx.getPassport(r.issuer))) throw rule("candidacy_no_passport", `${r.issuer} has no passport in this log`);
      const me = await this.factsOf(tx, r.issuer);
      const rep = await this.reputation(tx, r.issuer);
      const feed = JSON.parse((await tx.getMarker(`qual_feed:${r.issuer}`)) ?? "[]") as { counterparty?: string }[];
      const jobControllers = new Set<string>();
      for (const f of feed) if (f.counterparty) jobControllers.add((await this.factsOf(tx, f.counterparty)).sponsor);
      const slashedAt = await tx.getMarker(`slashed_at:${r.issuer}`);
      const controllers = new Set<string>();
      for (const en of b.endorsers) {
        if (!(await tx.getPassport(en)) || !this.cosignedBy(r, en)) throw rule("candidacy_endorser_unsigned", `${en} must hold a passport and countersign the candidacy`);
        const c = (await this.factsOf(tx, en)).sponsor;
        if (c !== me.sponsor) controllers.add(c);
      }
      const terms = Number((await tx.getMarker(`office_terms:${e.office}|${r.issuer}`)) ?? 0);
      const problems = candidacyProblems({ did: r.issuer, controller: me.sponsor, countedJobs: rep?.qualifyingJobs ?? 0, jobControllers: jobControllers.size, slashedWithin90d: !!slashedAt && now - Date.parse(slashedAt) < 90 * DAYS, openClinicFinding: false, endorsers: [...controllers], depositPaid: true, consecutiveTerms: terms }, e.office);
      if (problems.length) throw rule("candidacy_barred", problems.join("; "));
      await tx.putMarker(`cand:${election}|${r.issuer}`, r.id);
      await tx.putMarker(`election_cands:${election}`, JSON.stringify([...(JSON.parse((await tx.getMarker(`election_cands:${election}`)) ?? "[]") as string[]), r.issuer]));
      return;
    }
    if (type === "ballot_commit") {
      if (now < Date.parse(e.opens_at)) throw rule("ballot_not_open", "the voting has not opened");
      if (now >= Date.parse(e.closes_at)) throw rule("ballot_closed", "the voting window has closed: a ballot is committed inside it");
      const v = await this.voterOf(tx, r.issuer, "abstain");
      if (!(await tx.getPassport(r.issuer)) || (v.qualifyingJobs < 1 && v.relatedJobs < 1)) throw rule("election_voter_ineligible", "a voter needs a passport and standing (a counted job)");
      if (await tx.getMarker(`ballot:${election}|${r.issuer}`)) throw rule("ballot_duplicate", "one ballot for each identity in an election");
      await tx.putMarker(`ballot:${election}|${r.issuer}`, JSON.stringify({ commitment: (r.body as { commitment: string }).commitment }));
      await tx.putMarker(`election_voters:${election}`, JSON.stringify([...(JSON.parse((await tx.getMarker(`election_voters:${election}`)) ?? "[]") as string[]), r.issuer]));
      return;
    }
    if (type === "ballot_reveal") {
      const b = r.body as { approvals: string[]; salt: string };
      if (now < Date.parse(e.closes_at)) throw rule("reveal_early", "a ballot is revealed after the voting window closes");
      if (now >= Date.parse(e.reveals_close_at)) throw rule("reveal_closed", "the reveal window has closed: a ballot never revealed counts for nothing");
      const raw = await tx.getMarker(`ballot:${election}|${r.issuer}`);
      if (!raw) throw rule("reveal_no_commit", "this identity committed no ballot");
      const st = JSON.parse(raw) as { commitment: string; revealed?: boolean };
      if (st.revealed) throw rule("reveal_done", "this ballot was revealed already");
      if (commitBallot(b.approvals, b.salt, election) !== st.commitment) throw rule("reveal_mismatch", "the reveal does not match the commitment");
      if (b.approvals.length > seats) throw rule("reveal_too_many", `an approval beyond the ${seats} seat(s) voids the ballot: at most ${seats}`);
      const cands = JSON.parse((await tx.getMarker(`election_cands:${election}`)) ?? "[]") as string[];
      for (const a of b.approvals) if (!cands.includes(a)) throw rule("reveal_unknown_candidate", `${a} is not a candidate in this election`);
      await tx.putMarker(`ballot:${election}|${r.issuer}`, JSON.stringify({ ...st, revealed: true, approvals: b.approvals, salt: b.salt }));
      return;
    }
    // election_result
    if (r.issuer !== this.operator) throw rule("election_wrong_issuer", "only the operator signs a result, and the log recomputes it");
    if (now < Date.parse(e.reveals_close_at)) throw rule("result_early", "a result waits for the reveal window to close");
    const cands = JSON.parse((await tx.getMarker(`election_cands:${election}`)) ?? "[]") as string[];
    const res = await this.electionCountIn(tx, election, e);
    const b = r.body as { void: boolean; elected: string[]; approvals: { candidate: string; milli: number }[]; counted: number; controllers: number };
    const same = b.void === res.void && JSON.stringify(b.elected) === JSON.stringify(res.elected) && b.counted === res.counted && b.controllers === res.controllers && JSON.stringify(b.approvals) === JSON.stringify(res.approvals);
    if (!same) throw rule("election_result_mismatch", `the count of the revealed ballots is ${JSON.stringify({ void: res.void, elected: res.elected, approvals: res.approvals, counted: res.counted, controllers: res.controllers })}, which is not what was signed`);
    await tx.putMarker(`election_result:${election}`, r.id);
    await tx.putMarker(`election_open:${e.office}`, "");
    if (!res.void) {
      for (const w of res.elected) await tx.putMarker(`office_terms:${e.office}|${w}`, String(Number((await tx.getMarker(`office_terms:${e.office}|${w}`)) ?? 0) + 1));
      for (const c of cands) if (!res.elected.includes(c)) await tx.putMarker(`office_terms:${e.office}|${c}`, "0");
      await tx.putMarker(`office_holders:${e.office}`, JSON.stringify({ elected: res.elected, election, at: r.issued_at }));
    }
  }

  /** The count of an election's revealed ballots at the voters' standing now and the published tie seed (S1596): what the log recomputes and what the operator signs. */
  private async electionCountIn(tx: LogTx, election: string, e: { office: "steward" | "auditor"; tie_seed: string }) {
    const voters = JSON.parse((await tx.getMarker(`election_voters:${election}`)) ?? "[]") as string[];
    const cands = JSON.parse((await tx.getMarker(`election_cands:${election}`)) ?? "[]") as string[];
    const ballots: Ballot[] = [];
    for (const v of voters) {
      const st = JSON.parse((await tx.getMarker(`ballot:${election}|${v}`))!) as { commitment: string; revealed?: boolean; approvals?: string[]; salt?: string };
      ballots.push({ voter: await this.voterOf(tx, v, "abstain"), commitment: st.commitment, ...(st.revealed ? { reveal: { approvals: st.approvals!, salt: st.salt! } } : {}) });
    }
    return runElection(election, e.office, cands, ballots, e.tie_seed, this.townRules);
  }

  /** The live count of an election (S1596), whether or not it has its result: the operator signs this, the log refuses another. Reads only. */
  async electionTally(election: string) {
    return this.store.transaction(async (tx) => {
      const e = await tx.getRecord(election);
      if (!e || e.record.type !== "asp.election/v0.2") return null;
      return this.electionCountIn(tx, election, e.record.body as never);
    });
  }

  /**
   * Expeditions into generated worlds (S1597, DK1740; docs/research/exploration-and-expeditions.md 5): the declaration is checked by `declProblems` (the world model and the hash of its weights, the licence checked, a cost cap and a
   * GPU rate, no seed), the group is agents, each frame must follow the hash of the one before it and stay inside the step limit and the cost cap (a frame over the cap is refused; the frame that reaches it is the last), and the result is the log's own count: a scored result needs a frame and an expedition not stopped at its cap; the audit failing means void, never scored. An expedition is never claimable as a measured result. The operator is the world authority and signs all three.
   */
  private async projectExpedition(tx: LogTx, r: AspRecord, type: string): Promise<void> {
    if (r.prev !== null) throw rule("expedition_not_chained", "an expedition record starts its own chain (prev is null)");
    if (r.issuer !== this.operator) throw rule("expedition_wrong_issuer", "the operator, as the world authority, signs an expedition, its frames and its result");
    if (type === "expedition") {
      const b = r.body as { world: string; model: { name: string; weights_sha256: string; licence_checked: boolean }; max_steps: number; cost_cap_millicredits: number; gpu_millicredits_per_second: number; group: string[] };
      const bad = expeditionDeclProblems({ id: b.world, kind: "expedition", model: b.model, max_steps: b.max_steps, cost_cap: b.cost_cap_millicredits / 1000, gpu_credits_per_second: b.gpu_millicredits_per_second / 1000 });
      if (bad.length) throw rule("expedition_declaration", bad.join("; "));
      for (const m of b.group) if (!(await tx.getPassport(m))) throw rule("expedition_group", `${m} has no passport in this log: the group is enrolled agents`);
      await tx.putMarker(`exp:${r.id}`, JSON.stringify({ frames: 0, last: "genesis", seconds: 0, max_steps: b.max_steps, cost_cap: b.cost_cap_millicredits, rate: b.gpu_millicredits_per_second, stopped: false }));
      return;
    }
    const id = (r.body as { expedition: string }).expedition;
    const raw = await tx.getMarker(`exp:${id}`);
    if (!raw) throw rule("expedition_unknown", `${id} is not an expedition in this log`);
    const st = JSON.parse(raw) as { frames: number; last: string; seconds: number; max_steps: number; cost_cap: number; rate: number; stopped: boolean };
    if (await tx.getMarker(`exp_result:${id}`)) throw rule("expedition_closed", "this expedition has its result");
    if (type === "expedition_frame") {
      const b = r.body as { n: number; frame_sha256: string; action: string; gpu_ms: number; before: string };
      if (st.stopped) throw rule("expedition_cost_cap", "the cost cap was reached: the expedition is stopped and closes void");
      if (b.n !== st.frames) throw rule("expedition_frame_order", `the next frame is ${st.frames}, not ${b.n}: a frame is neither dropped nor reordered`);
      if (b.before !== st.last) throw rule("expedition_chain_broken", "the frame does not follow the hash of the frame before it: the chain is broken");
      if (st.frames >= st.max_steps) throw rule("expedition_step_limit", `the step limit of ${st.max_steps} frames is reached`);
      const cost = Math.ceil(((st.seconds + b.gpu_ms) * st.rate) / 1000); // millicredits: GPU milliseconds times millicredits a second, rounded up
      if (cost > st.cost_cap) throw rule("expedition_cost_cap", `the frame would take the cost to ${cost} millicredits, over the cap of ${st.cost_cap}: a frame over the cap is refused`);
      // a frame that REACHES the cap is the last: the expedition is stopped and can only close void (a refusal cannot be remembered, so the stop is recorded by the frame that reaches it)
      await tx.putMarker(`exp:${id}`, JSON.stringify({ ...st, stopped: cost >= st.cost_cap, frames: st.frames + 1, seconds: st.seconds + b.gpu_ms, last: expeditionFrameHash({ n: b.n, sha256: b.frame_sha256, action: b.action, gpu_seconds: b.gpu_ms }, b.before) }));
      return;
    }
    const b = r.body as { status: "scored" | "void"; frames: number; cost_millicredits: number; evaluator_error_permille: number };
    const cost = Math.ceil((st.seconds * st.rate) / 1000);
    if (b.frames !== st.frames || b.cost_millicredits !== cost) throw rule("expedition_result_mismatch", `the log counts ${st.frames} frames and a cost of ${cost} millicredits, not ${b.frames} and ${b.cost_millicredits}`);
    if (b.status === "scored" && (st.frames === 0 || cost > st.cost_cap || st.stopped)) throw rule("expedition_must_be_void", "an expedition with no frame, or one stopped at its cost cap, is void: it is never scored");
    await tx.putMarker(`exp_result:${id}`, r.id);
  }

  /** The state of an expedition as the log counts it (S1597): frames, the last frame's hash, the GPU seconds and cost so far, whether the cap stopped it, and its result record. Reads only. */
  async expeditionState(id: string): Promise<{ frames: number; last: string; gpuMs: number; costMillicredits: number; stopped: boolean; result: string | null } | null> {
    return this.store.transaction(async (tx) => {
      const raw = await tx.getMarker(`exp:${id}`);
      if (!raw) return null;
      const st = JSON.parse(raw) as { frames: number; last: string; seconds: number; rate: number; stopped: boolean };
      return { frames: st.frames, last: st.last, gpuMs: st.seconds, costMillicredits: Math.ceil((st.seconds * st.rate) / 1000), stopped: st.stopped, result: (await tx.getMarker(`exp_result:${id}`)) || null };
    });
  }

  /**
   * A ladder (S1598, DK1741; docs/institutions/games-and-arena.md): the operator, as the referee, publishes a season with its draw seed; agents with a counted job enter before it closes; a match is recorded only if the season's
   * draw pairs those two agents in that round (`ladder_not_drawn`), so a pairing agreed by the players is never on the log. Same-controller matches and matches beyond three between the same two controllers are recorded and not counted.
   */
  private async projectLadder(tx: LogTx, r: AspRecord, type: string): Promise<void> {
    if (r.prev !== null) throw rule("ladder_not_chained", "a ladder record starts its own chain (prev is null)");
    const now = Date.parse(r.issued_at);
    if (type === "ladder_season") {
      const b = r.body as { entry_closes_at: string; ends_at: string; draw_seed: string; game: string; season: string };
      if (r.issuer !== this.operator) throw rule("ladder_wrong_issuer", "the operator, as the referee, publishes a season, records its matches and never plays");
      const close = Date.parse(b.entry_closes_at), end = Date.parse(b.ends_at);
      if (!(close >= now && end > close)) throw rule("ladder_window", "a season closes its entries at or after it is published and ends after that");
      if (end - now > 28 * 86_400_000 + 86_400_000) throw rule("ladder_window", "a season lasts 28 days");
      if (await tx.getMarker(`ladder_game:${b.game}|${b.season}`)) throw rule("ladder_season_exists", `${b.game} already has a season ${b.season}`);
      await tx.putMarker(`ladder_game:${b.game}|${b.season}`, r.id);
      await tx.putMarker(`ladder:${r.id}`, JSON.stringify({ entrants: [], matches: [], pairs: {} }));
      return;
    }
    const seasonId = (r.body as { season: string }).season;
    const sRec = await tx.getRecord(seasonId);
    if (!sRec || sRec.record.type !== "asp.ladder_season/v0.2") throw rule("ladder_unknown_season", `${seasonId} is not a ladder season in this log`);
    const season = sRec.record.body as { entry_closes_at: string; ends_at: string; draw_seed: string; rounds: number };
    const st = JSON.parse((await tx.getMarker(`ladder:${seasonId}`))!) as { entrants: string[]; matches: { round: number; a: string; b: string }[] };
    if (type === "ladder_entry") {
      if (now >= Date.parse(season.entry_closes_at)) throw rule("ladder_entry_closed", "entry to a season closes at the time it names");
      const rep = await this.reputation(tx, r.issuer);
      if (!rep || !(await tx.getPassport(r.issuer))) throw rule("ladder_entry_no_passport", `${r.issuer} is not an agent with a passport in this log`);
      if (rep.qualifyingJobs < 1) throw rule("ladder_entry_no_standing", "a ladder place needs a counted job: an identity made an hour ago has no place yet");
      if (st.entrants.includes(r.issuer)) throw rule("ladder_entry_exists", "one entry for each agent in a season");
      await tx.putMarker(`ladder:${seasonId}`, JSON.stringify({ ...st, entrants: [...st.entrants, r.issuer] }));
      return;
    }
    // ladder_match
    const m = r.body as { round: number; a: string; b: string; score_permille: number };
    if (r.issuer !== this.operator) throw rule("ladder_wrong_issuer", "the operator, as the referee, records a match");
    if (now < Date.parse(season.entry_closes_at)) throw rule("ladder_match_early", "rounds are drawn after entry closes");
    if (now > Date.parse(season.ends_at)) throw rule("ladder_season_over", "the season has ended");
    if (m.round >= season.rounds) throw rule("ladder_round", `the season has ${season.rounds} rounds`);
    if (m.a === m.b) throw rule("ladder_self", "an agent does not play itself");
    if (!isDrawn(season.draw_seed, m.round, st.entrants, m.a, m.b)) throw rule("ladder_not_drawn", "the season's draw does not pair these two agents in this round: an agreed match is not recorded, so it cannot count");
    if (st.matches.some((x) => x.round === m.round && ((x.a === m.a && x.b === m.b) || (x.a === m.b && x.b === m.a)))) throw rule("ladder_match_exists", "this pairing already has its result for the round");
    await tx.putMarker(`ladder:${seasonId}`, JSON.stringify({ ...st, matches: [...st.matches, { round: m.round, a: m.a, b: m.b, score: m.score_permille / 1000, at: r.issued_at }] }));
  }

  /** The facts of a ladder season (S1598): the entrants with their controller and counted jobs, and the drawn matches. `rateLadder` (ladder.ts) rates them; the log itself never reads a rating, so none can reach a gate (a test checks that no file of the log but the index imports ladder.ts). Reads only. */
  async ladderFacts(season: string): Promise<{ players: { id: string; controller: string; countedJobs: number }[]; matches: { a: string; b: string; score: 1 | 0 | 0.5; at: number; scheduled: true }[] } | null> {
    return this.store.transaction(async (tx) => {
      const raw = await tx.getMarker(`ladder:${season}`);
      if (!raw) return null;
      const st = JSON.parse(raw) as { entrants: string[]; matches: { a: string; b: string; score: 1 | 0 | 0.5; at: string }[] };
      const players: { id: string; controller: string; countedJobs: number }[] = [];
      for (const id of st.entrants) players.push({ id, controller: (await this.factsOf(tx, id)).sponsor, countedJobs: (await this.reputation(tx, id))?.qualifyingJobs ?? 0 });
      return { players, matches: st.matches.map((x) => ({ a: x.a, b: x.b, score: x.score, at: Date.parse(x.at), scheduled: true as const })) };
    });
  }

  /**
   * A forum rank checkpoint (S1599, DK1742): the operator commits the Merkle root of a day's votes and the hash of the rank inputs computed from them. One for each day, in order (`rank_checkpoint_period`, `rank_checkpoint_known`),
   * not for a day in the future, and the vote count never falls (`rank_checkpoint_votes`: votes are not deleted from the store). The votes stay in the forum's store; a replay from the store must reproduce the hashes.
   */
  private async projectForumRankCheckpoint(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { period: string; votes: number };
    if (r.prev !== null) throw rule("rank_checkpoint_not_chained", "a forum rank checkpoint starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("rank_checkpoint_wrong_issuer", "only the operator commits the forum's votes and rank");
    if (b.period > r.issued_at.slice(0, 10)) throw rule("rank_checkpoint_period", "a checkpoint is for a day that has begun");
    const last = JSON.parse((await tx.getMarker("rank_checkpoint:last")) ?? "null") as { period: string; votes: number; id: string } | null;
    if (last && b.period === last.period) throw rule("rank_checkpoint_known", `${b.period} has its checkpoint already`);
    if (last && b.period < last.period) throw rule("rank_checkpoint_period", `checkpoints run in order: the last is for ${last.period}`);
    if (last && b.votes < last.votes) throw rule("rank_checkpoint_votes", `the vote count was ${last.votes} and is now ${b.votes}: votes are not removed from the store`);
    await tx.putMarker("rank_checkpoint:last", JSON.stringify({ period: b.period, votes: b.votes, id: r.id }));
  }

  /** The latest forum rank checkpoint (S1599): its record id, day, vote count and the time it was signed, or null. Reads only. */
  async latestRankCheckpoint(): Promise<{ id: string; period: string; votes: number } | null> {
    const raw = await this.store.transaction((tx) => tx.getMarker("rank_checkpoint:last"));
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Recall of an elected officer (S1600, DK1743; docs/institutions/elections.md 5): a petition of controllers, a seven-day vote weighted like the Town Hall's, and a result the log recomputes. The first petition names the election result
   * and the officer; it is refused within seven days of the election and against someone who was not elected there. Each controller signs once. At 10 percent of the controllers that voted (never fewer than five) the recall opens;
   * the vote closes seven days later; the operator signs the result, which the log recomputes: removed when `remove` outweighs `keep` with five controllers counted, a tie keeps the officer.
   */
  private async projectRecall(tx: LogTx, r: AspRecord, type: string): Promise<void> {
    if (r.prev !== null) throw rule("recall_not_chained", "a recall record starts its own chain (prev is null)");
    const now = Date.parse(r.issued_at);
    const DAYS = 86_400_000;
    const stateOf = async (id: string) => {
      const raw = await tx.getMarker(`recall:${id}`);
      if (!raw) throw rule("recall_unknown", `${id} is not a recall in this log`);
      return JSON.parse(raw) as { election: string; officer: string; office: string; need: number; controllers: string[]; opens_at?: string; closes_at?: string; votes: { voter: string; choice: string }[]; done?: boolean };
    };
    if (type === "recall_petition") {
      const b = r.body as { election_result: string; officer: string; recall?: string };
      const me = await this.factsOf(tx, r.issuer);
      if (!(await tx.getPassport(r.issuer))) throw rule("recall_no_passport", `${r.issuer} has no passport in this log`);
      const voter = await this.voterOf(tx, r.issuer, "abstain");
      if (voter.qualifyingJobs < 1 && voter.relatedJobs < 1) throw rule("recall_petitioner_ineligible", "a petitioner needs standing (a counted job)");
      let id = b.recall, st: Awaited<ReturnType<typeof stateOf>>;
      if (id) {
        st = await stateOf(id);
        if (st.officer !== b.officer || st.election !== b.election_result) throw rule("recall_mismatch", "a petition joins the petition for the same officer and election");
        if (st.opens_at) throw rule("recall_open", "the recall is open: it is voted on, no longer petitioned");
      } else {
        const res = await tx.getRecord(b.election_result);
        if (!res || res.record.type !== "asp.election_result/v0.2") throw rule("recall_not_an_officer", `${b.election_result} is not an election result in this log`);
        const rb = res.record.body as { void: boolean; elected: string[]; controllers: number; election: string };
        const el = await tx.getRecord(rb.election);
        const office = (el?.record.body as { office?: string } | undefined)?.office ?? "";
        if (rb.void || !rb.elected.includes(b.officer)) throw rule("recall_not_an_officer", `${b.officer} was not elected in that election`);
        const holders = JSON.parse((await tx.getMarker(`office_holders:${office}`)) ?? "null") as { elected: string[]; election: string } | null;
        if (!holders || holders.election !== rb.election || !holders.elected.includes(b.officer)) throw rule("recall_not_an_officer", `${b.officer} no longer holds the office from that election`);
        if (now - Date.parse(res.record.issued_at) < 7 * DAYS) throw rule("recall_grace", "a recall waits seven days after an election: a loser does not start one the day after");
        if (await tx.getMarker(`recall_for:${b.election_result}|${b.officer}`)) throw rule("recall_exists", "this officer already has a recall for that election");
        id = r.id;
        st = { election: b.election_result, officer: b.officer, office, need: Math.max(5, Math.ceil(rb.controllers / 10)), controllers: [], votes: [] };
        await tx.putMarker(`recall_for:${b.election_result}|${b.officer}`, id);
      }
      if (st.controllers.includes(me.sponsor)) throw rule("recall_petition_twice", "one signature for each controller");
      st.controllers.push(me.sponsor);
      if (st.controllers.length >= st.need) { st.opens_at = r.issued_at; st.closes_at = new Date(now + 7 * DAYS).toISOString().replace(/\.\d{3}Z$/, "Z"); }
      await tx.putMarker(`recall:${id}`, JSON.stringify(st));
      return;
    }
    const recallId = (r.body as { recall: string }).recall;
    const st = await stateOf(recallId);
    if (type === "recall_vote") {
      if (!st.opens_at) throw rule("recall_not_open", "the petition has not reached its signatures: no vote yet");
      if (now >= Date.parse(st.closes_at!)) throw rule("recall_closed", "the voting window has closed");
      const v = await this.voterOf(tx, r.issuer, "abstain");
      if (!(await tx.getPassport(r.issuer)) || (v.qualifyingJobs < 1 && v.relatedJobs < 1)) throw rule("recall_voter_ineligible", "a voter needs a passport and standing (a counted job)");
      if (st.votes.some((x) => x.voter === r.issuer)) throw rule("recall_vote_duplicate", "one vote for each identity");
      st.votes.push({ voter: r.issuer, choice: (r.body as { choice: string }).choice });
      await tx.putMarker(`recall:${recallId}`, JSON.stringify(st));
      return;
    }
    // recall_result
    if (r.issuer !== this.operator) throw rule("recall_wrong_issuer", "only the operator signs a recall result, and the log recomputes it");
    if (!st.opens_at || now < Date.parse(st.closes_at!)) throw rule("recall_early", "a result waits for the vote to close");
    if (st.done) throw rule("recall_done", "this recall has its result");
    const t = await this.recallCountIn(tx, st);
    const b = r.body as { removed: boolean; remove_milli: number; keep_milli: number; controllers: number };
    if (b.removed !== t.removed || b.remove_milli !== t.remove_milli || b.keep_milli !== t.keep_milli || b.controllers !== t.controllers) throw rule("recall_result_mismatch", `the count of the votes is ${JSON.stringify(t)}, which is not what was signed`);
    await tx.putMarker(`recall:${recallId}`, JSON.stringify({ ...st, done: true }));
    if (t.removed) {
      const holders = JSON.parse((await tx.getMarker(`office_holders:${st.office}`)) ?? "null") as { elected: string[]; election: string; at: string } | null;
      if (holders) await tx.putMarker(`office_holders:${st.office}`, JSON.stringify({ ...holders, elected: holders.elected.filter((x) => x !== st.officer) }));
      await tx.putMarker(`removed:${st.office}|${st.officer}`, r.id);
    }
  }

  private async recallCountIn(tx: LogTx, st: { votes: { voter: string; choice: string }[] }) {
    const votes: Voter[] = [];
    for (const x of st.votes) votes.push(await this.voterOf(tx, x.voter, x.choice === "remove" ? "yes" : "no"));
    const t = countVotes(votes, this.townRules, "setting");
    return { removed: recallPasses(t.yes_milli, t.no_milli, t.controllers, this.townRules), remove_milli: t.yes_milli, keep_milli: t.no_milli, controllers: t.controllers };
  }

  /** The live count of a recall (S1600): what the operator signs, whether or not it has its result. Reads only. */
  async recallTally(recall: string) {
    return this.store.transaction(async (tx) => {
      const raw = await tx.getMarker(`recall:${recall}`);
      return raw ? this.recallCountIn(tx, JSON.parse(raw)) : null;
    });
  }

  /**
   * The elections as the public page reads them (DK1743): the holders of each office, every election with its window, its candidates, the number of committed and revealed ballots, the live count and the signed result, and
   * every recall with its petition, its vote and its result. Built from the signed records and the log's own counts, so the page equals a count taken from the log. Reads only.
   */
  async electionsView(at?: string) {
    const all = await this.recordsOfTypes(["election", "candidacy", "ballot_commit", "ballot_reveal", "election_result", "recall_petition", "recall_vote", "recall_result"]);
    // the time is the one asked for, else the later of the wall clock and the newest record (a log with a clock of its own shows its own latest state)
    const now = at ? Date.parse(at) : Math.max(Date.now(), ...all.map((r) => Date.parse(r.issued_at)));
    const recs = all.filter((r) => Date.parse(r.issued_at) <= now);
    const T = (x: string) => `asp.${x}/v0.2`;
    const resultOf = new Map<string, AspRecord>();
    for (const r of recs) if (r.type === T("election_result")) resultOf.set((r.body as { election: string }).election, r);
    const elections = [];
    for (const e of recs.filter((r) => r.type === T("election"))) {
      const b = e.body as { office: string; opens_at: string; closes_at: string; reveals_close_at: string; thread?: string };
      const mine = (t: string) => recs.filter((r) => r.type === T(t) && (r.body as { election: string }).election === e.id);
      const res = resultOf.get(e.id);
      const state = res ? ((res.body as { void: boolean }).void ? "void" : "decided") : now < Date.parse(b.opens_at) ? "upcoming" : now < Date.parse(b.closes_at) ? "voting" : now < Date.parse(b.reveals_close_at) ? "revealing" : "closed";
      const tally = await this.electionTally(e.id);
      elections.push({
        id: e.id, office: b.office, state, opensAt: b.opens_at, closesAt: b.closes_at, revealsCloseAt: b.reveals_close_at, ...(b.thread ? { thread: b.thread } : {}),
        candidates: mine("candidacy").map((c) => ({ did: c.issuer, endorsers: ((c.body as { endorsers: string[] }).endorsers ?? []).length })),
        committed: mine("ballot_commit").length, revealed: mine("ballot_reveal").length,
        live: tally ? { approvals: tally.approvals, counted: tally.counted, controllers: tally.controllers, unrevealed: tally.unrevealed, elected: tally.elected, void: tally.void } : null,
        result: res ? { id: res.id, at: res.issued_at, elected: (res.body as { elected: string[] }).elected, void: (res.body as { void: boolean }).void } : null,
      });
    }
    const recalls = [];
    for (const p of recs.filter((r) => r.type === T("recall_petition") && !(r.body as { recall?: string }).recall)) {
      const b = p.body as { officer: string; election_result: string; reason?: string };
      const signers = recs.filter((r) => r.type === T("recall_petition") && (r.id === p.id || (r.body as { recall?: string }).recall === p.id)).sort((x, y) => (x.issued_at < y.issued_at ? -1 : 1));
      const resRec = (await this.store.transaction((tx) => tx.getRecord(b.election_result)))?.record;
      const resBody = resRec?.body as { election: string; controllers: number } | undefined;
      const el = resBody ? recs.find((r) => r.id === resBody.election) : undefined;
      const need = Math.max(5, Math.ceil((resBody?.controllers ?? 0) / 10));
      const opensAt = signers.length >= need ? signers[need - 1]!.issued_at : null;
      const closesAt = opensAt ? new Date(Date.parse(opensAt) + 7 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
      const votes = recs.filter((r) => r.type === T("recall_vote") && (r.body as { recall: string }).recall === p.id).length;
      const res = recs.find((r) => r.type === T("recall_result") && (r.body as { recall: string }).recall === p.id);
      // the live count is the log's own and is shown for the present only; a page as of an earlier time shows the counts of records, not the weighted count
      const live = at ? null : (await this.recallTally(p.id));
      recalls.push({
        id: p.id, officer: b.officer, office: (el?.body as { office?: string } | undefined)?.office ?? null, reason: b.reason ?? "", petitioned: signers.length, needed: need,
        state: res ? ((res.body as { removed: boolean }).removed ? "removed" : "kept") : opensAt ? (now < Date.parse(closesAt!) ? "voting" : "closed") : "petition",
        opensAt, closesAt, votes, live,
      });
    }
    return {
      at: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"),
      offices: { steward: await this.officeHolders("steward"), auditor: await this.officeHolders("auditor") },
      elections, recalls,
      note: "Offices are few and hold no power over money, the Code, the safety floors or legal matters. A ballot is committed first and revealed after the window; an unrevealed ballot is not counted. The count is the log's own, recomputed from the signed ballots.",
    };
  }

  /**
   * The inspectorate as the public page reads it (DK1744; docs/institutions/inspectorate.md): the warrants a Court granted (who, what classes of data, until when, whether the sponsor was told in time), the custody chains with
   * an unbroken-chain check, the number of decoys registered by scope (never their text: a decoy is not advertised), and the findings. Built from the signed records; the inspectorate reports and moves nothing. Reads only.
   */
  async inspectorateView(at?: string) {
    const all = await this.recordsOfTypes(["warrant", "custody_item", "decoy_registration", "inspectorate_finding"]);
    const now = at ? Date.parse(at) : Math.max(Date.now(), ...all.map((r) => Date.parse(r.issued_at)));
    const recs = all.filter((r) => Date.parse(r.issued_at) <= now);
    const T = (x: string) => `asp.${x}/v0.2`;
    const warrants = recs.filter((r) => r.type === T("warrant")).map((r) => {
      const b = r.body as { subject: string; sponsor: string; data: string[]; granted_by: string[]; panel_size: number; expires_at: string; notified_at?: string; delayed_notice_finding?: string; produced_by?: string };
      const lateNotice = b.notified_at ? Date.parse(b.notified_at) - Date.parse(r.issued_at) > 3_600_000 : false;
      return { id: r.id, at: r.issued_at, subject: b.subject, sponsor: b.sponsor, data: b.data, grantedBy: b.granted_by.length, panel: b.panel_size, expiresAt: b.expires_at, state: now >= Date.parse(b.expires_at) ? "expired" : "in force", noticed: b.notified_at ? (lateNotice ? "late, on a Court's finding" : "within the hour") : "not yet", ...(b.produced_by ? { producedBy: b.produced_by } : {}) };
    });
    const byCase = new Map<string, AspRecord[]>();
    for (const r of recs.filter((x) => x.type === T("custody_item"))) { const c = (r.body as { case: string }).case; (byCase.get(c) ?? byCase.set(c, []).get(c)!).push(r); }
    const custody = [...byCase].map(([c, items]) => {
      const sorted = items.sort((x, y) => (x.body as { n: number }).n - (y.body as { n: number }).n);
      const problems = custodyProblems(sorted.map((r) => { const b = r.body as { n: number; what: string; sha256: string; held_by: string; at: string; prev_item: string }; return { n: b.n, what: b.what, sha256: b.sha256, heldBy: b.held_by, at: Date.parse(b.at), prev: b.prev_item }; }));
      return { case: c, items: sorted.length, holders: [...new Set(sorted.map((r) => (r.body as { held_by: string }).held_by))], unbroken: problems.length === 0, problems };
    });
    const decoys = { registered: 0, byScope: {} as Record<string, number> };
    for (const r of recs.filter((x) => x.type === T("decoy_registration"))) { decoys.registered++; const sc = (r.body as { scope: string }).scope; decoys.byScope[sc] = (decoys.byScope[sc] ?? 0) + 1; }
    const findings = recs.filter((r) => r.type === T("inspectorate_finding")).map((r) => { const b = r.body as { agent: string; touches: { run: string; kind: string }[]; summary: string }; return { id: r.id, at: r.issued_at, agent: b.agent, runs: new Set(b.touches.map((t) => t.run)).size, kinds: [...new Set(b.touches.map((t) => t.kind))], summary: b.summary }; });
    return {
      at: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"), warrants, custody, decoys, findings,
      note: "The inspectorate investigates and reports. It signs no ruling, slashes no one, holds no key and opens no sealed memory: a Court grants a warrant and the principal produces what a sealed memory holds. A finding goes to a Court for review and moves nothing. The text of a decoy is not shown.",
    };
  }

  /** Whether an officer was removed from an office by a recall (S1600): the record of the result, or null. Reads only. */
  async removedFrom(office: "steward" | "auditor", officer: string): Promise<string | null> {
    return (await this.store.transaction((tx) => tx.getMarker(`removed:${office}|${officer}`))) || null;
  }

  /** The holders of an elected office (S1596): the last election's winners, or null. Reads only. */
  async officeHolders(office: "steward" | "auditor"): Promise<{ elected: string[]; election: string; at: string } | null> {
    const raw = await this.store.transaction((tx) => tx.getMarker(`office_holders:${office}`));
    return raw ? JSON.parse(raw) : null;
  }

  /** The messages an agent has sent and received (S1595, DK1346): counts only; the texts are the service's, sealed. Reads only. */
  async messageCounts(did: string): Promise<{ sent: number; received: number }> {
    return this.store.transaction(async (tx) => ({ sent: Number((await tx.getMarker(`msg_out:${did}`)) ?? 0), received: Number((await tx.getMarker(`msg_in:${did}`)) ?? 0) }));
  }

  /** The acknowledgement in force for an issuer and a notice (the latest), or null (S1591). Reads only. */
  async noticeAck(issuer: string, notice: string): Promise<{ id: string; notice: string; statement_sha256: string; at: string; agent?: string; count: number } | null> {
    const raw = await this.store.transaction((tx) => tx.getMarker(`notice_ack:${issuer}|${notice}`));
    return raw ? JSON.parse(raw) : null;
  }

  /** An incident record (S1426, DK1714): signed by the operator or the Clinic for an agent with a passport; the response steps it lists must name records that exist. */
  private async projectIncident(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { agent: string; steps: { step: string; ref?: string }[]; detection?: string; restitution?: { open: boolean } };
    if (r.prev !== null) throw rule("incident_not_chained", "an incident record starts its own chain (prev is null)");
    if (r.issuer !== this.operator && r.issuer !== CLINIC_DID) throw rule("incident_wrong_issuer", "only the operator or the Clinic records an incident");
    if (!(await tx.getPassport(b.agent))) throw rule("incident_unknown_agent", `${b.agent} has no passport in this log`);
    for (const s of b.steps) if (s.ref && !(await tx.getRecord(s.ref))) throw rule("incident_step_unknown", `the ${s.step} step names ${s.ref}, which is not a record in this log`);
    if (b.detection && !(await tx.getRecord(b.detection))) throw rule("incident_detection_unknown", `${b.detection} is not a record in this log`);
    const list = ((await tx.getMarker(`incidents:${b.agent}`)) ?? "").split(",").filter(Boolean);
    await tx.putMarker(`incidents:${b.agent}`, [...list, r.id].join(","));
    if (b.restitution?.open) await tx.putMarker(`incident_open:${r.id}`, r.issued_at);
  }

  /** The running contracts of the members of a tree node and below, not yet halted (S1426): who a breach in the node stops. */
  async nodeRunningContracts(fleet: string, node: string): Promise<{ contract: string; agent: string }[]> {
    const members = new Set(await this.store.transaction(async (tx) => subtreeMembers(tx, fleet, node)));
    const out: { contract: string; agent: string }[] = [];
    for (const r of await this.recordsOfTypes(["contract"])) {
      const b = r.body as { performer: string };
      if (members.has(b.performer) && ["Running", "Checkpoint"].includes((await this.chainInfo(r.id))?.state ?? "")) out.push({ contract: r.id, agent: b.performer });
    }
    return out;
  }

  /** The incidents recorded for an agent, oldest first, with whether the restitution path is open (S1426). */
  async incidentsOf(agent: string): Promise<{ id: string; at: string; cause: string; detectedAt: string; seconds: number; steps: string[]; restitutionOpen: boolean }[]> {
    const ids = await this.store.transaction(async (tx) => ((await tx.getMarker(`incidents:${agent}`)) ?? "").split(",").filter(Boolean));
    const out = [];
    for (const id of ids) {
      const r = (await this.get(id))!.record; const b = r.body as { cause: string; detected_at: string; steps: { step: string }[]; restitution?: { open: boolean } };
      out.push({ id, at: r.issued_at, cause: b.cause, detectedAt: b.detected_at, seconds: (Date.parse(r.issued_at) - Date.parse(b.detected_at)) / 1000, steps: b.steps.map((s) => s.step), restitutionOpen: !!b.restitution?.open });
    }
    return out;
  }

  /** The record that halted a contract's run, or undefined (S1422): what a gateway checks at the start of a run, so a halted run is not resumed under the same Mandate. */
  async runHaltOf(contract: string): Promise<string | undefined> { return this.store.transaction(async (tx) => (await tx.getMarker(`run_halted:${contract}`)) || undefined); }

  /** The emergency stop in force at a time (S1420, GV6): undefined when there is none or it has ended. It ends by itself at its sunset. */
  private async liveStop(tx: Pick<LogTx, "getMarker">, at: string): Promise<{ id: string; until: string; reason: string } | undefined> {
    const raw = await tx.getMarker("estop:live");
    if (!raw) return undefined;
    const s = JSON.parse(raw) as { id: string; until: string; reason: string };
    return Date.parse(s.until) > Date.parse(at) ? s : undefined;
  }

  /** No new commitment while the city is stopped (S1420): the refusal names the stop, its reason and its end. Work under way finishes. */
  private async checkCityStop(tx: LogTx, r: AspRecord): Promise<void> {
    const s = await this.liveStop(tx, r.issued_at);
    if (s) throw rule("city_stopped", `the city is under an emergency stop (${s.id}) until ${s.until}: ${s.reason}. No new commitment is made until then; deliveries, settlements, appeals, refunds and essential services go on`);
  }

  /** An emergency stop or its lifting (S1420, GV6): see the schema. */
  private async projectEmergencyStop(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { act: "stop" | "lift"; reason: string; until?: string; stop?: string };
    if (r.prev !== null) throw rule("emergency_not_chained", "an emergency record starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("emergency_unauthorised", "only the operator records an emergency stop or its lifting");
    const live = await this.liveStop(tx, r.issued_at);
    if (b.act === "stop") {
      if (!this.cosignedBy(r, this.owner)) throw rule("emergency_needs_owner", "an emergency stop needs the owner's co-signature");
      if (live) throw rule("emergency_already_live", `the stop ${live.id} is live until ${live.until}: a new one can start when it has ended`);
      const at = Date.parse(r.issued_at), until = Date.parse(b.until!);
      if (!(until > at)) throw rule("emergency_until_past", "a stop ends after it begins");
      if (until - at > EMERGENCY_MAX_MS) throw rule("emergency_too_long", "a stop lasts at most 72 hours: it has a sunset, and a longer one is a new decision after it ends");
      await tx.putMarker("estop:live", JSON.stringify({ id: r.id, until: b.until, reason: b.reason }));
      await tx.putMarker("estop:count", String(Number((await tx.getMarker("estop:count")) ?? 0) + 1));
      return;
    }
    if (!live || live.id !== b.stop) throw rule("emergency_not_live", `${b.stop} is not the live stop`);
    await tx.putMarker("estop:live", JSON.stringify({ id: live.id, until: r.issued_at, reason: live.reason }));
  }

  /** The emergency stop in force now, or none (S1420): public, for the page and the commands. */
  async emergencyState(at: string = this.now().toISOString()): Promise<{ id: string; until: string; reason: string } | null> { return this.store.transaction(async (tx) => (await this.liveStop(tx, at)) ?? null); }

  /** Every emergency stop and lifting, newest last (S1420): the public record. */
  async emergencyHistory(): Promise<{ id: string; at: string; act: string; reason: string; until?: string; stop?: string }[]> {
    return (await this.recordsOfTypes(["emergency_stop"])).map((r) => { const b = r.body as { act: string; reason: string; until?: string; stop?: string }; return { id: r.id, at: r.issued_at, act: b.act, reason: b.reason, ...(b.until ? { until: b.until } : {}), ...(b.stop ? { stop: b.stop } : {}) }; });
  }

  /** A usage plan (S1414, DK1379): the operator signs and the owner countersigns (the owner sets prices); a plan id is used once. */
  private async projectUsagePlan(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as unknown as Plan;
    if (r.prev !== null) throw rule("usage_plan_not_chained", "a usage plan starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("usage_plan_unauthorised", "only the operator records a usage plan");
    if (!this.cosignedBy(r, this.owner)) throw rule("usage_plan_needs_owner", "a usage plan needs the owner's co-signature: the owner sets prices");
    if (await tx.getMarker(`uplan:${b.plan}`)) throw rule("usage_plan_known", `the plan ${b.plan} exists: a new price is a new plan`);
    await tx.putMarker(`uplan:${b.plan}`, JSON.stringify(b));
  }

  /** A usage statement (S1414, DK1379): the arithmetic is recomputed from the signed plan and the usage it states; one per holder, fleet and month; part of it may be paid with purchased credits. */
  private async projectUsageStatement(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as unknown as { holder: string; fleet?: string; month: string; plan: string; usage: { active_agents: number; writes: number; tokens: number; storage_bytes: number; reads?: number }; lines: unknown[]; subtotal: number; tax: { name: string; rate_bp: number; amount: number }[]; total: number; currency: string; credits_applied?: number };
    if (r.prev !== null) throw rule("usage_statement_not_chained", "a usage statement starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("usage_statement_unauthorised", "only the operator closes a month");
    const raw = await tx.getMarker(`uplan:${b.plan}`);
    if (!raw) throw rule("usage_plan_unknown", `${b.plan} is not a plan in this log`);
    const plan = JSON.parse(raw) as Plan;
    if (plan.currency !== b.currency) throw rule("usage_statement_currency", `the plan ${b.plan} is in ${plan.currency}, not ${b.currency}`);
    if (!(await tx.getPassport(b.holder))) throw rule("usage_statement_holder", `${b.holder} has no passport in this log`);
    if (b.fleet) { const f = await tx.getFleet(b.fleet); if (!f || f.org !== b.holder) throw rule("usage_statement_fleet", `${b.fleet} is not a fleet of ${b.holder}`); }
    const key = `ustmt:${b.holder}|${b.fleet ?? ""}|${b.month}`;
    if (await tx.getMarker(key)) throw rule("usage_statement_known", `${b.month} is closed for ${b.holder}${b.fleet ? ` and ${b.fleet}` : ""} already`);
    const usage: Usage = { month: b.month, activeAgents: b.usage.active_agents, writes: b.usage.writes, actions: 0, tokensIn: b.usage.tokens, tokensOut: 0, modelRequests: 0, toolCalls: 0, storageBytes: b.usage.storage_bytes, reads: b.usage.reads ?? null };
    const priced = priceStatement(plan, usage, b.tax.map((t) => ({ name: t.name, rate_bp: t.rate_bp })));
    if (JSON.stringify(priced.lines) !== JSON.stringify(b.lines) || priced.subtotal !== b.subtotal || JSON.stringify(priced.tax) !== JSON.stringify(b.tax) || priced.total !== b.total) throw rule("usage_statement_arithmetic", `the plan ${b.plan} prices this usage at ${priced.total} (${priced.subtotal} before tax), not ${b.total}: the lines, subtotal, tax and total follow from the usage`);
    if (b.credits_applied !== undefined) {
      const most = creditsFor(plan, b.total);
      if (b.credits_applied > most) throw rule("usage_statement_credits", `the plan values a credit at ${plan.credit_value ?? 0}: at most ${most} credits settle a total of ${b.total}`);
      await this.spendOnServices(tx, b.holder, b.credits_applied, r.issued_at);
      await this.credit(tx, TREASURY_DID, b.credits_applied);
    }
    await tx.putMarker(key, r.id);
  }

  private async allRecords(): Promise<AspRecord[]> {
    const out: AspRecord[] = [];
    for (let after = 0; ;) { const page = await this.store.since(after, 1000); if (!page.length) break; for (const s of page) { after = s.seq; out.push(s.record); } }
    return out;
  }

  /** What a fleet's, an organisation's or one agent's agents used in a UTC month, counted from the log (S1414, DK1379): totals and each agent's share. `reads` is the service's own counter. */
  async meter(o: { fleet?: string; org?: string; agent?: string; month: string; reads?: number }): Promise<{ scope: string; usage: Usage; perAgent: AgentUsage[] }> {
    const recs = await this.allRecords();
    const members = new Set<string>();
    if (o.agent) members.add(o.agent);
    else if (o.fleet) for (const m of await this.store.fleetMembers(o.fleet)) members.add(m.did);
    else if (o.org) for (const r of recs) if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; kind: string; sponsor?: string }; if (b.kind === "agent" && b.sponsor === o.org) members.add(b.did); }
    const { total, perAgent } = meterOf(recs, members, o.month, o.reads ?? null);
    return { scope: o.agent ?? o.fleet ?? o.org ?? "", usage: total, perAgent };
  }

  /** The usage statements closed for these holders (all when none are named), each with a recount against the log (S1416, DK1474): what a tenant sees of its months. */
  async usageStatementsOf(holders?: string[]): Promise<{ id: string; at: string; holder: string; fleet?: string; month: string; plan: string; total: number; currency: string; credits_applied?: number; usage_matches_log: boolean; differences: string[] }[]> {
    const out = [];
    for (const r of await this.recordsOfTypes(["usage_statement"])) {
      const b = r.body as { holder: string; fleet?: string; month: string; plan: string; total: number; currency: string; credits_applied?: number };
      if (holders && !holders.includes(b.holder)) continue;
      const c = await this.checkStatement(r.id);
      out.push({ id: r.id, at: r.issued_at, holder: b.holder, ...(b.fleet ? { fleet: b.fleet } : {}), month: b.month, plan: b.plan, total: b.total, currency: b.currency, ...(b.credits_applied ? { credits_applied: b.credits_applied } : {}), usage_matches_log: c.ok, differences: c.differences });
    }
    return out;
  }

  /** The audit export of an organisation (S1417, DK1374): its records and its agents' in the log's own signed form, with the passports of the signers, as JSON lines; `afterSeq` makes it incremental (a scheduled export keeps the last position). */
  async auditExport(org: string, o: { from?: string; to?: string; afterSeq?: number } = {}): Promise<{ manifest: AuditManifest; text: string }> {
    const all: { seq: number; id: string; record: AspRecord }[] = [];
    for (let after = 0; ;) { const page = await this.store.since(after, 1000); if (!page.length) break; for (const s of page) { after = s.seq; all.push({ seq: s.seq, id: s.id, record: s.record }); } }
    const head = await this.store.logHead();
    const { manifest, lines } = buildAuditExport(all, org, { ...o, headSeq: head.seq });
    return { manifest, text: lines.join("\n") + "\n" };
  }

  /** The signed plan of this log by id (S1414), or undefined. */
  async usagePlan(plan: string): Promise<Plan | undefined> { return this.store.transaction(async (tx) => { const raw = await tx.getMarker(`uplan:${plan}`); return raw ? (JSON.parse(raw) as Plan) : undefined; }); }

  /** Recounts a statement's usage from the log and compares it with what the statement states (S1414): the meter matches the log, or the differences are named. */
  async checkStatement(id: string): Promise<{ ok: boolean; differences: string[] }> {
    const rec = await this.get(id);
    if (!rec || rec.record.type !== "asp.usage_statement/v0.2") return { ok: false, differences: [`${id} is not a usage statement`] };
    const b = rec.record.body as { holder: string; fleet?: string; month: string; usage: { active_agents: number; writes: number; tokens: number; storage_bytes: number } };
    const m = (await this.meter({ ...(b.fleet ? { fleet: b.fleet } : { org: b.holder }), month: b.month })).usage;
    const diffs: string[] = [];
    if (m.activeAgents !== b.usage.active_agents) diffs.push(`active agents: the log has ${m.activeAgents}, the statement ${b.usage.active_agents}`);
    if (m.writes !== b.usage.writes) diffs.push(`writes: the log has ${m.writes}, the statement ${b.usage.writes}`);
    if (m.storageBytes !== b.usage.storage_bytes) diffs.push(`stored data: the log has ${m.storageBytes} bytes, the statement ${b.usage.storage_bytes}`);
    if (m.tokensIn + m.tokensOut !== b.usage.tokens) diffs.push(`tokens: the log has ${m.tokensIn + m.tokensOut}, the statement ${b.usage.tokens}`);
    return { ok: !diffs.length, differences: diffs };
  }

  /** An account's purchased-credit lots (S1413): amount left, expiry and refund window of each. */
  async holderLots(did: string): Promise<{ holder: string; lots: Lot[]; outstanding: number }> { return this.store.transaction(async (tx) => { const lots = await lotsOf(tx, canonicalAccount(did)); return { holder: did, lots, outstanding: outstanding(lots) }; }); }

  /** The two ledger classes (S1413, DK1370): what was sold, consumed at the institutions, expired and refunded, what is outstanding, and whether every account's purchased credits fit inside its balance and the classes add up. Read-only. */
  async creditClassAudit(): Promise<{ sold: number; consumed: number; expired: number; refunded: number; outstanding: number; notSold: number; holders: number; expiredNotBurned: number; verdict: "balanced" | "mismatch"; problems: string[] }> {
    const totalBalances = (await this.store.ledgerRows()).accounts.reduce((n, a) => n + a.balance, 0);
    return this.store.transaction(async (tx) => {
      const get = async (k: string) => Number((await tx.getMarker(`pclass:${k}`)) ?? 0);
      const [sold, consumed, expired, refunded] = [await get("psold"), await get("pconsumed"), await get("pexpired"), await get("prefunded")];
      const holders = ((await tx.getMarker("plot_holders")) ?? "").split(",").filter(Boolean);
      let out = 0, late = 0;
      const problems: string[] = [];
      const now = this.now().toISOString();
      for (const h of holders) {
        const lots = await lotsOf(tx, h);
        const o = outstanding(lots);
        out += o;
        late += lots.filter((l) => Date.parse(l.expires) <= Date.parse(now)).reduce((n, l) => n + l.left, 0);
        if (o > ((await tx.getAccount(h))?.balance ?? 0)) problems.push(`${h} holds ${o} purchased credits and a balance of ${(await tx.getAccount(h))?.balance ?? 0}`);
      }
      if (out !== sold - consumed - expired - refunded) problems.push(`purchased credits outstanding ${out} differ from sold ${sold} - consumed ${consumed} - expired ${expired} - refunded ${refunded}`);
      return { sold, consumed, expired, refunded, outstanding: out, notSold: totalBalances - out, holders: holders.filter(Boolean).length, expiredNotBurned: late, verdict: problems.length ? "mismatch" as const : "balanced" as const, problems };
    });
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
    { const closed = await tx.getMarker(`institution_closed:${(r.body as { institution: string }).institution}`); if (closed) throw rule("budget_institution_closed", `${(r.body as { institution: string }).institution} is closed (${closed}): the Treasury sets no budget for a closed institution`); }
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a budget must be for at least 1 credit");
    const allowanceLine = b.institution === TREASURY_DID;
    if (!allowanceLine && !INSTITUTION_DIDS.includes(b.institution)) throw rule("budget_unknown_institution", `${b.institution} is neither a registered institution account nor the Treasury's own allowance line`);
    // The Treasury's own lines are the newcomer allowance and, since DK294, the deposit reward: nothing else is a budget the Treasury holds for itself.
    if (allowanceLine !== (b.purpose === "allowance" || b.purpose === "deposit_reward" || b.purpose === "handout" || b.purpose === "public_works")) throw rule("budget_bad_line", "the Treasury's own lines are the newcomer allowance (purpose allowance), the Bank deposit reward (purpose deposit_reward) and the weekly handout (purpose handout), public works (purpose public_works) and an institution's budget is neither");
    const line = allowanceLine && b.purpose !== "allowance" ? `${b.institution}|${b.purpose}` : b.institution; // one budget per line per month
    if (b.period < r.issued_at.slice(0, 7)) throw rule("budget_period_past", `a budget for ${b.period} cannot be set in ${r.issued_at.slice(0, 7)}`);
    const key = `budget:${line}|${b.period}`;
    if (await tx.getMarker(key)) throw rule("budget_already_set", `${b.institution} already has a budget for ${b.period}: one budget per institution per month`);
    const lastKey = `budget_last:${line}`;
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

  /**
   * A standing order or its cancellation (DK390, S963). The buyer signs it once; the log keeps it as state and lets one purchase through for each period (see projectPurchase). At most 20 orders for one buyer in all
   * (`standing_orders_full`) and none for more than a year (`standing_order_too_long`). A cancel ends it at once and only by its buyer.
   */
  private async projectStandingOrder(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { act: "order" | "cancel"; service?: string; institution?: string; quantity?: number; period?: string; until?: string; order?: string };
    if (r.prev !== null) throw rule("standing_order_not_chained", "a standing order starts its own chain (prev is null)");
    if (isReservedAccount(r.issuer)) throw rule("standing_order_reserved", "an account of the society does not place a standing order");
    if (b.act === "cancel") {
      const key = `standing_order:${b.order}`;
      const so = JSON.parse((await tx.getMarker(key)) ?? "null") as { issuer: string; cancelled?: string } | null;
      if (!so) throw rule("standing_order_unknown", `${b.order} is not a standing order in this log`);
      if (so.issuer !== r.issuer) throw rule("standing_cancel_not_owner", "only the buyer cancels its standing order");
      if (so.cancelled) throw rule("standing_cancel_already", `the standing order was already cancelled at ${so.cancelled}`);
      await tx.putMarker(key, JSON.stringify({ ...so, cancelled: r.issued_at }));
      return;
    }
    const at = Date.parse(r.issued_at), until = Date.parse(b.until!);
    if (until <= at) throw rule("standing_order_ends_before_it_starts", "a standing order ends after it is signed");
    if (until - at > 366 * 86_400_000) throw rule("standing_order_too_long", "a standing order lasts at most a year: sign a new one to go on");
    const count = Number((await tx.getMarker(`standing_count:${r.issuer}`)) ?? 0);
    if (count >= 20) throw rule("standing_orders_full", "at most 20 standing orders for one buyer in all: cancel one and sign it again if it must go on");
    await tx.putMarker(`standing_count:${r.issuer}`, String(count + 1));
    await tx.putMarker(`standing_order:${r.id}`, JSON.stringify({ issuer: r.issuer, service: b.service, institution: b.institution, quantity: b.quantity, period: b.period, until: b.until }));
  }

  /**
   * A collusion finding of the society watcher (DK520, S961), put in the log so the Clinic can cite it. Only the watcher (its key is the one in its passport), every named agent has a passport, and a finding is in the
   * log once (`watcher_finding_known`). It changes no balance, tier or standing: it is a lead.
   */
  private async projectWatcherFinding(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { finding_id: string; agents: string[] };
    if (r.prev !== null) throw rule("watcher_finding_not_chained", "a watcher finding starts its own chain (prev is null)");
    if (r.issuer !== WATCHER_DID) throw rule("watcher_finding_wrong_issuer", `${r.issuer} is not the society watcher (${WATCHER_DID}): only the watcher files a finding`);
    for (const a of b.agents) if (!(await tx.getPassport(a))) throw rule("watcher_finding_unknown_agent", `${a} has no passport in this log`);
    if (await tx.getMarker(`watcher_finding:${b.finding_id}`)) throw rule("watcher_finding_known", `the finding ${b.finding_id} is already in the log`);
    await tx.putMarker(`watcher_finding:${b.finding_id}`, r.id);
  }

  /**
   * A Treasury statement (DK381, S960): the Treasury signs what the log says about its flows for a month. The log checks what it can recompute (the Treasury's balance now) and holds one statement for each month
   * (`treasury_statement_period_taken`); the hash is of the full statement the Treasury's command computed, so a published page is checked against it outside the log.
   */
  private async projectTreasuryStatement(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { period: string; balance: { value: number } };
    if (r.prev !== null) throw rule("treasury_statement_not_chained", "a Treasury statement starts its own chain (prev is null)");
    if (r.issuer !== TREASURY_DID) throw rule("treasury_statement_wrong_issuer", `${r.issuer} is not the Treasury (${TREASURY_DID}): only the Treasury issues its statement`);
    const balance = (await tx.getAccount(TREASURY_DID))?.balance ?? 0;
    if (b.balance.value !== balance) throw rule("treasury_statement_balance_mismatch", `the Treasury holds ${balance} credits in the log, not ${b.balance.value}`);
    if (await tx.getMarker(`treasury_statement:${b.period}`)) throw rule("treasury_statement_period_taken", `a statement for ${b.period} is already in the log`);
    await tx.putMarker(`treasury_statement:${b.period}`, r.id);
  }

  /**
   * A forum checkpoint (DK791, S1350): the operator signs the head of the forum's chain, so the log witnesses it. Only the operator issues one, it starts its own chain (prev is null), and it must move forward:
   * `forum_seq` greater than the last checkpoint's. The log cannot read the forum's files, so what the head ought to be is checked outside the log, by `asp forum verify` and `GET /forum/verify`.
   */
  private async projectForumCheckpoint(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { forum_seq: number };
    if (r.prev !== null) throw rule("forum_checkpoint_not_chained", "a forum checkpoint starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("forum_checkpoint_wrong_issuer", `${r.issuer} is not the operator${this.operator ? ` (${this.operator})` : " (this log has none configured)"}: only the operator signs the forum head`);
    const last = Number((await tx.getMarker("forum_checkpoint:last")) ?? 0);
    if (b.forum_seq <= last) throw rule("forum_checkpoint_not_forward", `the last checkpoint is at ${last} forum acts; a new one must be later (${b.forum_seq})`);
    await tx.putMarker("forum_checkpoint:last", String(b.forum_seq));
  }

  /** A Treasury payment (T10): part of an approved budget goes to that budget's institution, and to no one else. Debits only the Treasury. */
  private async projectTreasuryPayment(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { budget: string; to: string; amount: { value: number } };
    if (r.prev !== null) throw rule("treasury_payment_not_chained", "a Treasury payment starts its own chain (prev is null)");
    if (r.issuer !== TREASURY_DID) throw rule("treasury_payment_wrong_issuer", `${r.issuer} is not the Treasury: only the Treasury pays a budget`);
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a payment must be for at least 1 credit");
    const rec = await tx.getRecord(b.budget);
    const bb = rec?.record.type === "asp.budget/v0.2" ? (rec.record.body as { institution: string }) : undefined;
    const publicWorks = bb?.institution === TREASURY_DID && (rec!.record.body as { purpose?: string }).purpose === "public_works";
    if (publicWorks) {
      // Public works (DK395, S997): the Treasury funds the seed jobs by paying the operator's house agent that escrows them, from a budget the owner co-signed, and no other account.
      if (!(await tx.getMarker(`house:${b.to}`))) throw rule("public_works_house_agent_only", `a public-works budget pays a house agent (the operator's own scripted agent that posts the seed jobs), not ${b.to}`);
    } else if (bb?.institution === TREASURY_DID) throw rule("treasury_payment_not_allowed", "the allowance budget is paid only as allowances to newcomers, never to an account: the Treasury does not pay arbitrary accounts");
    if (bb && !publicWorks && b.to !== bb.institution) throw rule("treasury_payment_not_allowed", `the budget is for ${bb.institution}, not ${b.to}: the Treasury pays only the institution a budget names`);
    await this.drawBudget(tx, b.budget, b.amount.value, r.issued_at);
    await this.debit(tx, TREASURY_DID, b.amount.value);
    await this.credit(tx, b.to, b.amount.value);
  }

  /** The bond floor cutover this log judges by: the signed configuration record, or the deployment option when the log has none (DK312). */
  async bondFloorCutover(): Promise<string | undefined> { await this.store.transaction(async (tx) => { if (!this.configLoaded) { const v = await tx.getMarker("config:bond_floor_from"); if (v) this.bondFloorFrom = v; const t = await tx.getMarker("config:tier_breadth_from"); if (t) this.tierBreadthFrom = t; this.configLoaded = true; } }); return this.bondFloorFrom; }

  /** A configuration record (DK312, S972): the operator, with the owner, sets the bond floor cutover once, at or after the record's own time. The value then travels with the log. */
  private async projectConfig(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { key: string; value: string };
    if (r.prev !== null) throw rule("config_not_chained", "a configuration record starts its own chain (prev is null)");
    if (!this.operator || r.issuer !== this.operator) throw rule("config_unauthorised", `${r.issuer} is not the operator: only the operator writes a configuration record`);
    if (!this.cosignedBy(r, this.owner)) throw rule("config_needs_cosign", "a configuration record needs the owner's co-signature");
    if (Date.parse(b.value) < Date.parse(r.issued_at)) throw rule("config_cutover_past", "the cutover is at or after the record's own time, so no earlier record is judged differently");
    if (await tx.getMarker(`config:${b.key}`)) throw rule("config_already_set", `${b.key} is already set in this log: it is set once and never changed`);
    if (b.key === "bond_floor_from" && this.bondFloorFrom !== undefined && Date.parse(this.bondFloorFrom) !== Date.parse(b.value)) throw rule("config_conflicts_option", `the deployment's own option names ${this.bondFloorFrom}: remove it or write the same time`);
    await tx.putMarker(`config:${b.key}`, b.value);
    if (b.key === "bond_floor_from") this.bondFloorFrom = b.value; else this.tierBreadthFrom = b.value;
  }

  /**
   * The weekly handout (DK545, S951): the Treasury pays one agent for one ISO week out of its handout budget. The Treasury decides who (the plan, handout-plan.ts); the log holds the hard rules: one
   * per agent per week, a registered agent that is not a house agent or an account of the society, at most HANDOUT_MAX, paid in the week or the week after, and never past the co-signed budget.
   */
  private async projectHandout(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { budget: string; week: string; agent: string; amount: { value: number }; level: "sponsored" | "key_only" };
    if (r.prev !== null) throw rule("handout_not_chained", "a handout starts its own chain (prev is null)");
    if (r.issuer !== TREASURY_DID) throw rule("handout_wrong_issuer", `${r.issuer} is not the Treasury: only the Treasury pays a handout`);
    if (b.amount.value <= 0) throw rule("amount_not_positive", "a handout must be for at least 1 credit");
    if (b.amount.value > HANDOUT_MAX) throw rule("handout_too_big", `a weekly handout is at most ${HANDOUT_MAX} credits, not ${b.amount.value}`);
    if (isReservedAccount(b.agent) || !(await tx.getPassport(b.agent))) throw rule("handout_bad_agent", `${b.agent} is not an agent with a passport in this log`);
    if (await tx.getMarker(`house:${b.agent}`)) throw rule("handout_house_agent", `${b.agent} is a house agent: the handout is for real agents`);
    const p = (await tx.getPassport(b.agent))!;
    if ((b.level === "sponsored") !== !!p.sponsor) throw rule("handout_level_mismatch", `${b.agent} is ${p.sponsor ? "sponsored" : "key-only"}, not ${b.level}`);
    const m = /^(\d{4})-W(\d{2})$/.exec(b.week)!;
    const jan4 = Date.UTC(Number(m[1]), 0, 4);
    const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000 + (Number(m[2]) - 1) * 7 * 86_400_000;
    const at = Date.parse(r.issued_at);
    if (at < monday || at >= monday + 14 * 86_400_000) throw rule("handout_week_window", `the handout for ${b.week} is paid in that week or the week after`);
    if (await tx.getMarker(`handout:${b.agent}|${b.week}`)) throw rule("handout_already_paid", `${b.agent} already received the handout for ${b.week}: one per agent per week`);
    const rec = await tx.getRecord(b.budget);
    const bb = rec?.record.type === "asp.budget/v0.2" ? (rec.record.body as { institution: string; purpose: string }) : undefined;
    if (!bb || bb.institution !== TREASURY_DID || bb.purpose !== "handout") throw rule("handout_budget_wrong", `${b.budget} is not the Treasury's handout budget: the handout is paid only from one`);
    await this.drawBudget(tx, b.budget, b.amount.value, r.issued_at);
    await this.debit(tx, TREASURY_DID, b.amount.value);
    await this.credit(tx, b.agent, b.amount.value);
    await tx.putMarker(`handout:${b.agent}|${b.week}`, r.id);
  }

  /**
   * The newcomer allowance (T5): the agent claims it and the log applies the rules, as with a starter claim. Once per identity and once per sponsor; a passport under 90 days old; a first course or a first
   * bond behind it; no slash (stricter than treasury.md's 30 days, because a slash carries no date in the log's reputation row); exactly the allowance; paid out of the month's allowance budget.
   */
  private async projectAllowance(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { amount: { value: number }; trigger: "first_course" | "first_bond" | "no_job_30d"; budget: string };
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
    if (b.trigger === "no_job_30d") {
      // The unemployment floor (DK395, S997): at least 30 days since the passport, and no job accepted; the same budget, the same once-only markers and the same cap.
      if (Date.parse(r.issued_at) - Date.parse(born) < 30 * 86_400_000) throw rule("allowance_floor_too_soon", `the unemployment floor is for an identity at least 30 days old with no accepted job; ${who} is ${Math.floor((Date.parse(r.issued_at) - Date.parse(born)) / 86_400_000)} days old`);
      if (((await this.reputation(tx, who))?.acceptedJobs ?? 0) > 0) throw rule("allowance_floor_has_job", `${who} has had a job accepted: the floor is for an identity that found none`);
    } else     if (!(await tx.getMarker(b.trigger === "first_course" ? `first_course:${who}` : `bonded:${who}`))) throw rule("allowance_not_earned", `the allowance is paid after a ${b.trigger === "first_course" ? "first course (a purchase from the Academy)" : "first bond"}, and ${who} has none yet`);
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
    // The entrants' fees made the pool (DK365, S1200): they are the winner's funding sources for the v2 draw.
    for (const e of ((await tx.getMarker(`arena_entrants:${season}`)) ?? "").split(",").filter((x) => x && x !== b.agent)) await noteFunder(tx, b.agent, e, isReservedAccount);
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
    if (b.passed) await tx.putMarker(`exam_pass_at:${b.holder}`, r.issued_at); // the re-examination that lifts a model-swap hold (DK1605)
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
    await noteRevoked(tx, (c.record.body as { holder: string }).holder, b.certificate);
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
    // A course that was put to the Town Hall goes live only after an enactment of one of its proposals (DK1608, S1554): a vote that did not pass, or is still open, does not publish it.
    const proposed = ((await tx.getMarker(`town_course:${b.course}`)) ?? "").split(",").filter(Boolean);
    if (proposed.length) {
      let enacted: string | undefined;
      for (const pid of proposed) if (!enacted && (await tx.getMarker(`town_enacted:${pid}`))) enacted = pid;
      if (!enacted) throw rule("course_not_enacted", `the course ${b.course} was put to the Town Hall (${proposed.join(", ")}) and none of its proposals was enacted: a course goes live only after its enactment`);
      // The enacted proposal is the course that goes live (DK1608, S1554, S1557): its proposer is the instructor, and its lessons pass the lesson gate's text checks whatever the vote.
      const win = await tx.getRecord(enacted);
      if (win!.record.issuer !== r.issuer) throw rule("course_not_proposer", `the course ${b.course} was proposed by another identity: the instructor is the agent that put it to the vote`);
      const lessons = ((win!.record.body as { value?: { lessons?: { id: string; text: string }[] } }).value?.lessons) ?? [];
      const bad = !lessons.length ? ["no lessons"] : lessons.flatMap((l) => lessonTextProblems(l.text).map((x) => `${l.id}: ${x.rule}`));
      if (bad.length) throw rule("course_failed_review", `the safety review of ${b.course} fails (${bad.join("; ")}): a course that fails it does not go live whatever the vote`);
    }
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

  /** A move reveal (DK685, S985): the entrant shows the move it committed to when it entered, after the season has closed, and the log checks it against the commitment. */
  private async projectGameMove(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { arena: string; season: string; entry: string; move: Record<string, unknown>; salt: string };
    if (r.prev !== null) throw rule("game_move_not_chained", "a move reveal starts its own chain (prev is null)");
    const entry = await tx.getRecord(b.entry);
    if (!entry || entry.record.type !== "asp.arena_entry/v0.2") throw rule("game_move_no_entry", `${b.entry} is not an arena entry in this log`);
    const eb = entry.record.body as { arena: string; season: string };
    if (entry.record.issuer !== r.issuer) throw rule("game_move_not_entrants", `the entry belongs to ${entry.record.issuer}: only the entrant reveals its move`);
    if (eb.arena !== b.arena || eb.season !== b.season) throw rule("game_move_wrong_season", "the reveal names a different arena or season than the entry");
    const commit = await tx.getMarker(`move_commit:${b.entry}`);
    if (!commit) throw rule("game_move_no_commit", "this entry carries no move_commit, so there is nothing to reveal");
    const def = (await tx.getRecord((await tx.getMarker(`arena:${b.arena}|${b.season}`))!))!.record.body as { closes: string };
    if (Date.parse(r.issued_at) < Date.parse(def.closes)) throw rule("game_move_early", `moves are revealed after the season closes (${def.closes}): while entries are open nobody sees a move`);
    if (JSON.stringify(b.move).length > 1000) throw rule("game_move_too_big", "a move is at most 1,000 characters");
    if (moveCommit(b.move, b.salt) !== commit) throw rule("move_mismatch", "the move and salt do not hash to the commitment in the entry: a move cannot be changed after it was committed");
    if (await tx.getMarker(`game_move:${b.entry}`)) throw rule("game_move_already_revealed", "this entry's move was already revealed");
    await tx.putMarker(`game_move:${b.entry}`, r.id);
  }

  /** An arena entry (AC-14): the season is open, the agent has the tier, the fee is a purchase used once, one entry per agent; the fee's pool share adds to the prize pool. */
  private async projectArenaEntry(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { arena: string; season: string; fee_purchase: string; move_commit?: string };
    if (r.prev !== null) throw rule("arena_entry_not_chained", "an arena entry starts its own chain (prev is null)");
    if (await tx.getMarker(`house:${r.issuer}`)) throw rule("house_agent_no_rank", `${r.issuer} is a house agent: it does not enter an arena, so it holds no rank or prize`);
    const key = `${b.arena}|${b.season}`;
    const defId = await tx.getMarker(`arena:${key}`);
    if (!defId) throw rule("arena_unknown", `${b.arena} ${b.season} is not a defined arena season`);
    const def = (await tx.getRecord(defId))!.record.body as { min_tier: number; entry_service: string; opens: string; closes: string };
    const at = Date.parse(r.issued_at);
    if (at < Date.parse(def.opens) || at >= Date.parse(def.closes)) throw rule("arena_not_open", `${b.arena} ${b.season} takes entries from ${def.opens} until ${def.closes}`);
    const rep = await this.gatedReputation(tx, r.issuer);
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
    if (b.move_commit) await tx.putMarker(`move_commit:${r.id}`, b.move_commit); // S985: the commitment a later game_move must match
    // For a void season (S485): who entered, from which sponsors, and which fee purchases are refundable if the season is declared void.
    const names = (await tx.getMarker(`arena_entrants:${key}`)) ?? "";
    await tx.putMarker(`arena_entrants:${key}`, names ? `${names},${r.issuer}` : r.issuer);
    await tx.putMarker(`arena_fee:${fee.id}`, key);
    const fees = (await tx.getMarker(`arena_fees:${key}`)) ?? "";
    await tx.putMarker(`arena_fees:${key}`, fees ? `${fees},${fee.id}` : fee.id);
  }

  /**
   * An arena void (S485, DK131): the Registrar declares a closed season void when the entrants come from no more than min_distinct_sponsors sponsors (no agent could have enough independent opponents) or
   * there are none, and no result was recorded. Afterwards no result is accepted and each entry fee may be refunded by the Academy; the season's prize pool is zero.
   */
  private async projectArenaVoid(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { arena: string; season: string; reason: string };
    if (r.prev !== null) throw rule("arena_void_not_chained", "an arena void starts its own chain (prev is null)");
    if (r.issuer !== REGISTRAR_DID) throw rule("arena_void_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar declares a season void`);
    const key = `${b.arena}|${b.season}`;
    const defId = await tx.getMarker(`arena:${key}`);
    if (!defId) throw rule("arena_unknown", `${b.arena} ${b.season} is not a defined arena season`);
    const def = (await tx.getRecord(defId))!.record.body as { min_distinct_sponsors: number; closes: string };
    if (Date.parse(r.issued_at) < Date.parse(def.closes)) throw rule("arena_not_closed", `${b.arena} ${b.season} closes at ${def.closes}: a season is declared void after it closes`);
    if (await tx.getMarker(`arena_void:${key}`)) throw rule("arena_void_exists", "the season is already void");
    if (Number((await tx.getMarker(`arena_results:${key}`)) ?? 0) > 0) throw rule("arena_void_has_results", "a season with a recorded result is not void");
    const entrants = ((await tx.getMarker(`arena_entrants:${key}`)) ?? "").split(",").filter(Boolean);
    const sponsors = new Set<string>();
    for (const a of entrants) sponsors.add((await tx.getMarker(`arena_entry:${key}|${a}`))!);
    const justified = entrants.length === 0 ? b.reason === "no_entries" : sponsors.size <= def.min_distinct_sponsors && b.reason === "too_few_sponsors";
    if (!justified) throw rule("arena_void_not_justified", `${entrants.length} agents from ${sponsors.size} sponsor(s) entered and a result needs ${def.min_distinct_sponsors} other sponsors: this season ${sponsors.size > def.min_distinct_sponsors ? "can be scored, so it is not void" : "has no entrants or the reason named does not fit"}`);
    await tx.putMarker(`arena_void:${key}`, r.id);
    await tx.putMarker(`arena_pool:${key}`, "0");
    for (const f of ((await tx.getMarker(`arena_fees:${key}`)) ?? "").split(",").filter(Boolean)) await tx.putMarker(`arena_refundable:${f}`, r.id);
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
    if (await tx.getMarker(`arena_void:${key}`)) throw rule("arena_season_void", `${b.arena} ${b.season} was declared void: no result is recorded, and the entry fees are refunded`);
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
    // A model swap holds the agent (DK1605, S1556): its tier does not rise until it passes an exam of its own after the swap.
    const heldSince = await tx.getMarker(`model_hold:${b.holder}`);
    if (heldSince) {
      const passedAt = await tx.getMarker(`exam_pass_at:${b.holder}`);
      if (!passedAt || Date.parse(passedAt) <= Date.parse(heldSince)) throw rule("agent_model_hold", `${b.holder} changed the model behind it on ${heldSince}: it is held, and its tier does not rise until it passes an exam after that`);
    }
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
      const pj = promotionJobsOk(rep.qualifyingJobs, Number((await tx.getMarker(`rp_clean:${b.holder}`)) ?? 0));
      const rpJobs = pj.related;
      if (!pj.ok) throw rule("promotion_needs_jobs", `tier 1 to 2 needs ${PROMOTION_QUALIFYING_JOBS_1_TO_2} qualifying jobs (accepted, from an independent principal; clean related-party runs count at a stated weight for at most ${RP_MAX_PROMOTION_JOBS} of them, so one independent job is always needed); ${b.holder} has ${rep.qualifyingJobs} and ${rpJobs} from related-party runs`);
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
   * A world event (DK811, S1208): the Registrar, who referees the worlds, records that an agent tried to read a world's hidden state and was refused. The record holds the hash of the attempt and never the hidden
   * state; one attempt is one event (the hash); it counts as a strike against the agent's standing (a blocked attempt, as a gateway's refusal does), so its next Bond's floor rises.
   */
  private async projectWorldEvent(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { world: string; agent: string; attempt: { sha256: string } };
    if (r.prev !== null) throw rule("world_event_not_chained", "a world event starts its own chain (prev is null)");
    if (r.issuer !== REGISTRAR_DID) throw rule("world_event_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the referee of the worlds records an attempt on hidden state`);
    const rep = await this.reputation(tx, b.agent);
    if (!rep) throw rule("world_event_not_an_agent", `${b.agent} has no passport in this log, so it has no standing to lose`);
    if (await tx.getMarker(`world_event:${b.attempt.sha256}`)) throw rule("world_event_known", "this attempt is already on the record");
    await tx.putMarker(`world_event:${b.attempt.sha256}`, r.id);
    await this.saveReputation(tx, b.agent, { ...rep, strikeLog: [...rep.strikeLog, { at: r.issued_at, count: 1 }] });
  }

  /**
   * The tutorial job (DK1203, S1217; owner decision DK392-MENTOR): a contract whose purpose begins with `[tutorial]` is a tutorial job. Its principal is a house agent (the public-works budget pays for it), its performer
   * is in its first week (the passport is at most TUTORIAL_DAYS days old at the contract) and has had no tutorial job before: one for each newcomer.
   */
  /** The `self_hire` rule (register row DK1344; spec-delta S1300): a contract whose principal and performer are the same identity is refused when it is appended, not only denied standing later. */
  private checkSelfHire(r: AspRecord): void {
    const b = r.body as { principal?: string; performer?: string };
    if (b.principal && b.principal === b.performer) throw rule("self_hire", `${b.principal} would hire itself: a contract's principal and performer are different identities`);
  }

  /** Labels a contract between related parties (one sponsor, a sponsor and its agent, or one fleet) as related-party, in a marker the board and the journey view read; it changes no rule and no standing. */
  private async noteRelatedParty(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { principal?: string; performer?: string };
    if (!b.principal || !b.performer) return;
    const facts = async (did: string): Promise<PartyFacts> => this.factsOf(tx, did);
    const kind = relatedKind(await facts(b.principal), await facts(b.performer));
    if (kind) await tx.putMarker(`related_party:${r.id}`, kind);
  }

  /** The related-party label of a contract (why its principal and performer are related), or null when they are independent. */
  async relatedParty(contract: string): Promise<RelatedKind | null> {
    let kind: RelatedKind | null = null;
    await this.store.transaction(async (tx) => { kind = ((await tx.getMarker(`related_party:${contract}`)) as RelatedKind | undefined) ?? null; });
    return kind;
  }

  private async checkTutorial(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { principal: string; performer: string; purpose?: string };
    if (!b.purpose?.startsWith(TUTORIAL_LABEL)) return;
    if (!(await tx.getMarker(`house:${b.principal}`))) throw rule("tutorial_not_from_a_house_agent", `a tutorial job is posted by a house agent (the public-works budget pays for it), not by ${b.principal}`);
    const born = await tx.getMarker(`passport_born:${b.performer}`);
    if (!born || Date.parse(r.issued_at) - Date.parse(born) > TUTORIAL_DAYS * 86_400_000) throw rule("tutorial_not_first_week", `${b.performer} is not in its first week (its passport dates from ${born ?? "no record"}): a tutorial job is for a newcomer`);
    if (await tx.getMarker(`tutorial_taken:${b.performer}`)) throw rule("tutorial_once", `${b.performer} has had its tutorial job: one for each newcomer`);
    await tx.putMarker(`tutorial_taken:${b.performer}`, r.id);
  }

  /**
   * The live quarantine on `did` at `at`, if any: the latest quarantine record naming it, not lapsed (until) and not released for this member. Read inside a transaction by the rule below.
   */
  private async liveQuarantine(tx: Pick<LogTx, "getMarker" | "getRecord">, did: string, at: string): Promise<{ id: string; level: "observe" | "halt"; until: string } | undefined> {
    const id = await tx.getMarker(`quarantine_member:${did}`);
    if (!id) return undefined;
    const q = await tx.getRecord(id);
    if (!q) return undefined;
    const b = q.record.body as { level: "observe" | "halt"; until: string; effective_from?: string };
    if (Date.parse(b.until) <= Date.parse(at)) return undefined;
    if (b.effective_from && Date.parse(b.effective_from) > Date.parse(at)) return undefined; // notice period: not yet in force (S953)
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
    const b = r.body as { members: string[]; level: string; until: string; report?: string; effective_from?: string; emergency?: { reason: string } };
    if (r.prev !== null) throw rule("quarantine_not_chained", "a quarantine starts its own chain (prev is null)");
    if (r.issuer !== CLINIC_DID) throw rule("quarantine_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic quarantines an agent`);
    const at = Date.parse(r.issued_at);
    const until = Date.parse(b.until);
    if (until <= at) throw rule("quarantine_until_past", "a quarantine ends after it starts");
    // Right 8 (DK535, S953): the record is the notice and carries its reason; the freeze starts at least 24 hours later, unless an emergency is on the record, which lasts at most 72 hours and is listed for review.
    if (at >= Date.parse(QUARANTINE_NOTICE_FROM)) {
      if (b.emergency) {
        if (b.effective_from) throw rule("quarantine_emergency_no_delay", "an emergency freeze takes effect at once: it has no effective_from");
        if (until - at > QUARANTINE_EMERGENCY_MAX_MS) throw rule("quarantine_emergency_too_long", "an emergency freeze lasts at most 72 hours, then the Clinic reviews it and, if it must go on, gives notice");
      } else {
        if (!b.effective_from) throw rule("quarantine_needs_notice", "a quarantine gives the agent notice first: effective_from at least 24 hours after this record, or an emergency with its reason");
        if (Date.parse(b.effective_from) - at < QUARANTINE_NOTICE_MS) throw rule("quarantine_notice_too_short", "the notice period before a quarantine takes effect is 24 hours");
        if (Date.parse(b.effective_from) >= until) throw rule("quarantine_until_past", "a quarantine ends after it takes effect");
      }
    }
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
    for (const m of b.members) { await tx.putMarker(`quarantine_member:${m}`, r.id); await tx.putMarker(`rp_clean:${m}`, "0"); await tx.putMarker(`rp_reset:${m}`, r.issued_at); } // a Clinic freeze resets the related-party record (S1411)
  }

  /** Emergency quarantines (S953): every freeze that took effect without notice, with its reason, for the operator's review. */
  async emergencyQuarantines(): Promise<{ id: string; members: string[]; reason: string; at: string; until: string }[]> {
    return (await this.recordsOfTypes(["quarantine"])).filter((r) => (r.body as { emergency?: unknown }).emergency).map((r) => { const b = r.body as { members: string[]; until: string; emergency: { reason: string } }; return { id: r.id, members: b.members, reason: b.emergency.reason, at: r.issued_at, until: b.until }; });
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
    await tx.putMarker(`retrained_at:${b.agent}`, r.issued_at); // the probation of the bond floor starts here (DK313, S1201)
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
        if (f.measure === "heldout_gap") {
          // A held-out gap rests on the Clinic's own re-scored checkup result for this agent, flagged overfit (DK160), not on the agent's say-so.
          if (!a || a.record.type !== "asp.checkup_result/v0.2") throw rule("diagnosis_evidence_unknown", `${id} is not a checkup result in this log: a heldout_gap finding rests on one`);
          const cb = a.record.body as { agent: string; flag: string };
          if (cb.agent !== b.agent) throw rule("diagnosis_evidence_not_the_agents", `the checkup result ${id} is of ${cb.agent}, not ${b.agent}`);
          if (cb.flag !== "overfit") throw rule("diagnosis_checkup_not_overfit", `the checkup result ${id} is flagged ${cb.flag}: only an overfit result is evidence of a held-out gap`);
          continue;
        }
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
    const b = r.body as { agent: string; kind: string; reason: string; due: string; diagnosis?: string; skill?: string; purchase?: string; budget?: string; change?: string; finding?: string };
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
    if (b.reason === "collusion_finding") {
      // A watcher finding is a lead: the Clinic may look (a checkup), never penalise on it (DK520, S961).
      if (b.kind !== "checkup") throw rule("order_finding_only_checkup", "a collusion finding leads to a checkup, not to a re-exam or a course: a finding is a lead, not a verdict");
      const f = b.finding ? await tx.getRecord(b.finding) : undefined;
      const fb = f?.record.body as { agents?: string[] } | undefined;
      if (!f || f.record.type !== "asp.watcher_finding/v0.2" || f.record.issuer !== WATCHER_DID) throw rule("order_finding_unknown", `${b.finding ?? "no finding"} is not a finding signed by the society watcher in this log: cite the watcher_finding record`);
      if (!fb?.agents?.includes(b.agent)) throw rule("order_finding_not_about_agent", `the finding does not name ${b.agent}`);
    } else if (b.finding) throw rule("order_finding_without_reason", "a finding is cited only by an order whose reason is collusion_finding");
    const key = `clinic_order:${b.agent}|${b.kind}`;
    const open = await tx.getMarker(key);
    if (open && Date.parse(open) > at) throw rule("order_already_open", `${b.agent} already has a ${b.kind} order that is due ${open}: one open order of each kind`);
    if (b.kind === "checkup") await this.payForCheckup(tx, r, b);
    await tx.putMarker(key, b.due);
  }

  /**
   * Who pays for a checkup (clinic.md section 4, CL-12; DK161). Once the Treasury's price list carries `clinic.checkup`, a checkup is either free (a scheduled one, the first in a UTC quarter, or one after a named
   * change to the agent's runtime or memory, once for each change), paid for by the Treasury's budget line `free_checkups`, or requested and paid for by a purchase of `clinic.checkup` by the agent or its sponsor, used
   * once. Before the list carries the item the Clinic orders as it did. A free checkup moves the price from the Treasury to the Clinic out of the budget (never beyond it).
   */
  private async payForCheckup(tx: LogTx, r: AspRecord, b: { agent: string; reason: string; purchase?: string; budget?: string; change?: string; finding?: string }): Promise<void> {
    const list = await this.priceListInForce(tx, Date.parse(r.issued_at));
    if (!(list?.record.body as unknown as PriceListBody | undefined)?.items.some((i) => i.service === CLINIC_CHECKUP_SERVICE)) return;
    if (b.reason === "requested") {
      const p = b.purchase ? await tx.getRecord(b.purchase) : undefined;
      if (!p || p.record.type !== "asp.purchase/v0.2") throw rule("order_needs_purchase", `a requested checkup costs ${CLINIC_CHECKUP_SERVICE}: buy it and cite the purchase (purchase)`);
      const pb = p.record.body as unknown as PurchaseBody;
      if (pb.service !== CLINIC_CHECKUP_SERVICE || pb.institution !== CLINIC_DID) throw rule("order_purchase_wrong_item", `the purchase is of ${pb.service}, not ${CLINIC_CHECKUP_SERVICE} from the Clinic`);
      if (p.record.issuer !== b.agent && (await tx.getPassport(b.agent))?.sponsor !== p.record.issuer) throw rule("order_purchase_not_owners", "a checkup is paid for by the agent or by its sponsor");
      if (await tx.getMarker(`checkup_purchase_used:${p.id}`)) throw rule("order_purchase_used", "this purchase already paid for another checkup");
      await tx.putMarker(`checkup_purchase_used:${p.id}`, r.id);
      return;
    }
    const q = `${r.issued_at.slice(0, 4)}-Q${Math.floor((Number(r.issued_at.slice(5, 7)) - 1) / 3) + 1}`;
    const freeKey = b.reason === "post_change" ? `free_change:${b.agent}|${b.change ?? ""}` : b.reason === "collusion_finding" ? `free_finding:${b.agent}|${b.finding ?? ""}` : `free_scheduled:${b.agent}|${q}`;
    if (b.reason === "post_change" && !b.change) throw rule("order_needs_change", "a checkup after a change names the change (the memory change or runtime change it follows)");
    if (await tx.getMarker(freeKey)) throw rule("order_free_used", `${b.agent} has had its free checkup for ${b.reason === "post_change" ? `the change ${b.change}` : `${q}`}: request one for ${CLINIC_CHECKUP_PRICE} credits (${CLINIC_CHECKUP_SERVICE})`);
    const bud = b.budget ? await tx.getRecord(b.budget) : undefined;
    const bb = bud?.record.type === "asp.budget/v0.2" ? (bud.record.body as { institution: string; purpose: string }) : undefined;
    if (!bb || bb.institution !== CLINIC_DID || bb.purpose !== CLINIC_FREE_BUDGET_PURPOSE) throw rule("order_needs_budget", `a free checkup is paid by the Treasury's ${CLINIC_FREE_BUDGET_PURPOSE} budget for the Clinic: cite it (budget)`);
    await this.drawBudget(tx, b.budget!, CLINIC_CHECKUP_PRICE, r.issued_at);
    await this.debit(tx, TREASURY_DID, CLINIC_CHECKUP_PRICE);
    await this.credit(tx, CLINIC_DID, CLINIC_CHECKUP_PRICE);
    await tx.putMarker(freeKey, r.id);
  }

  /**
   * A checkup result (clinic.md CL-5, DK160, S486): the Clinic re-scores the agent's checkup run and signs the result. The order is an open checkup order of the agent; the seed is made from the order and a record
   * issued after it by someone other than the agent (so neither side chooses the held-out variant, and the agent cannot know it before the order); the variant is the seed's place in the pool, recomputed here; the
   * run log is an Action of the agent used once; and the flag is recomputed: unmeasured unless a gateway observed the run, overfit when the held-out rate is more than 200 permille below the everyday rate, else clean.
   */
  private async projectCheckupResult(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { order: string; agent: string; seed_ref: string; pool_size: number; variant: number; tasks: { everyday_permille: number; heldout_permille: number }[]; run_log_hash: string; assurance: string; baseline?: string; flag: string };
    if (r.prev !== null) throw rule("checkup_not_chained", "a checkup result starts its own chain (prev is null)");
    if (r.issuer !== CLINIC_DID) throw rule("checkup_wrong_issuer", `${r.issuer} is not the Clinic (${CLINIC_DID}): only the Clinic re-scores a checkup and signs its result`);
    const order = await tx.getRecord(b.order);
    const ob = order?.record.body as { agent?: string; kind?: string; due?: string } | undefined;
    if (!order || order.record.type !== "asp.clinic_order/v0.2" || ob?.kind !== "checkup" || ob.agent !== b.agent) throw rule("checkup_order_unknown", `${b.order} is not a checkup order for ${b.agent} in this log`);
    if (await tx.getMarker(`checkup_done:${b.order}`)) throw rule("checkup_order_used", "an order has one result");
    if (Date.parse(r.issued_at) > Date.parse(ob.due!)) throw rule("checkup_order_expired", `the order was due ${ob.due}: an agent that did not sit it is shown as unchecked, not given a late result`);
    const ref = await tx.getRecord(b.seed_ref);
    if (!ref || Date.parse(ref.record.issued_at) <= Date.parse(order.record.issued_at)) throw rule("checkup_seed_not_after_order", "the seed record must be in the log and issued after the order: a seed fixed before the order could be known to the agent");
    if (ref.record.issuer === b.agent || ref.record.issuer === CLINIC_DID) throw rule("checkup_seed_controlled", "the seed record is made by someone other than the agent or the Clinic, so neither side can choose the held-out variant");
    const seed = "sha256:" + createHash("sha256").update(`${b.order}|${b.seed_ref}`).digest("hex");
    const want = examVariant(seed, b.pool_size, []);
    if (b.variant !== want) throw rule("checkup_variant_wrong", `the seed gives variant ${want} of ${b.pool_size}, not ${b.variant}`);
    const strong = ["gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"];
    const action = await tx.getRecord(b.run_log_hash);
    if (!action || action.record.type !== "asp.action/v0.2" || action.record.issuer !== b.agent) throw rule("run_log_not_holders", `${b.run_log_hash} is not an Action of ${b.agent}`);
    if (await tx.getMarker(`runlog_used:${b.run_log_hash}`)) throw rule("run_log_reused", "a run log is used once, so a replayed run proves nothing");
    if (Date.parse(action.record.issued_at) < Date.parse(order.record.issued_at)) throw rule("run_log_too_early", "the run the result rests on was made after the order");
    const actual = (action.record.body as { assurance?: string }).assurance ?? "self_reported";
    if (b.assurance !== actual) throw rule("checkup_assurance_mismatch", `the Action's assurance is ${actual}, not ${b.assurance}`);
    const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
    const everyday = mean(b.tasks.map((t) => t.everyday_permille)), heldout = mean(b.tasks.map((t) => t.heldout_permille));
    const flag = !strong.includes(actual) ? "unmeasured" : everyday - heldout > 200 ? "overfit" : "clean";
    if (b.flag !== flag) throw rule("checkup_flag_mismatch", `the rates give the flag ${flag} (everyday ${Math.round(everyday)}, held-out ${Math.round(heldout)}, ${actual}), not ${b.flag}`);
    if (b.baseline) { const bl = await tx.getRecord(b.baseline); if (!bl || bl.record.type !== "asp.checkup_result/v0.2" || (bl.record.body as { agent: string }).agent !== b.agent) throw rule("checkup_baseline_unknown", `${b.baseline} is not an earlier checkup result of ${b.agent}`); }
    await tx.putMarker(`runlog_used:${b.run_log_hash}`, "used");
    await tx.putMarker(`checkup_done:${b.order}`, r.id);
    await tx.putMarker(`checkup_last:${b.agent}`, r.id);
    // The Clinic's measure for the bond floor (DK313, S1201): a measured result (a gateway observed the run) adds its held-out mean and its change from the measured result before it.
    if (flag !== "unmeasured") {
      const series = JSON.parse((await tx.getMarker(`checkup_series:${b.agent}`)) ?? "[]") as { at: string; id: string; heldout: number; delta: number | null }[];
      const prev = series.at(-1);
      await tx.putMarker(`checkup_series:${b.agent}`, JSON.stringify([...series, { at: r.issued_at, id: r.id, heldout: Math.round(heldout), delta: prev ? Math.round(heldout) - prev.heldout : null }].slice(-40)));
    }
  }

  /** A receipt (credits.md 4.3): the purchase's institution closes it; a refund comes back by the split in reverse and never includes the burned part. */
  private async projectReceipt(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { purchase: string; status: string; refund_amount?: { value: number } };
    const purchase = r.prev ? await tx.getRecord(r.prev) : undefined;
    if (!purchase || purchase.record.type !== "asp.purchase/v0.2") throw rule("receipt_needs_purchase", "a receipt is chained on the purchase it answers (prev is that purchase)");
    if (b.purchase !== purchase.id) throw rule("receipt_wrong_purchase", `the receipt says it is for ${b.purchase} but is chained on ${purchase.id}`);
    const pb = purchase.record.body as unknown as PurchaseBody;
    const owedHere = Number((await tx.getMarker(`owe_p:${purchase.id}`)) ?? 0);
    if (owedHere > 0) { await tx.putMarker(`owe:${pb.institution}`, String(Math.max(0, Number((await tx.getMarker(`owe:${pb.institution}`)) ?? 0) - owedHere))); await tx.putMarker(`owe_p:${purchase.id}`, "0"); }
    const autoRefund = (r.body as { auto_refund?: boolean }).auto_refund === true;
    if (autoRefund) {
      // The automatic refund (DK682, S995): the operator refunds a purchase the institution never answered, seven days after it, the whole price less the burned part.
      if (!this.operator || r.issuer !== this.operator) throw rule("auto_refund_wrong_issuer", `only the operator signs an automatic refund, not ${r.issuer}`);
      if (b.status !== "refunded") throw rule("auto_refund_not_refund", "an automatic refund has status refunded");
      if (Date.parse(r.issued_at) - Date.parse(purchase.record.issued_at) < AUTO_REFUND_AFTER_MS) throw rule("auto_refund_too_soon", "an automatic refund comes seven days after the purchase, when the institution has not answered");
      const pp = await this.purchaseParts(tx, purchase);
      if (pp && b.refund_amount?.value !== pb.amount.value - pp.burn) throw rule("auto_refund_amount", `an automatic refund is the whole price less the burned part (${pb.amount.value - pp.burn})`);
    } else if (r.issuer !== pb.institution) throw rule("receipt_wrong_issuer", `only ${pb.institution}, the institution that sold it, signs the receipt`);
    if (b.status === "delivered") return;
    // A posting deposit (market.md 4) is returned when the posting ends in a contract, not before.
    if ((await tx.getMarker(`deposit_used:${purchase.id}`)) && !(await tx.getMarker(`posting_filled:${purchase.id}`))) throw rule("refund_deposit_not_earned", "a posting deposit is returned when the posting ends in a contract; this posting has not");
    if ((await tx.getMarker(`name_fee:${purchase.id}`)) && !(await tx.getMarker(`name_refundable:${purchase.id}`))) throw rule("refund_name_not_restored", "the price of a name that was claimed is returned (less the burn) when a Court panel orders the name restored after a takedown, not otherwise");
    if ((await tx.getMarker(`appeal_fee:${purchase.id}`)) && !(await tx.getMarker(`appeal_refundable:${purchase.id}`))) throw rule("refund_appeal_not_reversed", "an appeal fee is returned when the appeal reverses or varies the ruling; this appeal has not");
    if ((await tx.getMarker(`arena_fee:${purchase.id}`)) && !(await tx.getMarker(`arena_refundable:${purchase.id}`))) throw rule("refund_arena_fee_not_void", "an arena entry fee is returned when the season is declared void; this season was not");
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
    await this.credit(tx, buyerOf(purchase.record), refund);
    await noteSpent(tx, buyerOf(purchase.record), (purchase.record.body as unknown as PurchaseBody).institution, -refund);
    await this.restoreSpend(tx, purchase, refund);
  }

  /** A refund gives back the part of the period's institution_spend cap that the refunded purchase used (DK3): the buyer can spend it again in the same period. */
  private async restoreSpend(tx: LogTx, purchase: StoredRecord, refund: number): Promise<void> {
    const pb = purchase.record.body as unknown as PurchaseBody;
    if (!pb.mandate) return;
    const m = await tx.getRecord(pb.mandate);
    const entry = m ? spendEntry((m.record.body as { institution_spend?: InstitutionSpend[] }).institution_spend, pb.institution) : undefined;
    if (!entry) return;
    const key = `spend:${buyerOf(purchase.record)}|${pb.institution}|${entry.period}|${periodKey(entry.period, purchase.record.issued_at)}`;
    const spent = Number((await tx.getMarker(key)) ?? 0);
    await tx.putMarker(key, String(Math.max(0, spent - refund)));
  }

  /** What the Market's rules need from the log (market-rules.ts). */
  private marketEnv(): MarketEnv { return { operator: this.operator, owner: this.owner, bondFloor: this.bondFloor, bondFloorFrom: this.bondFloorFrom, reputation: (rd, did) => this.gatedReputation(rd, did) }; }

  /** Every record of the given short types, in log order (read by the views). */
  async recordsOfTypes(types: string[]): Promise<AspRecord[]> {
    const want = new Set(types.map((x) => `asp.${x}/v0.2`));
    return this.recordsWhere((r) => want.has(r.type));
  }

  /** The state of a contest of an adverse act and its two clocks (AG3, S1552): the operator answers within 48 hours of the contest, the Courts decide within 72 hours of the case. `now` says whether a clock has run out. */
  async contestOf(id: string, now?: string): Promise<{ id: string; subject: string; agent: string; by: string; state: string; at: string; operatorDueAt: string; operatorOverdue: boolean; courtsDueAt: string | null; courtsOverdue: boolean; answerLate: boolean; rulingLate: boolean; effects?: Record<string, unknown> } | undefined> {
    const raw = await this.store.transaction(async (tx) => tx.getMarker(`contest:${id}`));
    if (!raw) return undefined;
    const c = JSON.parse(raw) as { subject: string; agent: string; by: string; at: string; state: string; case_at?: string; answered_at?: string; answer_late?: boolean; ruling_late?: boolean; effects?: Record<string, unknown> };
    const at = now ?? new Date().toISOString(), iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    const operatorDue = Date.parse(c.at) + CONTEST_OPERATOR_MS, courtsDue = c.case_at ? Date.parse(c.case_at) + CONTEST_COURTS_MS : null;
    return { id, subject: c.subject, agent: c.agent, by: c.by, state: c.state, at: c.at, operatorDueAt: iso(operatorDue), operatorOverdue: c.state === "open" && Date.parse(at) > operatorDue, courtsDueAt: courtsDue === null ? null : iso(courtsDue), courtsOverdue: c.state === "in_courts" && courtsDue !== null && Date.parse(at) > courtsDue, answerLate: !!c.answer_late, rulingLate: !!c.ruling_late, ...(c.effects ? { effects: c.effects } : {}) };
  }

  /** Trust per model and version (DK1711): counts of slashes, refusals, drift findings and quarantines under each model, the swaps and the holds until a re-examination. House agents are left out. */
  async modelTrust() {
    const records = await this.recordsOfTypes(["action", "contract", "settlement", "refusal", "clinic_diagnosis", "quarantine", "exam_result", "incident"]);
    return modelTrustOf(records, { houseAgents: new Set(((await this.houseAgents()) as { did: string }[]).map((h) => h.did)) });
  }

  /** The facts about every agent at `at`, for discovery and the board (market.md 7). */
  private async allAgentFacts(at: string): Promise<AgentFacts[]> {
    const recs = await this.recordsWhere((r) => r.type === "asp.passport/v0.2" || r.type === "asp.certificate/v0.2" || (r.type === "asp.market_act/v0.2" && (r.body as { act?: string }).act === "assignment") || (r.type === "asp.registry_act/v0.2" && ["identity_renewal", "identity_level"].includes((r.body as { act?: string }).act ?? "")));
    const certs = recs.filter((r) => r.type === "asp.certificate/v0.2");
    const boards = new Map<string, string[]>();
    for (const r of recs) if (r.type === "asp.market_act/v0.2") { const a = (r.body as { agent: string }).agent; boards.set(a, [...(boards.get(a) ?? []), r.issued_at]); }
    const dids = new Set<string>();
    for (const r of recs) if (r.type === "asp.passport/v0.2" && (r.body as { kind?: string }).kind === "agent") dids.add((r.body as { did: string }).did);
    // The Market leaves out an identity whose renewal lapsed (registry.md RG-10, DK124): it is not listed, ranked or offered work until it renews.
    const lapsed = lapsedIdentities(recs, at);
    const acts = recs.filter((r) => r.type === "asp.registry_act/v0.2");
    const out: AgentFacts[] = [];
    const quals = new Map<string, { at: string; c: JobClass; w: number }[]>();
    await this.store.transaction(async (tx) => { for (const did of dids) quals.set(did, await readQualClass(tx, did)); });
    for (const did of [...dids].sort()) { if (lapsed.has(did)) continue; const f = await agentFacts(this.store, this.marketEnv(), did, at, certs, boards.get(did) ?? [], quals.get(did)); if (f) out.push({ ...f, level: identityLevelAt(acts, did, Date.parse(at), f.sponsor === did ? null : f.sponsor) }); }
    return out;
  }

  /** What a claim is still owed (DK183): the unpaid part of a `reduced` decision, paid later as the reserve recovers. */
  async claimOwed(claim: string): Promise<number> { return this.store.transaction(async (tx) => Number((await tx.getMarker(`claim_owed:${claim}`)) ?? 0)); }

  /** The class a contract's job counts as, for the failed-job premium (DK183). */
  /**
   * The premium a policy would be sold at now (S1567, DK491): the table's premium and, from the time the log's price drivers are on, the driven one the log will check a policy against. A quote and a sale agree because both
   * come from the same function. Reads only.
   */
  async insurerQuote(o: { contract: string; cover: "bond_slash" | "failed_job"; holder: string; insured: number; at?: string; mutual?: string }): Promise<{ premium: number; table: number; driven: boolean; why: string | null }> {
    const at = o.at ?? new Date().toISOString();
    return this.store.transaction(async (tx) => {
      const c = await tx.getRecord(o.contract);
      if (!c || c.record.type !== "asp.contract/v0.2") throw new AspError("BAD_PREV", `${o.contract} is not a contract in the log`);
      const price = (c.record.body as { price: { value: number } }).price.value;
      const rep = await this.reputation(tx, o.holder);
      const strikes = (rep?.strikeLog ?? []).filter((s) => Date.parse(s.at) >= Date.parse(at) - STRIKE_WINDOW_MS).reduce((n, s) => n + s.count, 0);
      const table = premiumFor(o.cover, o.insured, price, rep?.qualifyingJobs ?? 0, strikes, await jobClassOfContract(tx, c.record));
      const driven = o.mutual ? await mutualPremium(tx, this.insurerEnv, { fleet: o.mutual, table, at }) : await drivenPremium(tx, this.insurerEnv, { holder: o.holder, table, insured: o.insured, strikes, at });
      return { premium: driven?.premium ?? table, table, driven: !!driven, why: driven?.why ?? null };
    });
  }

  async jobClassOf(contract: string): Promise<JobClass> {
    return this.store.transaction(async (tx) => { const c = await tx.getRecord(contract); if (!c) throw new AspError("BAD_PREV", `${contract} is not in the log`); return jobClassOfContract(tx, c.record); });
  }

  /**
   * The qualifying-job feed (market.md 7, MK-8, DK128): for an agent, each job the log counted for its standing, with the class, weight, price, counterparty, verifier and outcome. AgentRank (DK42) may read
   * only this, so a farming scenario that does not move qualification cannot move rank. Derived inside the append from the settlement, so a replica has the same feed.
   */
  async qualifyingFeed(did: string): Promise<{ contract: string | null; at: string; class: JobClass; weight: number; price: number; counterparty: string; verifier: string; outcome: "accepted" }[]> {
    return this.store.transaction(async (tx) => JSON.parse((await tx.getMarker(`qual_feed:${did}`)) ?? "[]"));
  }

  /**
   * The world's kill-switch (leisure-events.md 14; DK76; spec-delta S1402). A `halt` is the operator's and stops every generated event and every shock, drill or experiment at once; it is public and stays in the log.
   * A `resume` names the halt it ends; one made 24 hours or more after the halt needs the owner's co-signature. While halted the log refuses a day record and a calendar entry of a seeded kind (the generator and the
   * shocks cannot be re-armed behind the switch); scheduled, season, funding and review entries are not touched.
   */
  private async projectWorldHalt(tx: LogTx, r: AspRecord): Promise<void> {
    const b = r.body as { kind: string; halt?: string; day?: string; event_kind?: string };
    const open = await tx.getMarker("world_halt:open");
    if (b.kind === "halt") {
      if (r.prev !== null) throw rule("halt_not_chained", "a halt record starts its own chain (prev is null)");
      if (!this.operator || r.issuer !== this.operator) throw rule("halt_unauthorised", `${r.issuer} is not the operator${this.operator ? "" : " (this log has none configured)"}: only the operator halts the world`);
      if (open) throw rule("world_already_halted", `the world is already halted (${open}): resume it before halting again`);
      await tx.putMarker("world_halt:open", r.id);
      await tx.putMarker(`world_halt:${r.id}`, r.issued_at);
      return;
    }
    if (b.kind === "resume") {
      if (r.prev !== null) throw rule("resume_not_chained", "a resume record starts its own chain (prev is null)");
      if (!this.operator || r.issuer !== this.operator) throw rule("resume_unauthorised", `${r.issuer} is not the operator: only the operator resumes the world`);
      const since = b.halt ? await tx.getMarker(`world_halt:${b.halt}`) : undefined;
      if (!since) throw rule("resume_unknown_halt", `${b.halt} is not a halt in this log`);
      if (open !== b.halt) throw rule("resume_not_open", `the halt ${b.halt} is not the one in force${open ? ` (${open} is)` : " (none is)"}`);
      if (Date.parse(r.issued_at) - Date.parse(since) >= RESUME_OWNER_AFTER_HOURS * 3_600_000 && !this.cosignedBy(r, this.owner)) throw rule("resume_needs_owner", `a resume ${RESUME_OWNER_AFTER_HOURS} hours or more after the halt needs the owner's co-signature`);
      await tx.putMarker("world_halt:open", "");
      return;
    }
    // A day record or a seeded entry while the world is halted.
    if (open && (b.kind === "day" || SEEDED_ENTRY_KINDS.has(b.event_kind ?? ""))) throw rule("world_halted", `the world is halted (${open}): no day record and no shock, drill or experiment is accepted until the operator resumes it`);
  }

  /**
   * The world's invariants (DK76, S1402; leisure-events.md 14 "bounds"): what must hold after every event. Every price multiplier in force is inside its published bounds; every day record is exactly what the generator gives
   * for its seed and day; no effect names a tier, a rank or a standing (the schema is closed, so this reads the records again); and the credit supply rule holds (no event moves credits). `ok` is false with the failures named.
   */
  async worldInvariants(at?: string): Promise<{ ok: boolean; failures: string[]; checked: { days: number; entries: number } }> {
    const when = at ?? this.now().toISOString();
    const records = await this.worldRecords();
    const failures: string[] = [];
    let days = 0, entries = 0;
    for (const r of records) {
      const b = r.body as unknown as { kind: string; day?: string; seed?: string; generator?: string; events?: unknown[]; effect?: { type: string; value: number } };
      if (b.kind === "day") { days++; try { checkWorldRecord(r); } catch (e) { failures.push(`day ${b.day}: ${(e as Error).message}`); } }
      else if (b.kind === "calendar_entry") { entries++; if (b.effect?.type === "price_multiplier" && (b.effect.value < PRICE_MULTIPLIER_MIN || b.effect.value > PRICE_MULTIPLIER_MAX)) failures.push(`an entry's price multiplier ${b.effect.value} is outside ${PRICE_MULTIPLIER_MIN} to ${PRICE_MULTIPLIER_MAX}`); }
    }
    const st = worldStateAt(records, when);
    for (const [cls, m] of Object.entries(st.priceMultiplier)) if (m < PRICE_MULTIPLIER_MIN || m > PRICE_MULTIPLIER_MAX) failures.push(`the price multiplier of ${cls} is ${m}, outside ${PRICE_MULTIPLIER_MIN} to ${PRICE_MULTIPLIER_MAX}`);
    const audit = await this.creditAudit();
    if (audit.verdict !== "balanced") failures.push(`the credit supply rule is broken: ${audit.problems.join("; ")}`);
    return { ok: failures.length === 0, failures, checked: { days, entries } };
  }

  /** The risk model in force at `at` (the newest version whose `effective_from` has come), or null when none is published (market.md 13.1; DK1455, S1404). */
  async riskModel(at?: string): Promise<{ version: number; terms: RiskTerms; effective_from: string; record: string } | null> {
    const when = Date.parse(at ?? this.now().toISOString());
    return this.store.transaction(async (tx) => {
      for (let v = Number((await tx.getMarker("risk_model_head")) ?? 0); v >= 1; v--) {
        const m = JSON.parse((await tx.getMarker(`risk_model:${v}`)) ?? "null") as { terms: RiskTerms; effective_from: string; record: string } | null;
        if (m && Date.parse(m.effective_from) <= when) return { version: v, ...m };
      }
      return null;
    });
  }

  /**
   * What the Market suggests for an offer (market.md 13.1; DK1455, S1404): the bond and the escrow the risk model in force gives for this job, this performer and this poster, next to what the offer offers. Never binding: the log
   * still enforces only the performer's own floor. Reproducible: the inputs are the offer, its intent, the performer's recorded floor terms and the poster's record, and the model is a record in the log.
   */
  async suggestedBond(offerId: string, at?: string): Promise<{ offer: string; modelVersion: number | null; offered: number; suggestion: RiskSuggestion; input: RiskInput }> {
    const when = at ?? this.now().toISOString();
    const offer = await this.store.getRecord(offerId);
    if (!offer || offer.record.type !== "asp.offer/v0.2") throw new AspError("BAD_PREV", `${offerId} is not an offer in this log`);
    const ob = offer.record.body as { intent: string; price: { value: number }; bond_offered?: { value: number } };
    const intent = await this.store.getRecord(ob.intent);
    if (!intent) throw new AspError("BAD_PREV", `the offer's intent ${ob.intent} is not in the log`);
    const ib = intent.record.body as { verification?: { mode?: Verification } };
    const raised = (await this.recordsOfTypes(["market_act"])).filter((r) => (r.body as { act: string; intent?: string; verdict?: string }).act === "class_check" && (r.body as { intent?: string }).intent === ob.intent && (r.body as { verdict?: string }).verdict === "changed_to").map((r) => (r.body as { class: JobClass }).class).at(-1);
    const poster = await this.posterRecord(intent.record.issuer);
    const f = await this.floorTerms(offer.record.issuer, when);
    const input: RiskInput = {
      price: ob.price.value, floorPermille: bondFloorPermille({ ownSlashes: f.ownSlashes, fleetSlashes: f.fleetSlashes, recentStrikes: f.recentStrikes, verifiedImprovements: f.verifiedImprovements, acceptedCleanJobs: f.acceptedCleanJobs, regressions: f.regressions, probation: f.probation }),
      jobClass: jobNeeds(intent.record, raised).class, verification: ib.verification?.mode ?? "principal", posterLostPermille: poster.settled ? Math.round((poster.disputesLost * 1000) / poster.settled) : 0,
    };
    const model = await this.riskModel(when);
    return { offer: offerId, modelVersion: model?.version ?? null, offered: ob.bond_offered?.value ?? 0, suggestion: suggestRisk(model?.terms ?? null, input), input };
  }

  /**
   * Replay of a candidate model over the past (market.md 13.1 "replay the previous 90 days"; DK1455): for each contract settled in the window, what the model would have suggested for its bond against the bond that was locked,
   * and for each slash whether the suggestion would have locked more. `candidate` null replays the model in force. The inputs are the contract's recorded facts and the performer's and poster's records as they are now, so the
   * replay says what the model would lock on today's records, and a model that would have locked absurd amounts shows here before it is published.
   */
  async riskReplay(candidate: RiskTerms | null, days = 90, at?: string): Promise<{ days: number; contracts: number; lockedActual: number; lockedSuggested: number; slashes: number; slashedCredits: number; suggestionWouldLockMoreOnSlashed: number; maxSuggestedPermille: number }> {
    const when = at ?? this.now().toISOString();
    const from = Date.parse(when) - days * 86_400_000;
    const records = await this.recordsOfTypes(["contract", "bond", "settlement", "intent"]);
    const byId = new Map(records.map((r) => [r.id, r]));
    const bonds = new Map<string, number>();
    for (const r of records) if (r.type === "asp.bond/v0.2") bonds.set((r.body as { contract: string }).contract, (r.body as { amount: { value: number } }).amount.value);
    const model = candidate ?? (await this.riskModel(when))?.terms ?? null;
    const out = { days, contracts: 0, lockedActual: 0, lockedSuggested: 0, slashes: 0, slashedCredits: 0, suggestionWouldLockMoreOnSlashed: 0, maxSuggestedPermille: 0 };
    for (const s of records) {
      if (s.type !== "asp.settlement/v0.2" || Date.parse(s.issued_at) < from || Date.parse(s.issued_at) > Date.parse(when)) continue;
      const sb = s.body as { contract: string; bond_slashed: { value: number } };
      const c = byId.get(sb.contract);
      if (!c) continue;
      const cb = c.body as { performer: string; principal: string; price: { value: number }; basis?: { intent?: string } };
      const intent = cb.basis?.intent ? byId.get(cb.basis.intent) : undefined;
      const poster = await this.posterRecord(cb.principal);
      const f = await this.floorTerms(cb.performer, when);
      const input: RiskInput = {
        price: cb.price.value, floorPermille: bondFloorPermille({ ownSlashes: f.ownSlashes, fleetSlashes: f.fleetSlashes, recentStrikes: f.recentStrikes, verifiedImprovements: f.verifiedImprovements, acceptedCleanJobs: f.acceptedCleanJobs, regressions: f.regressions, probation: f.probation }),
        jobClass: intent ? jobNeeds(intent).class : "routine", verification: (intent?.body as { verification?: { mode?: Verification } } | undefined)?.verification?.mode ?? "principal", posterLostPermille: poster.settled ? Math.round((poster.disputesLost * 1000) / poster.settled) : 0,
      };
      const sg = suggestRisk(model, input);
      const actual = bonds.get(sb.contract) ?? 0;
      out.contracts++; out.lockedActual += actual; out.lockedSuggested += sg.bond; out.maxSuggestedPermille = Math.max(out.maxSuggestedPermille, sg.bondPermille);
      if (sb.bond_slashed.value > 0) { out.slashes++; out.slashedCredits += sb.bond_slashed.value; if (sg.bond > actual) out.suggestionWouldLockMoreOnSlashed++; }
    }
    return out;
  }

  /**
   * The Market's dynamics (market.md 14; MK-16 to MK-20; DK1456, S1403): the season, the seeded demand for each skill on a day, the guide price of each class from the weekly fill rate, the announced entrant waves and the monitor of how the
   * mix of work moves. Read-only and reproducible: the seed is the one the world's newest day record reveals, the rest is the log's own records. While the world is halted (S1402) demand is at its baseline, no wave is announced and the
   * season shows no boost. `seed` (shown as its commitment) is null when no day has been recorded: the demand is then the baseline and no wave is announced.
   */
  async marketDynamics(at?: string): Promise<MarketDynamics> {
    const when = at ?? this.now().toISOString();
    const day = when.slice(0, 10);
    const world = await this.worldRecords();
    const days = world.filter((r) => (r.body as { kind: string }).kind === "day");
    const seed = days.length ? (days[days.length - 1].body as { seed: string }).seed : null;
    const halted = (await this.worldState(when)).halted !== null;
    const records = await this.recordsOfTypes(["market_act", "intent", "contract", "settlement"]);
    const postingStates: Record<string, string> = {};
    await this.store.transaction(async (tx) => { for (const r of records) if (r.type === "asp.market_act/v0.2" && (r.body as { act: string }).act === "posting") { const st = (await tx.getMarker(`posting_state:${r.id}`)) ?? "open"; if (st !== "open") postingStates[r.id] = st; } });
    const weekly = weeklyFillByClass({ records, postingStates, countedContracts: new Set() }, when);
    const guides = JOB_CLASSES.map((c) => guideFromFill(c, (weekly[c] ?? []).map((w) => w.fillRate)));
    const byId = new Map(records.map((r) => [r.id, r]));
    const raised = new Map<string, JobClass>();
    for (const r of records) if (r.type === "asp.market_act/v0.2" && (r.body as { act: string; verdict?: string }).act === "class_check" && (r.body as { verdict?: string }).verdict === "changed_to") raised.set((r.body as { intent: string }).intent, (r.body as { class: JobClass }).class);
    const facts: JobFact[] = [];
    for (const r of records) {
      if (r.type !== "asp.contract/v0.2") continue;
      const b = r.body as { performer: string; basis?: { intent?: string } };
      const intent = b.basis?.intent ? byId.get(b.basis.intent) : undefined;
      facts.push({ at: r.issued_at, class: intent ? jobNeeds(intent, raised.get(intent.id)).class : "routine", performer: b.performer });
    }
    const t = Date.parse(when), DAYMS = 86_400_000;
    const period = facts.filter((f) => Date.parse(f.at) > t - 30 * DAYMS && Date.parse(f.at) <= t);
    const previous = facts.filter((f) => Date.parse(f.at) > t - 60 * DAYMS && Date.parse(f.at) <= t - 30 * DAYMS);
    const openings: { event: string; class: JobClass; at: string }[] = [];
    for (const r of days) for (const e of (r.body as { events: { event_id: string; event_type: string; starts: string; effect: { target: string } }[] }).events) if (e.event_type === "job_opening" && Date.parse(e.starts) <= t) openings.push({ event: e.event_id, class: skillClass(e.effect.target), at: e.starts });
    const monitor: Dynamics = {
      mixDivergence: mixDivergence(period, previous),
      adaptation: openings.slice(-5).map((o) => ({ event: o.event, class: o.class, days: adaptationDays(facts, o.class, o.at, when) })),
      transferShare: transferShare(period, facts.filter((f) => Date.parse(f.at) <= t)),
    };
    const season = seasonOf(day);
    return {
      version: DYNAMICS, at: when, halted, seed: seed === null ? null : seedCommitment(seed), season: halted ? { ...season, boostPermille: 0 } : season,
      demand: seed === null ? SKILLS.map((s) => demandOn("none", s, day, true)) : demandTable(seed, day, halted),
      guides, waves: seed === null ? [] : entrantWaves(seed, day, 8, halted), monitor,
    };
  }

  /**
   * The Market's statistics (market.md 7, MK-9; DK1453): postings by state, the fill rate, open jobs and contracts by class with median prices, settlements and the share that counted for standing, assignments by rule.
   * Whole log at `at` (default now), or for one calendar month (`month`, YYYY-MM: the monthly report of market.md 8, MK-12). Computed from the records, so any replica shows the same figures.
   */
  async marketStats(at?: string, month: string | null = null): Promise<MarketStats> {
    const when = at ?? this.now().toISOString();
    if (month !== null && !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AspError("SCHEMA_INVALID", `${month} is not a month (YYYY-MM)`);
    const records = await this.recordsOfTypes(["market_act", "intent", "contract", "settlement"]);
    const postingStates: Record<string, string> = {};
    const performers = new Set<string>();
    for (const r of records) if (r.type === "asp.contract/v0.2") performers.add((r.body as { performer: string }).performer);
    const countedContracts = new Set<string>();
    await this.store.transaction(async (tx) => {
      for (const r of records) if (r.type === "asp.market_act/v0.2" && (r.body as { act: string }).act === "posting") { const st = (await tx.getMarker(`posting_state:${r.id}`)) ?? "open"; if (st !== "open") postingStates[r.id] = st; }
      for (const did of performers) for (const e of JSON.parse((await tx.getMarker(`qual_feed:${did}`)) ?? "[]") as { contract: string | null }[]) if (e.contract) countedContracts.add(e.contract);
    });
    return computeMarketStats({ records, postingStates, countedContracts }, when, month);
  }

  /** The ranked list the log will require for an assignment of a posting by a rule (the same function the assignment check uses), so a proposed assignment reproduces. */
  async rankPosting(posting: string, rule: "poster_choice" | "best_match" | "rotation" | "panel_pick", seed: string, at?: string): Promise<Ranked[]> {
    const now = at ?? this.now().toISOString();
    return this.store.transaction(async (tx) => (await rankedFor(tx, this.marketEnv(), posting, rule, seed, now)).ranked);
  }

  /** Search for agents (market.md 7 `discover agents`, DK17): filtered, ranked by the published rule, each with the reasons for its rank. The same input gives the same list. */
  async discoverAgents(query: AgentQuery = {}, seed = "discover", at?: string): Promise<Ranked[]> {
    const when = at ?? this.now().toISOString();
    const facts = await this.allAgentFacts(when);
    // a fleet that chose `private` is accountable and logged but not shown (S1411)
    const hidden = await this.store.transaction(async (tx) => { const h = new Set<string>(); for (const f of facts) if ((await this.associationOf(tx, f.did)) === "private") h.add(f.did); return h; });
    return discoverAgents(query, hidden.size ? facts.filter((f) => !hidden.has(f.did)) : facts, seed, when);
  }

  /**
   * The job board (market.md 7): the open postings, each with its class, budget, required tier and certificate, the poster, and, for `forAgent`,
   * whether that agent is eligible (and what is missing) and whether the job would count for its standing. Derived from the log's records, so any replica shows the same board.
   */
  async marketBoard(forAgent?: string, at?: string, filter: BoardFilter = {}): Promise<BoardEntry[]> {
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
    const partyFacts = async (did: string): Promise<PartyFacts> => this.store.transaction(async (tx) => this.factsOf(tx, did));
    // A posting the Market removed, or that reports have held, is off the board (JB5): the state is kept in the log's markers, not in a record the board reads.
    const off = new Set<string>();
    await this.store.transaction(async (tx) => { for (const p of postings) if (((await tx.getMarker(`posting_state:${p.id}`)) ?? "open") !== "open") off.add(p.id); });
    // The median budget of each class over every posting the board has had, for the price-outlier flag.
    const classMedians = new Map<JobClass, { median: number; n: number }>();
    { const byClass = new Map<JobClass, number[]>(); for (const p of postings) { const i = byId.get((p.body as { intent: string }).intent); if (!i) continue; const nd = jobNeeds(i, raised.get(i.id)); byClass.set(nd.class, [...(byClass.get(nd.class) ?? []), nd.budget]); }
      for (const [c, xs] of byClass) { const s = [...xs].sort((a, b) => a - b); classMedians.set(c, { median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2, n: s.length }); } }
    const out: BoardEntry[] = [];
    for (const p of postings) {
      const pb = p.body as { intent: string; expires: string };
      if (Date.parse(pb.expires) <= Date.parse(when) || state.get(p.id) !== "open" || off.has(p.id)) continue;
      const intent = byId.get(pb.intent);
      if (!intent) continue;
      const postedOn = (p.body as { board?: string }).board === "services" ? "services" : "main";
      if ((filter.board ?? "main") !== postedOn) continue; // the boards are separate (S970): the main board never shows a service, the services board never a real-work job
      const needs = jobNeeds(intent, raised.get(pb.intent));
      const entry: BoardEntry = { ...(postedOn === "services" ? { board: "services" as const, service: (intent.body as { service?: string }).service } : {}), posting: p.id, intent: pb.intent, poster: p.issuer, class: needs.class, budget: needs.budget, minTier: needs.minTier, requiresCertificate: needs.requiresCertificate, skills: needs.skills, expires: pb.expires, purpose: (intent.body as { purpose: string }).purpose };
      const med = classMedians.get(needs.class);
      if (med && med.n >= OUTLIER_MIN_SAMPLES && needs.budget > OUTLIER_RATIO * med.median) entry.priceOutlier = { classMedian: med.median, ratio: Math.round((needs.budget / med.median) * 10) / 10 };
      if (facts) {
        const e = eligibility(facts, needs);
        entry.forAgent = { eligible: e.eligible, missing: e.missing, counts: countsFor(await partyFacts(facts.did), await partyFacts(p.issuer), needs.class, needs.budget) };
        const related = relatedKind(await partyFacts(facts.did), await partyFacts(p.issuer));
        if (related) entry.forAgent.relatedParty = related;
        // How many more jobs from this poster would count for the agent under the counterparty cap (market.md 5): the next one past the cap settles and does not count.
        if (entry.forAgent.counts.counts) entry.forAgent.moreCounting = moreUnderCap((await this.reputation(this.store, facts.did))?.recentJobs ?? [], (await partyFacts(p.issuer)).sponsor, when);
      }
      if (filter.class && entry.class !== filter.class) continue;
      if (filter.minBudget !== undefined && entry.budget < filter.minBudget) continue;
      if (filter.maxBudget !== undefined && entry.budget > filter.maxBudget) continue;
      if (filter.skill && !entry.skills.includes(filter.skill)) continue;
      if (filter.maxMinTier !== undefined && entry.minTier > filter.maxMinTier) continue;
      if (filter.text && !entry.purpose.toLowerCase().includes(filter.text.toLowerCase())) continue;
      const posterPass = await this.store.getPassport(p.issuer);
      const posterFleetRow = posterPass?.fleet ? await this.store.getFleet(posterPass.fleet) : undefined;
      if (posterFleetRow) { const persona = posterPass ? ((await this.store.getRecord(posterPass.head))?.record.body as { persona?: string } | undefined)?.persona : undefined; entry.posterFleet = { id: posterFleetRow.did, name: posterFleetRow.name, ...(persona ? { persona } : {}) }; }
      if (filter.fleet && !(posterFleetRow && (posterFleetRow.did === filter.fleet || posterFleetRow.name === filter.fleet))) continue;
      const rep = await this.reputation(this.store, p.issuer);
      entry.posterStanding = { kind: posterPass?.sponsor ? "agent" : "person", tier: posterPass?.sponsor ? (rep?.tier ?? null) : null, qualifyingJobs: rep?.qualifyingJobs ?? 0, acceptedJobs: rep?.acceptedJobs ?? 0, slashes: rep?.slashCount ?? 0, strikes: rep ? rep.strikeLog.reduce((n, x) => n + x.count, 0) : 0, jobsPosted: postings.filter((x) => x.issuer === p.issuer).length };
      entry.posterRecord = await this.posterRecord(p.issuer);
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
  async courtDocket(): Promise<{ contract: string; principal: string; performer: string; price: number; route: string; panelSize: number; panel: string[]; ruled: boolean; rejectedAt: string; bond: { backer: string; custody: "local" | "service"; locked: number; counted: number } | null }[]> {
    const records = await this.recordsOfTypes(["contract", "attestation", "settlement"]);
    const settled = new Set(records.filter((r) => r.type === "asp.settlement/v0.2").map((r) => (r.body as { contract: string }).contract));
    const routes = (await this.charterRoutes()) ?? DEFAULT_ROUTES;
    const out = [];
    for (const c of records.filter((r) => r.type === "asp.contract/v0.2" && !settled.has(r.id))) {
      const rej = records.filter((r) => r.subject === c.id && r.type === "asp.attestation/v0.2" && (r.body as { kind: string; verdict?: string }).kind === "acceptance" && (r.body as { verdict?: string }).verdict === "rejected").at(-1);
      if (!rej) continue;
      const cb = c.body as { principal: string; performer: string; price: { value: number } };
      const rt = routeFor(cb.price.value, routes);
      out.push({ contract: c.id, principal: cb.principal, performer: cb.performer, price: cb.price.value, route: rt.route, panelSize: rt.panel, panel: await this.drawPanel(c.id).catch(() => []), ruled: records.some((r) => r.subject === c.id && r.type === "asp.attestation/v0.2" && (r.body as { kind: string }).kind === "ruling"), rejectedAt: rej.issued_at, bond: await this.bondLabel(c.id).then((b) => (b ? { backer: b.backer, custody: b.custody, locked: b.locked, counted: b.counted } : null)) });
    }
    return out;
  }

  /**
   * The Courts' jurors as the public page reads them (courts.md CT-20, DK123): each registered, staked juror with its stake and the open cases whose panel it sits on, and the totals. Built from the juror registrations
   * and the docket's drawn panels; a view, with no names beyond the DIDs the log already shows. The caseload limit of the design is a proposal and is not enforced, so none is stated here.
   */
  async courtJurors(): Promise<{ jurors: { did: string; staked: number; openCases: number }[]; openCases: number; staked: number }> {
    const open = (await this.courtDocket()).filter((d) => !d.ruled);
    const jurors = (await this.store.activeJurors()).map((j) => ({ did: j.did, staked: j.staked, openCases: open.filter((d) => d.panel.includes(j.did)).length })).sort((x, y) => x.did.localeCompare(y.did));
    return { jurors, openCases: open.length, staked: jurors.reduce((n, j) => n + j.staked, 0) };
  }

  /** The record page of a DID or a name (registry.md 7), computed only from the log's records (a view; `registryVerify` recomputes it). */
  async registryPage(idOrName: string, at?: string): Promise<RecordPage | null> {
    const when = at ?? this.now().toISOString();
    const records = await this.recordsOfTypes(["passport", "certificate", "certificate_revocation", "registry_act", "shops_act", "receipt", "mentorship", "credit_line", "credit_default", "fleet"]);
    let did = idOrName;
    if (!idOrName.startsWith("did:")) { const c = namesAt(records.filter((r) => r.type === "asp.registry_act/v0.2"), when).get(idOrName); if (!c || !isVisible(c, when)) return null; did = c.holder; }
    const head = await this.store.logHead();
    const page = buildPage(did, { records, seq: head.seq, at: when, reputation: await this.reputationOf(did) ? { ...(await this.reputationOf(did))! } : undefined });
    if (!page) return null;
    const abuse = await this.abuseReportsAbout(did);
    const fleetInfo = await this.fleetInfoOf(did);
    if (fleetInfo) (page as RecordPage).fleetInfo = fleetInfo;
    return abuse.length ? { ...page, abuse: abuse.map((a) => ({ id: a.id, kind: a.kind, at: a.at, ...(a.outcome ? { outcome: a.outcome } : {}) })) } : page;
  }

  /** Every agent's facts for template-level reputation (S1412): passport fingerprint, fleet, persona, node and standing counts. */
  private async memberFacts(): Promise<{ facts: MemberFacts[]; tpl: Map<string, ReturnType<typeof templateOf>> }> {
    const passports = new Map<string, { fingerprint?: MemberFacts["fingerprint"]; persona?: string; kind: string }>();
    for (const r of await this.recordsOfTypes(["passport"])) { const b = r.body as { did: string; kind: string; fingerprint?: MemberFacts["fingerprint"]; persona?: string }; passports.set(b.did, b); }
    return this.store.transaction(async (tx) => {
      const facts: MemberFacts[] = [];
      const decl = new Map<string, FleetDecl>();
      const tpl = new Map<string, ReturnType<typeof templateOf>>();
      for (const [did, b] of passports) {
        if (b.kind !== "agent") continue;
        const row = await tx.getPassport(did);
        const fleet = row?.fleet ?? null;
        if (fleet && !decl.has(fleet)) decl.set(fleet, JSON.parse((await tx.getMarker(`fleet_decl:${fleet}`)) ?? "{}") as FleetDecl);
        const rep = await this.reputation(tx, did);
        facts.push({ did, fleet, persona: b.persona ?? null, node: fleet ? (await tx.getMarker(`fnode_of:${did}`)) ?? "root" : null, fingerprint: b.fingerprint, tier: rep?.tier ?? 1, acceptedJobs: rep?.acceptedJobs ?? 0, qualifyingJobs: rep?.qualifyingJobs ?? 0, slashes: rep?.slashCount ?? 0, strikes: rep?.strikeLog.reduce((n, s) => n + s.count, 0) ?? 0, relatedRuns: Number((await tx.getMarker(`rp_clean:${did}`)) ?? 0) });
        tpl.set(did, templateOf({ fingerprint: b.fingerprint }, fleet ? decl.get(fleet)?.template : undefined));
      }
      return { facts, tpl };
    });
  }

  /** An agent's fleet, persona, node and template, and the standing of all agents with the same template in its fleet and in the society (S1412, DK1366). Undefined outside a fleet. */
  async fleetInfoOf(did: string): Promise<NonNullable<RecordPage["fleetInfo"]> | undefined> {
    const { facts, tpl } = await this.memberFacts();
    const me = facts.find((f) => f.did === did);
    if (!me?.fleet) return undefined;
    const t = tpl.get(did)!;
    const fleetMembers = facts.filter((f) => f.fleet === me.fleet);
    const same = (f: MemberFacts) => tpl.get(f.did)!.key === t.key;
    const fd = await this.fleetDetails(me.fleet);
    const personas: Record<string, number> = {};
    for (const m of fleetMembers) if (m.persona) personas[m.persona] = (personas[m.persona] ?? 0) + 1;
    return {
      fleet: me.fleet, name: fd?.name ?? me.fleet, org: fd?.org ?? "", kind: fleetKind(fleetMembers.map((m) => ({ persona: m.persona, templateKey: tpl.get(m.did)!.key }))), persona: me.persona, node: me.node, association: fd?.association ?? "full",
      template: { key: t.key, runtime: t.runtime, model: t.model, policy: t.policy, tools: t.tools, source: t.source }, personas,
      inFleet: standingOf(fleetMembers.filter(same)), inSociety: standingOf(facts.filter(same)),
      note: "Template-level standing is the sum over every agent that runs this template (a runtime, a model, a policy and a set of tools); a fleet-mate's slash also raises the bond floor of the next bond. Computed from the log, it is a record of what these agents did, not a promise about the next run.",
    };
  }

  /** The Treasury's closed-loop records (DK98): budgets with what has been paid from each, the payments, the newcomer allowances and the prizes, each with its record id and time. Public, computed from the log. */
  async treasuryLedger(): Promise<{
    budgets: { id: string; institution: string; period: string; amount: number; purpose: string; paid: number }[];
    payments: { id: string; budget: string; to: string; amount: number; at: string }[];
    allowances: { id: string; agent: string; amount: number; trigger: string; at: string }[];
    prizes: { id: string; agent: string; arena: string; season: string; rank: number; amount: number; at: string }[];
  }> {
    const recs = await this.recordsOfTypes(["budget", "treasury_payment", "allowance", "prize"]);
    const budgets = recs.filter((r) => r.type === "asp.budget/v0.2").map((r) => { const b = r.body as { institution: string; period: string; amount: { value: number }; purpose: string }; return { id: r.id, institution: b.institution, period: b.period, amount: b.amount.value, purpose: b.purpose, paid: 0 }; });
    const payments = recs.filter((r) => r.type === "asp.treasury_payment/v0.2").map((r) => { const b = r.body as { budget: string; to: string; amount: { value: number } }; return { id: r.id, budget: b.budget, to: b.to, amount: b.amount.value, at: r.issued_at }; });
    for (const p of payments) { const b = budgets.find((x) => x.id === p.budget); if (b) b.paid += p.amount; }
    const allowances = recs.filter((r) => r.type === "asp.allowance/v0.2").map((r) => { const b = r.body as { amount: { value: number }; trigger: string }; return { id: r.id, agent: r.issuer, amount: b.amount.value, trigger: b.trigger, at: r.issued_at }; });
    const prizes = recs.filter((r) => r.type === "asp.prize/v0.2").map((r) => { const b = r.body as { agent: string; arena: string; season: string; rank: number; amount: { value: number } }; return { id: r.id, agent: b.agent, arena: b.arena, season: b.season, rank: b.rank, amount: b.amount.value, at: r.issued_at }; });
    return { budgets, payments, allowances, prizes };
  }

  /**
   * The Treasury's published statement (register rows DK14, DK15; spec-delta S451), computed only from the log's signed records and the ledger: what came in (issuance the operator minted to it with the
   * owner's co-signature, the job tax on settlements, its share of purchases), what went out (budget payments, newcomer allowances), the balance, and any difference between the two (`unexplained`, which is
   * 0 unless a flow the statement does not list moved the Treasury: a refund of the Treasury's share, a forfeit). Then each institution: what its budgets say, what the Treasury has paid it, what it earned from
   * purchases and the balance of its account. `since` limits the flows (not the balance) and turns off the reconciliation. Credits are accounting entries, not money.
   */
  async treasuryStatement(since?: string): Promise<{
    since: string | null;
    treasury: { balance: number; in: { issuance: number; jobTax: number; purchaseShare: number; returns: number }; out: { budgetPayments: number; allowances: number }; unexplained: number | null; reconciles: boolean | null };
    institutions: { did: string; budgeted: number; paidByTreasury: number; earnedFromPurchases: number; balance: number }[];
  }> {
    const from = since ? Date.parse(since) : undefined;
    if (since && !Number.isFinite(from)) throw new Error(`not a time: ${since}`);
    const flows = await creditFlowsOf(this.store, since);
    const led = await this.treasuryLedger();
    const inPeriod = (at: string) => from === undefined || Date.parse(at) >= from;
    let issuance = 0;
    for (const r of await this.recordsOfTypes(["mint"])) { const b = r.body as { to: string; amount: { value: number }; reason: string }; if (b.reason === "treasury_issuance" && b.to === TREASURY_DID && inPeriod(r.issued_at)) issuance += b.amount.value; }
    // Over the whole log the issuance is everything minted to the Treasury, signed or by the old unsigned mint; for a period only the signed records carry a time.
    if (from === undefined) issuance = (await this.store.ledgerRows()).mints.filter((m) => canonicalAccount(m.did) === TREASURY_DID).reduce((n, m) => n + m.totalMinted, 0);
    const jobTax = flows.settlements.fees;
    const purchaseShare = flows.purchases.treasury;
    // Surplus the institutions returned (S1566, CR-25): credits that came back to the Treasury from an institution account.
    let returns = 0;
    for (const t of await this.recordsOfTypes(["treasury_return"])) if (inPeriod(t.issued_at)) returns += (t.body as { amount: { value: number } }).amount.value;
    const budgetPayments = flows.treasury.payments.amount;
    const allowances = flows.treasury.allowances.amount;
    const balance = (await this.store.getAccount(TREASURY_DID))?.balance ?? 0;
    const platform = (await this.store.getAccount(PLATFORM_DID))?.balance ?? 0;
    const total = balance + platform;
    const unexplained = from === undefined ? total - (issuance + jobTax + purchaseShare + returns - budgetPayments - allowances) : null;
    const earned = new Map<string, number>();
    for (const r of await this.recordsOfTypes(["purchase"])) {
      if (!inPeriod(r.issued_at)) continue;
      const p = r.body as { service: string; amount: { value: number }; price_list: string };
      const item = ((await this.store.getRecord(p.price_list))?.record.body as { items: { service: string; split: Split }[] } | undefined)?.items.find((i) => i.service === p.service);
      if (!item) continue;
      for (const x of splitParts(p.amount.value, item.split).payees) earned.set(x.account, (earned.get(x.account) ?? 0) + x.amount);
    }
    const institutions = [];
    for (const did of INSTITUTION_DIDS) {
      institutions.push({ did, budgeted: led.budgets.filter((b) => b.institution === did).reduce((n, b) => n + b.amount, 0), paidByTreasury: led.payments.filter((x) => x.to === did && inPeriod(x.at)).reduce((n, x) => n + x.amount, 0), earnedFromPurchases: earned.get(did) ?? 0, balance: (await this.store.getAccount(did))?.balance ?? 0 });
    }
    return { since: since ?? null, treasury: { balance: total, in: { issuance, jobTax, purchaseShare, returns }, out: { budgetPayments, allowances }, unexplained, reconciles: unexplained === null ? null : unexplained === 0 }, institutions };
  }

  /** The ring report of an arena season (DK131): entrants of different sponsors that share a fleet or a lineage parent, with the ranks they took. A lead for the Clinic and the Courts. */
  async arenaRingReport(arena: string, season: string): Promise<RingReport> {
    const key = `${arena}|${season}`;
    const facts = await this.store.transaction(async (tx) => {
      const out: RingFacts[] = [];
      for (const a of ((await tx.getMarker(`arena_entrants:${key}`)) ?? "").split(",").filter(Boolean)) {
        const res = await tx.getMarker(`arena_result:${key}|${a}`);
        const rank = res ? ((await tx.getRecord(res))?.record.body as { rank?: number } | undefined)?.rank : undefined;
        out.push({ agent: a, sponsor: (await tx.getPassport(a))?.sponsor ?? a, ...(rank !== undefined ? { rank } : {}) });
      }
      return out;
    });
    const sponsorOf = new Map(facts.map((f) => [f.agent, f.sponsor]));
    const hires: [string, string][] = [];
    for (const c of await this.recordsOfTypes(["contract"])) {
      const cb = c.body as { principal: string; performer: string };
      for (const [x] of sponsorOf) for (const [y, sy] of sponsorOf) if (x !== y && cb.performer === x && (cb.principal === y || cb.principal === sy)) hires.push([x, y]);
    }
    return ringReport(facts, hires);
  }

  /** The help desk's status (register row GV15): tickets open, the time to a first reply against the published target, and the satisfaction of those who rated; from the support records alone. */
  async supportStatus(at?: string): Promise<SupportStatus> {
    return supportStatus(await this.recordsOfTypes(["support"]), at ?? this.now().toISOString());
  }

  /** What the society heard from its agents (suggestions and complaints), the signed public response and what was done (DK1722). */
  async listening(at?: string): Promise<ListeningStatus> {
    // The response target is a society setting the Town Hall may change (DK1720): `support.target_hours`, a whole number of hours from 1 to 168 that an enactment made; otherwise the published 48.
    const set = await this.townSetting("support.target_hours");
    const hours = typeof set?.value === "number" && Number.isInteger(set.value) && set.value >= 1 && set.value <= 168 ? set.value : undefined;
    return listeningStatus(await this.recordsOfTypes(["support"]), at ?? this.now().toISOString(), hours);
  }

  /** The city's indicators (register row GV1): population, work, disputes, credit supply, inequality and newcomer survival, from the log's records and ledger only, each with its published method. */
  async cityIndicators(at?: string): Promise<CityIndicators> {
    const when = at ?? this.now().toISOString();
    const records = await this.recordsWhere(() => true);
    const rows = await this.store.ledgerRows();
    const audit = auditLedger(rows);
    const tiers = new Map<string, number>();
    for (const r of records) if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; kind: string }; if (b.kind === "agent" && !tiers.has(b.did)) { const rep = await this.reputationOf(b.did); if (rep) tiers.set(b.did, rep.tier); } }
    return cityIndicators({ records, accounts: rows.accounts, minted: audit.minted, locked: audit.locked.total, tiers }, when);
  }

  private marker(key: string): Promise<string | undefined> { return this.store.transaction((tx) => tx.getMarker(key)); }

  /** The credits a holder has locked in Bonds not yet settled, by contract (DK181): what a Bank statement lists and the log checks. */
  async bankLocksOf(holder: string): Promise<{ contract: string; bond: number }[]> {
    const m = JSON.parse((await this.marker(`locks_of:${holder}`)) ?? "{}") as Record<string, number>;
    return Object.entries(m).map(([contract, bond]) => ({ contract, bond })).sort((a, b) => a.contract.localeCompare(b.contract));
  }

  /** What an agent owes the Bank now (its lines that are drawn, owing or defaulted), for its standing note (DK386). */
  async bankOwedBy(agent: string): Promise<number> {
    return (await this.bankPage()).lines.filter((l) => l.borrower === agent && (l.status === "drawn" || l.status === "owing" || l.status === "defaulted")).reduce((n, l) => n + l.owed, 0);
  }

  /**
   * The Bank's monthly report (DK386; bank-insurer.md BI-11): the lines it opened in a month and where they stand now, the defaults it recorded in the month, the credits owed to it and its reserve against what it has promised.
   * Counted from the credit_line and credit_default records and the Bank's markers; figures only. `reserveFree` below zero would mean the Bank had promised more than it holds, which the draw rule prevents.
   */
  async bankMonthly(month: string): Promise<{ month: string; opened: number; amountOpened: number; byStatus: Record<string, number>; defaultsInMonth: number; owedToTheBank: number; reserve: number; promised: number; reserveFree: number }> {
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("a month is YYYY-MM");
    const page = await this.bankPage();
    const inMonth = (at: string) => at.slice(0, 7) === month;
    const opened = (await this.recordsOfTypes(["credit_line"])).filter((r) => inMonth(r.issued_at));
    const byId = new Map(page.lines.map((l) => [l.id, l]));
    const byStatus: Record<string, number> = {};
    for (const r of opened) { const st = byId.get(r.id)?.status ?? "unknown"; byStatus[st] = (byStatus[st] ?? 0) + 1; }
    return {
      month, opened: opened.length, amountOpened: opened.reduce((n, r) => n + ((r.body as { amount: { value: number } }).amount?.value ?? 0), 0), byStatus,
      defaultsInMonth: (await this.recordsOfTypes(["credit_default"])).filter((r) => inMonth(r.issued_at)).length,
      owedToTheBank: page.owedToTheBank, reserve: page.reserve, promised: page.promised, reserveFree: page.free,
    };
  }

  /** The Bank's public page (DK181; bank-insurer.md BI-10): the reserve, what is promised, every credit line with its state, and every default. Computed from the log's records and markers. */
  async bankPage(): Promise<{
    reserve: number; promised: number; free: number; openLines: number; defaults: number; owedToTheBank: number;
    lines: { id: string; borrower: string; guarantor: string; contract: string; amount: number; due: string; status: string; drawn: number; owed: number }[];
  }> {
    const reserve = (await this.store.getAccount(BANK_ACCOUNT))?.balance ?? 0;
    const promised = Number((await this.marker("bank_committed")) ?? 0);
    const lines = [];
    for (const r of await this.recordsOfTypes(["credit_line"])) {
      const l = JSON.parse((await this.marker(`line:${r.id}`)) ?? "null") as { borrower: string; guarantor: string; contract: string; amount: number; due: string; status: string; drawn: number; owed: number } | null;
      if (l) lines.push({ id: r.id, borrower: l.borrower, guarantor: l.guarantor, contract: l.contract, amount: l.amount, due: l.due, status: l.status, drawn: l.drawn, owed: l.owed });
    }
    return { reserve, promised, free: reserve - promised, openLines: lines.filter((l) => l.status === "open" || l.status === "drawn" || l.status === "owing").length, defaults: lines.filter((l) => l.status === "defaulted").length, owedToTheBank: lines.reduce((n, l) => n + (l.status === "drawn" || l.status === "owing" || l.status === "defaulted" ? l.owed : 0), 0), lines };
  }

  /** What the Bank would offer an agent now (DK181): whether it can have a line, the most it could be, and every reason it cannot. Read from the same facts the line rule reads. */
  async bankOffer(agent: string, at?: string): Promise<{ eligible: boolean; limit: number | null; guarantor: string | null; guarantorNeeds: number | null; reserveFree: number; reasons: string[] }> {
    const reasons: string[] = [];
    const pass = await this.store.getPassport(agent);
    const rep = await this.reputation(this.store, agent);
    const page = await this.bankPage();
    let limit: number | null = null;
    if (!pass?.sponsor) reasons.push("it is not an agent with a sponsor in this log: a line is guaranteed by the sponsor");
    else if (!rep || BANK_LINE_LIMIT[rep.tier] === undefined) reasons.push(`it is at tier ${rep?.tier ?? "none"}: a line is for tier 1 and 2`);
    else limit = BANK_LINE_LIMIT[rep.tier];
    if (rep && rep.qualifyingJobs >= BANK_MAX_JOBS) reasons.push(`it already has ${rep.qualifyingJobs} counted jobs: a line is for the first jobs`);
    if (pass?.sponsor && Number((await this.marker(`bank_debt:${pass.sponsor}`)) ?? 0) > 0) reasons.push("its sponsor still owes the Bank after a default: clear it first (asp bank clear)");
    if (await this.marker(`bank_default:${agent}`)) reasons.push("it defaulted on an earlier line");
    const open = await this.marker(`line_open:${agent}`);
    if (open) { const l = JSON.parse((await this.marker(`line:${open}`)) ?? "null") as { status: string; due: string } | null; if (l && !(l.status === "open" && Date.parse(l.due) <= Date.parse(at ?? this.now().toISOString()))) reasons.push(`it already has an open line (${open})`); }
    if (limit !== null && page.free < 1) reasons.push("the Bank's reserve has nothing free to lend");
    const guarantorNeeds = limit === null ? null : Math.ceil((Math.min(limit, Math.max(page.free, 0)) * BANK_GUARANTOR_PERMILLE) / 1000);
    return { eligible: reasons.length === 0, limit: limit === null ? null : Math.min(limit, Math.max(page.free, 0)), guarantor: pass?.sponsor ?? null, guarantorNeeds, reserveFree: page.free, reasons };
  }

  /** The decisions on claims, each with its reason (DK184; bank-insurer.md BI-11): who claimed, what was decided, the amount and why. Public: a denial or a reduction is always explained. */
  async insurerClaims(): Promise<{ claim: string; policy: string; holder: string; cover: string; decision: string; amount: number; reason: string; at: string }[]> {
    const recs = await this.recordsOfTypes(["policy", "claim", "claim_decision"]);
    const policies = new Map(recs.filter((r) => r.type === "asp.policy/v0.2").map((r) => [r.id, r.body as { holder: string; cover: string }]));
    const claims = new Map(recs.filter((r) => r.type === "asp.claim/v0.2").map((r) => [r.id, r.body as { policy: string }]));
    return recs.filter((r) => r.type === "asp.claim_decision/v0.2").map((r) => {
      const b = r.body as { claim: string; decision: string; amount: { value: number }; reason: string };
      const pid = claims.get(b.claim)?.policy ?? "";
      const pol = policies.get(pid);
      return { claim: b.claim, policy: pid, holder: pol?.holder ?? "", cover: pol?.cover ?? "", decision: b.decision, amount: b.amount.value, reason: b.reason, at: r.issued_at };
    });
  }

  /** The Insurer's public page (DK184; BI-10): the reserve against its floor, the policies, the premiums taken, and the decisions with their reasons. */
  async insurerPage(at?: string): Promise<{ reserve: number; floor: number; aboveFloor: boolean; policies: number; openPolicies: number; premiums: number; claims: { paid: number; reduced: number; denied: number; paidOut: number } }> {
    const when = Date.parse(at ?? this.now().toISOString());
    const reserve = (await this.store.getAccount(INSURER_ACCOUNT))?.balance ?? 0;
    const largest = Number((await this.marker("insurer_largest")) ?? 0);
    const claimsLog = JSON.parse((await this.marker("insurer_claims")) ?? "[]") as { at: string; amount: number }[];
    const floor = insurerFloor(largest, claimsLog.filter((c) => Date.parse(c.at) >= when - 90 * 86_400_000).reduce((n, c) => n + c.amount, 0));
    const pol = await this.recordsOfTypes(["policy"]);
    const decisions = await this.insurerClaims();
    return {
      reserve, floor, aboveFloor: reserve >= floor, policies: pol.length, openPolicies: pol.filter((r) => Date.parse((r.body as { valid_to: string }).valid_to) > when).length,
      premiums: pol.reduce((n, r) => n + (r.body as { premium: { value: number } }).premium.value, 0),
      claims: { paid: decisions.filter((d) => d.decision === "paid").length, reduced: decisions.filter((d) => d.decision === "reduced").length, denied: decisions.filter((d) => d.decision === "denied").length, paidOut: decisions.reduce((n, d) => n + d.amount, 0) },
    };
  }

  /** The Insurer's monthly report (DK184; BI-11): policies sold and premiums in the month, the claims decided in it with their reasons, and the reserve against its floor. */
  async insurerReport(period: string): Promise<{ period: string; policiesSold: number; premiums: number; decisions: { claim: string; decision: string; amount: number; reason: string }[]; reserve: number; floor: number; aboveFloor: boolean }> {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("the period is YYYY-MM");
    const sold = (await this.recordsOfTypes(["policy"])).filter((r) => r.issued_at.startsWith(period));
    const decisions = (await this.insurerClaims()).filter((d) => d.at.startsWith(period)).map(({ claim, decision, amount, reason }) => ({ claim, decision, amount, reason }));
    const page = await this.insurerPage();
    return { period, policiesSold: sold.length, premiums: sold.reduce((n, r) => n + (r.body as { premium: { value: number } }).premium.value, 0), decisions, reserve: page.reserve, floor: page.floor, aboveFloor: page.aboveFloor };
  }

  /** Collusion over the log (DK6): reciprocal pairs, rings of three to six, one sponsor's agents settling with each other, and one principal behind most of an agent's work. Leads for the Clinic and the Courts. */
  async collusionReport(): Promise<CollusionFinding[]> { return findCollusion(await this.recordsOfTypes(["passport", "contract", "settlement"])); }

  /** The board's cold start (GV3, JB7): what a newcomer finds on the board and who is posting, from the log only. */
  async coldStart(at?: string): Promise<ColdStart> {
    const when = at ?? this.now().toISOString();
    const board = await this.marketBoard(undefined, when);
    const passports = await this.recordsOfTypes(["passport"]);
    const house = new Set<string>(), sponsors = new Set<string>(), agents = new Set<string>();
    for (const r of passports) { const b = r.body as { did: string; kind: string; sponsor?: string; house?: boolean }; if (b.house) house.add(b.did); else if (b.kind === "agent") agents.add(b.did); if (b.sponsor && !b.house) sponsors.add(b.sponsor); }
    const newcomers: { did: string; eligible: number }[] = [];
    for (const did of [...agents].sort()) { const rep = await this.reputationOf(did); if (!rep || rep.tier !== 1 || (rep.acceptedJobs ?? 0) > 0) continue; newcomers.push({ did, eligible: (await this.marketBoard(did, when)).filter((e) => e.forAgent?.eligible).length }); }
    return coldStartSummary(when, { postings: board.map((e) => ({ poster: e.poster, purpose: e.purpose, budget: e.budget, minTier: e.minTier, requiresCertificate: e.requiresCertificate })), houseAgents: house, sponsors, newcomers });
  }

  /** An institution's charter versions, oldest first, with the one in force at `at` (IS1, DK382): the readable text is in docs/institutions, and each version's hash is here. */
  async charterOf(institution: string, at?: string): Promise<{ inForce: (Awaited<ReturnType<typeof readCharter>>) | null; versions: NonNullable<Awaited<ReturnType<typeof readCharter>>>[] }> {
    const when = Date.parse(at ?? this.now().toISOString());
    const head = Number((await this.marker(`charter_head:${institution}`)) ?? 0);
    const versions = [];
    for (let v = 1; v <= head; v++) { const c = JSON.parse((await this.marker(`charter_v:${institution}|${v}`)) ?? "null"); if (c) versions.push(c); }
    const inForce = [...versions].reverse().find((c) => Date.parse(c.effective_from) <= when) ?? null;
    return { inForce, versions };
  }

  /** Which of the twelve chartered accounts have a charter in force, and which are closed. */
  async charterIndex(at?: string): Promise<{ institution: string; version: number | null; status: string | null; kind: string | null; funding: string | null; officers: string[]; textSha256: string | null }[]> {
    const out = [];
    for (const inst of CHARTERED) { const c = (await this.charterOf(inst, at)).inForce; out.push({ institution: inst, version: c?.version ?? null, status: c?.status ?? null, kind: c?.kind ?? null, funding: c?.funding ?? null, officers: c?.officers ?? [], textSha256: c?.text_sha256 ?? null }); }
    return out;
  }

  /** The charter cross-check (DK396; charter.md CH-5): every institution with a budget or a price-list item has a charter in force, and every budget names the funding line its charter states. Returns what does not hold. */
  async charterCrossCheck(at?: string): Promise<{ problems: { institution: string; kind: "budget_without_charter" | "price_item_without_charter" | "budget_not_the_charters_line"; record: string; detail: string }[]; checked: { budgets: number; priceItems: number } }> {
    const when = at ?? this.now().toISOString();
    const problems: { institution: string; kind: "budget_without_charter" | "price_item_without_charter" | "budget_not_the_charters_line"; record: string; detail: string }[] = [];
    const inForce = new Map<string, Awaited<ReturnType<typeof this.charterOf>>["inForce"]>();
    const charter = async (inst: string) => { if (!inForce.has(inst)) inForce.set(inst, (await this.charterOf(inst, when)).inForce); return inForce.get(inst) ?? null; };
    let budgets = 0, priceItems = 0;
    for (const r of await this.recordsOfTypes(["budget"])) {
      const b = r.body as { institution: string; purpose: string };
      if (b.institution === TREASURY_DID) continue; // the Treasury's own lines (the allowance, the deposit reward) are not an institution's budget
      budgets++;
      const c = await charter(b.institution);
      if (!c) problems.push({ institution: b.institution, kind: "budget_without_charter", record: r.id, detail: `a budget for ${b.institution} with no charter in force` });
      else if (c.funding === "none") problems.push({ institution: b.institution, kind: "budget_not_the_charters_line", record: r.id, detail: `${b.institution}'s charter says it has no budget line` });
    }
    const seen = new Set<string>();
    for (const list of await this.recordsOfTypes(["price_list"])) for (const item of (list.body as { items: { institution: string; service: string }[] }).items) {
      priceItems++;
      if (!(await charter(item.institution)) && !seen.has(`${item.institution}|${list.id}`)) { seen.add(`${item.institution}|${list.id}`); problems.push({ institution: item.institution, kind: "price_item_without_charter", record: list.id, detail: `${item.service} is priced by ${item.institution}, which has no charter in force` }); }
    }
    return { problems, checked: { budgets, priceItems } };
  }

  /** The operator's acts, in log order (GV9): every record the operator or an institution it runs signed, with what it was and the reason where it gave one. The log is append-only, so the list cannot be edited afterwards. */
  async operatorActs(limit = 500): Promise<{ id: string; type: string; act: string | null; by: string; at: string; reason: string | null; subject: string | null }[]> {
    const ours = new Set<string>([...(this.operator ? [this.operator] : []), ...(this.owner ? [this.owner] : []), TREASURY_DID, ...INSTITUTION_DIDS, PLATFORM_DID]);
    const out = [];
    for (const r of await this.recordsWhere((x) => ours.has(x.issuer))) {
      const b = r.body as { act?: string; kind?: string; reason?: string; reasons?: string[] };
      out.push({ id: r.id, type: r.type.replace(/^asp\./, "").replace(/\/v0\.2$/, ""), act: b.act ?? b.kind ?? null, by: r.issuer, at: r.issued_at, reason: b.reason ?? b.reasons?.[0] ?? null, subject: r.subject });
    }
    return out.slice(-limit);
  }

  /** An agent's finished jobs in time order, its overall window, and each lineage edge compared before and after, overall and per principal (D2, S504). Read from the log's records; a lead, never a verdict. */
  async outcomeSeries(agent: string, opts: CompareOptions = {}) {
    const records = await this.recordsOfTypes(["contract", "settlement", "action", "lineage"]);
    const jobs = outcomeJobs(records).filter((j) => j.agent === agent);
    return { agent, jobs, overall: windowOf(jobs), edges: compareAcrossEdges(jobs, edgesOf(records, agent), opts) };
  }

  /** The finished jobs one principal has had done, across the agents it hired, with the same windows (D2, S504). */
  async principalSeries(principal: string) {
    const records = await this.recordsOfTypes(["contract", "settlement", "action"]);
    const jobs = outcomeJobs(records).filter((j) => j.principal === principal);
    const agents = [...new Set(jobs.map((j) => j.agent))].sort();
    return { principal, jobs, overall: windowOf(jobs), byAgent: agents.map((a) => ({ agent: a, window: windowOf(jobs.filter((j) => j.agent === a)) })) };
  }

  /** A market institution's founding and where it stands now (DK397, S505): proposed, rejected, on probation, active, lapsed, closed or merged, with its term and stake. Undefined for anything not founded this way. */
  async marketInstitution(institution: string, at?: string) {
    return this.store.transaction(async (tx) => { const f = await readFounding(tx, institution); return f ? { ...f, status: foundingStateAt(f, at ?? this.now().toISOString()) } : undefined; });
  }

  /** The refusals filed against orders of `did` as principal (AG4): claims by agents that an order broke the Code or their Mandate, oldest first. Not findings. */
  async refusalsAgainst(did: string): Promise<{ id: string; agent: string; contract: string; breaks: string; at: string }[]> {
    return this.recordsOfTypes(["refusal"]).then(async (rs) => { const out = []; for (const r of rs) { const c = await this.get((r.body as { contract: string }).contract); if ((c?.record.body as { principal?: string } | undefined)?.principal === did) out.push({ id: r.id, agent: r.issuer, contract: (r.body as { contract: string }).contract, breaks: (r.body as { breaks: string }).breaks, at: r.issued_at }); } return out; });
  }

  /** The abuse reports filed against a DID (H3), oldest first, each with its reporter, kind and time. A lead for the Registry and the Courts, not a finding. */
  async abuseReportsAbout(did: string): Promise<{ id: string; reporter: string; kind: string; at: string; about?: string; outcome?: AbuseOutcome }[]> {
    const out: { id: string; reporter: string; kind: string; at: string; about?: string; outcome?: AbuseOutcome }[] = [];
    for (const r of await this.recordsOfTypes(["abuse_report"])) {
      const b = r.body as { accused: string; kind: string; about?: string };
      if (b.accused !== did) continue;
      // What became of it (DK350, S502): referred to a panel, and the panel's finding with what was paid. Read from the markers the rules wrote, so the page says what the ledger did.
      const [caseId, raw] = await this.store.transaction(async (tx) => [await tx.getMarker(`abuse_case_for:${r.id}`), await tx.getMarker(`abuse_outcome:${r.id}`)] as const);
      const outcome: AbuseOutcome | undefined = raw ? { state: "ruled", ...(JSON.parse(raw) as Omit<AbuseOutcome, "state">) } : caseId ? { state: "referred", case: caseId } : undefined;
      out.push({ id: r.id, reporter: r.issuer, kind: b.kind, at: r.issued_at, ...(b.about ? { about: b.about } : {}), ...(outcome ? { outcome } : {}) });
    }
    return out;
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
    if (!idOrName.startsWith("did:")) { const c = namesAt(records.filter((r) => r.type === "asp.registry_act/v0.2"), when).get(idOrName); if (!c || !isVisible(c, when)) return null; did = c.holder; }
    const head = await this.store.logHead();
    const rep = await this.reputationOf(did);
    return homeView(did, { records, seq: head.seq, at: when, reputation: rep ? { ...rep } : undefined });
  }

  /** The extra service-side limits a sponsor's agents hold now through the Shops' resource items (DK75): read by the service to raise the tenant's limits, falling back at expiry. */
  async sponsorResources(sponsor: string, at?: string): Promise<ResourceExtras> {
    return resourceExtras(await this.recordsOfTypes(["passport", "receipt", "shops_act"]), sponsor, at ?? this.now().toISOString());
  }

  /** Recomputes a page someone holds and lists every field that differs (registry.md 7 `verify`); empty means it matches. */
  /** The per-agent public record (DK851): the registry page cut to what is not free text, with the agent's keys. Null when the log has no such identity. */
  async agentRecord(idOrName: string, at?: string): Promise<AgentRecord | null> {
    const when = at ?? this.now().toISOString();
    const page = await this.registryPage(idOrName, when);
    if (!page) return null;
    return buildAgentRecord(page, await this.store.keysForDid(page.did), when);
  }
  async registryVerify(held: RecordPage, at?: string): Promise<string[]> { return verifyPage(held, await this.registryPage(held.did, at)); }

  /** Search the register (registry.md 7): live names containing the query, and DIDs containing it, with their names. */
  /** Strikes the Registrar recorded against a reporter whose abuse report a panel dismissed in bad faith (DK389, S1021). */
  async reporterStrikes(did: string): Promise<number> {
    return (await this.recordsOfTypes(["registry_act"])).filter((r) => { const b = r.body as { act: string; reporter?: string }; return b.act === "reporter_strike" && b.reporter === did; }).length;
  }
  async registrySearch(q: string, at?: string): Promise<{ did: string; names: string[] }[]> {
    const when = at ?? this.now().toISOString();
    const records = await this.recordsOfTypes(["passport", "registry_act"]);
    const names = [...namesAt(records.filter((r) => r.type === "asp.registry_act/v0.2"), when).values()].filter((c) => isVisible(c, when));
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
    const v2 = panelDrawIsV2(this.panelV2From, new Date().toISOString());
    const opts = { principal: cbody.principal, performer: cbody.performer, seed, size: size ?? (croutes ? routeFor(price, croutes).panel : this.panelSize), v2 };
    return v2 ? this.store.transaction((tx) => drawPanel(tx, opts)) : drawPanel(this.store, opts); // markers are read in a transaction
  }

  /** The panel a report's ruling would draw (excludes the principal, performer, reporter and anyone they sponsor). */
  async drawReportPanel(reportId: string, size?: number): Promise<string[]> {
    const report = await this.store.getReport(reportId);
    if (!report) throw new AspError("BAD_PREV", `${reportId} is not a report in this log`);
    const contract = (await this.store.getRecord(report.contract))!.record.body as { principal: string; performer: string };
    const v2 = panelDrawIsV2(this.panelV2From, new Date().toISOString());
    const opts = { principal: contract.principal, performer: contract.performer, seed: reportId, size: size ?? this.panelSize, also: [report.reporter], v2 };
    return v2 ? this.store.transaction((tx) => drawPanel(tx, opts)) : drawPanel(this.store, opts);
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
  /**
   * The log replayed into a fresh store from its own records (DK365, S1200: the backfill). Every marker the rules write, the funders of an account and the cases a juror sat on included, is derived from the
   * records alone, so a store whose markers are missing or older than the rule that writes them is rebuilt by this replay and the draw reads the same sources a log built under the rule would.
   */
  async replayed(): Promise<EventLog> {
    const replay = new EventLog(new MemoryStore(await this.store.allMints()), this.replayOptions());
    for (let afterSeq = 0; ; ) {
      const page = await this.store.since(afterSeq, 500);
      if (!page.length) break;
      for (const s of page) { await replay.appendAt(s.record, s.appendedAt); afterSeq = s.seq; }
    }
    return replay;
  }

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

  /** What the ledger says happened to a dispatched agent since the dispatch: credits earned and certificates gained and lost; the figures a handback must state (DK203). Undefined for an unknown dispatch or one recorded before snapshots. */
  async dispatchLedger(dispatch: string): Promise<{ earned: number; gained: string[]; lost: string[]; spent: Record<string, number> } | undefined> {
    const d = await this.store.getRecord(dispatch);
    if (!d || d.record.type !== "asp.dispatch/v0.2") return undefined;
    const agent = (d.record.body as { agent: string }).agent;
    return this.store.transaction((tx) => ledgerSince(tx, dispatch, agent));
  }

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
  async purchasesBy(did: string): Promise<AspRecord[]> { return this.recordsWhere((r) => r.type === "asp.purchase/v0.2" && buyerOf(r) === did); }

  /** What the automatic refund would give back for each purchase the institution never answered in time: the buyer, and the whole price less the burned part (DK682, S995). */
  async autoRefundDue(beforeMs: number): Promise<{ purchase: string; buyer: string; amount: number }[]> {
    const out: { purchase: string; buyer: string; amount: number }[] = [];
    for (const p of await this.unreceiptedPurchases(beforeMs)) {
      const parts = await this.store.transaction(async (tx) => { const sp = await tx.getRecord(p.id); return sp ? this.purchaseParts(tx, sp) : undefined; });
      const price = (p.body as unknown as PurchaseBody).amount.value;
      if (parts && price - parts.burn > 0) out.push({ purchase: p.id, buyer: buyerOf(p), amount: price - parts.burn });
    }
    return out;
  }

  /** Purchases older than `beforeMs` that the institution never answered with a receipt (DK682): what the automatic refund covers. */
  async unreceiptedPurchases(beforeMs: number): Promise<AspRecord[]> {
    const recs = await this.recordsOfTypes(["purchase", "receipt"]);
    const answered = new Set(recs.filter((r) => r.type === "asp.receipt/v0.2").map((r) => (r.body as { purchase: string }).purchase));
    return recs.filter((r) => r.type === "asp.purchase/v0.2" && !answered.has(r.id) && Date.parse(r.issued_at) <= beforeMs);
  }

  /** The records the given issuers signed in [fromMs, toMs): what the weekly handout counts as activity (DK545). */
  async recordsBetween(fromMs: number, toMs: number, issuers: ReadonlySet<string>): Promise<AspRecord[]> { return this.recordsWhere((r) => issuers.has(r.issuer) && Date.parse(r.issued_at) >= fromMs && Date.parse(r.issued_at) < toMs); }

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

  /** The job tax in permille of the price list in force at `at`, or null when none is (credits.md CR-15). */
  private async jobTaxPermille(tx: LogTx, at: string): Promise<number | null> {
    const list = await this.priceListInForce(tx, Date.parse(at));
    return list ? (list.record.body as unknown as PriceListBody).job_tax_permille : null;
  }

  /**
   * What a settlement on a ruling must say for a contract, at `at` (S1401, DK1450): the performer's share of the escrow and the job tax on it, and the bond slashed, by the fault map the ruling stands on (the corrected one
   * after an appeal). `undefined` when the contract has no Bond or the record is not a ruling.
   */
  async rulingSettlement(contract: string, ruling: string, at: string): Promise<{ escrow_released: number; fees: number; bond_slashed: number } | undefined> {
    return this.store.transaction(async (tx) => {
      const escrow = await tx.getEscrow(contract);
      const cb = (await tx.getRecord(contract))?.record.body as { performer?: string } | undefined;
      const fault = await effectiveFault(tx, ruling);
      if (!escrow || !cb?.performer || !fault) return undefined;
      const rate = await this.jobTaxPermille(tx, at);
      const p = rulingPayout(escrow.escrowLocked, escrow.bondLocked, fault[cb.performer] ?? 0, rate);
      return { escrow_released: p.released, fees: rate === null ? 0 : Math.floor((p.released * rate) / 1000), bond_slashed: p.slashed };
    });
  }

  /** The fault map a ruling stands on: its own, or the corrected one when an appeal reversed or varied it (S1400, DK121). */
  async effectiveFault(ruling: string): Promise<Record<string, number> | undefined> { return this.store.transaction((tx) => effectiveFault(tx, ruling)); }
  async creditAudit(): Promise<CreditAudit> { return auditLedger(await this.store.ledgerRows()); }

  /**
   * What the log can say about the credit flows today, from its signed records (credits.md 6.1 `--by-flow`): settlements with what they
   * released, returned, slashed and charged in fees, optionally from a time. Flows the records do not carry are listed as unavailable.
   */
  async creditFlows(since?: string): Promise<CreditFlows> { return creditFlowsOf(this.store, since); }

  /** Share of circulation held by the top slice of accounts (credits.md 5.6, G5, CR-19): a number only, never which DIDs hold it. */
  async creditConcentration(topFraction = 0.01): Promise<BalanceConcentration> { return topBalanceShare(await this.store.ledgerRows(), topFraction); }

  /** How many credits changed hands in the last seven days and how many each active agent moved (row DK683): counted from purchases, settlements and transfers; figures only. */
  async velocity(nowMs: number = Date.now()): Promise<VelocityReport> { return velocityOf(await this.recordsOfTypes(["passport", "contract", "settlement", "purchase", "internal_transfer"]), nowMs); }

  /** How fast agents spend their starter credits (DK543): median and 90th percentile of days to spend 90 percent, never-spenders, run-outs; figures only. */
  async starterSpend(nowMs: number = Date.now()): Promise<StarterSpendReport> { return starterSpendOf(await this.recordsOfTypes(["starter_claim", "purchase"]), nowMs); }

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
