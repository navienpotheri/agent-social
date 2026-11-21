/**
 * Limits by plan and by tenant (DK1362, docs/enterprise-fleets.md). A fleet of 10,000 agents cannot live inside the starting limits (600 requests and 120 writes a minute, 100,000 records), so the operator
 * puts a tenant on a plan, or sets a figure for it, and the service reads the figures from the tenant's own entry at each request. A figure on the tenant wins over its plan's, and the plan's over the
 * service's default. Plans are the operator's to change here; the numbers below are sized from the arithmetic in docs/enterprise-fleets.md (an agent acting once a minute is one write a minute) and are
 * not measured prices.
 */
export interface PlanLimits { /** Requests a minute. */ rateLimitPerMinute: number; /** Writes a minute (each record of a batch counts). */ writeLimitPerMinute: number; /** Records the tenant may hold; 0 is no limit (billed by use). */ recordQuota: number; /** Bytes of records; 0 is no limit. */ byteQuota: number }

export const PLANS: Readonly<Record<string, PlanLimits>> = {
  starter: { rateLimitPerMinute: 600, writeLimitPerMinute: 120, recordQuota: 100_000, byteQuota: 100 * 1024 * 1024 },
  team: { rateLimitPerMinute: 6_000, writeLimitPerMinute: 1_200, recordQuota: 5_000_000, byteQuota: 5 * 1024 * 1024 * 1024 },
  enterprise: { rateLimitPerMinute: 60_000, writeLimitPerMinute: 12_000, recordQuota: 0, byteQuota: 0 },
};

export interface PlanTenant { plan?: string; rateLimitPerMinute?: number; writeLimitPerMinute?: number; recordQuota?: number; byteQuota?: number }

/** A tenant's own figure, else its plan's, else undefined (the service's default applies). */
export function effectiveLimits(t: PlanTenant): { rateLimitPerMinute?: number; writeLimitPerMinute?: number; recordQuota?: number; byteQuota?: number } {
  const p = t.plan ? PLANS[t.plan] : undefined;
  return {
    ...(t.rateLimitPerMinute ?? p?.rateLimitPerMinute) !== undefined ? { rateLimitPerMinute: t.rateLimitPerMinute ?? p?.rateLimitPerMinute } : {},
    ...(t.writeLimitPerMinute ?? p?.writeLimitPerMinute) !== undefined ? { writeLimitPerMinute: t.writeLimitPerMinute ?? p?.writeLimitPerMinute } : {},
    ...(t.recordQuota ?? p?.recordQuota) !== undefined ? { recordQuota: t.recordQuota ?? p?.recordQuota } : {},
    ...(t.byteQuota ?? p?.byteQuota) !== undefined ? { byteQuota: t.byteQuota ?? p?.byteQuota } : {},
  };
}

/** The most records one batch may carry: the most a tenant's write allowance can pay for at once (a quarter of a minute's writes), and never more than 200. */
export const BATCH_MAX = 200;
export const batchLimit = (writeLimitPerMinute: number): number => (writeLimitPerMinute <= 0 ? BATCH_MAX : Math.max(1, Math.min(BATCH_MAX, Math.ceil(writeLimitPerMinute / 4))));
