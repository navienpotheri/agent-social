/**
 * The Clinic's health service (docs/institutions/clinic.md CL-1, CL-2, CL-4; register row DK28): reads the signed Action records of one agent, builds its drift series from what the gateway observed, scores a
 * recent window against the agent's own baseline, and turns a flag into a diagnosis with the evidence listed and an order for a re-exam or a refresher course.
 *
 * What it counts: only Actions whose assurance is gateway_observed or stronger (clause 2 of clinic.md section 1: an agent's own report cannot anchor a series). An agent with fewer observed jobs than a window
 * needs is "unmeasured", said so, never "clean". It uses the canary's own drift thresholds (packages/asp-cli/src/canary.ts: tokens above 1.5 times and 200 more, tool calls 1.5 times and 2 more, seconds 2 times
 * and 20 more, more blocked attempts than the baseline) so a drift means the same thing in a checkup as in a canary run. A flag needs two different measures; one measure is a note ("watch"), never a diagnosis.
 *
 * Stated detection bound: an agent whose behaviour changed and stays changed is flagged within DETECT_WITHIN_JOBS (5) observed jobs after the change (the median of the last 5 jobs moves on the 3rd).
 */

export const OBSERVED_ASSURANCE = ["gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"];

/** Thresholds and window sizes. Proposals for the first season (clinic.md section 11, decision 5). */
export const HEALTH = {
  /** The recent jobs compared with the baseline (the median is used, so one noisy job never flags). */
  window: 5,
  /** The earlier jobs that make the baseline. */
  baseline: 20,
  /** Fewest baseline jobs; below this the agent is unmeasured and nothing is flagged. */
  minBaseline: 5,
  /** A change that stays is flagged within this many observed jobs. */
  detectWithinJobs: 5,
  tokens: { factor: 1.5, plus: 200 },
  toolCalls: { factor: 1.5, plus: 2 },
  seconds: { factor: 2, plus: 20 },
  /** Refused attempts in the window, as well as a higher median, before blocked attempts count. */
  blockedTotal: 3,
};

export interface HealthJob {
  id: string;
  issuedAt: string;
  assurance?: string;
  tokens: number;
  toolCalls: number;
  seconds: number;
  /** Refused attempts in this job (the sum of blocked_attempts counts). */
  blocked: number;
  scopes: string[];
  models: string[];
}

export interface LineageMark { id: string; at: string; layer: string }

export type Measure = "tokens" | "tool_calls" | "seconds" | "blocked_attempts" | "new_risky_scope";

export interface Finding {
  measure: Measure;
  baseline: number | string;
  observed: number | string;
  threshold: string;
  /** Action ids the finding rests on. */
  evidence: string[];
}

export type Severity = "ok" | "unmeasured" | "watch" | "warn" | "quarantine_recommended";
export type Cause = "memory_change" | "runtime_swap" | "model_update" | "environment" | "unknown";

export interface HealthScore {
  severity: Severity;
  findings: Finding[];
  /** Window [from, to] as issued_at of its first and last job. */
  window?: { from: string; to: string; jobs: string[] };
  baselineJobs: number;
  observedJobs: number;
  skippedUnobserved: number;
  cause?: { cause: Cause; edge?: string };
}

const RISKY = (s: string) => ["shell.exec", "shell.network", "repo.push", "pr.merge", "pr.open"].includes(s) || s.startsWith("mcp.") || s.startsWith("tool.");

