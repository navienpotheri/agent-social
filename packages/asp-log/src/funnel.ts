/**
 * The measured front door (register row DK838; spec-delta S1211; docs/intake/11th-nov.md, both agent-social chats; extends U10, the measurement of the beta funnel): anonymous counters for each step an agent takes from
 * the front door, by source, and a drop-off view. The steps are fixed, in order: the start page read, enrolment, the first act, the first free lesson started, the first free lesson passed, the first return. A counter
 * counts a visitor once for a step however often it repeats it. A visitor is a hash of an opaque key under a salt that changes every day, so the same key is the same visitor within a day and nothing identifies it
 * afterwards; a source is a short label from a fixed alphabet, never free text. The store keeps counts and hashes, nothing a person typed. A scripted agent walks the steps in the tests; no real traffic is measured here.
 */
import { createHash } from "node:crypto";

export const STEPS = ["start_page_read", "enrolled", "first_act", "free_lesson_started", "free_lesson_passed", "returned"] as const;
export type Step = (typeof STEPS)[number];
const SOURCE = /^[a-z0-9][a-z0-9-]{0,23}$/;

export interface DropOffRow { step: Step; visitors: number; /** Share of the first step still here, in permille. */ ofFirstPermille: number; /** Share of the step before still here, in permille (1000 for the first step). */ ofPreviousPermille: number; /** Visitors lost since the step before. */ lost: number }

export class Funnel {
  /** step -> source -> visitor hashes (a Set so a repeat is one visitor). */
  private readonly seen = new Map<string, Set<string>>();
  private readonly salt: (day: string) => string;
  constructor(salt: (day: string) => string = (day) => `asp-funnel|${day}`) { this.salt = salt; }

  /** A visitor's hash for a day: of an opaque key (a cookie-less nonce, a session id), never stored raw. */
  visitor(key: string, day: string): string { return createHash("sha256").update(`${this.salt(day)}|${key}`).digest("hex").slice(0, 16); }

  /** Counts a visitor at a step for a source. A source outside the alphabet is refused; the step must be one of the fixed steps. Returns whether this was a new count. */
  record(step: Step, source: string, key: string, day: string): boolean {
    if (!STEPS.includes(step)) throw new Error(`${step} is not a funnel step`);
    if (!SOURCE.test(source)) throw new Error("a source is a short label of lowercase letters, digits and hyphens, not text");
    const id = `${step}|${source}`;
    const set = this.seen.get(id) ?? this.seen.set(id, new Set()).get(id)!;
    const v = this.visitor(key, day);
    if (set.has(v)) return false;
    set.add(v);
    return true;
  }

  count(step: Step, source?: string): number {
    let n = 0;
    for (const [id, set] of this.seen) { const [s, src] = id.split("|"); if (s === step && (source === undefined || src === source)) n += set.size; }
    return n;
  }
  sources(): string[] { return [...new Set([...this.seen.keys()].map((id) => id.split("|")[1]))].sort(); }

  /** The drop-off view: the steps in order with the visitors at each, the share of the first and of the step before, and how many were lost. Optionally for one source. */
  dropOff(source?: string): DropOffRow[] {
    const rows: DropOffRow[] = [];
    let first = 0, prev = 0;
    for (const [i, step] of STEPS.entries()) {
      const n = this.count(step, source);
      if (i === 0) first = n;
      rows.push({ step, visitors: n, ofFirstPermille: first ? Math.round((n / first) * 1000) : 0, ofPreviousPermille: i === 0 ? 1000 : prev ? Math.round((n / prev) * 1000) : 0, lost: i === 0 ? 0 : Math.max(0, prev - n) });
      prev = n;
    }
    return rows;
  }
  /** The step where the most visitors are lost, with how many (the first thing to fix). */
  worstStep(source?: string): { step: Step; lost: number } | null {
    const rows = this.dropOff(source).slice(1);
    const w = rows.reduce<DropOffRow | null>((a, b) => (!a || b.lost > a.lost ? b : a), null);
    return w && w.lost > 0 ? { step: w.step, lost: w.lost } : null;
  }
  /** The stored hashes by step and source, for a file the service keeps so a restart does not lose the counts (hashes under a daily salt; no raw key, no address). */
  dump(): Record<string, string[]> { return Object.fromEntries([...this.seen].map(([id, set]) => [id, [...set]])); }
  /** Reads what `dump` wrote; anything that is not a known step, a valid source or a 16-hex hash is dropped. */
  load(data: unknown): void {
    if (!data || typeof data !== "object") return;
    for (const [id, list] of Object.entries(data as Record<string, unknown>)) {
      const [step, source] = id.split("|");
      if (!STEPS.includes(step as Step) || !SOURCE.test(source ?? "") || !Array.isArray(list)) continue;
      const set = this.seen.get(id) ?? this.seen.set(id, new Set()).get(id)!;
      for (const h of list) if (typeof h === "string" && /^[0-9a-f]{16}$/.test(h)) set.add(h);
    }
  }
  /** What is stored: counts only, as the public view would show them. No visitor hash leaves this object. */
  snapshot(): { step: Step; source: string; visitors: number }[] {
    return [...this.seen].map(([id, set]) => { const [step, source] = id.split("|"); return { step: step as Step, source, visitors: set.size }; }).sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step) || a.source.localeCompare(b.source));
  }
}
