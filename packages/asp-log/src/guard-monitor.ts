/**
 * The monetary guard monitor (docs/institutions/economy/credits.md 5.6; register rows DK1, DK73; CR-19): the named triggers, computed from
 * what the log can show today, and published (the public supply page, economy-supply.ts, shows this report).
 *
 * Four of the eight measures in credits.md need data the log does not hold yet: the starter pool's cap and use are a file separate from the
 * ledger (DK70), the sign-up service's claim rate is not read here, the basket ratio needs a median qualifying-job earnings figure nothing
 * computes yet, and dormancy needs upkeep, which is not built (DK22). They are reported as unavailable, with the reason, rather than guessed
 * at: a monitor that invents a number is worse than one that says it does not have one. A measure never changes a balance, a tier, a rank or
 * a record; it only reads and reports. Credits are accounting entries, not money.
 */
import type { LogHandle } from "./server.ts";

export type GuardMeasureId = "G1" | "G5" | "G6" | "G8";
export type GuardUnavailableId = "G2" | "G3" | "G4" | "G7";

export interface GuardMeasure {
  id: GuardMeasureId;
  label: string;
  value: number;
  threshold: string;
  triggered: boolean;
  action: string;
}

export interface GuardUnavailable {
  id: GuardUnavailableId;
  label: string;
  reason: string;
}

export interface GuardReport {
  at: string;
  measures: GuardMeasure[];
  unavailable: GuardUnavailable[];
  anyTriggered: boolean;
}

const UNAVAILABLE: GuardUnavailable[] = [
  { id: "G2", label: "starter pool use", reason: "the pool's cap and use are kept in a file separate from the ledger, not yet derived from the signed mint records (register row DK70)" },
  { id: "G3", label: "claim rate", reason: "new starter claims a day are counted by the sign-up service (packages/asp-log/src/signup.ts), which this monitor does not read" },
  { id: "G4", label: "basket ratio", reason: "needs the median monthly earnings of agents with a qualifying job in 30 days, which nothing computes yet (GV4)" },
  { id: "G7", label: "dormancy", reason: "upkeep and the dormant state do not exist yet (register row DK22)" },
];

export async function computeGuardReport(o: { handle: LogHandle; now?: () => number }): Promise<GuardReport> {
  const now = o.now ? o.now() : Date.now();
  const audit = await o.handle.log.creditAudit();
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const flows = await o.handle.log.creditFlows(since);
  const mintedIn30d = Object.values(flows.mintedByReason).reduce((a, b) => a + b, 0);
  const issuanceRate = audit.circulating > 0 ? mintedIn30d / audit.circulating : 0;
  const concentration = await o.handle.log.creditConcentration(0.01);
  const treasuryRatio = audit.circulating > 0 ? audit.treasury / audit.circulating : 0;

  const measures: GuardMeasure[] = [
    {
      id: "G1", value: issuanceRate, threshold: "above 0.10", triggered: issuanceRate > 0.10,
      label: "issuance rate: signed mints in the last 30 days (credits.md's old unsigned mints carry no time and are not counted here) / circulation today",
      action: "pause bootstrap and treasury_issuance mints until the owner approves; starter claims continue within the pool",
    },
    {
      id: "G5", value: concentration.topShare, threshold: "above 0.50", triggered: concentration.topShare > 0.50,
      label: `hoarding: share of circulation held by the top ${concentration.topCount} of ${concentration.accountsConsidered} account(s)`,
      action: "publish, and review the tax rate (bounds 0 to 50 permille)",
    },
    {
      id: "G6", value: treasuryRatio, threshold: "above 0.25", triggered: treasuryRatio > 0.25,
      label: "Treasury balance / circulation",
      action: "spend a plan or lower the tax (the drained side of this measure, below one month of approved budgets, needs budget records that do not exist yet: register row DK14)",
    },
    {
      id: "G8", value: audit.verdict === "mismatch" ? 1 : 0, threshold: "any mismatch", triggered: audit.verdict === "mismatch",
      label: "audit mismatch: the supply rule does not hold",
      action: "stop institution purchases and settlements-with-fees on the hosted service until the operator finds it; the log still accepts other records",
    },
  ];
  return { at: new Date(now).toISOString(), measures, unavailable: UNAVAILABLE, anyTriggered: measures.some((m) => m.triggered) };
}
