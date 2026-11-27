/**
 * The capacity plan's arithmetic (docs/capacity-plan.md; register row DK65): what a beta of `tenants` tenants and `runs` governed runs asks of the log service, and whether the shipped limits and the starter pool
 * cover it. Pure functions over stated inputs; the inputs that are measured (bytes a record takes, latency) come from the load test (`evals/load-test.mjs`, results in docs/load-test-results-*.md). Nothing here
 * says a hosted target is met: that needs a hosted run (owner checklist). Credits are accounting entries, not money.
 */
import { DEFAULT_STARTING } from "./signup.ts";
import { STARTER_MAX_DIDS, STARTER_PER_DID, starterPoolFor, STARTER_POOL } from "./starter.ts";

/** The share of the peak one busy tenant carries (assumption). */
export const BUSY_TENANT_SHARE = 0.1;
/** The service's write limit a tenant gets by default (`asp serve --write-limit`). */
export const DEFAULT_WRITE_LIMIT_PER_MINUTE = 120;

export interface CapacityInput {
  tenants: number; runs: number; days: number;
  /** Records one run writes to the log: an Action a stretch for a governed run (about 2), a marketed job about ten (intent, offer, contract, bond, mandate, action, delivery, acceptance, settlement). */
  recordsPerRun: number;
  /** Measured by the load test, in bytes, on the log's own database file. */
  bytesPerRecord: number;
  /** How much busier the busiest hour is than the average hour (assumption). */
  peakFactor: number;
  /** Requests a record write comes with (reads, token checks, the call itself); assumption. */
  requestsPerWrite: number;
}
export interface CapacityPlan {
  records: number; storageBytes: number; recordsPerTenant: number; runsPerTenant: number;
  avgWritesPerSecond: number; peakWritesPerSecond: number; peakRequestsPerSecond: number;
  /** A busy tenant carries a tenth of the peak (assumption): its writes and requests a minute at the peak. */
  busyTenantWritesPerMinute: number; busyTenantRequestsPerMinute: number;
}

export function plan(i: CapacityInput): CapacityPlan {
  const records = i.runs * i.recordsPerRun;
  const seconds = i.days * 86_400;
  const avg = records / seconds;
  const peak = avg * i.peakFactor;
  const busyWrites = peak * BUSY_TENANT_SHARE * 60;
  return { records, storageBytes: records * i.bytesPerRecord, recordsPerTenant: records / i.tenants, runsPerTenant: i.runs / i.tenants, avgWritesPerSecond: avg, peakWritesPerSecond: peak, peakRequestsPerSecond: peak * i.requestsPerWrite, busyTenantWritesPerMinute: busyWrites, busyTenantRequestsPerMinute: busyWrites * i.requestsPerWrite };
}

/** What the shipped limits cannot carry for this plan: each problem names the limit and the figure. */
export function limitProblems(i: CapacityInput, limits: { recordQuota: number; byteQuota: number; rateLimitPerMinute: number; writeLimitPerMinute?: number } = DEFAULT_STARTING, starterPool: number = STARTER_POOL): string[] {
  const p = plan(i);
  const out: string[] = [];
  if (p.recordsPerTenant > limits.recordQuota) out.push(`record quota ${limits.recordQuota} a tenant is below the ${Math.round(p.recordsPerTenant)} records a tenant writes (${Math.round(p.runsPerTenant)} runs x ${i.recordsPerRun} records)`);
  if ((p.recordsPerTenant * i.bytesPerRecord) > limits.byteQuota) out.push(`byte quota ${limits.byteQuota} a tenant is below the ${Math.round(p.recordsPerTenant * i.bytesPerRecord)} bytes a tenant writes`);
  if (p.busyTenantRequestsPerMinute > limits.rateLimitPerMinute) out.push(`rate limit ${limits.rateLimitPerMinute} requests a minute a tenant is below the ${Math.round(p.busyTenantRequestsPerMinute)} a busy tenant makes at the peak`);
  const wl = limits.writeLimitPerMinute ?? DEFAULT_WRITE_LIMIT_PER_MINUTE;
  if (p.busyTenantWritesPerMinute > wl) out.push(`write limit ${wl} a minute a tenant is below the ${Math.round(p.busyTenantWritesPerMinute)} writes a busy tenant makes at the peak`);
  const need = starterPoolFor(i.tenants);
  if (starterPool < need) out.push(`starter pool ${starterPool} is below the ${need} that ${i.tenants} tenants x ${STARTER_MAX_DIDS} identities x ${STARTER_PER_DID} credits need`);
  return out;
}
