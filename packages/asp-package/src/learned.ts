/**
 * What an agent learned, and what its principal can do about it (gap D10, docs/continual-learning-loop.md section 4): every memory change a package has had, what it added, changed and removed,
 * and Keep, Undo and Edit. The record of each change is kept by `updatePackage` in the package's `learned/` folder (text before and after); the lineage edge in the signed history is the
 * authority that the change happened, and the folder says what it was. A change made before this existed has the edge and no text, and is listed as such: it can be kept, not undone.
 *
 * Review state (kept, undone, edited) is the principal's own and is not signed: it is a note in `learned/review.json`. Undo and edit are changes to memory like any other, so each is a new signed
 * lineage `update` edge (undo names the edge it rolls back in `reverts`), never a rewrite of history.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { AspRecord } from "@agent-social/asp-core";
import { readJson, writeJson } from "./files.ts";
import { HISTORY, type LessonFile } from "./package.ts";

export type Review = "kept" | "undone" | "edited";
export interface Lesson {
  /** The lineage edge's id, and a short form of it that a person can type. */
  edge: string; short: string;
  at: string; description: string;
  /** Absent for a change made before the text was kept. */
  files?: LessonFile[];
  review?: { state: Review; at: string };
  /** The edge that rolled this one back, if one did. */
  undoneBy?: string;
  /** Set when this change is itself a roll-back: the edge it rolled back. */
  reverts?: string;
}

const dirOf = (pkg: string) => join(pkg, "learned");
const fileFor = (pkg: string, edge: string) => join(dirOf(pkg), `${edge.replace(/[^A-Za-z0-9]/g, "-")}.json`);
const reviewPath = (pkg: string) => join(dirOf(pkg), "review.json");
const shortOf = (edge: string) => edge.replace(/^sha256:/, "").slice(0, 8);
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function readReview(pkg: string): Record<string, { state: Review; at: string }> {
  try { return JSON.parse(readFileSync(reviewPath(pkg), "utf8")); } catch { return {}; }
}

/** Every memory change in the package's history, newest first. */
export function listLessons(pkg: string): Lesson[] {
  if (!existsSync(join(pkg, HISTORY))) return [];
  const history = readFileSync(join(pkg, HISTORY), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord);
  const edges = history.filter((r) => r.type === "asp.lineage/v0.2" && (r.body as any).edge === "update" && (r.body as any).change?.layer === "memory");
  const reverted = new Map<string, string>();
  for (const e of edges) { const r = (e.body as any).change?.reverts; if (r) reverted.set(r, e.id); }
  const review = readReview(pkg);
  return edges.map((e) => {
    const rec = existsSync(fileFor(pkg, e.id)) ? (readJson(fileFor(pkg, e.id)) as { files: LessonFile[] }) : undefined;
    return {
      edge: e.id, short: shortOf(e.id), at: e.issued_at, description: String((e.body as any).change.description),
      ...(rec ? { files: rec.files } : {}), ...(review[e.id] ? { review: review[e.id] } : {}), ...(reverted.has(e.id) ? { undoneBy: reverted.get(e.id)! } : {}), ...((e.body as any).change?.reverts ? { reverts: String((e.body as any).change.reverts) } : {}),
    };
  }).reverse();
}

/** The one lesson an id (or the start of one) names. */
export function findLesson(pkg: string, id: string): Lesson {
  const all = listLessons(pkg);
  const hit = all.filter((l) => l.edge === id || l.short.startsWith(id.replace(/^sha256:/, "")) || l.edge.startsWith(id));
  if (!id) throw new Error("name a change: asp learned lists them, with their ids");
  if (!hit.length) throw new Error(`no memory change starts with ${id}; asp learned lists them`);
  if (hit.length > 1) throw new Error(`${id} matches ${hit.length} changes; give more characters`);
  return hit[0];
}

