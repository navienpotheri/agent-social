/**
 * The self-report SDK (docs/gateway-design.md, P4): for agents that cannot be wrapped (hosted, enterprise, or running in
 * someone else's cloud). The agent checks the live Mandate itself, records what it did, and signs its own Action with
 * its own key. The evidence is `self_reported`, the weakest level: it is only as good as the agent, but it puts the agent
 * under the same Mandate, Bond, strikes and Courts as any other, and the log still refuses an Action that reports a scope
 * the Mandate does not grant.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-log";
import { RemoteLog } from "../remote.ts";

export type Assurance = "self_reported" | "runtime_observed" | "gateway_observed" | "gateway_enforced" | "hook_enforced" | "sandbox_enforced";

export class MandateRefusal extends Error {
  readonly scope: string;
  constructor(scope: string, why: string) { super(`ASP: ${why}`); this.name = "MandateRefusal"; this.scope = scope; }
}

export interface ReporterOptions {
  log: LogHandle;
  /** The agent's DID, the issuer of every Action it reports. */
  agent: string;
  /** The agent's own key. */
  signer: Signer;
  /** The job being worked. */
  contract: string;
  /** Defaults to self_reported; an integration that really did enforce may say more. */
  assurance?: Assurance;
}

export class AgentReporter {
  private readonly o: ReporterOptions;
  private used = new Set<string>();
  private blocked = new Map<string, number>();
  private artifacts: { uri: string; sha256: string }[] = [];

  constructor(o: ReporterOptions) { this.o = o; }

  /** A reporter that talks to a log service (`asp serve`). */
  static remote(o: { url: string; token?: string; agent: string; signer: Signer; contract: string; assurance?: Assurance }): AgentReporter {
    return new AgentReporter({ log: new RemoteLog(o.url, o.token), agent: o.agent, signer: o.signer, contract: o.contract, assurance: o.assurance });
  }

  /** The live Mandate: its scopes, and whether the job is still running. Re-read each time, since a Mandate can end. */
  async mandate(): Promise<{ scopes: string[]; running: boolean; state?: string }> {
    const state = (await this.o.log.log.chainInfo(this.o.contract))?.state ?? undefined;
    const m = await this.o.log.log.mandateOf(this.o.contract);
    return { scopes: m?.scopes ?? [], running: state === "Running" || state === "Checkpoint", state };
  }

  async allowed(scope: string): Promise<boolean> {
    const m = await this.mandate();
    return m.running && m.scopes.includes(scope);
  }

  /** Checks the Mandate, then runs `fn`; a refused scope is recorded as a blocked attempt and `fn` is not run. */
  async guard<T>(scope: string, fn: () => Promise<T> | T, opts: { artifact?: { uri: string; sha256: string } } = {}): Promise<T> {
    const m = await this.mandate();
    if (!m.running) throw new MandateRefusal(scope, `the job is ${m.state ?? "not in the log"}, not running`);
    if (!m.scopes.includes(scope)) {
      this.blocked.set(scope, (this.blocked.get(scope) ?? 0) + 1);
      throw new MandateRefusal(scope, `the scope ${scope} is not granted by this job's Mandate`);
    }
    const out = await fn();
    this.used.add(scope);
    if (opts.artifact) this.artifacts.push(opts.artifact);
    return out;
  }

  /** Records something that was done without asking first (for example what a tool library did on the agent's behalf). */
  note(scope: string, artifact?: { uri: string; sha256: string }): void {
    this.used.add(scope);
    if (artifact) this.artifacts.push(artifact);
  }

  /** Signs and appends one Action with what has been recorded since the last flush. Returns undefined when there is nothing to say. */
  async flush(summary?: string): Promise<{ id: string; seq: number } | undefined> {
    if (!this.used.size && !this.blocked.size) return undefined;
    const body: Record<string, unknown> = {
      contract: this.o.contract,
      scopes_used: [...this.used].sort(),
      assurance: this.o.assurance ?? "self_reported",
      ...(summary ? { summary } : {}),
      ...(this.blocked.size ? { blocked_attempts: [...this.blocked].map(([scope, count]) => ({ scope, count })) } : {}),
      ...(this.artifacts.length ? { artifacts: this.artifacts } : {}),
    };
    const record: AspRecord = createRecord({ type: "action", issuer: this.o.agent, subject: this.o.contract, prev: null, body, issued_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }, this.o.signer);
    const res = await this.o.log.append(record);
    this.used = new Set(); this.blocked = new Map(); this.artifacts = [];
    return { id: res.id, seq: res.seq };
  }
}
