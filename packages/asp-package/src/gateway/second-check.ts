/**
 * The second check on risky calls (register row DK531; owner decision 2026-11-18, BM18): a small model may look at a call the rules ALLOWED and are not sure is safe, and may only make the answer
 * stricter. The rules stay the floor: a call the rules block never reaches the model, so the model can never widen what a Mandate allows, and a model that says "allow", says "unsure", fails, times
 * out or has no budget left changes nothing. It runs on risky calls only (anything that is not a plain read), behind a switch, and its cost is counted against a budget the operator sets; when the
 * budget is spent the rules answer alone. The model is injected: nothing here calls a provider, and the call text is passed as data, never as instructions. Credits are not involved; the cost is the operator's.
 */
import { classify, type Judgement, type ToolCall } from "./judge.ts";

export type SecondVerdict = "block" | "allow" | "unsure";
export interface SecondAnswer { verdict: SecondVerdict; /** What the call cost, in micro-dollars (millionths of a dollar). */ costMicro?: number }
export type SecondJudge = (call: ToolCall, context: { scope: string }) => Promise<SecondAnswer>;

export interface SecondCheckOptions {
  /** The switch. Off: the rules answer alone and the model is never called. */
  enabled: boolean;
  judge?: SecondJudge;
  /** The most the second check may spend in micro-dollars; once spent it falls back to the rules. */
  budgetMicro: number;
  /** Which allowed calls are worth a second look; the default is any call that is not a plain read. */
  isRisky?: (call: ToolCall, rules: Judgement) => boolean;
}

export interface SecondCheckLedger { reviewed: number; blocked: number; unsure: number; fellBack: number; skippedSafe: number; skippedBudget: number; spentMicro: number }
export type Reviewed = Judgement & { by: "rules" | "second_check" };

const READ_ONLY = /\.(read|list|search|get)$/;
export const defaultRisky = (call: ToolCall, rules: Judgement): boolean => {
  const scope = rules.scope || classify(call).scope;
  return scope !== "" && !READ_ONLY.test(scope);
};

export class SecondCheck {
  readonly ledger: SecondCheckLedger = { reviewed: 0, blocked: 0, unsure: 0, fellBack: 0, skippedSafe: 0, skippedBudget: 0, spentMicro: 0 };
  private readonly o: SecondCheckOptions;
  constructor(o: SecondCheckOptions) { this.o = o; }

  /** The final answer for a call the rules already judged. Never returns allow where the rules said block. */
  async review(call: ToolCall, rules: Judgement): Promise<Reviewed> {
    if (!rules.allow || !this.o.enabled || !this.o.judge) return { ...rules, by: "rules" };
    if (!(this.o.isRisky ?? defaultRisky)(call, rules)) { this.ledger.skippedSafe++; return { ...rules, by: "rules" }; }
    if (this.ledger.spentMicro >= this.o.budgetMicro) { this.ledger.skippedBudget++; return { ...rules, by: "rules" }; }
    let answer: SecondAnswer;
    try { answer = await this.o.judge(call, { scope: rules.scope }); } catch { this.ledger.fellBack++; return { ...rules, by: "rules" }; }
    this.ledger.reviewed++;
    this.ledger.spentMicro += Math.max(0, Math.trunc(answer.costMicro ?? 0));
    if (answer.verdict === "block") { this.ledger.blocked++; return { ...rules, allow: false, reason: "the second check judged this call unsafe for the Mandate (the rules allowed it)", by: "second_check" }; }
    if (answer.verdict === "unsure") this.ledger.unsure++;
    return { ...rules, by: "rules" };
  }

  /** The cost, in words, for the operator's report. */
  report(): string {
    const l = this.ledger;
    return `second check ${this.o.enabled ? "on" : "off"}: ${l.reviewed} call(s) reviewed, ${l.blocked} blocked that the rules allowed, ${l.unsure} unsure, ${l.fellBack} fell back after an error, ${l.skippedSafe} plain reads skipped, ${l.skippedBudget} skipped for budget; spent $${(l.spentMicro / 1_000_000).toFixed(4)} of $${(this.o.budgetMicro / 1_000_000).toFixed(4)}`;
  }
}
