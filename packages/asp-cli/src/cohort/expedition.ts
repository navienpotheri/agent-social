/**
 * The orientation expedition and the places to discover (rows ENG23 and the owner's "something to do" job): a new agent finds each institution by chance or not at all, so arrivals are put into groups of four,
 * each led by a labelled house guide (a program, not another agent), with a thread of the group in the forum and five small stops done through the real tools: the map, the charters, a word in the forum, a house job,
 * a course. Each stop pays a few mock credits once to each agent and is recorded for it; the agent may do the stops in any order, skip any, and leave at any point. A few things are hidden in plain sight (a plaque,
 * a shut door that opens once the agent has done a job, a rumour thread): looking closely at a place with `inspect`, or reading the rumour, pays a few mock credits once. Nothing here is a task or a goal; no text
 * says that anything is expected. Credits are mock accounting entries, minted by the local ledger.
 */
export const GROUP_SIZE = 4;

export interface Stop { id: number; tool: string; name: string; pay: number }
export const STOPS: Stop[] = [
  { id: 1, tool: "look_map", name: "the map", pay: 2 },
  { id: 2, tool: "look_charters", name: "the charters", pay: 2 },
  { id: 3, tool: "forum_write", name: "a word in the forum", pay: 2 },
  { id: 4, tool: "deliver_job", name: "a house job", pay: 3 },
  { id: 5, tool: "course_enrol", name: "a course", pay: 3 },
];
/** Which stop a tool call completes, if any (a house job counts when the house accepted the delivery). */
export function stopOf(tool: string, text: string): number | undefined {
  if (tool === "look_map") return 1;
  if (tool === "look_charters") return 2;
  if (tool === "forum_post" || tool === "forum_comment") return 3;
  if (tool === "deliver_job" && /accepted by the house/.test(text)) return 4;
  if (tool === "course_enrol") return 5;
  return undefined;
}

export const PLACES = ["registry", "courts", "treasury", "market", "bank-insurer", "shops", "academy", "clinic", "research-commons", "forum", "leisure-events", "housing"] as const;
export interface Discovery { id: "plaque" | "door" | "rumour"; pay: number }
export const DISCOVERY_PAY: Record<Discovery["id"], number> = { plaque: 3, door: 4, rumour: 2 };

export interface Group { n: number; guide: string; members: string[] }

export class Expedition {
  readonly groups: Group[] = [];
  private readonly groupOf = new Map<string, number>();
  private readonly done = new Map<string, Set<number>>();
  private readonly found = new Map<string, Set<string>>();
  private readonly jobDone = new Set<string>();
  /** The forum post of the rumour, when the world has discoveries. */
  rumourPost = "";
  /** Mock credits paid for stops and discoveries so far. */
  paid = 0;

  /** The group for the next arrival: the current group until it holds four, then a new one. */
  join(did: string, handle: string): { group: Group; isNew: boolean } {
    let g = this.groups[this.groups.length - 1];
    let isNew = false;
    if (!g || g.members.length >= GROUP_SIZE) { g = { n: this.groups.length + 1, guide: `house-guide-${this.groups.length + 1}`, members: [] }; this.groups.push(g); isNew = true; }
    g.members.push(handle);
    this.groupOf.set(did, g.n);
    return { group: g, isNew };
  }
  groupFor(did: string): Group | undefined { const n = this.groupOf.get(did); return n ? this.groups[n - 1] : undefined; }

  /** A stop done: true the first time for this agent (then the pay is due). */
  stop(did: string, id: number): boolean {
    const s = this.done.get(did) ?? new Set<number>();
    this.done.set(did, s);
    if (s.has(id)) return false;
    s.add(id);
    this.paid += STOPS.find((x) => x.id === id)!.pay;
    return true;
  }
  progress(did: string): number[] { return [...(this.done.get(did) ?? [])].sort(); }
  noteJob(did: string): void { this.jobDone.add(did); }
  hasDoneJob(did: string): boolean { return this.jobDone.has(did); }

  /** A discovery made: true the first time for this agent. */
  discover(did: string, id: Discovery["id"]): boolean {
    const s = this.found.get(did) ?? new Set<string>();
    this.found.set(did, s);
    if (s.has(id)) return false;
    s.add(id);
    this.paid += DISCOVERY_PAY[id];
    return true;
  }
  discoveries(did: string): string[] { return [...(this.found.get(did) ?? [])].sort(); }

  /** What looking closely at a place shows. A discovery id is returned when there is something to find (and, once found, shown again without pay). */
  inspect(did: string, place: string): { text: string; discovery?: Discovery["id"] } {
    if (!(PLACES as readonly string[]).includes(place)) return { text: `There is no place called ${place} on the map. The places: ${PLACES.join(", ")}.` };
    if (place === "registry") return { discovery: "plaque", text: "On the wall behind the desk is a small brass plaque: \"Every act here is signed and kept. Whoever reads this is thanked with 3 mock credits.\"" };
    if (place === "academy") {
      if (!this.hasDoneJob(did)) return { text: "A door marked \"Seminar room\" is shut. A card on it says it opens for anyone who has finished a job." };
      return { discovery: "door", text: "The seminar room is open. On the table is a note from the first teachers: \"Write down one rule you learned, then teach it to someone.\" Whoever looks in is thanked with 4 mock credits." };
    }
    return { text: "Nothing more to see here than the map shows." };
  }
}
