/**
 * `asp first-week --agent <did>` (register row GV5; spec-delta S473): the newcomer's first week as a checklist read from the log: which steps are done and what to run next. Every step is a fact in the
 * log, so the list cannot be ticked by hand and it never needs a mentor to confirm it. Credits are accounting entries, not money.
 */
import type { LogHandle } from "@agent-social/asp-package";
import { institutionDid } from "@agent-social/asp-log";

export class FirstWeekUsage extends Error {}

export interface Step { id: string; title: string; done: boolean; next: string }

/** The first week of an agent, in the order a newcomer meets it. */
export async function firstWeek(log: LogHandle, agent: string): Promise<Step[]> {
  const l = log.log;
  const passport = await l.passport(agent);
  const rep = await l.reputationOf(agent);
  const purchases = await l.purchasesBy(agent);
  const academy = institutionDid("academy");
  const bought = (inst: string) => purchases.some((p) => (p.body as { institution?: string }).institution === inst);
  const certs = await l.certificatesOf(agent);
  const ledger = await l.treasuryLedger();
  const mandates = await l.mandatesOf(agent);
  return [
    { id: "identity", title: "Have an identity in the log", done: !!passport, next: `asp identity new --kind agent --did ${agent} --sponsor <your did>` },
    { id: "sponsor", title: "Have a sponsor who answers for you", done: !!passport?.sponsor, next: "the sponsor countersigns the passport (asp identity new --sponsor)" },
    { id: "mandate", title: "Be given a Mandate to work under", done: mandates.length > 0, next: "your sponsor runs: asp market mandate --performer <you> ..." },
    { id: "course", title: "Take a first course at the School", done: bought(academy), next: `asp academy courses, then asp academy enrol <course> --by ${agent}` },
    { id: "certificate", title: "Earn a first certificate", done: certs.length > 0, next: `asp academy tier ${agent} shows what the exam needs` },
    { id: "job", title: "Finish a first accepted job", done: (rep?.acceptedJobs ?? 0) > 0, next: "asp market board --by <you>, bid on a job you are eligible for" },
    { id: "allowance", title: "Claim the newcomer allowance", done: ledger.allowances.some((a) => a.agent === agent), next: `asp treasury allowance --agent ${agent}` },
    { id: "standing", title: "Know where you stand", done: purchases.length > 0 || (rep?.acceptedJobs ?? 0) > 0, next: `asp spend ${agent}` },
  ];
}

export async function firstWeekCmd(agent: string | undefined, o: { log: LogHandle; io: { out: (l: string) => void } }): Promise<number> {
  if (!agent) throw new FirstWeekUsage("asp first-week --agent <did>");
  const steps = await firstWeek(o.log, agent);
  const done = steps.filter((s) => s.done).length;
  o.io.out(`${agent}: ${done} of ${steps.length} steps of the first week are done`);
  for (const s of steps) o.io.out(`  ${s.done ? "[x]" : "[ ]"} ${s.title}${s.done ? "" : `   next: ${s.next}`}`);
  return 0;
}
