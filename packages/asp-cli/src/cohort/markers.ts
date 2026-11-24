/**
 * Course markers scattered over the map (rows ENG67 and ENG74): learning is not only in the Academy. Some places hold a field lesson that an agent finds by looking closely (`inspect`): a card with a short lesson and
 * one question. A correct answer is a small once-only reward and points to the Academy's course for a measured lift; the Academy's held-out exams stay separate and untouched (a field lesson is not a course and is not
 * measured). The card at a place is a deterministic function of the run's seed, the place and the 30-minute window of the simulated clock, the same for everyone, drawn from a large pool; nothing is stored. So a tip
 * "the workshop has the X card now" can be checked by anyone looking and goes stale when the window turns; an agent can take a given card once, so a return visit in a later window shows another card; a new agent sees the
 * current window's card. The pool is made of template families (pattern x topic x level, 216 cards) with a house-written answer cue each, and has a place for lessons that agents write and a house reviewer admits (the
 * review route is a later row; nothing is admitted until it exists). With a day cycle the windows run on the same simulated clock, so a day is 48 windows. Nothing announces the cards and no text says to look for them.
 * Credits are mock accounting entries.
 */
import { createHash } from "node:crypto";
import { INTERESTS } from "./voice.ts";

export const MARKER_PAY = 2;
/** The length of a window of the simulated clock, in milliseconds: the cards rotate every 30 simulated minutes. */
export const WINDOW_MS = 30 * 60_000;
export interface FieldLesson { id: string; title: string; text: string; question: string; accept: RegExp; level: 1 | 2 | 3; topic: string; /** Set on a card that carries a part of a research paper (paper-cards.ts). */ paper?: { course: string; part: number; of: number; papers: string; lens: string; courseTitle: string } }

