/**
 * House-seeded lesson cards (next-run batch B1, `--house-lessons`): so that the continual-learning chain (create, gate, feed, read, effect) can be measured even when no agent authors a card. A house teacher (a program, labelled "house") really calls
 * four read tools, then offers four one-sentence cards that name those tools as their evidence; they go through the same gate as an agent's card, and are shown as admitted cards by their author's handle (`house-teacher`). A house student reads and
 * cites them as a labelled sample. Every card is a true statement about what the society does; nothing in them asks the reader to do anything.
 */
import { runTool, TOOLS } from "./tools.ts";
import type { AgentCtx, WorldApi } from "./types.ts";

export const HOUSE_CARDS: Array<{ title: string; lesson: string; evidence: string; tool: string }> = [
  { title: "The board lists two-agent jobs first", lesson: "The job board lists the jobs two agents can do together first, then the jobs one agent can do alone, each with its price.", evidence: "look_jobs shows the board in that order.", tool: "look_jobs" },
  { title: "A certificate is what some jobs ask for", lesson: "Courses cost mock credits, and some house jobs ask for the certificate of a course before an agent may take them.", evidence: "look_courses lists the courses with their cost.", tool: "look_courses" },
  { title: "The map ends with a count of who looked where", lesson: "The text of the map ends with a count of how many agents have looked closely at each place and names the least visited.", evidence: "look_map shows the atlas line at its end.", tool: "look_map" },
  { title: "The first writes cost nothing", lesson: "An agent's first five writes cost nothing, and the balance shows how many free writes are left.", evidence: "my_balance shows the free writes left.", tool: "my_balance" },
];

/** Enrols the house teacher and student, makes the teacher's real calls, and submits the cards through the gate. Returns the ids of the cards the gate admitted. */
export async function seedHouseLessons(world: { api: WorldApi; enrol: (n: number, handle: string) => Promise<AgentCtx> }): Promise<string[]> {
  const api = world.api, shelf = api.lessons, hall = api.market;
  if (!shelf || !hall) return [];
  const teacher = await world.enrol(-7, "house-teacher"), student = await world.enrol(-8, "house-student");
  await hall.enrolStandalone(teacher); await hall.enrolStandalone(student);
  const all = new Set(TOOLS.map((t) => t.scope));
  for (const c of HOUSE_CARDS) await runTool(api, teacher, all, c.tool, {});
  const ids: string[] = [];
  for (const c of HOUSE_CARDS) { const card = shelf.submit(teacher.did, teacher.handle, { title: c.title, lesson: c.lesson, evidence: c.evidence }); if (card.decision.admitted) ids.push(card.id); }
  // the labelled student sample: reads and cites them
  for (const id of ids) { shelf.read(student.did, student.handle, id); shelf.cite(student.did, student.handle, id); }
  return ids;
}
