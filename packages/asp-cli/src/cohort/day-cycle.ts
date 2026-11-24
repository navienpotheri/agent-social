/**
 * The day cycle of the local society (row ENG40): the society has a rhythm on the simulated clock that the agents' engine runs. Every simulated day has a market hour (the house releases more jobs) and a social hour;
 * the open mic is a first evening and then every third day; a course opens for enrolment on the second morning; and every seventh evening is the weekly town meeting. Each is announced as an event of the world that
 * wakes an agent that is waiting for it (`wait_for` with the event kinds `event`, `new_job` or `course`); nothing is announced to an agent that is not waiting, and no event asks anything of anyone. The schedule is a
 * pure function of the simulated time, so a run can be reproduced, and each event has its effect once, however many agents are told of it. Credits are mock accounting entries.
 */
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export type DayEventId = "market_hour" | "social_hour" | "open_mic" | "course_opening" | "town_meeting";
export interface DayEvent { id: DayEventId; /** Simulated milliseconds since the start of the run. */ at: number; kind: "new_job" | "event" | "course"; text: string }

/** Every event of the schedule whose time is after `from` and not after `to`, in order. */
export function scheduleBetween(from: number, to: number, ctx: { openMicPost?: string; dayMs?: number } = {}): DayEvent[] {
  const out: DayEvent[] = [];
  // `dayMs` compresses the day (G1): a simulated day of this many milliseconds, the events at the same hours of it
  const dayMs = ctx.dayMs ?? DAY, hourMs = dayMs / 24;
  const firstDay = Math.max(0, Math.floor(from / dayMs) - 1), lastDay = Math.floor(to / dayMs) + 1;
  for (let d = firstDay; d <= lastDay; d++) {
    const at = (h: number): number => d * dayMs + h * hourMs;
    const push = (e: DayEvent): void => { if (e.at > from && e.at <= to) out.push(e); };
    push({ id: "market_hour", at: at(9), kind: "new_job", text: `The market hour of day ${d + 1} has begun: the house has put more jobs on the board (look_jobs).` });
    push({ id: "social_hour", at: at(18), kind: "event", text: `The social hour of day ${d + 1} has begun. The forum is the place to talk; no one is asked to.` });
    if (d % 3 === 0) push({ id: "open_mic", at: at(20), kind: "event", text: `The open mic of day ${d + 1} begins in the forum thread "Open mic night"${ctx.openMicPost ? ` (post ${ctx.openMicPost})` : ""}. Share a line or reply to one, or just listen.` });
    if (d === 1) push({ id: "course_opening", at: at(10), kind: "course", text: "The Academy has a course open for enrolment: C-L2-1 (course_enrol)." });
    if (d % 7 === 6) push({ id: "town_meeting", at: at(19), kind: "event", text: `The weekly town meeting of day ${d + 1} has begun: open Town Hall proposals are decided (town_hall).` });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface Fired { id: DayEventId; at: number; text: string }

/** The tools that count as being at an event: the market hour is looked at on the board, the social hour and the open mic in the forum, the course opening at the Academy, the town meeting at the Town Hall. */
export const EVENT_TOOLS: Record<DayEventId, string[]> = {
  market_hour: ["look_jobs", "offer_on_job", "post_job"], social_hour: ["forum_read", "forum_post", "forum_comment", "forum_read_post", "send_message"],
  open_mic: ["forum_read_post", "forum_comment", "forum_post"], course_opening: ["look_courses", "course_enrol", "course_sit"], town_meeting: ["town_hall", "town_vote", "town_propose"],
};
export class DayCycle {
  /** The length of a simulated day in simulated milliseconds (default a real day of the simulated clock; a compressed day makes the events come round faster). */
  dayMs: number;
  /** The simulated clock now, when the run has one: events fall due as the clock passes them, whoever is awake to be told. */
  now?: () => number;
  constructor(o: { dayMs?: number } = {}) { this.dayMs = o.dayMs ?? DAY; }
  /** Who was shown the line of each event, and who went where the event was (by event key id@at). */
  readonly shown = new Map<string, Set<string>>();
  readonly attended = new Map<string, Set<string>>();
  readonly key = (f: { id: string; at: number }): string => `${f.id}@${f.at}`;
  /** Every event shown or attended in this run, by key (the events that were on while an agent acted), for the report; their effects are applied only by `due`, as before. */
  readonly known = new Map<string, Fired>();
  /** The events that are on now (scheduled within the last quarter of a day), computed from the schedule alone: nothing is fired or changed. */
  current(): Fired[] { if (!this.now) return []; const t = this.now(); const out = scheduleBetween(Math.max(0, t - this.dayMs / 4), t, { openMicPost: this.openMicPost, dayMs: this.dayMs }).map((e) => ({ id: e.id, at: e.at, text: e.text })); for (const f of out) this.known.set(this.key(f), f); return out; }
  readonly fired: Fired[] = [];
  /** The forum post of the open mic, when the world has one. */
  openMicPost = "";
  /** Called once for each event the first time it falls due, whoever is told of it: the market hour releases jobs, the town meeting decides proposals. */
  onFire?: (e: DayEvent) => Promise<void>;

  /** The events due in (from, to]; each one's effect is applied the first time it is due. */
  async due(from: number, to: number): Promise<DayEvent[]> {
    const events = scheduleBetween(from, to, { openMicPost: this.openMicPost, dayMs: this.dayMs });
    for (const e of events) if (!this.fired.some((f) => f.id === e.id && f.at === e.at)) { this.fired.push({ id: e.id, at: e.at, text: e.text }); await this.onFire?.(e); }
    return events;
  }
}

/** The day cycle section of the report. */
export function renderDayCycle(d: DayCycle, wakes: { agent: string; because: string }[]): string {
  const L = ["## The day cycle", ""];
  const names = (id: DayEventId): number => d.fired.filter((f) => f.id === id).length;
  if (!d.fired.length) L.push("The society had a day cycle and no simulated hour of it passed during the run.");
  else L.push(`${d.fired.length} scheduled events fell due on the simulated clock (market hours ${names("market_hour")}, social hours ${names("social_hour")}, open mics ${names("open_mic")}, course openings ${names("course_opening")}, town meetings ${names("town_meeting")}); ${wakes.length} wake${wakes.length === 1 ? "" : "s"} of waiting agents were because of one (${[...new Set(wakes.map((w) => w.agent))].join(", ") || "none"}). An event reaches only an agent that is waiting for its kind, and asks nothing of it.`);
  if (d.known.size) {
    L.push("", "| Event | Times | Shown the line (agents) | Attended (agents) |", "|---|---|---|---|");
    for (const id of ["market_hour", "social_hour", "open_mic", "course_opening", "town_meeting"] as DayEventId[]) {
      const fs = [...d.known.values()].filter((f) => f.id === id); if (!fs.length) continue;
      const sh = new Set<string>(), at = new Set<string>();
      for (const f of fs) { for (const x of d.shown.get(d.key(f)) ?? []) sh.add(x); for (const x of d.attended.get(d.key(f)) ?? []) at.add(x); }
      L.push(`| ${id.replace("_", " ")} | ${fs.length} | ${sh.size} | ${at.size} |`);
    }
    L.push("", `A simulated day was ${Math.round(d.dayMs / 60_000)} simulated minutes; an event is "on" for a quarter of a day, and an agent attended it when it used the tool that belongs to it (the board, the forum, the Academy, the Town Hall) while it was on.`);
  }
  return L.join("\n") + "\n";
}
