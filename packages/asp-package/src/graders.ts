/**
 * Grader agents with a measured record (register row DK802; spec-delta S1220; the 19th Nov owner screenshots): a run is scored by graders (an LLM-style judge, in the tests a scripted one) and by a deterministic
 * end-state check. A grader's weight follows its measured agreement with the deterministic check over the runs it has graded, so a grader that disagrees is down-weighted and one that agrees counts for more; a grader
 * may not grade its own work or the work of an agent its sponsor sponsors; failures are clustered by runtime, tool and check in a fixed order; and a grade is an enum and a number, never text. A simulated society of
 * scripted graders; a real judge model is a live run.
 */
export interface RunFacts { id: string; agent: string; sponsor: string; runtime: string; tool: string; check: string; /** The deterministic end-state check's verdict: the truth the graders are measured against. */ endStatePass: boolean }
export interface Grader { id: string; sponsor: string }
export type Verdict = "pass" | "fail";
export interface Grade { grader: string; run: string; verdict: Verdict; weightPermille: number }
export type Refusal = { ok: false; code: "GRADES_OWN_WORK" | "GRADES_SPONSORS_AGENT" | "UNKNOWN_GRADER" };

export class GraderBook {
  /** grader -> [agreements with the deterministic check, runs graded]. */
  private readonly record = new Map<string, [number, number]>();
  private readonly graders = new Map<string, Grader>();
  constructor(graders: Grader[]) { for (const g of graders) { this.graders.set(g.id, g); this.record.set(g.id, [0, 0]); } }

  /** Whether a grader may grade a run: not its own work, and not the work of an agent its sponsor sponsors. */
  eligible(graderId: string, run: RunFacts): true | Refusal {
    const g = this.graders.get(graderId);
    if (!g) return { ok: false, code: "UNKNOWN_GRADER" };
    if (g.id === run.agent) return { ok: false, code: "GRADES_OWN_WORK" };
    if (g.sponsor === run.sponsor) return { ok: false, code: "GRADES_SPONSORS_AGENT" };
    return true;
  }

  /** Measures a grader against the deterministic check on a run it graded: one more run, and one more agreement if it said what the check said. */
  measure(graderId: string, run: RunFacts, verdict: Verdict): void {
    const rec = this.record.get(graderId)!;
    rec[1]++;
    if ((verdict === "pass") === run.endStatePass) rec[0]++;
  }
  /** The weight in permille: the share of its graded runs on which it agreed with the check, smoothed so a new grader starts at one half and no grader is ever 0 or 1000. */
  weightPermille(graderId: string): number { const [a, n] = this.record.get(graderId) ?? [0, 0]; return Math.round(((a + 1) / (n + 2)) * 1000); }
  agreement(graderId: string): { agreed: number; graded: number } { const [a, n] = this.record.get(graderId) ?? [0, 0]; return { agreed: a, graded: n }; }

  /** The grade of a run by the weighted vote of the graders that may grade it; the grades are enums and numbers. */
  combine(run: RunFacts, votes: { grader: string; verdict: Verdict }[]): { verdict: Verdict; grades: Grade[]; passWeight: number; failWeight: number } | Refusal {
    const grades: Grade[] = [];
    for (const v of votes) { const e = this.eligible(v.grader, run); if (e !== true) return e; grades.push({ grader: v.grader, run: run.id, verdict: v.verdict, weightPermille: this.weightPermille(v.grader) }); }
    const passWeight = grades.filter((g) => g.verdict === "pass").reduce((n, g) => n + g.weightPermille, 0), failWeight = grades.filter((g) => g.verdict === "fail").reduce((n, g) => n + g.weightPermille, 0);
    return { verdict: passWeight > failWeight ? "pass" : "fail", grades, passWeight, failWeight };
  }
}

/** Failures grouped by runtime, tool and check, in a fixed order: the same runs in any order give the same clusters. */
export function clusters(runs: RunFacts[]): { runtime: string; tool: string; check: string; count: number; runs: string[] }[] {
  const by = new Map<string, RunFacts[]>();
  for (const r of runs.filter((x) => !x.endStatePass)) { const k = [r.runtime, r.tool, r.check].join("\u0000"); (by.get(k) ?? by.set(k, []).get(k)!).push(r); }
  return [...by.values()].map((g) => ({ runtime: g[0].runtime, tool: g[0].tool, check: g[0].check, count: g.length, runs: g.map((r) => r.id).sort() }))
    .sort((a, b) => b.count - a.count || a.runtime.localeCompare(b.runtime) || a.tool.localeCompare(b.tool) || a.check.localeCompare(b.check));
}