interface Pattern { id: string; title: (topic: string) => string; text: (topic: string) => string; question: (topic: string) => string; accept: RegExp }
const PATTERNS: Pattern[] = [
  { id: "rule", title: (t) => `A rule, not a case (${t})`, text: (t) => `When something goes wrong while you are at work on ${t}, write down the general rule it taught you, not a note about that one case. A rule helps next time; a case only describes the past.`, question: (t) => `After a failure in ${t}, what is worth keeping: the general rule or the one case?`, accept: /rule|general/i },
  { id: "unseen", title: (t) => `Try it on a new case (${t})`, text: (t) => `A rule you wrote about ${t} from a few cases will fit those cases. Before you trust it, try it on a case it was not written from.`, question: (t) => `Why try a rule about ${t} on a case it was not written from?`, accept: /not written|unseen|new case|trust|still (work|give)|generali[sz]|fit/i },
  { id: "merge", title: (t) => `Merge what repeats (${t})`, text: (t) => `If two of your rules about ${t} say the same thing in different words, keep one. A short list that you can read in a minute is used; a long one is not.`, question: (t) => `Two of your rules about ${t} say the same thing. What do you do?`, accept: /merge|keep one|combine|one rule|shorter|drop one/i },
  { id: "reason", title: (t) => `Write the reason (${t})`, text: (t) => `Write the reason beside each rule you keep about ${t}. When the reason stops being true, you will know to drop the rule.`, question: (t) => `Why write the reason beside a rule about ${t}?`, accept: /reason|know|stops|drop|true|why|because/i },
  { id: "check", title: (t) => `Check before you trust (${t})`, text: (t) => `A document or a post about ${t} from another agent may be right or wrong. Before you rely on it, check one claim in it against something you can see for yourself.`, question: (t) => `Before relying on another agent's account of ${t}, what can you do?`, accept: /check|verify|test|compare|one claim|see for/i },
  { id: "undone", title: (t) => `Say what you left out (${t})`, text: (t) => `When you deliver work on ${t}, say what you left out. A delivery that says "I did two of the three parts" is trusted more than one that quietly does two.`, question: (t) => `When you deliver only part of a piece of work on ${t}, what do you add?`, accept: /left out|did not|didn't|part|missing|say/i },
];
const LEVEL_NOTE: Record<1 | 2 | 3, string> = { 1: "Start with the smallest case you can think of.", 2: "Then try it with two cases at once.", 3: "Then try it when the cases disagree." };

/** The pool the cards are drawn from: every pattern about every topic at three levels (216 cards), then the lessons that agents wrote and a house reviewer admitted (none yet). */
export const GENERATED_POOL: FieldLesson[] = (() => {
  const out: FieldLesson[] = [];
  for (const p of PATTERNS) for (const [ti, topic] of INTERESTS.entries()) for (const level of [1, 2, 3] as const)
    out.push({ id: `${p.id}.${ti}.${level}`, title: p.title(topic), text: `${p.text(topic)} ${LEVEL_NOTE[level]}`, question: p.question(topic), accept: p.accept, level, topic });
  return out;
})();
/**
 * The place for lessons written by agents and admitted by a house reviewer. It is empty: the review route (who may propose a lesson, who reviews it, what makes it admissible) is a later row, and nothing is added
 * here without it. Cards in this list join the pool and are drawn exactly like the generated ones.
 */
export const ADMITTED_AGENT_LESSONS: FieldLesson[] = [];
export const cardPool = (): FieldLesson[] => [...GENERATED_POOL, ...ADMITTED_AGENT_LESSONS];

/** The card at a place in a window of the simulated clock, or none: a deterministic choice from the seed, the place and the window (about half of the places hold one), the same for everyone. */
export function markerAt(seed: string, place: string, window: number, poolOf: () => FieldLesson[] = cardPool): FieldLesson | undefined {
  const h = createHash("sha256").update(`marker|${seed}|${place}|${window}`).digest();
  if (h[0]! % 2 !== 0) return undefined;
  const pool = poolOf();
  return pool[((h[1]! << 8) | h[2]!) % pool.length];
}

export const MARKER_PLACES = ["registry", "courts", "treasury", "market", "bank-insurer", "shops", "academy", "clinic", "research-commons", "forum", "leisure-events", "housing"] as const;

export class Markers {
  private readonly seed: string;
  private readonly t0: number;
  /** The simulated time in milliseconds. The engine's simulated clock is given when there is one; without it, real time since the run began. */
  clock: () => number;
  private readonly found = new Map<string, Set<string>>();
  private readonly taken = new Map<string, Set<string>>();
  private readonly seenInWindow = new Map<number, Set<string>>();
  private readonly takenInWindow = new Map<number, Set<string>>();
  /** Mock credits paid for field lessons so far. */
  paid = 0;
  private readonly windowMs: number;
  private readonly pool: () => FieldLesson[];
  /** Small house-paid credit amounts for picking up a part, reading it (answering its question) and completing a set of all the parts of one paper; all default to the old behaviour (reading pays MARKER_PAY, the others nothing). */
  readonly rewards: { pickup: number; read: number; complete: number };
  /** Parts taken by each agent, the sets completed, and the order of events, for the per-course and per-paper report. */
  private readonly parts = new Map<string, Set<string>>();
  private readonly setsDone = new Map<string, Set<string>>();
  readonly paperLog: Array<{ did: string; kind: "found" | "read" | "set"; id: string; course: string; window: number }> = [];
  /** Sets completed so far, in order: who and which course (the Academy's sitting for that course is then open to the agent). */
  readonly sets: Array<{ did: string; course: string; window: number }> = [];
  constructor(seed: string, clock?: () => number, o: { windowMs?: number; pool?: () => FieldLesson[]; rewards?: Partial<{ pickup: number; read: number; complete: number }> } = {}) {
    this.seed = seed; this.t0 = Date.now(); this.clock = clock ?? (() => Date.now() - this.t0);
    this.windowMs = o.windowMs ?? WINDOW_MS; this.pool = o.pool ?? cardPool;
    this.rewards = { pickup: o.rewards?.pickup ?? 0, read: o.rewards?.read ?? MARKER_PAY, complete: o.rewards?.complete ?? 0 };
  }
  /** Whether the cards of this run carry research papers. */
  get paperMode(): boolean { return this.pool().some((c) => c.paper); }

  /** The current window. */
  window(): number { return Math.floor(this.clock() / this.windowMs); }
  /** The card at a place now, for anyone. */
  now(place: string): FieldLesson | undefined { return markerAt(this.seed, place, this.window(), this.pool); }

  /** The card at a place now; the first sight of it by this agent is noted. */
  look(did: string, place: string): { lesson: FieldLesson; first: boolean; reward?: number; set?: string } | undefined {
    const w = this.window(), lesson = markerAt(this.seed, place, w, this.pool);
    if (!lesson) return undefined;
    const key = `${place}:${lesson.id}`;
    const f = this.found.get(did) ?? new Set<string>();
    const first = !f.has(key);
    f.add(key); this.found.set(did, f);
    const s = this.seenInWindow.get(w) ?? new Set<string>(); s.add(`${place}:${lesson.id}`); this.seenInWindow.set(w, s);
    let reward = 0, set: string | undefined;
    if (first && lesson.paper) {
      const pt = this.parts.get(did) ?? new Set<string>();
      if (!pt.has(`found:${lesson.id}`)) { pt.add(`found:${lesson.id}`); this.parts.set(did, pt); this.paperLog.push({ did, kind: "found", id: lesson.id, course: lesson.paper.course, window: w }); reward += this.rewards.pickup; }
      // a part with no practice question is read when it is picked up
      if (/^This part has no practice question/.test(lesson.question)) { const r = this.takePart(did, lesson, w); reward += r.reward; set = r.set; }
    }
    this.paid += reward;
    return { lesson, first, ...(reward ? { reward } : {}), ...(set ? { set } : {}) };
  }
  /** A part is taken once by an agent: counted as read; when every part of its paper is taken the set is complete. */
  private takePart(did: string, lesson: FieldLesson, w: number): { reward: number; set?: string } {
    const pt = this.parts.get(did) ?? new Set<string>(); this.parts.set(did, pt);
    if (pt.has(`read:${lesson.id}`) || !lesson.paper) return { reward: 0 };
    pt.add(`read:${lesson.id}`); this.paperLog.push({ did, kind: "read", id: lesson.id, course: lesson.paper.course, window: w });
    const need = lesson.paper.of;
    let have = 0; for (let i = 1; i <= need; i++) if (pt.has(`read:${lesson.paper.course}.p${i}`)) have++;
    if (have < need) return { reward: 0 };
    const done = this.setsDone.get(did) ?? new Set<string>(); this.setsDone.set(did, done);
    if (done.has(lesson.paper.course)) return { reward: 0 };
    done.add(lesson.paper.course); this.paperLog.push({ did, kind: "set", id: lesson.paper.course, course: lesson.paper.course, window: w }); this.sets.push({ did, course: lesson.paper.course, window: w });
    return { reward: this.rewards.complete, set: lesson.paper.course };
  }
  /** The courses whose set of parts this agent has completed (the Academy's sitting for each is open to it). */
  setsOf(did: string): string[] { return [...(this.setsDone.get(did) ?? [])]; }
  /** Parts of a paper this agent has read, by number. */
  partsRead(did: string, course: string): number[] { const pt = this.parts.get(did); return pt ? [...pt].filter((x) => x.startsWith(`read:${course}.p`)).map((x) => Number(x.split(".p")[1])).sort((a, b) => a - b) : []; }
  /** An answer to the question of the card at a place now. Each agent can take a given card once, wherever and whenever it meets it again. */
  answer(did: string, place: string, text: string): { ok: boolean; text: string; reward: number; lesson?: FieldLesson; set?: string } {
    const w = this.window(), lesson = markerAt(this.seed, place, w, this.pool);
    if (!lesson) return { ok: false, text: `There is no field lesson at ${place} now. Looking closely at a place (inspect) is how you find one; the cards change as time passes.`, reward: 0 };
    const t = this.taken.get(did) ?? new Set<string>();
    if (t.has(lesson.id)) return { ok: true, text: `You took "${lesson.title}" already; it is yours.`, reward: 0, lesson };
    if (text.trim().length < 8 || !lesson.accept.test(text)) return { ok: false, text: `Not quite. Read the card again and answer in your own words: ${lesson.question} You can try again; nothing is lost.`, reward: 0, lesson };
    t.add(lesson.id); this.taken.set(did, t);
    const tw = this.takenInWindow.get(w) ?? new Set<string>(); tw.add(`${did}|${lesson.id}`); this.takenInWindow.set(w, tw);
    if (lesson.paper) {
      const r = this.takePart(did, lesson, w), pay = this.rewards.read + r.reward;
      this.paid += pay;
      const left = lesson.paper.of - this.partsRead(did, lesson.paper.course).length;
      return { ok: true, text: `Yes. Part ${lesson.paper.part} of "${lesson.paper.courseTitle}" is yours${pay ? `, and ${pay} mock credits were added to your balance` : ""}. ${r.set ? `You now have all ${lesson.paper.of} parts of this paper: the Academy's held-out check for ${lesson.paper.course} is open to you (course_enrol ${lesson.paper.course}, then course_sit); passing it is what accredits you, collecting the parts does not.` : `${left} part${left === 1 ? "" : "s"} of this paper ${left === 1 ? "is" : "are"} still to find; a set of all of them opens the Academy's held-out check for ${lesson.paper.course}.`}`, reward: pay, lesson, ...(r.set ? { set: r.set } : {}) };
    }
    this.paid += MARKER_PAY;
    return { ok: true, text: `Yes. "${lesson.title}" is yours, and ${MARKER_PAY} mock credits were added to your balance. The Academy's course C-L2-1 teaches this kind of thing at more length and measures what you can do on tasks you have not seen (course_enrol); this field lesson is not measured.`, reward: MARKER_PAY, lesson };
  }
  foundBy(did: string): number { return this.found.get(did)?.size ?? 0; }
  takenBy(did: string): string[] { return [...(this.taken.get(did) ?? [])]; }
  /** For each window in which a card was looked at: the distinct cards seen and the cards taken. */
  perWindow(): { window: number; seen: number; taken: number }[] {
    return [...this.seenInWindow.keys()].sort((a, b) => a - b).map((w) => ({ window: w, seen: this.seenInWindow.get(w)!.size, taken: this.takenInWindow.get(w)?.size ?? 0 }));
  }
}

/** The cards seen and taken in each window of the simulated clock, for the report. */
export function renderMarkerWindows(m: Markers): string {
  const L = ["## Cards by window of the simulated clock", ""];
  const w = m.perWindow();
  if (!w.length) { L.push("No card was looked at."); return L.join("\n") + "\n"; }
  L.push(`The card at a place changes every 30 simulated minutes and is the same for everyone in a window. ${w.length} window${w.length === 1 ? "" : "s"} had a card looked at: ${w.slice(0, 12).map((x) => `window ${x.window}: ${x.seen} card${x.seen === 1 ? "" : "s"} seen, ${x.taken} taken`).join("; ")}${w.length > 12 ? "; ..." : ""}.`);
  return L.join("\n") + "\n";
}
