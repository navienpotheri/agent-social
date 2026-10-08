/**
 * An agent's memory as a folder (docs/spec-deltas.md S50): merging what several runs learned, and keeping it within a budget.
 *
 * Merging is three-way. `base` is the memory a run started from, `ours` what it ended with, and `mergedDir` what the package
 * holds now (which may already include other runs' lessons). Nothing is silently overwritten: a MEMORY.md index is merged as
 * the union of its lines, a topic file two runs changed differently is kept side by side, and a removal never deletes a
 * file someone else has changed since.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { listFiles } from "./files.ts";
import { diffTrees } from "./package.ts";

export function copyFileEnsured(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

/** Inserts .<label> before the last extension: foo/bar.md, node2 -> foo/bar.node2.md. */
export function withSuffix(path: string, label: string): string {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash ? `${path.slice(0, dot)}.${label}${path.slice(dot)}` : `${path}.${label}`;
}

/**
 * Merges a memory index file by the union of its lines: every line already at `dest` (or, failing that, the original `base`)
 * is kept, and every non-blank line from `incoming` not already present (by exact trimmed match) is appended.
 * Never drops an existing entry.
 */
export function mergeLineUnion(base: string, incoming: string, dest: string): void {
  const startFrom = existsSync(dest) ? dest : base;
  const destLines = existsSync(startFrom) ? readFileSync(startFrom, "utf8").split("\n") : [];
  const seen = new Set(destLines.map((l) => l.trim()).filter(Boolean));
  for (const line of readFileSync(incoming, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || seen.has(t)) continue;
    destLines.push(line);
    seen.add(t);
  }
  while (destLines.length && destLines.at(-1) === "") destLines.pop();
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, destLines.join("\n") + "\n");
}

const sameFile = (a: string, b: string) => readFileSync(a, "utf8") === readFileSync(b, "utf8");

/**
 * Applies what `oursDir` changed relative to `baseDir` onto `mergedDir`. `who` names the changer ("node 2", "this run") and
 * `label` is the suffix for a file kept side by side (node2 -> shared.node2.md). Returns notes about conflicts.
 */
export function mergeMemoryInto(mergedDir: string, baseDir: string, oursDir: string, who: { name: string; label: string; other: string }): string[] {
  const notes: string[] = [];
  const diff = diffTrees(baseDir, oursDir);
  for (const rel of [...diff.added, ...diff.changed]) {
    const src = join(oursDir, rel);
    const dest = join(mergedDir, rel);
    if (basename(rel) === "MEMORY.md") {
      mergeLineUnion(existsSync(dest) ? dest : join(baseDir, rel), src, dest);
    } else if (!existsSync(dest)) {
      copyFileEnsured(src, dest);
    } else if (!sameFile(dest, src)) {
      const alt = withSuffix(dest, who.label);
      copyFileEnsured(src, alt);
      notes.push(`${who.name}'s ${rel} differs from ${who.other}; kept separately as ${relative(mergedDir, alt)}`);
    }
  }
  for (const rel of diff.removed) {
    const dest = join(mergedDir, rel);
    if (!existsSync(dest)) continue;
    if (existsSync(join(baseDir, rel)) && sameFile(dest, join(baseDir, rel))) rmSync(dest);
    else notes.push(`${who.name} removed ${rel}, but it has changed since; kept`);
  }
  return notes;
}

export interface MemoryBudget {
  /** Most topic files (every file except MEMORY.md indexes). */
  maxFiles: number;
  /** Most bytes across all files. */
  maxBytes: number;
  /** Most lines in a MEMORY.md index. */
  maxIndexLines: number;
}

export const DEFAULT_MEMORY_BUDGET: MemoryBudget = { maxFiles: 200, maxBytes: 1024 * 1024, maxIndexLines: 200 };

export interface BudgetResult {
  /** Topic files removed, least recently changed first. */
  pruned: string[];
  /** Index lines removed (those pointing at pruned files, then the oldest). */
  indexLinesRemoved: number;
  files: number;
  bytes: number;
}

/**
 * Keeps a memory folder within its budget: the least recently changed topic files go first (and the index lines that point at
 * them), then the oldest index lines. Memory only grows otherwise. What was pruned is reported so the lineage update can say so.
 */
export function enforceMemoryBudget(dir: string, budget: MemoryBudget = DEFAULT_MEMORY_BUDGET): BudgetResult {
  const all = () => listFiles(dir).map((rel) => ({ rel, size: statSync(join(dir, rel)).size, mtime: statSync(join(dir, rel)).mtimeMs }));
  const isIndex = (rel: string) => basename(rel) === "MEMORY.md";
  const pruned: string[] = [];
  let indexLinesRemoved = 0;

  const dropFromIndexes = (rel: string) => {
    const name = basename(rel);
    for (const idx of listFiles(dir).filter(isIndex)) {
      const p = join(dir, idx);
      const lines = readFileSync(p, "utf8").split("\n");
      const kept = lines.filter((l) => !l.includes(`](${name})`) && !l.includes(`](${rel.split("\\").join("/")})`));
      if (kept.length !== lines.length) { indexLinesRemoved += lines.length - kept.length; writeFileSync(p, kept.join("\n")); }
    }
  };

  for (;;) {
    const files = all();
    const topics = files.filter((f) => !isIndex(f.rel));
    const bytes = files.reduce((n, f) => n + f.size, 0);
    if (topics.length <= budget.maxFiles && bytes <= budget.maxBytes) break;
    const oldest = [...topics].sort((a, b) => a.mtime - b.mtime || (a.rel < b.rel ? -1 : 1))[0];
    if (!oldest) break; // only indexes left: they are capped below
    rmSync(join(dir, oldest.rel));
    pruned.push(oldest.rel);
    dropFromIndexes(oldest.rel);
  }
  for (const idx of listFiles(dir).filter(isIndex)) {
    const p = join(dir, idx);
    const lines = readFileSync(p, "utf8").split("\n");
    const nonBlank = lines.filter((l) => l.trim());
    if (nonBlank.length > budget.maxIndexLines) {
      const drop = nonBlank.length - budget.maxIndexLines;
      const dropSet = new Set(nonBlank.slice(0, drop)); // the oldest entries are at the top
      indexLinesRemoved += drop;
      writeFileSync(p, lines.filter((l) => !dropSet.has(l)).join("\n"));
    }
  }
  const files = all();
  return { pruned, indexLinesRemoved, files: files.filter((f) => !isIndex(f.rel)).length, bytes: files.reduce((n, f) => n + f.size, 0) };
}
