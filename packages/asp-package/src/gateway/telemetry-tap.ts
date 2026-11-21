/**
 * The telemetry tap of a gateway run (register row DK241; instrumentation.md 7). It feeds the Collector (asp-log) from the calls the gateway judges, and only through the Collector's consent gate: a signal that
 * the Mandate's `telemetry` field does not list, or that the consent does not name, is never read (its source function is not called), and a run with no consent says `telemetry: off` and collects nothing.
 *
 * What a gateway can see from calls alone is small and stated here: `plan_trace` (the order in which the agent used tools: step number, tool name, scope, allowed) and `sub_agent_graph` (a call that starts a sub-agent:
 * step number only). The other seven signals (reasoning, memory rules, belief state, predictions, world-model updates, active inference, calibration) come from the agent's own reports, not from a call the gateway judges,
 * so this tap never collects them. Entries hold numbers and identifiers only, never the arguments or any text. The figures are never read by a tier, rank, bond, certificate or eligibility code.
 * Credits are accounting entries, not money.
 */
import { Collector, type ConsentView, type Signal } from "@agent-social/asp-log";

/** Tool names that start a sub-agent (Claude Code's Task and Agent tools, and the generic names runtimes use). */
const SPAWNS = /^(task|agent|spawn_agent|subagent|sub_agent|delegate)$/i;

export interface GatewayCall { tool: string; scope: string; allowed: boolean }

export class GatewayTelemetry {
  readonly collector: Collector;
  private step = 0;
  constructor(consent: ConsentView | undefined, at: () => string = () => new Date().toISOString()) { this.collector = new Collector(consent, at); }

  /** Called for every judged call, in order. The source functions run only when the consent gate says yes. */
  observeCall(e: GatewayCall): void {
    const n = ++this.step;
    this.collector.collect("plan_trace", () => ({ step: n, tool: e.tool.slice(0, 80), scope: e.scope.slice(0, 40), allowed: e.allowed }));
    if (SPAWNS.test(e.tool)) this.collector.collect("sub_agent_graph", () => ({ step: n, spawn: true }));
  }

  /** What the run log says at the end of the run: `telemetry: on` or `off`, the signals that were collected and how many entries each holds; numbers and names only. */
  summary(): { status: string; signals: Partial<Record<Signal, number>> } {
    const signals: Partial<Record<Signal, number>> = {};
    for (const [k, v] of Object.entries(this.collector.entries)) signals[k as Signal] = (v as unknown[]).length;
    return { status: this.collector.status, signals };
  }
}
