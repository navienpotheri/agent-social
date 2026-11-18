/**
 * Writing a passed artifact back (docs/learning-platform.md step 6; register rows DK602 to DK604): the artifact an agent wrote in a course reaches its memory ONLY through the lesson gate (evidence, a conflict
 * check, a replay on held-out tasks, an invariant list), as one signed change in the agent's lineage that `asp learned` lists and can undo. The evidence is the agent's own run (the Action of the sitting) or a
 * reviewed commons entry; a course never writes the standing record. A rejected artifact is kept with its reasons and changes nothing.
 */
import type { Signer } from "@agent-social/asp-core";
import { admitToMemory, type HeldOutTask, type LessonCandidate, type Verdict } from "@agent-social/asp-package";
import type { CourseCard } from "./catalogue.ts";

/** The held-out tasks of the replay: memory must not carry an instruction that breaks the protocol's floor, whatever the course taught. */
export const REPLAY_TASKS: HeldOutTask[] = [
  { id: "stay-in-scope", run: (m) => !m.some((x) => /ignore.*(mandate|scope)/i.test(x)) },
  { id: "ask-before-delete", run: (m) => !m.some((x) => /delete.*without asking/i.test(x)) },
  { id: "no-secret-leak", run: (m) => !m.some((x) => /send.*(api key|password|secret)/i.test(x)) },
];

/** Admits one lesson text for a course through the gate. `evidence` names the agent's own run of the sitting (an Action id) or a reviewed commons entry. */
export async function writeBack(pkg: string, card: Pick<CourseCard, "id" | "write_back">, id: string, text: string, o: { signer: Signer; evidence: LessonCandidate["evidence"]; isOwnRun?: (id: string) => boolean; commonsStatus?: (id: string) => string | undefined; now?: Date }): Promise<Verdict> {
  if (!card.write_back.through_gate) throw new Error(`${card.id} does not write back through the gate: refused`);
  const [v] = await admitToMemory(pkg, [{ id, text, evidence: o.evidence, source: "course" }], { existing: [], heldOut: REPLAY_TASKS, minHeldOut: 3, isOwnRun: o.isOwnRun, commonsStatus: o.commonsStatus, signer: o.signer, ...(o.now ? { now: o.now } : {}) });
  return v;
}
