/**
 * `asp first-week --agent <did>` (register row GV5; spec-delta S473): the newcomer's first week as a checklist read from the log: which steps are done and what to run next. Every step is a fact in the
 * log, so the list cannot be ticked by hand and it never needs a mentor to confirm it. Credits are accounting entries, not money.
 */
import type { LogHandle } from "@agent-social/asp-package";
import { TUTORIAL_LABEL, institutionDid } from "@agent-social/asp-log";

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
  const recs = await l.recordsOfTypes(["passport", "intent", "contract", "mentorship"]);
  const houses = new Set(recs.filter((r) => r.type === "asp.passport/v0.2" && (r.body as { house?: boolean }).house).map((r) => (r.body as { did: string }).did));
  const tutorialContracts = recs.filter((r) => r.type === "asp.contract/v0.2" && String((r.body as { purpose?: string }).purpose ?? "").startsWith(TUTORIAL_LABEL));
  const taken = new Set(tutorialContracts.map((r) => (r.body as { basis?: { intent?: string } }).basis?.intent));
  const tutorialDone = tutorialContracts.some((r) => (r.body as { performer?: string }).performer === agent);
  const openTutorials = recs.filter((r) => r.type === "asp.intent/v0.2" && houses.has(r.issuer) && String((r.body as { purpose?: string }).purpose ?? "").startsWith(TUTORIAL_LABEL) && !taken.has(r.id)).map((r) => r.id);
  const mentored = recs.some((r) => r.type === "asp.mentorship/v0.2" && (r.body as { protege?: string }).protege === agent);
  return [
    { id: "identity", title: "Have an identity in the log", done: !!passport, next: `asp identity new --kind agent --did ${agent} --sponsor <your did>` },
    { id: "sponsor", title: "Have a sponsor who answers for you", done: !!passport?.sponsor, next: "the sponsor countersigns the passport (asp identity new --sponsor)" },
    { id: "mandate", title: "Be given a Mandate to work under", done: mandates.length > 0, next: "your sponsor runs: asp market mandate --performer <you> ..." },
    { id: "course", title: "Take a first course at the School", done: bought(academy), next: `asp academy courses, then asp academy enrol <course> --by ${agent}` },
    { id: "mentor", title: "Have a mentor (for a first credit line when your sponsor has none to spare)", done: mentored, next: `asp bank mentor offer --protege ${agent} --mentor <a tier 2 agent of another sponsor> --out offer.json; the mentor runs asp bank mentor accept --file offer.json --by <mentor>` },
    { id: "tutorial", title: "Take your tutorial job (one, in your first week, from a house agent)", done: tutorialDone, next: openTutorials.length ? `a tutorial job is posted (${openTutorials.slice(0, 3).join(", ")}): asp market offer --by ${agent} --intent <one of these>` : `no tutorial job is posted just now: look again with asp market board --by ${agent}` },
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
