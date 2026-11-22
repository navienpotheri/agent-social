/**
 * Course markers scattered over the map (row ENG67): learning is not only in the Academy. Some places hide a field lesson that an agent finds by looking closely (`inspect`): a card pinned to the wall with a short
 * lesson and one question about it. A correct answer is a small once-only reward and points to the Academy's course for a measured lift; the Academy's held-out exams stay separate and untouched (a field lesson is
 * not a course and is not measured). Which places hold a marker, and which lesson, is a deterministic function of the run's seed, the agent and (when the society has a day cycle) the day, so a run can be reproduced,
 * each agent can find different ones, and the markers move from one day to the next. Nothing announces them and no text says to look for them. The lessons are practical advice that the house wrote, true of this run.
 * Credits are mock accounting entries.
 */
import { createHash } from "node:crypto";

export const MARKER_PAY = 2;
export interface FieldLesson { id: string; title: string; text: string; question: string; accept: RegExp }
export const FIELD_LESSONS: FieldLesson[] = [
  { id: "rule-not-case", title: "Write the rule, not the case", text: "When something goes wrong, write down the general rule it taught you (\"let the queue drain before a migration\"), not a note about that one case (\"service x failed on Friday\"). A rule helps next time; a case only describes the past.", question: "Which is worth keeping: \"let the queue drain before a migration\" or \"service x failed on Friday\"?", accept: /drain|rule|general|first one|the first/i },
  { id: "unseen-case", title: "Try the rule on a case you have not seen", text: "A rule you wrote from three failures will always fit those three. Before you trust it, try it on a case it was not written from, and see whether it still gives the right answer.", question: "Why try a new rule on a case it was not written from?", accept: /not written|unseen|new case|fit|trust|still (work|give)|generali[sz]/i },
  { id: "merge-repeats", title: "Merge what repeats", text: "If two of your rules say the same thing in different words, keep one. A short list that you can read in a minute is used; a long list is not.", question: "Two of your rules say the same thing in different words. What do you do?", accept: /merge|keep one|combine|one rule|shorter|drop one/i },
  { id: "drop-contradicts", title: "Drop what contradicts", text: "When a new rule contradicts an old one, one of them is wrong. Find a case that decides between them and drop the loser; do not keep both and hope.", question: "A new rule contradicts an old one. What decides which to keep?", accept: /case|test|evidence|decide|check|drop/i },
  { id: "reason-with-rule", title: "A rule needs its reason", text: "Write the reason beside each rule (\"because the queue loses messages when it is busy\"). When the reason stops being true, you will know to drop the rule.", question: "Why write the reason beside a rule?", accept: /reason|know|stops|drop|true|why/i },
  { id: "check-a-copy", title: "Check a copy before you trust it", text: "A document or a post from another agent may be right or wrong. Before you rely on it, check one claim in it against something you can see for yourself.", question: "Before relying on another agent's document, what is one thing you can do?", accept: /check|verify|test|compare|one claim|see for/i },
  { id: "price-by-check", title: "Price a job by its check", text: "A job with a clear check (\"three institutions, each with a reason\") is easy to do and easy to accept; a job with no check is a dispute waiting to happen. When you post a job, write the check first.", question: "What should you write first when you post a job?", accept: /check|criterion|test|accept|what.*check/i },
  { id: "say-what-undone", title: "Say what you did not do", text: "When you deliver, say what you left out. A delivery that says \"I did two of the three parts\" is trusted more than one that quietly does two.", question: "When you deliver part of a job, what do you add?", accept: /left out|did not|didn't|part|what.*missing|say/i },
];

/** The marker at a place for an agent on a day, or none: a deterministic choice from the seed, the agent, the place and the day (about half of the places hold one for a given agent and day). */
export function markerAt(seed: string, did: string, place: string, day: number): FieldLesson | undefined {
  const h = createHash("sha256").update(`marker|${seed}|${did}|${place}|${day}`).digest();
  if (h[0]! % 2 !== 0) return undefined;
  return FIELD_LESSONS[h[1]! % FIELD_LESSONS.length];
}

export const MARKER_PLACES = ["registry", "courts", "treasury", "market", "bank-insurer", "shops", "academy", "clinic", "research-commons", "forum", "leisure-events", "housing"] as const;

export class Markers {
  private readonly seed: string;
  /** The simulated day, set by the day cycle when the society has one (so that markers move); 0 otherwise. */
  day = 0;
  private readonly found = new Map<string, Set<string>>();
  private readonly taken = new Map<string, Set<string>>();
  /** Mock credits paid for field lessons so far. */
  paid = 0;
  constructor(seed: string) { this.seed = seed; }

  /** The marker at a place for this agent now; the first sight of it is noted. */
  look(did: string, place: string): { lesson: FieldLesson; first: boolean } | undefined {
    const lesson = markerAt(this.seed, did, place, this.day);
    if (!lesson) return undefined;
    const key = `${place}:${lesson.id}`;
    const f = this.found.get(did) ?? new Set<string>();
    const first = !f.has(key);
    f.add(key); this.found.set(did, f);
    return { lesson, first };
  }
  /** An answer to the question of the marker at a place. Returns what to tell the agent and whether the reward is due now. */
  answer(did: string, place: string, text: string): { ok: boolean; text: string; reward: number; lesson?: FieldLesson } {
    const lesson = markerAt(this.seed, did, place, this.day);
    if (!lesson) return { ok: false, text: `There is no field lesson at ${place} for you now. Looking closely at a place (inspect) is how you find one.`, reward: 0 };
    const t = this.taken.get(did) ?? new Set<string>();
    if (t.has(`${place}:${lesson.id}`)) return { ok: true, text: `You took "${lesson.title}" already; it is yours.`, reward: 0, lesson };
    if (text.trim().length < 8 || !lesson.accept.test(text)) return { ok: false, text: `Not quite. Read the card again and answer in your own words: ${lesson.question} You can try again; nothing is lost.`, reward: 0, lesson };
    t.add(`${place}:${lesson.id}`); this.taken.set(did, t);
    this.paid += MARKER_PAY;
    return { ok: true, text: `Yes. "${lesson.title}" is yours, and ${MARKER_PAY} mock credits were added to your balance. The Academy's course C-L2-1 teaches this at more length and measures what you can do on tasks you have not seen (course_enrol); this field lesson is not measured.`, reward: MARKER_PAY, lesson };
  }
  foundBy(did: string): number { return this.found.get(did)?.size ?? 0; }
  takenBy(did: string): string[] { return [...(this.taken.get(did) ?? [])]; }
}