/** An Action record's body into a job (the fields a series needs). */
export function jobOf(id: string, issuedAt: string, body: { scopes_used?: string[]; assurance?: string; blocked_attempts?: { count: number }[]; metrics?: { tokens_in?: number; tokens_out?: number; tool_calls?: number; seconds?: number; models?: { name: string }[] } }): HealthJob {
  const m = body.metrics ?? {};
  return {
    id, issuedAt, assurance: body.assurance, tokens: (m.tokens_in ?? 0) + (m.tokens_out ?? 0), toolCalls: m.tool_calls ?? 0, seconds: m.seconds ?? 0,
    blocked: (body.blocked_attempts ?? []).reduce((n, b) => n + b.count, 0), scopes: body.scopes_used ?? [], models: (m.models ?? []).map((x) => x.name),
  };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** The drift series of one agent: its jobs in time order, only the ones a gateway observed, and how many were left out for being self-reported. */
export function driftSeries(jobs: HealthJob[]): { series: HealthJob[]; skippedUnobserved: number } {
  const ordered = [...jobs].sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt) || a.id.localeCompare(b.id));
  const series = ordered.filter((j) => OBSERVED_ASSURANCE.includes(j.assurance ?? ""));
  return { series, skippedUnobserved: ordered.length - series.length };
}

/**
 * Scores the series up to and including job `end` (an index into `series`): the last HEALTH.window jobs against the HEALTH.baseline jobs before them. When `after` names a lineage edge time that falls inside
 * the series, the baseline is the jobs before that edge and the window the jobs after it (a post-change checkup), so a long change is still compared with the agent as it was.
 */
export function scoreSeries(series: HealthJob[], end: number, marks: LineageMark[] = [], skippedUnobserved = 0, after?: string): HealthScore {
  const upto = series.slice(0, end + 1);
  const base = { baselineJobs: 0, observedJobs: upto.length, skippedUnobserved };
  const winStart = after ? upto.findIndex((j) => Date.parse(j.issuedAt) > Date.parse(after)) : Math.max(0, upto.length - HEALTH.window);
  if (winStart < 0 || upto.length - winStart < HEALTH.window) return { severity: "unmeasured", findings: [], ...base };
  const win = upto.slice(after ? winStart : upto.length - HEALTH.window, after ? winStart + HEALTH.window : undefined);
  const start = after ? winStart : upto.length - HEALTH.window;
  const bl = upto.slice(Math.max(0, start - HEALTH.baseline), start);
  if (bl.length < HEALTH.minBaseline) return { severity: "unmeasured", findings: [], ...base, baselineJobs: bl.length };
  const ids = win.map((j) => j.id);
  const findings: Finding[] = [];
  const rise = (measure: Measure, pick: (j: HealthJob) => number, t: { factor: number; plus: number }) => {
    const b = median(bl.map(pick)), o = median(win.map(pick));
    if (o > b * t.factor && o - b > t.plus) findings.push({ measure, baseline: b, observed: o, threshold: `above ${t.factor} times the baseline and more than ${t.plus} higher (median of the last ${win.length} jobs against the ${bl.length} before)`, evidence: win.filter((j) => pick(j) > b * t.factor && pick(j) - b > t.plus).map((j) => j.id) });
  };
  rise("tokens", (j) => j.tokens, HEALTH.tokens);
  rise("tool_calls", (j) => j.toolCalls, HEALTH.toolCalls);
  rise("seconds", (j) => j.seconds, HEALTH.seconds);
  const bb = median(bl.map((j) => j.blocked)), ob = median(win.map((j) => j.blocked)), total = win.reduce((n, j) => n + j.blocked, 0);
  if (ob > bb && total >= HEALTH.blockedTotal) findings.push({ measure: "blocked_attempts", baseline: bb, observed: ob, threshold: `a higher median of refused attempts per job and at least ${HEALTH.blockedTotal} refused in the window (${total})`, evidence: win.filter((j) => j.blocked > 0).map((j) => j.id) });
  const known = new Set(bl.flatMap((j) => j.scopes));
  const fresh = [...new Set(win.flatMap((j) => j.scopes).filter((s) => RISKY(s) && !known.has(s)))].sort();
  if (fresh.length) findings.push({ measure: "new_risky_scope", baseline: "none of these in the baseline", observed: fresh.join(", "), threshold: "any risky scope the agent had not used in its baseline jobs", evidence: win.filter((j) => j.scopes.some((s) => fresh.includes(s))).map((j) => j.id) });
  const measures = new Set(findings.map((f) => f.measure));
  const severity: Severity = measures.size === 0 ? "ok" : measures.size === 1 ? "watch" : measures.size >= 3 || measures.has("new_risky_scope") ? "quarantine_recommended" : "warn";
  const out: HealthScore = { severity, findings, window: { from: win[0].issuedAt, to: win[win.length - 1].issuedAt, jobs: ids }, baselineJobs: bl.length, observedJobs: upto.length, skippedUnobserved };
  if (severity === "warn" || severity === "quarantine_recommended") out.cause = causeOf(bl, win, marks);
  return out;
}

