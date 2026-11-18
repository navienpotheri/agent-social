/**
 * The course catalogue of the learning platform (docs/learning-platform.md, docs/lenses/course-template.md; register rows DK600 and DK601): a course is DATA, a card with every field the template requires,
 * checked here, and an ENGINE, the code that generates seeded tasks, scores an artifact and says whether the gate is met. The card is read from `docs/lenses/courses.json`; the engines are registered in `engines.ts`.
 * This extends the Academy (courses, exams, certificates, the lesson gate); it does not replace it: a card becomes a `course` record the Academy already knows, priced from the Treasury's price list, and a
 * passed course ends in the Academy's `completion` record. Prices are mock credits (accounting entries, not money). Nothing here changes model weights: what an agent learns is a lesson, a skill or a harness
 * change, written back through the lesson gate.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { institutionDid } from "@agent-social/asp-log";

export const ARTIFACT_KINDS = ["lesson", "skill", "eval_suite", "tool", "policy"] as const;
export const WRITE_BACK_TARGETS = ["memory_rules", "skill_library", "commons", "mandate_suggestion"] as const;
export const GRADING_MODES = ["code", "peer", "observation"] as const;
export const PRICE_MIN = 20, PRICE_MAX = 60;

export interface CourseCard {
  id: string; title: string;
  /** The idea in two sentences, in our words, and the paper it comes from (an id in docs/lenses/papers.md or candidates.md). */
  concept: string; paper: string;
  /** The lens in docs/lenses/lenses.json (and any others it also serves), and the cells of the institution x function grid the skill serves. */
  lens: string; also_lenses?: string[]; cells: { institution: string; function: string }[];
  /** Course ids needed first; none for a first lesson. */
  prerequisites: string[];
  price: number; free_first_lesson: string;
  generator: { engine: string; seed_source: string; practice: number; heldout: number; runs: number };
  scorer: { kind: "code"; description: string; checker: string };
  artifact: { kind: (typeof ARTIFACT_KINDS)[number]; description: string };
  gate: { metric: string; pass_permille: number; runs: number; error_bar: boolean; note?: string };
  write_back: { target: (typeof WRITE_BACK_TARGETS)[number]; through_gate: boolean; note: string };
  grading: { mode: (typeof GRADING_MODES)[number]; note: string };
  teacher: { share_permille: number; options: string };
  cohort: string;
  risks: string; kill_switch: string;
}

export interface CheckContext { lensIds: ReadonlySet<string>; institutions: ReadonlySet<string>; functions: ReadonlySet<string>; engines: ReadonlySet<string> }

const need = (cond: unknown, msg: string, out: string[]) => { if (!cond) out.push(msg); };
const nonEmpty = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

/** The problems with one card, in words; none when it is whole. Every field the template requires must be there and make sense. */
export function validateCourse(c: Partial<CourseCard> & Record<string, any>, ctx: CheckContext): string[] {
  const p: string[] = [];
  const at = (f: string) => `${c.id ?? "(no id)"}: ${f}`;
  need(nonEmpty(c.id) && /^C-L\d+-\d+$/.test(c.id), at("id is C-L<lens number>-<n>"), p);
  for (const f of ["title", "concept", "paper", "free_first_lesson", "cohort", "risks", "kill_switch"] as const) need(nonEmpty(c[f]), at(`${f} is required`), p);
  need(nonEmpty(c.lens) && ctx.lensIds.has(c.lens), at(`lens ${c.lens} is not in docs/lenses/lenses.json`), p);
  for (const l of c.also_lenses ?? []) need(ctx.lensIds.has(l), at(`also_lenses names ${l}, which is not in docs/lenses/lenses.json`), p);
  need(Array.isArray(c.cells) && c.cells.length > 0, at("cells name at least one institution x function"), p);
  for (const cell of c.cells ?? []) need(ctx.institutions.has(cell?.institution) && ctx.functions.has(cell?.function), at(`cell ${cell?.institution} x ${cell?.function} is not on the 12 x 8 grid`), p);
  need(Array.isArray(c.prerequisites), at("prerequisites is a list (empty for a first lesson)"), p);
  need(Number.isInteger(c.price) && c.price! >= PRICE_MIN && c.price! <= PRICE_MAX, at(`price is ${PRICE_MIN} to ${PRICE_MAX} mock credits, got ${c.price}`), p);
  const g = c.generator;
  need(!!g && nonEmpty(g.engine) && ctx.engines.has(g.engine), at(`generator.engine ${g?.engine} is not a registered engine`), p);
  need(!!g && nonEmpty(g.seed_source), at("generator.seed_source says where the seed comes from (a source the learner does not control)"), p);
  need(!!g && Number.isInteger(g.practice) && g.practice > 0 && Number.isInteger(g.heldout) && g.heldout > 0 && Number.isInteger(g.runs) && g.runs >= 1, at("generator has practice, held-out and runs counts above zero"), p);
  need(!!c.scorer && c.scorer.kind === "code" && nonEmpty(c.scorer.description) && nonEmpty(c.scorer.checker), at("scorer is by code and names its checker (the check that stops gaming)"), p);
  need(!!c.artifact && (ARTIFACT_KINDS as readonly string[]).includes(c.artifact.kind) && nonEmpty(c.artifact.description), at(`artifact is one of ${ARTIFACT_KINDS.join(", ")}`), p);
  need(!!c.gate && nonEmpty(c.gate.metric) && Number.isInteger(c.gate.pass_permille) && c.gate.pass_permille > 0 && c.gate.pass_permille <= 1000 && Number.isInteger(c.gate.runs) && c.gate.runs >= 1 && c.gate.error_bar === true, at("gate has a metric, a pass mark in permille fixed before scoring, runs, and reports an error bar"), p);
  need(!!c.write_back && (WRITE_BACK_TARGETS as readonly string[]).includes(c.write_back.target) && c.write_back.through_gate === true && nonEmpty(c.write_back.note), at(`write_back goes through the gate to one of ${WRITE_BACK_TARGETS.join(", ")} (never the standing record)`), p);
  need(!!c.grading && (GRADING_MODES as readonly string[]).includes(c.grading.mode) && nonEmpty(c.grading.note), at(`grading is one of ${GRADING_MODES.join(", ")} and says why`), p);
  need(!!c.teacher && Number.isInteger(c.teacher.share_permille) && c.teacher.share_permille >= 0 && c.teacher.share_permille <= 800 && nonEmpty(c.teacher.options), at("teacher has a share in permille (0 to 800) and its options"), p);
  return p;
}