/** A line diff of one file, small enough to read: the lines taken out with `-`, the lines put in with `+`. */
export function fileDiff(f: LessonFile, maxLines = 40): string[] {
  if (!f.kept) return ["  (the text was not kept: a binary file or a long one)"];
  const a = (f.before ?? "").split("\n"), b = (f.after ?? "").split("\n");
  if (f.before === undefined) a.length = 0;
  if (f.after === undefined) b.length = 0;
  const inB = new Set(b), inA = new Set(a);
  const out = [...a.filter((l) => !inB.has(l) && l !== "").map((l) => `  - ${l}`), ...b.filter((l) => !inA.has(l) && l !== "").map((l) => `  + ${l}`)];
  return out.length > maxLines ? [...out.slice(0, maxLines), `  ... ${out.length - maxLines} more line(s)`] : out;
}

/** Records the principal's review of a change: kept. */
export function markReviewed(pkg: string, edge: string, state: Review, now: Date = new Date()): void {
  mkdirSync(dirOf(pkg), { recursive: true });
  writeJson(reviewPath(pkg), { ...readReview(pkg), [edge]: { state, at: stamp(now) } });
}

export interface UndoPlan {
  lesson: Lesson;
  /** Files that will be put back as they were. */
  restore: { path: string; before?: string }[];
  /** Files the change touched that have been changed again since: undoing would lose that later work. */
  conflicts: string[];
}

/** What undoing a change would do to the memory as it is now. */
export function planUndo(pkg: string, lesson: Lesson): UndoPlan {
  if (!lesson.files) throw new Error("the text of this change was not kept (it was made before asp learned existed), so it cannot be taken back automatically; edit the file by hand with asp learned edit");
  if (lesson.undoneBy) throw new Error(`this change was already rolled back (${shortOf(lesson.undoneBy)})`);
  const restore: UndoPlan["restore"] = [], conflicts: string[] = [];
  for (const f of lesson.files) {
    if (!f.kept) throw new Error(`${f.path} is a binary or long file whose text was not kept, so this change cannot be taken back automatically`);
    const now = existsSync(join(pkg, "memory", f.path)) ? readFileSync(join(pkg, "memory", f.path), "utf8") : undefined;
    if (now !== f.after) conflicts.push(f.path);
    restore.push({ path: f.path, ...(f.before !== undefined ? { before: f.before } : {}) });
  }
  return { lesson, restore, conflicts };
}

const inside = (root: string, p: string) => { const r = resolve(root, p); return r === resolve(root) || r.startsWith(resolve(root) + sep) ? r : undefined; };

/** A copy of the package's memory with the plan's files put back (or removed, if the change added them): the directory to hand to `updatePackage` as `memoryFrom`. The caller removes it. */
export function memoryAfterUndo(pkg: string, plan: UndoPlan): string {
  const dir = mkdtempSync(join(tmpdir(), "asp-undo-"));
  if (existsSync(join(pkg, "memory"))) cpSync(join(pkg, "memory"), dir, { recursive: true });
  for (const r of plan.restore) {
    const to = inside(dir, r.path);
    if (!to) throw new Error(`${r.path} is outside the memory folder`);
    if (r.before === undefined) rmSync(to, { force: true });
    else { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, r.before); }
  }
  return dir;
}

/** A copy of the package's memory with one file replaced by the principal's text: the directory to hand to `updatePackage`. */
export function memoryAfterEdit(pkg: string, file: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "asp-edit-"));
  if (existsSync(join(pkg, "memory"))) cpSync(join(pkg, "memory"), dir, { recursive: true });
  const to = inside(dir, file);
  if (!to || resolve(to) === resolve(dir)) throw new Error(`${file} is not a file in the memory folder`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, text);
  return dir;
}

/** One line for a list: what changed, in words. */
export function summarize(l: Lesson): string {
  if (!l.files) return "no detail kept (made before asp learned)";
  const added = l.files.filter((f) => f.before === undefined && f.after !== undefined).length, removed = l.files.filter((f) => f.after === undefined && f.before !== undefined).length;
  const changed = l.files.length - added - removed;
  return [added && `${added} added`, changed && `${changed} changed`, removed && `${removed} removed`].filter(Boolean).join(", ") + `: ${l.files.map((f) => f.path).slice(0, 4).join(", ")}${l.files.length > 4 ? ", ..." : ""}`;
}
