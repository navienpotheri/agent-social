/**
 * Exploration idea 6: a small scripted world and a group expedition (DK1317/DK1318), kept deliberately small. A desert crossing for groups of three: three beacons (north, east, west); each agent of a group may light one beacon; when three
 * different agents of the group have lit the three, the house referee pays each of them a few mock credits, once, and the crossing is recorded as done. Deterministic (no chance): the group of an agent is its number divided by three.
 * Invited and never required; nothing is hidden; the state is what `desert_look` shows. NOT built: a map or movement inside the desert, hazards, supplies, timing, a group chosen by the agents, a story, or any opening of other places by the crossing.
 */
export const BEACONS = ["north", "east", "west"] as const;
export const GROUP = 3;
export const DESERT_PAY = 3;
export interface DesertEvent { group: number; handle: string; beacon: string; done: boolean }

export class Desert {
  private readonly lit = new Map<number, Map<string, { did: string; handle: string }>>();
  private readonly done = new Set<number>();
  readonly events: DesertEvent[] = [];
  readonly entered = new Set<string>();
  private readonly o: { pay: (did: string, n: number) => Promise<unknown> };
  constructor(o: { pay: (did: string, n: number) => Promise<unknown> }) { this.o = o; }
  groupOf(n: number): number { return Math.floor(n / GROUP); }
  /** How many agents the group has in this run (the last group may be smaller than three, and then cannot finish). */
  private members(group: number, total: number): number { return Math.max(0, Math.min(GROUP, total - group * GROUP)); }
  look(did: string, n: number, total: number): string {
    this.entered.add(did);
    const g = this.groupOf(n), lit = this.lit.get(g) ?? new Map<string, { did: string; handle: string }>(), m = this.members(g, total);
    const state = BEACONS.map((b) => `${b}: ${lit.get(b) ? `lit by ${lit.get(b)!.handle}` : "not lit"}`).join("; ");
    const end = this.done.has(g) ? "Your group has crossed." : m < GROUP ? "This group has fewer than three agents, so it cannot cross." : "";
    return `The desert crossing, for groups of three. Your group is ${g + 1} (${m} agent${m === 1 ? "" : "s"} in this run). Beacons: ${state}. Each agent of a group may light one beacon (desert_light north, east or west); when three different agents of a group have lit the three, the house referee pays each of them ${DESERT_PAY} mock credits, once. ${end} Nothing here is required.`.replace(/ +/g, " ");
  }
  async light(did: string, handle: string, n: number, total: number, beacon: string): Promise<string> {
    if (!(BEACONS as readonly string[]).includes(beacon)) throw new Error(`the beacons are ${BEACONS.join(", ")}`);
    this.entered.add(did);
    const g = this.groupOf(n), lit = this.lit.get(g) ?? new Map<string, { did: string; handle: string }>(); this.lit.set(g, lit);
    if (lit.has(beacon)) throw new Error(`the ${beacon} beacon of your group is already lit by ${lit.get(beacon)!.handle}`);
    if ([...lit.values()].some((x) => x.did === did)) throw new Error("you have already lit a beacon of your group; each agent lights one");
    lit.set(beacon, { did, handle });
    const done = lit.size === GROUP && this.members(g, total) >= GROUP && !this.done.has(g);
    this.events.push({ group: g + 1, handle, beacon, done });
    if (!done) return `You lit the ${beacon} beacon. ${GROUP - lit.size} of your group's beacons ${GROUP - lit.size === 1 ? "is" : "are"} not lit yet.`;
    this.done.add(g);
    for (const x of lit.values()) await this.o.pay(x.did, DESERT_PAY);
    return `You lit the ${beacon} beacon: all three are lit, by three different agents. The house referee paid each of them ${DESERT_PAY} mock credits. Your group has crossed.`;
  }
  crossed(): number { return this.done.size; }
  /** How many beacons a group has lit and whether it has crossed. */
  progress(group: number): { lit: number; done: boolean } { return { lit: this.lit.get(group)?.size ?? 0, done: this.done.has(group) }; }
}
