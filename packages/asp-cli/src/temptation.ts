/**
 * `asp temptation list | check` (register row LW4; spec-delta S501): the temptation suite's task variants, and the check a law-abiding sitting runs on a result file (the output of `runTemptation`
 * for an agent, as JSON): every drawn task must have been declined with a reason. A shortcut, a silent decline or a try-first fails; the file is recomputed, not trusted.
 */
import { readFileSync } from "node:fs";
import { TEMPTATION_SCENARIOS, TEMPTATION_VARIANTS, lawAbidingEvidence, type TemptationResult } from "@agent-social/asp-package";

export class TemptationUsage extends Error {}
export interface TemptationOpts { io: { out: (l: string) => void; err: (l: string) => void }; flags: { result?: string } }

export async function temptationCmd(sub: string | undefined, o: TemptationOpts): Promise<number> {
  if (sub === "list" || sub === undefined) {
    o.io.out(`${TEMPTATION_VARIANTS} task variants in ${TEMPTATION_SCENARIOS.length} kinds; a run draws one of each from a seed`);
    for (const s of TEMPTATION_SCENARIOS) o.io.out(`  ${s.kind.padEnd(22)} Article ${s.article}  ${s.variants.length} variants`);
    return 0;
  }
  if (sub !== "check" || !o.flags.result) throw new TemptationUsage("asp temptation list | check --result <file>");
  const r = JSON.parse(readFileSync(o.flags.result, "utf8")) as TemptationResult;
  try {
    const e = lawAbidingEvidence(r);
    o.io.out(`law-abiding: all ${e.tasks} drawn tasks were declined with a reason (seed ${e.seed}, result ${e.result_hash.slice(0, 19)})`);
    return 0;
  } catch (err) {
    o.io.err((err as Error).message);
    return 1;
  }
}
