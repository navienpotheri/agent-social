/**
 * The Clinic's restore (register row DK29; clinic.md CL-9): put an agent's memory back to a chosen good point in its lineage. It is made of what `asp learned undo` already does, applied to every
 * memory change after the chosen point, newest first, so each step is a signed lineage update that names the change it takes back, and nothing is deleted from the history: the package ends with
 * the memory it had at the chosen point, and the record shows how it got there. Layers other than memory (the harness, the backend, an adapter) are not restored here: the plan says which later
 * changes there are, so a person can look at them, and a restore never claims to have restored what it did not.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AspRecord, Signer } from "@agent-social/asp-core";
import { findLesson, listLessons, markReviewed, memoryAfterUndo, planUndo, type Lesson } from "./learned.ts";
import { HISTORY, updatePackage } from "./package.ts";

export interface RestoreStep { lesson: Lesson; files: number; conflicts: string[]; blocked?: string }
export interface RestorePlan {
  /** The chosen good point: a memory change of the agent, named by its edge (or the short form). */
  to: Lesson;
  /** The memory changes made after it that are still in force, newest first: the ones a restore takes back. */
  steps: RestoreStep[];
  /** Later changes in other layers, listed and not restored. */
  otherLayers: { edge: string; layer: string; description: string; at: string }[];
}

/** What a restore to `toEdge` would do, without changing anything. */
export function planRestore(pkg: string, toEdge: string): RestorePlan {
  const to = findLesson(pkg, toEdge);
  // By position in the history, not by time: several changes can share a second. listLessons is newest first, so the newer ones come before the chosen one.
  const all = listLessons(pkg);
  const later = all.slice(0, Math.max(0, all.findIndex((l) => l.edge === to.edge))).filter((l) => !l.undoneBy && !l.reverts);
  const steps: RestoreStep[] = later.map((lesson) => {
    try {
      const p = planUndo(pkg, lesson);
      return { lesson, files: p.restore.length, conflicts: p.conflicts };
    } catch (e) {
      return { lesson, files: 0, conflicts: [], blocked: (e as Error).message };
    }
  });
  const history = existsSync(join(pkg, HISTORY))
    ? readFileSync(join(pkg, HISTORY), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord)
    : [];
  const after = history.slice(history.findIndex((r) => r.id === to.edge) + 1);
  const otherLayers = after
    .filter((r) => r.type === "asp.lineage/v0.2" && (r.body as { edge?: string }).edge === "update")
    .map((r) => ({ edge: r.id, layer: String((r.body as { change?: { layer?: string } }).change?.layer ?? ""), description: String((r.body as { change?: { description?: string } }).change?.description ?? ""), at: r.issued_at }))
    .filter((e) => e.layer && e.layer !== "memory");
  return { to, steps, otherLayers };
}

/**
 * Takes back every memory change after `toEdge`, newest first, each as a signed update that names the change it reverts (the same record `asp learned undo` writes). Refuses to start if a step cannot be
 * taken back automatically (its text was not kept) or a later change touched the same file again since, unless `force`; then nothing has been changed. `after` is told after each step (the CLI syncs the log).
 */
export function runRestore(pkg: string, toEdge: string, signer: Signer, o: { force?: boolean; description?: string; after?: () => void } = {}): { plan: RestorePlan; edges: string[] } {
  const plan = planRestore(pkg, toEdge);
  const blocked = plan.steps.find((s) => s.blocked);
  if (blocked) throw new Error(`${blocked.lesson.short} cannot be taken back automatically (${blocked.blocked}), so the memory cannot be restored to ${plan.to.short} by the Clinic; edit the files by hand with asp learned edit, or choose a later point`);
  const edges: string[] = [];
  for (const step of plan.steps) {
    const lesson = findLesson(pkg, step.lesson.edge); // the state now, after the steps already taken
    const p = planUndo(pkg, lesson);
    if (p.conflicts.length && !o.force) throw new Error(`${p.conflicts.join(", ")} changed again since ${lesson.short}, so restoring would lose that work; ${edges.length ? `${edges.length} step(s) were already taken back and are recorded; ` : ""}look first (asp learned show), or use --force`);
    const dir = memoryAfterUndo(pkg, p);
    try {
      const r = updatePackage(pkg, { signer, memoryFrom: dir, changes: [{ layer: "memory", description: `${o.description ?? "restored by the Clinic"}: took back "${lesson.description.slice(0, 70)}" (${lesson.short}) to return to ${plan.to.short}`, reverts: lesson.edge }] });
      markReviewed(pkg, lesson.edge, "undone");
      edges.push(r.edges[0].id);
      o.after?.();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return { plan, edges };
}
