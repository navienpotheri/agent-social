/**
 * Sitting a course (register row DK1342; docs/learning-platform.md): the whole flow an agent follows, in one place, used by `asp academy lens sit` (on the agent's own machine) and by the service's signed
 * routes (`/society/courses/<id>/practice` and `/sit`). The flow: the first lesson is read free; tuition moves mock credits through the price list (a purchase, then an enrolment); the practice tasks are handed
 * out; the agent submits its artifact; the held-out tasks are drawn from seeds anchored in the log head at the moment of the sitting (so the agent could not know them ahead of time) and score it; a copied or
 * unchanged answer is refused; on a pass the Registrar attests the completion and the lessons enter the agent's memory through the lesson gate as one signed change with the sitting's Action as evidence.
 * A failed sitting changes nothing but a line in the ledger, and may be repeated: the same enrolment, up to MAX_SITTINGS_PER_DAY sittings a day, each on fresh seeds, never with the same answer again.
 * Credits are accounting entries, not money; the courses are toys with scripted executors; nothing here changes model weights.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { admitToMemory, type LessonCandidate, type Verdict } from "@agent-social/asp-package";
import type { Signer } from "@agent-social/asp-core";
import { REPLAY_TASKS } from "./writeback.ts";
import { courseSeeds, courseService, type CourseCard } from "./catalogue.ts";
import { ENGINES, attestation, sit, type Sitting } from "./engines.ts";

export const MAX_SITTINGS_PER_DAY = 3;
export const MAX_ARTIFACT_BYTES = 65_536;
const DAY = 86_400_000;

/** What a sitting reads from the log: the same methods the log and the service's handle give. */
export interface Reader {
  academyRecords(types: string[]): Promise<any[]>;
  get(id: string): Promise<any>;
  head(): Promise<{ seq: number; logHash: string }>;
}

/** One line of the ledger of sittings (never the artifact itself, only its hash). */
export interface LedgerEntry { /** Hashes of the word triples of a lesson list (DK1402): what a near copy is measured against; never the words. */ shingles?: string[]; at: string; course: string; holder: string; enrolment: string; attempt: number; artifact: string; passed: boolean; mean_permille: number; anchor: string; run_log?: string }

