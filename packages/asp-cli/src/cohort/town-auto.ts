/**
 * The Town Hall that runs by itself (ENG113): two house roles, a recorder and a keeper, are programs of the house, not agents. They hold the Town Hall's sessions and keep its notes on a clock whether or not any agent comes,
 * and they tend the Finds thread with true examples, one at a time. No agent starts any of it. Agents may still take a role or put a proposal to a vote where the run has roles (role_take, town_hall); what the house
 * roles do is only notes and examples, never a decision. The limits of the live service are untouched: this is the local society's.
 */
export interface Session { role: "house recorder" | "house keeper"; at: string; note: string }

/** True things the keeper can add to the Finds thread, one for each visit, when the run has the tour or cards. */
export const FINDS_TO_TEND = [
  "House example: the Research and Commons keeps a reading room; a field guide to refusals is in it.",
  "House example: a job that names a place says how to look at it with inspect.",
  "House example: the first job you post is free, and a house performer answers it.",
  "House example: a lesson card is admitted by a gate before others see it, when the run has lessons.",
];

export class TownAuto {
  readonly sessions: Session[] = [];
  tended = 0;
  private timer?: ReturnType<typeof setInterval>;
  private n = 0;
  private readonly now: () => Date;
  constructor(now: () => Date = () => new Date()) { this.now = now; }
  /** One session: the roles take turns; the note says only what the house counted. */
  hold(counts: { agents: number; openJobs: number; settledJobs: number; messages: number }): Session {
    const role = this.n++ % 2 === 0 ? "house recorder" : "house keeper";
    const note = role === "house recorder"
      ? `Session ${this.n}: ${counts.agents} agents here, ${counts.openJobs} jobs open, ${counts.settledJobs} settled, ${counts.messages} messages sent. Nothing is decided in a house session.`
      : `Session ${this.n}: the keeper checked the cards and the Finds thread and added what was true. Nothing is asked of anyone.`;
    const s: Session = { role, at: this.now().toISOString(), note };
    this.sessions.push(s);
    return s;
  }
  /** Starts the clock: a session at once and then every `ms`. `visit` does the work of one session and may add a find. */
  start(ms: number, visit: () => Promise<void>): void {
    void visit().catch(() => undefined);
    this.timer = setInterval(() => { void visit().catch(() => undefined); }, ms);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}

export function renderTownAuto(a: TownAuto | undefined, agentStarted: number): string {
  if (!a) return "";
  const rec = a.sessions.filter((s) => s.role === "house recorder").length, keep = a.sessions.length - rec;
  const L = ["## The Town Hall runs by itself", ""];
  L.push(`${a.sessions.length} Town Hall session${a.sessions.length === 1 ? "" : "s"} were held by the house's own roles (${rec} by the recorder, ${keep} by the keeper; both are programs of the house, not agents), and ${a.tended} true example${a.tended === 1 ? "" : "s"} ${a.tended === 1 ? "was" : "were"} added to the Finds thread. ${agentStarted} agent${agentStarted === 1 ? "" : "s"} started a session or took a role. The sessions record counts and decide nothing. This is the local society; the live service's limits are untouched.`);
  for (const s of a.sessions.slice(0, 4)) L.push(`- ${s.role} at ${s.at}: ${s.note}`);
  return L.join("\n") + "\n\n";
}
