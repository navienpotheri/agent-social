/**
 * The capability fingerprint of an agent (register row DK610): what it has learned in the catalogue, as the log and the sittings ledger record it. Which courses it completed (the Registrar's signed `completion` records in
 * the log), what it scored on held-out tasks at each sitting (the ledger holds hashes and scores only), which lenses and which institution-by-function cells those courses serve, and a digest of all of it so two agents
 * on different paths differ and the same path gives the same digest. It says what happened; it is not a rank, a tier or a claim that the agent is good at anything the courses do not test. Pure: records and entries in.
 */
import { createHash } from "node:crypto";
import type { CourseCard } from "./catalogue.ts";
import { completedCards, type LedgerEntry, type Reader } from "./sitting.ts";

export interface FingerprintCourse { id: string; title: string; lens: string; completed: boolean; sittings: number; passed_sittings: number; best_permille: number | null; last_sitting: string | null }
export interface Fingerprint {
  holder: string;
  courses: FingerprintCourse[];
  completed: number;
  lenses: Record<string, number>;
  cells: string[];
  digest: string;
  note: string;
}

export async function capabilityFingerprint(r: Reader, entries: readonly LedgerEntry[], holder: string, cards: readonly CourseCard[]): Promise<Fingerprint> {
  const done = await completedCards(r, holder);
  const mine = entries.filter((e) => e.holder === holder);
  const courses: FingerprintCourse[] = [];
  const lenses: Record<string, number> = {};
  const cells = new Set<string>();
  for (const c of cards) {
    const es = mine.filter((e) => e.course === c.id);
    if (!es.length && !done.has(c.id)) continue;
    const passed = es.filter((e) => e.passed);
    courses.push({ id: c.id, title: c.title, lens: c.lens, completed: done.has(c.id), sittings: es.length, passed_sittings: passed.length, best_permille: passed.length ? Math.max(...passed.map((e) => e.mean_permille)) : null, last_sitting: es.length ? es.map((e) => e.at).sort().pop()! : null });
    if (done.has(c.id)) { lenses[c.lens] = (lenses[c.lens] ?? 0) + 1; for (const x of c.cells) cells.add(`${x.institution} x ${x.function}`); }
  }
  const completed = courses.filter((c) => c.completed).length;
  const digest = "sha256:" + createHash("sha256").update(JSON.stringify({ holder, courses: courses.map((c) => [c.id, c.completed, c.best_permille]), lenses })).digest("hex");
  return { holder, courses, completed, lenses, cells: [...cells].sort(), digest, note: "What the agent completed in the catalogue and scored on held-out tasks, from the log's completions and the sittings ledger. It is a record, not a rank: it moves no tier and claims nothing the courses do not test." };
}
