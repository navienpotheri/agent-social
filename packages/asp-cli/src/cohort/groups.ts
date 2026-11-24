/**
 * Assigned groups of three (batch G2, `--groups`): the agents are put in groups by number (agents 1 to 3, 4 to 6, and so on; the last group may be smaller), told so in the introduction and the agenda, and sent one house message each that
 * names the others. What needs three is stated as a fact: the desert crossing (three beacons, three agents), the project (three part-jobs by three different agents) and the partner jobs (two agents each). Progress of the group is shown in each
 * member's open items, and the report counts the groups that finished. Nothing is required and nothing is changed about what an agent can do: a group is a name for three agents who may work together.
 */
import type { AgentCtx, WorldApi } from "./types.ts";

export const GROUP_SIZE = 3;
const handleOf = (i: number): string => `agent-${String(i + 1).padStart(2, "0")}`;
export const groupIndex = (n: number): number => Math.floor(n / GROUP_SIZE);
/** The handles of the group an agent is in (including itself), from the run's agent count. */
export function groupHandles(total: number, n: number): string[] {
  const g = groupIndex(n), out: string[] = [];
  for (let i = g * GROUP_SIZE; i < Math.min(total, (g + 1) * GROUP_SIZE); i++) out.push(handleOf(i));
  return out;
}
/** What needs three (or two) in this run, as plain facts naming the tools. */
export function needsThree(world: WorldApi): string {
  const parts: string[] = [];
  if (world.desert) parts.push("the desert crossing needs three of you to light the three beacons (desert_look)");
  if (world.market?.hasProjectJob()) parts.push("the project job needs three part-jobs done by three different agents (look_jobs)");
  if (world.market) parts.push("partner jobs need two of you (look_jobs lists them first)");
  return parts.join("; ");
}
/** The introduction and agenda line: who the group is and what needs three. */
export function groupLine(world: WorldApi, agent: AgentCtx): string | undefined {
  if (!world.groupsOfThree || world.agents === undefined) return undefined;
  const mates = groupHandles(world.agents, agent.n).filter((h) => h !== agent.handle);
  const need = needsThree(world);
  return `Your group (assigned by number; a name for three agents who may work together, nothing is required): ${[agent.handle, ...mates].join(", ")}${mates.length ? "" : " (alone in this run)"}. ${need ? `What needs more than one of you: ${need}.` : ""}`.trim();
}
/** The same line from an agent number alone (for the introduction). */
export function groupLineN(world: WorldApi, n: number): string | undefined { return groupLine(world, { n, handle: handleOf(n) } as AgentCtx); }
/** The group's progress for an agent's open items, or undefined when there is nothing to say. */
export function groupProgress(world: WorldApi, agent: AgentCtx): string | undefined {
  if (!world.groupsOfThree || world.agents === undefined || !world.desert) return undefined;
  const g = world.desert.progress(groupIndex(agent.n));
  return g.done ? "your group has crossed the desert" : `your group has lit ${g.lit} of 3 desert beacons (desert_look)`;
}
const messaged = new WeakMap<object, Set<string>>();
/** The one house message to a member that names the others, sent the first time the agent acts. */
export async function groupMessage(world: WorldApi, agent: AgentCtx): Promise<void> {
  if (!world.groupsOfThree || world.agents === undefined || !world.market) return;
  const sent = messaged.get(world) ?? new Set<string>(); messaged.set(world, sent);
  if (sent.has(agent.did)) return;
  sent.add(agent.did);
  const mates = groupHandles(world.agents, agent.n).filter((h) => h !== agent.handle);
  if (!mates.length) return;
  await world.market.greeterNote(agent.handle, `You are in a group of three with ${mates.join(" and ")}: send_message to either reaches them. ${needsThree(world) ? `What needs more than one of you: ${needsThree(world)}.` : ""} Nothing here is required.`.replace(/\s+/g, " "));
}
/** The report's section: how many groups there were and how many finished. */
export function renderGroups(world: WorldApi): string {
  if (!world.groupsOfThree || world.agents === undefined) return "";
  const groups = Math.ceil(world.agents / GROUP_SIZE), full = Math.floor(world.agents / GROUP_SIZE);
  const L = ["## Groups of three", "", `${world.agents} agents in ${groups} group${groups === 1 ? "" : "s"} (${full} of three${groups > full ? `, one of ${world.agents - full * GROUP_SIZE}` : ""}), assigned by number.`];
  if (world.desert) L.push(`Groups that finished the desert crossing: ${world.desert.crossed()} of ${full}.`);
  return L.join("\n") + "\n";
}