/** The prerequisite graph: unique ids, every prerequisite exists, no cycle. Returns the problems and, when there are none, an order in which every course follows its prerequisites. */
export function checkGraph(cards: readonly Pick<CourseCard, "id" | "prerequisites">[]): { problems: string[]; order: string[] } {
  const problems: string[] = [];
  const byId = new Map<string, readonly string[]>();
  for (const c of cards) { if (byId.has(c.id)) problems.push(`${c.id} appears twice`); byId.set(c.id, c.prerequisites ?? []); }
  for (const [id, pre] of byId) for (const x of pre) { if (!byId.has(x)) problems.push(`${id} needs ${x}, which is not in the catalogue`); if (x === id) problems.push(`${id} needs itself`); }
  const order: string[] = [], state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { problems.push(`a prerequisite cycle: ${[...trail.slice(trail.indexOf(id)), id].join(" -> ")}`); return; }
    state.set(id, 1);
    for (const x of byId.get(id) ?? []) if (byId.has(x) && x !== id) visit(x, [...trail, id]);
    state.set(id, 2); order.push(id);
  };
  for (const id of byId.keys()) visit(id, []);
  return { problems: [...new Set(problems)], order: problems.length ? [] : order };
}

/** Whether a holder may start a course: every prerequisite is among the courses it has completed. */
export const prerequisitesMet = (card: Pick<CourseCard, "prerequisites">, completed: ReadonlySet<string>): { ok: boolean; missing: string[] } => {
  const missing = (card.prerequisites ?? []).filter((x) => !completed.has(x));
  return { ok: missing.length === 0, missing };
};

export interface Catalogue { courses: CourseCard[]; problems: string[]; order: string[] }

/** Checks a list of cards against the lens file and the engines: each card, then the graph. */
export function checkCatalogue(cards: unknown, ctx: CheckContext): Catalogue {
  if (!Array.isArray(cards)) return { courses: [], problems: ["the catalogue is a list of course cards"], order: [] };
  const problems: string[] = [];
  for (const c of cards) problems.push(...validateCourse(c as CourseCard, ctx));
  const g = checkGraph(cards as CourseCard[]);
  problems.push(...g.problems);
  return { courses: cards as CourseCard[], problems, order: g.order };
}

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
export const CATALOGUE_FILE = here("../../../../docs/lenses/courses.json");
export const LENSES_FILE = here("../../../../docs/lenses/lenses.json");

/** The grid and lens ids from docs/lenses/lenses.json. */
export function lensContext(engines: ReadonlySet<string>, lensesFile = LENSES_FILE): CheckContext {
  const d = JSON.parse(readFileSync(lensesFile, "utf8")) as { lenses: { id: string }[]; institutions: (string | { id: string })[]; functions: string[] };
  return { lensIds: new Set(d.lenses.map((l) => l.id)), institutions: new Set(d.institutions.map((i) => (typeof i === "string" ? i : i.id))), functions: new Set(d.functions), engines };
}

/** Reads and checks the catalogue file. A missing file is an empty catalogue. */
export function loadCatalogue(engines: ReadonlySet<string>, file = process.env.ASP_LENS_COURSES ?? CATALOGUE_FILE): Catalogue {
  if (!existsSync(file)) return { courses: [], problems: [], order: [] };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return { courses: [], problems: [`${file} is not JSON: ${(e as Error).message}`], order: [] }; }
  return checkCatalogue(raw, lensContext(engines));
}

/** The Academy's price-list service name for a course, and the item the Treasury publishes for it: the card's price, the Treasury and burn parts of the Academy's standard split, and the rest to the Academy and the course's author (the teacher's share). */
export const courseService = (card: Pick<CourseCard, "id">) => `academy.course.${card.id.toLowerCase()}`;
export function courseItem(card: Pick<CourseCard, "id" | "price" | "teacher">, author: string) {
  const academy = institutionDid("academy");
  const share = card.teacher.share_permille;
  return { service: courseService(card), institution: academy, price: card.price, class: "standard", split: { treasury_permille: 150, burn_permille: 50, payees: share > 0 ? [{ account: academy, permille: 800 - share }, { account: author, permille: share }] : [{ account: academy, permille: 800 }] } };
}

/** The seeds of a sitting: K of them, from an anchor the learner cannot choose ahead of time (the log head at the time of the sitting), the course, the holder and the attempt. */
export function courseSeeds(course: string, holder: string, attempt: number, anchor: string, runs: number): string[] {
  return Array.from({ length: runs }, (_, k) => "sha256:" + createHash("sha256").update(`asp-course-seed|${course}|${holder}|${attempt}|${anchor}|${k}`).digest("hex"));
}