/** The likeliest cause: a model that changed between the baseline and the window, else the newest lineage edge inside or just before the window (memory edit or a runtime layer), else unknown. */
export function causeOf(baseline: HealthJob[], win: HealthJob[], marks: LineageMark[]): { cause: Cause; edge?: string } {
  const before = new Set(baseline.flatMap((j) => j.models));
  if (win.some((j) => j.models.some((m) => !before.has(m))) && before.size) return { cause: "model_update" };
  const from = Date.parse(baseline[0].issuedAt), to = Date.parse(win[win.length - 1].issuedAt);
  const edge = marks.filter((e) => Date.parse(e.at) >= from && Date.parse(e.at) <= to).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!edge) return { cause: "unknown" };
  return { cause: edge.layer === "memory" || edge.layer === "self_modification" ? "memory_change" : "runtime_swap", edge: edge.id };
}

/** Scans a series job by job, the way the Clinic's monitor would see it as each Action arrives, and returns the first job at which the agent is flagged (a warn or worse), with the score. */
export function firstFlag(series: HealthJob[], marks: LineageMark[] = [], skippedUnobserved = 0): { index: number; score: HealthScore } | undefined {
  for (let i = 0; i < series.length; i++) {
    const score = scoreSeries(series, i, marks, skippedUnobserved);
    if (score.severity === "warn" || score.severity === "quarantine_recommended") return { index: i, score };
  }
  return undefined;
}

/** What a diagnosis body carries (the record `clinic_diagnosis`, spec-delta S261). */
export interface DiagnosisBody {
  agent: string;
  window: { from: string; to: string };
  severity: "watch" | "warn" | "quarantine_recommended";
  findings: Finding[];
  cause: { cause: Cause; edge?: string };
  recommendation: { action: "re_exam" | "refresher_course" | "quarantine" | "watch"; skill?: string; note: string }[];
  assurance: string;
  baseline_jobs: number;
}

/** A score that is a warn or worse into a diagnosis body; nothing for an agent that is ok, unmeasured or only on watch (a watch is a note on the Clinic's list, not a record). */
export function diagnosisOf(agent: string, score: HealthScore, skill = "foundations"): DiagnosisBody | undefined {
  if ((score.severity !== "warn" && score.severity !== "quarantine_recommended") || !score.window) return undefined;
  const recommendation: DiagnosisBody["recommendation"] = [
    { action: "re_exam", skill, note: `sit the ${skill} exam again; a pass shows the agent is still the agent that earned its certificate` },
    { action: "refresher_course", skill, note: `take the ${skill} refresher course if the re-exam is failed` },
  ];
  if (score.severity === "quarantine_recommended") recommendation.unshift({ action: "quarantine", note: "two or more different measures moved and one is a new risky scope or a third measure: a quarantine at level observe is recommended while the cause is found" });
  return {
    agent, window: { from: score.window.from, to: score.window.to }, severity: score.severity, findings: score.findings,
    cause: score.cause ?? { cause: "unknown" }, recommendation, assurance: "gateway_observed", baseline_jobs: score.baselineJobs,
  };
}

/** When a scheduled checkup is due: a new one every 90 days, and one after every lineage change newer than the last checkup. */
export function checkupDue(lastCheckupAt: string | undefined, marks: LineageMark[], now: string): "scheduled" | "post_change" | undefined {
  if (lastCheckupAt === undefined) return "scheduled";
  const last = Date.parse(lastCheckupAt);
  if (marks.some((e) => Date.parse(e.at) > last)) return "post_change";
  if (Date.parse(now) - last >= 90 * 86_400_000) return "scheduled";
  return undefined;
}