/** The ledger of sittings: a JSONL file (or memory when there is no path). It is what limits repeats and catches a copied answer; it holds hashes and scores only. */
export class Ledger {
  private mem: LedgerEntry[] = [];
  private readonly path?: string;
  constructor(path?: string) { this.path = path; }
  entries(): LedgerEntry[] {
    if (!this.path) return [...this.mem];
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
  }
  add(e: LedgerEntry): void {
    if (!this.path) { this.mem.push(e); return; }
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(e) + "\n");
  }
}

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
const canon = (x: unknown): string => Array.isArray(x) ? `[${x.map(canon).join(",")}]` : x && typeof x === "object" ? `{${Object.keys(x as object).sort().map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(x);

/** The hash that says whether two answers are the same answer: lesson lists compare as sets of lower-cased, whitespace-collapsed lines (order and case do not make a new answer); anything else by its canonical JSON. */
export function artifactKey(artifact: unknown): string {
  const a = artifact as { lessons?: unknown };
  if (a && typeof a === "object" && Array.isArray(a.lessons) && a.lessons.every((l) => typeof l === "string")) {
    return sha("lessons|" + [...new Set((a.lessons as string[]).map((l) => l.trim().replace(/\s+/g, " ").toLowerCase()))].sort().join("\n"));
  }
  return sha("artifact|" + canon(artifact));
}

/** A near copy (DK1402): another holder's answer whose word triples overlap this one's by at least this many permille (Jaccard), for a lesson list of at least NEAR_COPY_MIN_SHINGLES triples. */
export const NEAR_COPY_PERMILLE = 700;
export const NEAR_COPY_MIN_SHINGLES = 8;

/** The hashes of the word triples of a lesson list, normalised as `artifactKey` does (lower case, no punctuation, one space); a line of fewer than three words is one unit. Undefined for any other artifact. */
export function shingleHashes(artifact: unknown): string[] | undefined {
  const a = artifact as { lessons?: unknown };
  if (!a || typeof a !== "object" || !Array.isArray(a.lessons) || !a.lessons.every((l) => typeof l === "string")) return undefined;
  const out = new Set<string>();
  for (const line of a.lessons as string[]) {
    const w = line.toLowerCase().replace(/[^a-z0-9=_ ]+/g, " ").split(/\s+/).filter(Boolean);
    if (!w.length) continue;
    if (w.length < 3) out.add(sha(w.join(" ")).slice(7, 19));
    for (let i = 0; i + 3 <= w.length; i++) out.add(sha(w.slice(i, i + 3).join(" ")).slice(7, 19));
  }
  return [...out].sort();
}

/** How much two answers overlap, in permille (intersection over union of their word triples). */
export function overlapPermille(a: string[], b: string[]): number {
  const sa = new Set(a);
  let inter = 0;
  for (const x of new Set(b)) if (sa.has(x)) inter++;
  const union = sa.size + new Set(b).size - inter;
  return union === 0 ? 0 : Math.floor((inter * 1000) / union);
}

/** Whether two answers are near copies of each other: an overlap of at least NEAR_COPY_PERMILLE. */
export const isNearCopy = (a: string[], b: string[]): boolean => overlapPermille(a, b) >= NEAR_COPY_PERMILLE;

export type Refusal =
  | "unknown_course" | "not_enrolled" | "tuition_not_paid" | "already_completed" | "too_many_today"
  | "artifact_unchanged" | "artifact_copied" | "artifact_too_big" | "artifact_missing" | "prerequisite_missing";
export class SittingRefused extends Error { readonly code: Refusal; constructor(code: Refusal, message: string) { super(message); this.code = code; } }

const bodyOf = <T>(r: { body?: unknown }) => r.body as unknown as T;
type Rec = { id: string; type: string; issuer: string; issued_at: string; body: Record<string, any> };

/** The practice tasks and the free lesson are drawn from seeds that are not the held-out seeds (those are anchored in the log head when the sitting happens). */
export const previewSeed = (card: Pick<CourseCard, "id">) => courseSeeds(card.id, "free-lesson", 0, "sha256:" + "0".repeat(64), 1)[0];
export const practiceSeed = (card: Pick<CourseCard, "id">, holder: string, enrolment: string, attempt: number) => courseSeeds(card.id, holder, attempt, enrolment, 1)[0];

/** What anyone may read before paying: the idea, the first lesson, what the course asks for and costs, and a sample of the practice material on a fixed public seed. */
export function freeLesson(card: CourseCard) {
  const engine = ENGINES[card.generator.engine];
  return {
    course: card.id, title: card.title, concept: card.concept, paper: card.paper, price: card.price, prerequisites: card.prerequisites,
    first_lesson: card.free_first_lesson, artifact: card.artifact, gate: card.gate, write_back: card.write_back,
    seed_rule: card.generator.seed_source, retry_rule: `a failed sitting may be repeated on the same enrolment, at most ${MAX_SITTINGS_PER_DAY} sittings a day, each on fresh seeds and never with the same answer again`,
    sample_practice: engine ? engine.practice(previewSeed(card)) : null,
    note: "Reading this costs nothing. Tuition is in mock credits (accounting entries, not money). Nothing here changes model weights.",
  };
}

/** The Academy records of one kind about one holder. */
async function mine(r: Reader, type: string, holder: string): Promise<Rec[]> {
  return ((await r.academyRecords([type])) as Rec[]).filter((x) => x.issuer === holder || x.body?.holder === holder);
}

/** The lens courses (by card id) a holder has completed: completions whose enrolment names a course record published for a card. */
export async function completedCards(r: Reader, holder: string): Promise<Set<string>> {
  const courses = new Map(((await r.academyRecords(["course"])) as Rec[]).map((c) => [c.id, bodyOf<{ course: string }>(c).course] as const));
  const enrols = new Map(((await r.academyRecords(["enrolment"])) as Rec[]).map((e) => [e.id, bodyOf<{ course: string }>(e).course] as const));
  const out = new Set<string>();
  for (const c of (await r.academyRecords(["completion"])) as Rec[]) {
    if (bodyOf<{ holder: string }>(c).holder !== holder) continue;
    const course = courses.get(enrols.get(bodyOf<{ enrolment: string }>(c).enrolment) ?? "");
    if (course) out.add(course);
  }
  return out;
}

/** The course record published for a card (its `course` field is the card id), or undefined when the operator has not published it. */
export async function courseRecordFor(r: Reader, card: Pick<CourseCard, "id">): Promise<Rec | undefined> {
  return ((await r.academyRecords(["course"])) as Rec[]).find((c) => bodyOf<{ course: string }>(c).course === card.id);
}

/** An enrolment of the holder in the card's course that has no completion yet (the open one), with the tuition purchase that paid for it. */
export async function openEnrolment(r: Reader, card: Pick<CourseCard, "id">, holder: string): Promise<Rec | undefined> {
  const course = await courseRecordFor(r, card);
  if (!course) return undefined;
  const done = new Set(((await r.academyRecords(["completion"])) as Rec[]).map((c) => bodyOf<{ enrolment: string }>(c).enrolment));
  return ((await r.academyRecords(["enrolment"])) as Rec[]).find((e) => e.issuer === holder && bodyOf<{ course: string }>(e).course === course.id && !done.has(e.id));
}

/** Checks that an enrolment is the holder's, for this card's course, paid (a purchase of the course's service by the holder for at least the price), and not yet completed. Throws SittingRefused in words. */
export async function checkEnrolment(r: Reader, card: CourseCard, holder: string, enrolment: string): Promise<Rec> {
  const e = ((await r.academyRecords(["enrolment"])) as Rec[]).find((x) => x.id === enrolment);
  const course = await courseRecordFor(r, card);
  if (!course) throw new SittingRefused("unknown_course", `${card.id} is not published in this log yet: the operator publishes a course (its price in the price list, then the course record) before anyone can enrol`);
  if (!e || e.issuer !== holder || bodyOf<{ course: string }>(e).course !== course.id) throw new SittingRefused("not_enrolled", `${holder} has no enrolment ${enrolment} in ${card.id}: enrol first (tuition ${card.price} mock credits)`);
  const purchase = ((await r.academyRecords(["purchase"])) as Rec[]).find((p) => p.id === bodyOf<{ purchase: string }>(e).purchase);
  const pb = purchase?.body as { service?: string; amount?: { value: number } } | undefined;
  if (!purchase || purchase.issuer !== holder || pb?.service !== courseService(card) || (pb?.amount?.value ?? 0) < card.price) throw new SittingRefused("tuition_not_paid", `the enrolment's purchase is not ${card.price} credits of ${courseService(card)} paid by ${holder}`);
  if (((await r.academyRecords(["completion"])) as Rec[]).some((c) => bodyOf<{ enrolment: string }>(c).enrolment === enrolment)) throw new SittingRefused("already_completed", `${card.id} is already completed on this enrolment`);
  return e;
}

