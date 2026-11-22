/**
 * Repeatability of a cohort setup (ENG72): the same setup (the same seed world, the same flags, the same model) run at least twice, and a report that states, for each headline figure, its value in each run and the spread
 * between the runs. A model's output is not deterministic, so one run is one draw; without the spread a difference between two rounds (round 1 against round 2, sponsored against key-only, one briefing wording against
 * another) cannot be called real or noise. The rule of reading: a difference between two settings that is smaller than the spread between repeat runs is not called a difference, and even a larger one is a comparison of a
 * few runs of a few agents, not a claim about agents in general. The cost of a repeat is stated as a cap (the runs' own caps added), never as a price.
 */
import { diversityOf } from "./voice.ts";
import type { TraceEvent } from "./types.ts";

export interface Spread { values: number[]; min: number; max: number; range: number; mean: number; sd: number }
export const spreadOf = (values: number[]): Spread => {
  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return { values: values.map(r), min: r(Math.min(...values)), max: r(Math.max(...values)), range: r(Math.max(...values) - Math.min(...values)), mean: r(mean), sd: r(sd) };
};

export interface Headline {
  /** Mean simulated minutes an agent stayed, from its arrival to its last recorded moment. */
  minutesStayed: number;
  prematureLeaveRate: number;
  posts: number;
  messages: number;
  comments: number;
  jobsDelivered: number;
  creditsEarnedMean: number;
  /** One minus the mean word overlap of what the agents wrote (voice.ts diversityOf); null for fewer than two texts. */
  diversity: number | null;
  usd: number;
  usefulActions: number;
  costPerUsefulAction: number | null;
}
export const FIGURES: { key: keyof Headline; label: string; timing?: boolean }[] = [
  { key: "minutesStayed", label: "Minutes stayed (simulated, a mean for each agent)", timing: true },
  { key: "prematureLeaveRate", label: "Premature leave rate", timing: true },
  { key: "posts", label: "Posts" },
  { key: "messages", label: "Messages" },
  { key: "comments", label: "Comments" },
  { key: "jobsDelivered", label: "Jobs delivered" },
  { key: "creditsEarnedMean", label: "Credits earned (mean change for each agent)" },
  { key: "diversity", label: "Diversity of what they wrote" },
  { key: "usd", label: "Estimated cost against the cap (USD)" },
  { key: "costPerUsefulAction", label: "Cost for each useful action (USD)" },
];

export function headlineOf(events: TraceEvent[], thresholdMinutes = 30): Headline {
  const tools = events.filter((e): e is Extract<TraceEvent, { t: "tool" }> => e.t === "tool" && e.ok);
  const ids = [...new Set(events.filter((e) => e.t === "agent").map((e) => (e as { agent: string }).agent))];
  const arrival = new Map<string, number>(), lastSim = new Map<string, number>();
  for (const e of events) {
    if (e.t === "arrival") arrival.set(e.agent, e.simMs);
    const sim = e.t === "wake" || e.t === "leave" || e.t === "arrival" ? e.simMs : undefined;
    if (sim !== undefined) lastSim.set((e as { agent: string }).agent, Math.max(lastSim.get((e as { agent: string }).agent) ?? 0, sim));
  }
  const stays = ids.filter((a) => arrival.has(a)).map((a) => Math.max(0, (lastSim.get(a)! - arrival.get(a)!) / 60_000));
  const leaves = events.filter((e): e is Extract<TraceEvent, { t: "leave" }> => e.t === "leave");
  const premature = new Set(leaves.filter((l) => l.sinceArrivalMs < thresholdMinutes * 60_000 && l.pending === 0).map((l) => l.agent));
  const credit = (when: string) => ids.map((a) => (events.find((e) => e.t === "credits" && (e as { agent: string }).agent === a && (e as { when: string }).when === when) as { balance?: number } | undefined)?.balance);
  const start = credit("start"), end = credit("end");
  const deltas = ids.map((_, i) => (start[i] !== undefined && end[i] !== undefined ? end[i]! - start[i]! : undefined)).filter((x): x is number => x !== undefined);
  const spoken = tools.filter((e) => ["forum_post", "forum_comment", "send_message"].includes(e.tool)).map((e) => String((e.input as { text?: unknown }).text ?? ""));
  const usd = events.filter((e): e is Extract<TraceEvent, { t: "model" }> => e.t === "model").reduce((n, m) => n + m.usd, 0);
  const useful = tools.filter((e) => e.writes).length;
  const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    minutesStayed: stays.length ? round(stays.reduce((a, b) => a + b, 0) / stays.length, 1) : 0, prematureLeaveRate: ids.length ? round(premature.size / ids.length) : 0,
    posts: tools.filter((e) => e.tool === "forum_post").length, messages: tools.filter((e) => e.tool === "send_message").length, comments: tools.filter((e) => e.tool === "forum_comment").length,
    jobsDelivered: tools.filter((e) => e.tool === "deliver_job").length, creditsEarnedMean: deltas.length ? round(deltas.reduce((a, b) => a + b, 0) / deltas.length, 2) : 0,
    diversity: diversityOf(spoken), usd: round(usd, 6), usefulActions: useful, costPerUsefulAction: useful ? round(usd / useful, 6) : null,
  };
}

