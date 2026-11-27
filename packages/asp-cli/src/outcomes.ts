/**
 * `asp outcomes --agent <did> | --principal <did>` (register row D2; spec-delta S504): what finished jobs came to, from the log's records, and for an agent how each lineage edge moved them, overall and per
 * principal. A "worse" is a lead for the Clinic, not a verdict; a side with too few jobs is "unmeasured".
 */
import type { LogHandle } from "@agent-social/asp-package";

export class OutcomesUsage extends Error {}
export interface OutcomesOpts { log: LogHandle; io: { out: (l: string) => void }; flags: { agent?: string; principal?: string; json?: boolean } }

interface W { jobs: number; accepted: number; failed: number; successPermille: number | null; blockedPerJob: number; avgPrice: number }
const pct = (w: W) => (w.successPermille === null ? "no decided job" : `${w.successPermille / 10}% of ${w.accepted + w.failed} decided`);
const line = (w: W) => `${w.jobs} job(s), ${pct(w)}, ${w.blockedPerJob} refused attempt(s) a job`;

export async function outcomesCmd(o: OutcomesOpts): Promise<number> {
  const { agent, principal } = o.flags;
  if ((!agent && !principal) || (agent && principal)) throw new OutcomesUsage("asp outcomes --agent <did> | --principal <did> [--json]");
  const log = (o.log as unknown as { log: { outcomeSeries(d: string): Promise<{ jobs: unknown[]; overall: W; edges: { edge: string; at: string; layer: string; before: W; after: W; verdict: string; deltaPermille: number | null; byPrincipal: { principal: string; before: W; after: W; verdict: string }[] }[] }>; principalSeries(d: string): Promise<{ jobs: unknown[]; overall: W; byAgent: { agent: string; window: W }[] }> } }).log;
  if (agent) {
    const s = await log.outcomeSeries(agent);
    if (o.flags.json) { o.io.out(JSON.stringify(s, null, 2)); return 0; }
    o.io.out(`${agent}: ${line(s.overall)}`);
    for (const e of s.edges) {
      o.io.out(`  edge ${e.edge.slice(0, 19)} (${e.layer}, ${e.at}): before ${line(e.before)}; after ${line(e.after)}; ${e.verdict}${e.deltaPermille === null ? "" : ` (${e.deltaPermille > 0 ? "+" : ""}${e.deltaPermille / 10} points)`}`);
      for (const p of e.byPrincipal.filter((x) => x.verdict !== "unmeasured")) o.io.out(`    for ${p.principal}: ${pct(p.before)} before, ${pct(p.after)} after; ${p.verdict}`);
    }
    if (!s.edges.length) o.io.out("  no lineage edge recorded in this log, so nothing to compare");
    o.io.out("a worse is a lead for the Clinic (a checkup needs a second measure), not a verdict");
    return 0;
  }
  const s = await log.principalSeries(principal!);
  if (o.flags.json) { o.io.out(JSON.stringify(s, null, 2)); return 0; }
  o.io.out(`${principal}: ${line(s.overall)}`);
  for (const a of s.byAgent) o.io.out(`  ${a.agent}: ${line(a.window)}`);
  return 0;
}