export interface SitResult {
  sitting: Sitting; attempt: number; anchor: string; artifact_key: string; attestation: { ok: boolean; reason: string };
  /** Sittings left today on this enrolment after this one. */
  left_today: number;
}

/**
 * One sitting: refuses what the rules refuse (not enrolled or unpaid, too many today, no artifact or too big, the same answer as the holder's earlier sitting, an answer another holder already gave), draws the seeds from the log head
 * now, scores, and writes one ledger line. Nothing else changes; a pass is acted on by the caller (the Registrar's completion, the write-back).
 */
export async function runSitting(card: CourseCard, req: { holder: string; enrolment: string; artifact: unknown; runLog?: string }, env: { reader: Reader; ledger: Ledger; now: () => string }): Promise<SitResult> {
  const enrolment = await checkEnrolment(env.reader, card, req.holder, req.enrolment);
  if (req.artifact === undefined || req.artifact === null) throw new SittingRefused("artifact_missing", "no artifact was submitted");
  if (JSON.stringify(req.artifact).length > MAX_ARTIFACT_BYTES) throw new SittingRefused("artifact_too_big", `the artifact is over ${MAX_ARTIFACT_BYTES} bytes`);
  const now = Date.parse(env.now());
  const all = env.ledger.entries().filter((x) => x.course === card.id);
  const today = all.filter((x) => x.enrolment === enrolment.id && now - Date.parse(x.at) < DAY).length;
  if (today >= MAX_SITTINGS_PER_DAY) throw new SittingRefused("too_many_today", `${today} sittings of ${card.id} on this enrolment in the last day: at most ${MAX_SITTINGS_PER_DAY}; the next one opens when the oldest leaves the day`);
  const key = artifactKey(req.artifact);
  if (all.some((x) => x.holder === req.holder && x.artifact === key)) throw new SittingRefused("artifact_unchanged", "this is the same answer as an earlier sitting of yours: change it before sitting again");
  const copied = all.find((x) => x.holder !== req.holder && x.artifact === key);
  if (copied) throw new SittingRefused("artifact_copied", "this answer is the same as one another agent already gave for this course: write your own");
  const triples = shingleHashes(req.artifact);
  if (triples && triples.length >= NEAR_COPY_MIN_SHINGLES) {
    for (const x of all) {
      if (x.holder === req.holder || !x.shingles || x.shingles.length < NEAR_COPY_MIN_SHINGLES) continue;
      const o = overlapPermille(triples, x.shingles);
      if (isNearCopy(triples, x.shingles)) throw new SittingRefused("artifact_copied", `this answer is a near copy (${Math.round(o / 10)}% of its word triples) of one another agent already gave for this course: write your own`);
    }
  }
  const attempt = all.filter((x) => x.holder === req.holder).length + 1;
  const anchor = (await env.reader.head()).logHash;
  const sitting = sit(card, req.artifact, req.holder, attempt, anchor);
  env.ledger.add({ at: env.now(), course: card.id, holder: req.holder, enrolment: enrolment.id, attempt, artifact: key, ...(triples ? { shingles: triples } : {}), passed: sitting.passed, mean_permille: sitting.mean_permille, anchor, ...(req.runLog ? { run_log: req.runLog } : {}) });
  return { sitting, attempt, anchor, artifact_key: key, attestation: attestation(sitting), left_today: MAX_SITTINGS_PER_DAY - today - 1 };
}