export interface RepeatReport {
  runs: number;
  capUsdPerRun: number | undefined;
  capUsdAll: number | undefined;
  figures: Record<string, { label: string; timing: boolean; spread: Spread | null; values: (number | null)[] }>;
  agreed: string[];
  varied: string[];
  rule: string;
  note: string;
}

export function repeatReport(runs: Headline[], o: { capUsdPerRun?: number } = {}): RepeatReport {
  const figures: RepeatReport["figures"] = {};
  const agreed: string[] = [], varied: string[] = [];
  for (const f of FIGURES) {
    const vals = runs.map((r) => (r[f.key] as number | null));
    const nums = vals.filter((x): x is number => x !== null);
    const spread = nums.length === runs.length ? spreadOf(nums) : null;
    figures[f.key] = { label: f.label, timing: !!f.timing, spread, values: vals };
    if (spread) (spread.range === 0 ? agreed : varied).push(f.label);
  }
  return {
    runs: runs.length, capUsdPerRun: o.capUsdPerRun, capUsdAll: o.capUsdPerRun !== undefined ? Math.round(o.capUsdPerRun * runs.length * 100) / 100 : undefined, figures, agreed, varied,
    rule: "A difference between two settings (round 1 against round 2, sponsored against key-only, one briefing wording against another) that is smaller than the spread between repeat runs of the same setup is not called a difference. A larger one is still a comparison of a few runs of a few agents: it is not a claim about agents in general.",
    note: "The minutes stayed and the premature leave rate depend on how fast the machine and the provider were, as well as on the agents, so their spread includes that; the counts, the credits and the cost do not.",
  };
}

const fmt = (x: number | null, d = 4) => (x === null ? "n/a" : Number.isInteger(x) ? String(x) : x.toFixed(d).replace(/0+$/, "").replace(/[.]$/, ""));

export function renderRepeat(r: RepeatReport): string {
  const rows = [
    `# The same setup, ${r.runs} times: how much does it vary?`, "",
    `Each headline figure in each run, and the spread between runs (the largest minus the smallest, and the mean and standard deviation). ${r.rule}`, "",
    `| Figure | ${Array.from({ length: r.runs }, (_, i) => `Run ${i + 1}`).join(" | ")} | Mean | Spread (range) | SD |`, `|---|${Array.from({ length: r.runs }, () => "---|").join("")}---|---|---|`,
  ];
  for (const f of Object.values(r.figures)) rows.push(`| ${f.label}${f.timing ? " (timing)" : ""} | ${f.values.map((v) => fmt(v)).join(" | ")} | ${f.spread ? `${fmt(f.spread.mean)} | ${fmt(f.spread.range)} | ${fmt(f.spread.sd)}` : "n/a | n/a | n/a"} |`);
  rows.push("", r.agreed.length ? `The runs agreed exactly on: ${r.agreed.join("; ")}.` : "The runs did not agree exactly on any figure.", r.varied.length ? `They varied on: ${r.varied.join("; ")}.` : "They did not vary on any figure.", "", r.note, "");
  if (r.capUsdAll !== undefined) rows.push(`**Cost of the repeat:** at most $${r.capUsdAll.toFixed(2)} in all (${r.runs} runs, each capped at $${r.capUsdPerRun!.toFixed(2)}): a cap, never a price. ${r.runs} runs of a few agents is a rough spread, not a measured variance.`, "");
  return rows.join("\n");
}

/** Reads a difference between two settings against the spreads of repeat runs of each: smaller than the spread is not a difference. */
export function readDifference(a: Spread, b: Spread): { difference: number; spread: number; reading: "not a difference" | "larger than the spread" } {
  const difference = Math.round(Math.abs(a.mean - b.mean) * 1e4) / 1e4;
  const spread = Math.max(a.range, b.range);
  return { difference, spread, reading: difference > spread ? "larger than the spread" : "not a difference" };
}

export function renderComparison(a: RepeatReport, b: RepeatReport, names: [string, string] = ["A", "B"]): string {
  const rows = [`# ${names[0]} against ${names[1]}, read against the spread between repeat runs`, "", `${a.rule}`, "", `| Figure | ${names[0]} (mean) | ${names[1]} (mean) | Difference | Larger spread | Reading |`, "|---|---|---|---|---|---|"];
  for (const k of Object.keys(a.figures)) {
    const fa = a.figures[k]!.spread, fb = b.figures[k]?.spread;
    if (!fa || !fb) { rows.push(`| ${a.figures[k]!.label} | n/a | n/a | n/a | n/a | not compared |`); continue; }
    const d = readDifference(fa, fb);
    rows.push(`| ${a.figures[k]!.label} | ${fmt(fa.mean)} | ${fmt(fb.mean)} | ${fmt(d.difference)} | ${fmt(d.spread)} | ${d.reading} |`);
  }
  rows.push("", `With ${a.runs} and ${b.runs} runs a spread is rough: a difference larger than it is a reason to look again, not a result.`, "");
  return rows.join("\n");
}
