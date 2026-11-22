/**
 * Whether a tool call's RESULT was correct or useful, not only whether it succeeded or was refused (the owner's question). A call can succeed (the gateway let it
 * through, the tool ran) and still be wrong: a delivery the house's check does not accept, a course sitting that is not passed, a field answer that earns nothing.
 *
 * Where the job has a checker the verdict is the checker's: pass or fail. Everywhere else the verdict is `not-measurable`, and the report says so rather than guess:
 * a forum read is useful or not only to the reader, a post is good or not only to its readers, and nothing here judges either. A pass rate is the share of the
 * CHECKED calls only, never of all calls.
 */
import type { TraceEvent } from "./types.ts";

export type Verdict = "pass" | "fail";
export interface CheckerRule { checker: string; verdict: (ok: boolean, text: string, discovery?: string) => Verdict | undefined }
/** The tools that have a checker, and what the checker is. Any tool not here is not measurable. */
export const CHECKERS: Record<string, CheckerRule> = {
  deliver_job: { checker: "the house's check of a delivery (a text job's criterion)", verdict: (ok, text) => /accepted by the house/.test(text) ? "pass" : /the house did not accept this delivery/.test(text) ? "fail" : undefined },
  course_sit: { checker: "the Academy's held-out grading of a sitting", verdict: (ok, text) => /^PASSED\./.test(text) ? "pass" : /^Not passed\./.test(text) ? "fail" : undefined },
  field_answer: { checker: "the card's own answer check (a good answer earns a once-only reward)", verdict: (ok, _t, discovery) => !ok ? undefined : discovery?.startsWith("marker-taken:") ? "pass" : "fail" },
};

/** The verdict for one finished call, or undefined when there is no checker for it (not measurable). */
export function verdictOf(tool: string, ok: boolean, text: string, discovery?: string): Verdict | undefined {
  return CHECKERS[tool]?.verdict(ok, text, discovery);
}

export interface ToolOutcome { calls: number; succeeded: number; refused: number; checked: number; pass: number; fail: number; succeededButFailed: number; notMeasurable: number; passRate: number | null }
export interface OutcomesReport { byTool: Record<string, ToolOutcome>; total: ToolOutcome; checkers: Record<string, string>; note: string }

const zero = (): ToolOutcome => ({ calls: 0, succeeded: 0, refused: 0, checked: 0, pass: 0, fail: 0, succeededButFailed: 0, notMeasurable: 0, passRate: null });
function add(x: ToolOutcome, e: Extract<TraceEvent, { t: "tool" }>) {
  x.calls++; if (e.ok) x.succeeded++; if (e.refused) x.refused++;
  if (e.outcome) { x.checked++; if (e.outcome === "pass") x.pass++; else { x.fail++; if (e.ok) x.succeededButFailed++; } } else if (e.ok) x.notMeasurable++;
}

export function outcomesReport(events: TraceEvent[]): OutcomesReport {
  const byTool: Record<string, ToolOutcome> = {}, total = zero();
  for (const e of events) if (e.t === "tool") { add((byTool[e.tool] ??= zero()), e); add(total, e); }
  for (const x of [...Object.values(byTool), total]) x.passRate = x.checked ? x.pass / x.checked : null;
  return { byTool, total, checkers: Object.fromEntries(Object.entries(CHECKERS).map(([k, v]) => [k, v.checker])), note: "A verdict exists only where the job has a checker; every other successful call is not measurable and is not counted as correct or incorrect. The pass rate is over the checked calls only." };
}

export function renderOutcomes(r: OutcomesReport): string {
  const L = ["## Was the result right? (tool-call outcomes)", "", `Of ${r.total.calls} calls, ${r.total.succeeded} succeeded and ${r.total.refused} were refused. ${r.total.checked} had a checker: ${r.total.pass} passed it and ${r.total.fail} failed it (${r.total.succeededButFailed} of those ran without error and were still wrong). ${r.total.notMeasurable} more succeeded with no checker and are not measurable (reads, posts and messages are good or not only to those who read them, and nothing here judges that).`, ""];
  const rows = Object.entries(r.byTool).filter(([, x]) => x.checked > 0);
  if (rows.length) {
    L.push("| Tool | Checker | Checked | Passed | Failed | Pass rate |", "|---|---|---|---|---|---|");
    for (const [k, x] of rows) L.push(`| ${k} | ${r.checkers[k] ?? ""} | ${x.checked} | ${x.pass} | ${x.fail} | ${x.passRate === null ? "n/a" : `${(x.passRate * 100).toFixed(0)}%`} |`);
    L.push("");
  } else L.push("No call in this run had a checker.", "");
  L.push("What this cannot tell you: whether an unchecked call was useful; whether a check is a good measure of the work (a house check tests the form of a text delivery, not its worth); and nothing about agents in general from one run.");
  return L.join("\n") + "\n";
}