/** The lesson texts a passed artifact becomes in memory: each line of a lesson list, or one entry that names the course and carries the artifact's JSON when the artifact is a policy, a procedure or a suite. */
export function lessonTexts(card: CourseCard, artifact: unknown): string[] {
  const a = artifact as { lessons?: unknown };
  if (a && typeof a === "object" && Array.isArray(a.lessons) && a.lessons.every((l) => typeof l === "string")) return (a.lessons as string[]).map((l) => l.trim()).filter(Boolean);
  const json = JSON.stringify(artifact);
  return [`Course ${card.id} (${card.title}), the ${card.artifact.kind} I wrote and passed: ${json}`];
}

/** Writes a passed sitting's lessons into the agent's memory through the lesson gate, replayed on the course's own held-out tasks (the generic floor when the engine has none), with the sitting's Action as evidence, as one signed change. */
export async function writeLessons(pkg: string, card: CourseCard, artifact: unknown, sitting: Sitting, o: { signer: Signer; actionId: string; now: Date }): Promise<Verdict[]> {
  const engine = ENGINES[card.generator.engine];
  const heldOut = engine?.replay ? engine.replay(sitting.seeds[0]) : REPLAY_TASKS;
  const lessons: LessonCandidate[] = lessonTexts(card, artifact).map((text, i) => ({ id: `${card.id.toLowerCase()}-${sitting.attempt}-${i + 1}`, text, evidence: [{ kind: "run" as const, ref: o.actionId }], source: "course" as const }));
  return admitToMemory(pkg, lessons, { existing: [], heldOut, minHeldOut: 3, isOwnRun: (id) => id === o.actionId, signer: o.signer, now: o.now });
}

/** The words of one sitting for the learner: the result, the error bar, what failed, and what happens next. */
export function describeSitting(card: CourseCard, r: SitResult): string[] {
  const s = r.sitting;
  return [
    `${card.id} sitting ${r.attempt}: ${s.passed ? "PASSED" : "not passed"}; mean ${s.mean_permille / 10}% over ${s.runs.length} runs (lowest ${s.min_permille / 10}%, error bar ${s.error_bar_permille / 10}%); the gate is ${card.gate.pass_permille / 10}% on every run`,
    `held-out seeds were drawn from the log head ${r.anchor.slice(0, 19)}... at the moment of the sitting`,
    ...(s.passed ? [] : [`what missed: ${r.attestation.reason}`, ...[...new Set(s.runs.flatMap((x) => x.failures))].slice(0, 5).map((f) => `  - ${f}`), `you may sit again with a changed answer (${r.left_today} sitting(s) left today on this enrolment); nothing was kept and tuition is not refunded or charged again`]),
  ];
}

