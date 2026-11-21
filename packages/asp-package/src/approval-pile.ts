/**
 * When approval requests pile up unanswered (register row P29; spec-delta S1453). Found in the long-horizon run (2026-10-12): an agent whose gated command went unanswered retried it for 40 minutes, each try holding a
 * full wait. The policy, in one place so the gateway and the package path (the pre-call hooks of Claude Code, Antigravity and OpenHands through `asp run`) apply the same one:
 *   1. a request nobody answered in time is counted;
 *   2. after `maxUnanswered` of them (default 2, `ASP_MAX_UNANSWERED_APPROVALS`) no more are asked: a gated call is refused at once, with a reason the agent can act on (continue without it, or stop and tell the person);
 *   3. the first call refused that way tells the person, once, in words ("approvals are piling up"), and goes in the run log;
 *   4. after `stopAfter` such refusals (default 6, `ASP_STOP_AFTER_UNANSWERED`) the agent is not carrying on without the call but retrying it: the session is stopped, without a strike and without a slash (the person was away,
 *      the agent did nothing against the Mandate), and the person is told that too.
 * The pile has no memory beyond the session. Credits are accounting entries, not money.
 */
const positive = (v: string | undefined, fallback: number): number => (Number(v) > 0 ? Math.floor(Number(v)) : fallback);

export interface PileOptions { maxUnanswered?: number; stopAfter?: number; env?: Record<string, string | undefined> }
export interface AtOnce { /** The reason handed to the agent. */ reason: string; /** True for the first refusal of this kind: tell the person now. */ notify?: string; /** True when the session should be stopped now. */ stop?: string }

export class ApprovalPile {
  readonly maxUnanswered: number;
  readonly stopAfter: number;
  private unanswered = 0;
  private refused = 0;
  private stopped = false;
  constructor(o: PileOptions = {}) {
    const env = o.env ?? process.env;
    this.maxUnanswered = o.maxUnanswered ?? positive(env.ASP_MAX_UNANSWERED_APPROVALS, 2);
    this.stopAfter = o.stopAfter ?? positive(env.ASP_STOP_AFTER_UNANSWERED, 6);
  }
  /** A request nobody answered in time. */
  noteUnanswered(): void { this.unanswered++; }
  /** Whether a gated call is now refused without asking. */
  get closed(): boolean { return this.unanswered >= this.maxUnanswered; }
  get unansweredCount(): number { return this.unanswered; }
  get refusedAtOnceCount(): number { return this.refused; }
  /** Whether a decision reason is the one a request that went unanswered gets (the hooks and `asp run` write it into the decision file). */
  static isUnanswered(reason: string | undefined): boolean { return /(^|\b)(no answer within|did not answer within)/.test(reason ?? ""); }

  /** Called for a gated call refused without asking: what to tell the agent, and whether to tell the person or stop the session. */
  refuseAtOnce(scope: string): AtOnce {
    this.refused++;
    const reason = `the scope ${scope} needs the principal's approval, and ${this.unanswered} earlier approval request(s) in this session went unanswered, so no more are asked: continue without this call, or stop and tell the person`;
    const out: AtOnce = { reason };
    if (this.refused === 1) out.notify = `approvals are piling up: ${this.unanswered} request(s) for your approval went unanswered, so the agent is no longer held waiting; its gated calls are refused at once. Answer with asp market resolve, or stop the run. If it keeps asking, the session is stopped after ${this.stopAfter} refusals.`;
    if (!this.stopped && this.refused >= this.stopAfter) { this.stopped = true; out.stop = `the agent kept asking for a call nobody approved (${this.refused} refusals after ${this.unanswered} unanswered requests): the session was stopped, with no strike and no slash, because the person did not answer`; }
    return out;
  }
}
