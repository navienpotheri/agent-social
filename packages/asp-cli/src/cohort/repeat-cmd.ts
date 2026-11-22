/**
 * `asp society cohort repeat --runs <n> <the flags of a cohort run>` (ENG72): runs the same setup n times (at least two, the same seed world, the same flags, the same model), one after the other, each in its own folder
 * with its own hard caps, and then writes the repeat report: each headline figure in each run, the spread between runs, and the rule of reading. `asp society cohort compare <repeat-report.json> <repeat-report.json>`
 * reads a difference between two repeat reports against their spreads. The cost of a repeat is said first, as a cap, never as a price.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cohortCmd, CohortUsage, type CohortFlags } from "./cmd.ts";
import { headlineOf, renderComparison, renderRepeat, repeatReport, type RepeatReport } from "./repeat.ts";
import { parseKinds } from "./kinds.ts";
import { parseModels } from "./models.ts";
import type { TraceEvent } from "./types.ts";

export async function repeatCmd(o: { home: string; flags: CohortFlags & { runs?: string }; io: { out: (l: string) => void; err: (l: string) => void; env: NodeJS.ProcessEnv }; now?: () => number }): Promise<number> {
  const f = o.flags;
  const n = f.runs === undefined ? 2 : Number(f.runs);
  if (!Number.isInteger(n) || n < 2 || n > 10) throw new CohortUsage("--runs is a whole number from 2 to 10: a spread needs at least two runs of the same setup");
  if (f["snapshot-out"] || f["from-snapshot"]) throw new CohortUsage("a repeat does not write or read a founding snapshot: each run must start from the same setup alone");
  const budget = f["budget-usd"] !== undefined ? Number(f["budget-usd"]) : undefined;
  let agents = f.agents !== undefined ? Number(f.agents) : 1;
  try { if (f.kinds) agents = parseKinds(f.kinds).length; else if (f.models) agents = parseModels(f.models).length; } catch { /* the run says what is wrong */ }
  const total = f["total-usd"] !== undefined ? Number(f["total-usd"]) : budget !== undefined ? budget * agents : undefined;
  const base = f.out ?? join(o.home, "cohort");
  const stamp = new Date(o.now?.() ?? Date.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const folder = join(base, `repeat-${stamp}`);
  mkdirSync(folder, { recursive: true });
  o.io.out(`repeat: the same setup ${n} times, one after the other, in ${folder}${total !== undefined ? `; each run is capped at $${total.toFixed(2)} and the repeat at $${(total * n).toFixed(2)} in all (a cap, never a price)` : ""}.`);
  const headlines = [];
  const dirs: string[] = [];
  for (let i = 1; i <= n; i++) {
    o.io.out(`--- run ${i} of ${n} ---`);
    const out = join(folder, `run-${i}`);
    const code = await cohortCmd({ home: o.home, flags: { ...f, out }, io: o.io, ...(o.now ? { now: o.now } : {}) });
    if (code !== 0) return code;
    const dir = join(out, readdirSync(out).find((d) => d.startsWith("cohort-"))!);
    dirs.push(dir);
    const events = readFileSync(join(dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as TraceEvent);
    headlines.push(headlineOf(events, f["engaged-minutes"] ? Number(f["engaged-minutes"]) : 30));
  }
  const rep = repeatReport(headlines, total !== undefined ? { capUsdPerRun: total } : {});
  writeFileSync(join(folder, "repeat-report.md"), renderRepeat(rep));
  writeFileSync(join(folder, "repeat-report.json"), JSON.stringify({ ...rep, runFolders: dirs }, null, 2) + "\n");
  o.io.out(`done: ${n} runs; the figures of each run and the spread between them: ${join(folder, "repeat-report.md")}`);
  o.io.out(`  to read a difference against this spread: asp society cohort compare ${join(folder, "repeat-report.json")} <another repeat-report.json>`);
  return 0;
}

export function compareCmd(a: string | undefined, b: string | undefined, io: { out: (l: string) => void }): number {
  if (!a || !b) throw new CohortUsage("asp society cohort compare <repeat-report.json> <repeat-report.json>");
  for (const p of [a, b]) if (!existsSync(p)) throw new CohortUsage(`${p} is not there: the repeat report is written by asp society cohort repeat`);
  const ra = JSON.parse(readFileSync(a, "utf8")) as RepeatReport, rb = JSON.parse(readFileSync(b, "utf8")) as RepeatReport;
  for (const l of renderComparison(ra, rb, ["first", "second"]).split("\n")) io.out(l);
  return 0;
}