/** A passed sitting of this very answer on an open enrolment whose completion was not recorded (the Action or the Registrar's step failed after the grading): the same sitting again, recomputed from the ledger's anchor and attempt, with no new draw. */
export function pendingPass(card: CourseCard, holder: string, enrolment: string, artifact: unknown, ledger: Ledger): SitResult | undefined {
  const key = artifactKey(artifact);
  const e = ledger.entries().find((x) => x.course === card.id && x.holder === holder && x.enrolment === enrolment && x.artifact === key && x.passed);
  if (!e) return undefined;
  const sitting = sit(card, artifact, holder, e.attempt, e.anchor);
  return { sitting, attempt: e.attempt, anchor: e.anchor, artifact_key: key, attestation: attestation(sitting), left_today: 0 };
}

export interface Appender { append(record: any): Promise<{ id: string }> }

/** The Registrar's completion for a passed sitting: the ledger must show a pass on this enrolment, and the run log must be the holder's own Action made after the enrolment and not used by another completion. Returns the completion's id. */
export async function completeSitting(r: Reader, w: Appender, registrar: Signer & { did?: string }, card: CourseCard, req: { holder: string; enrolment: string; runLog: string }, env: { ledger: Ledger; now: () => string; make: (type: string, issuer: string, subject: string | null, body: Record<string, unknown>, signer: Signer) => any }): Promise<string> {
  const e = await checkEnrolment(r, card, req.holder, req.enrolment);
  if (!env.ledger.entries().some((x) => x.course === card.id && x.holder === req.holder && x.enrolment === e.id && x.passed)) throw new SittingRefused("not_enrolled", `no passed sitting of ${card.id} is recorded for this enrolment`);
  const act = (await r.get(req.runLog))?.record as Rec | undefined;
  if (!act || act.type !== "asp.action/v0.2" || act.issuer !== req.holder) throw new SittingRefused("not_enrolled", `${req.runLog} is not an Action of ${req.holder}: the sitting is evidenced by the agent's own run`);
  if (Date.parse(act.issued_at) < Date.parse(e.issued_at)) throw new SittingRefused("not_enrolled", "the Action is older than the enrolment: report a run made after enrolling");
  const rec = env.make("completion", registrar.did ?? "", req.holder, { enrolment: e.id, holder: req.holder, exercises_passed: 1, run_log_hash: req.runLog }, registrar);
  return (await w.append(rec)).id;
}

/**
 * The operator's batch (DK1403): every passed sitting in the ledger that cites the agent's own Action and has no completion yet gets the Registrar's completion. The Registrar's key stays on the operator's machine; the
 * service signs nothing for an agent. A sitting whose Action is missing, older than its enrolment or another agent's is skipped with the reason, and is tried again on the next run.
 */
export async function completePending(r: Reader, w: Appender, registrar: Signer & { did?: string }, cards: CourseCard[], env: { ledger: Ledger; now: () => string; make: (type: string, issuer: string, subject: string | null, body: Record<string, unknown>, signer: Signer) => any }): Promise<{ done: { course: string; holder: string; completion: string }[]; skipped: { course: string; holder: string; why: string }[] }> {
  const completed = new Set(((await r.academyRecords(["completion"])) as Rec[]).map((c) => bodyOf<{ enrolment: string }>(c).enrolment));
  const done: { course: string; holder: string; completion: string }[] = [], skipped: { course: string; holder: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const e of env.ledger.entries()) {
    if (!e.passed || !e.run_log || completed.has(e.enrolment) || seen.has(e.enrolment)) continue;
    seen.add(e.enrolment);
    const card = cards.find((c) => c.id === e.course);
    if (!card) { skipped.push({ course: e.course, holder: e.holder, why: "the course is not in the catalogue" }); continue; }
    try {
      const completion = await completeSitting(r, w, registrar, card, { holder: e.holder, enrolment: e.enrolment, runLog: e.run_log }, env);
      done.push({ course: e.course, holder: e.holder, completion });
    } catch (err) { skipped.push({ course: e.course, holder: e.holder, why: (err as Error).message }); }
  }
  return { done, skipped };
}

/** The text an agent signs to ask the service for practice tasks, a grading or a completion: bound to the operation, the course, the identity, the enrolment, the time and the answer. */
export const sitMessage = (op: "practice" | "sit" | "complete", course: string, did: string, enrolment: string, at: string, artifact: string): Uint8Array => new TextEncoder().encode(`asp-lens-sit:v1:${op}:${course}:${did}:${enrolment}:${at}:${artifact}`);
export const SIGNED_REQUEST_MAX_AGE_MS = 10 * 60_000;
