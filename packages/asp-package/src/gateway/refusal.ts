/**
 * Gateway refusals as signed records (register rows DK1607, AG3; spec-delta S1601). Every call the gateway removes can be recorded in the log as an `asp.gateway_refusal/v0.2`, signed with the agent's OWN key
 * (the gateway runs on the agent's machine under the agent's run key; the log refuses any other signer), so the agent or its sponsor can contest it before a Court. The record holds the agent, the contract,
 * the scope, a rule class and the hash of the call: never the call's text, so no secret or command line reaches the log. The schema has one record per call hash (the log refuses the same hash twice) and no
 * batching, so a storm is bounded here instead: at most `perMinute` records a minute and `perRun` for a run, each distinct call once, and what is not recorded is counted and written to the run log
 * (`gateway_refusal_overflow`) and to the run's summary, never silently dropped. A refusal costs no credits and moves nothing.
 */
import { createHash } from "node:crypto";

export type RefusalRule = "outside_mandate" | "forbidden_means" | "injection_hold" | "budget" | "network_host";

/** The class of a refusal, from the gateway's own reason text and the scope. */
export function refusalRule(reason: string | undefined, _scope: string): RefusalRule {
  const r = (reason ?? "").toLowerCase();
  if (/is not one this job's mandate allows|host .* not allowed|no readable host|not in the mandate's hosts/.test(r)) return "network_host";
  if (/reaches outward|copied from a tool result|you just read|untrusted/.test(r)) return "injection_hold";
  if (/times in the last minute|rate limit|requests a minute|budget|token cap|ceiling|halt|loop/.test(r)) return "budget";
  if (/outbound scan|protected|forbidden|irreversible|probing|brute force|scanning|abuse|secret|credential|circumvent|malformed/.test(r)) return "forbidden_means";
  return "outside_mandate";
}

/** The hash of a call (its tool name and arguments): what the record carries instead of the call. */
export const callSha256 = (name: string, args: unknown): string => createHash("sha256").update(JSON.stringify([name, args ?? null])).digest("hex");

export interface RefusalEvent { tool: string; scope: string; rule: RefusalRule; callSha256: string }
export interface RefusalBody { agent: string; contract?: string; scope: string; rule: string; call_sha256: string; at: string }
export interface RefusalRecorderOptions {
  agent: string; contract?: string;
  /** Signs and appends one record. Rejects when the log refuses it. */
  append: (body: RefusalBody) => Promise<void>;
  now?: () => number; iso?: () => string;
  perMinute?: number; perRun?: number;
  /** Told once when a refusal is not recorded because of a cap (run log line). */
  onOverflow?: (e: { tool: string; scope: string; rule: string; reason: "per_minute" | "per_run"; skipped: number }) => void;
  onError?: (e: Error) => void;
}

export class RefusalRecorder {
  private o: RefusalRecorderOptions;
  private seen = new Set<string>();
  private stamps: number[] = [];
  private pending: Promise<void>[] = [];
  private accepted = 0;
  recorded = 0; duplicates = 0; overflow = 0; failed = 0;
  constructor(o: RefusalRecorderOptions) { this.o = o; }
  private get perMinute() { return this.o.perMinute ?? 10; }
  private get perRun() { return this.o.perRun ?? 50; }

  record(e: RefusalEvent): void {
    if (this.seen.has(e.callSha256)) { this.duplicates++; return; }
    const now = (this.o.now ?? Date.now)();
    this.stamps = this.stamps.filter((t) => now - t < 60_000);
    const reason = this.accepted >= this.perRun ? "per_run" : this.stamps.length >= this.perMinute ? "per_minute" : undefined;
    if (reason) { this.overflow++; this.o.onOverflow?.({ tool: e.tool, scope: e.scope, rule: e.rule, reason, skipped: this.overflow }); return; }
    this.seen.add(e.callSha256);
    this.accepted++;
    this.stamps.push(now);
    const body: RefusalBody = { agent: this.o.agent, ...(this.o.contract ? { contract: this.o.contract } : {}), scope: (e.scope || e.tool).slice(0, 128), rule: e.rule, call_sha256: e.callSha256, at: (this.o.iso ?? (() => new Date().toISOString().replace(/\.\d+Z$/, "Z")))() };
    const p = this.o.append(body).then(() => { this.recorded++; }, (err) => { this.failed++; this.o.onError?.(err as Error); });
    this.pending.push(p);
  }
  /** Waits for every append to finish. */
  async flush(): Promise<void> { await Promise.all(this.pending); this.pending = []; }
  summary(): { recorded: number; duplicates: number; overflow: number; failed: number } { return { recorded: this.recorded, duplicates: this.duplicates, overflow: this.overflow, failed: this.failed }; }
}
