/**
 * The lens matrix (docs/institutions/lenses.md; register row DK78). Reads docs/lenses/lenses.json and writes docs/lenses/matrix.md: lenses down, institutions across, each cell the functions the lens lights up there.
 * `coverageProblems` is the check: every lens has its fields, every cell names a known institution and function, and every institution spec lists the lenses it serves (a "Lenses served:" line) matching the cells.
 * Run with `npm run lenses`; a test fails when matrix.md is out of date or an institution spec serves no lens.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Lens {
  id: string; title: string; sources: { cite: string; claim: string }[]; core_claim: string;
  cells: { institution: string; function: string; hook: string }[];
  interventions: string[]; measures: string[]; experiment: string; assets: { name: string; licence: string; status: string }[]; risks: string[]; kill_switch: string; signals: string[];
}
export interface LensData { version: number; glossary?: Record<string, string>; functions: string[]; institutions: { id: string; spec: string }[]; lenses: Lens[] }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHORT: Record<string, string> = { perceive: "P", remember: "M", reflect: "R", plan: "Pl", act: "A", transact: "T", learn: "L", teach: "Te" };

/** The matrix as Markdown: one row per lens, one column per institution, each cell the function codes the lens lights up there. */
export function matrixOf(d: LensData): string {
  const head = `| Lens | ${d.institutions.map((i) => i.id).join(" | ")} |`;
  const rule = `|---|${d.institutions.map(() => "---").join("|")}|`;
  const rows = d.lenses.map((l) => `| ${l.id} | ${d.institutions.map((i) => [...new Set(l.cells.filter((c) => c.institution === i.id).map((c) => SHORT[c.function] ?? c.function))].join(" ")).join(" | ")} |`);
  const served = d.institutions.map((i) => `| ${i.id} | ${d.lenses.filter((l) => l.cells.some((c) => c.institution === i.id)).map((l) => l.id).join(", ") || "**none**"} |`);
  return [
    "# The lens matrix", "",
    "**Generated** from `docs/lenses/lenses.json` by `npm run lenses` (conformance/generate-lens-matrix.ts). Do not edit by hand. Register row DK78; framework in [lenses.md](../institutions/lenses.md).", "",
    `Functions: ${d.functions.map((f) => `${SHORT[f]} = ${f}`).join(", ")}. A cell lists the functions a lens lights up in an institution.`, "",
    ...(d.glossary ? ["## What the functions mean", "", "The owner's meanings (2026-11-13); a lens lights a cell only when its mechanism honestly fits the institution and the function.", "", ...d.functions.map((f) => `- **${f}**: ${d.glossary?.[f] ?? ""}`), ""] : []),
    head, rule, ...rows, "",
    "## Lenses served by each institution", "",
    "| Institution | Lenses served |", "|---|---|", ...served, "",
    "## Institution by function: which lenses light each cell", "",
    "Each cell lists the lens numbers (L8 = L8-memory-consolidation and so on) that name that institution and function; a dash means no lens lights the cell yet.", "",
    `| Institution | ${d.functions.join(" | ")} |`, `|---|${d.functions.map(() => "---").join("|")}|`,
    ...d.institutions.map((i) => `| ${i.id} | ${d.functions.map((f) => d.lenses.filter((l) => l.cells.some((c) => c.institution === i.id && c.function === f)).map((l) => l.id.split("-")[0]).join(" ") || "-").join(" | ")} |`), "",
  ].join("\n");
}

const REQUIRED: (keyof Lens)[] = ["id", "title", "sources", "core_claim", "cells", "interventions", "measures", "experiment", "assets", "risks", "kill_switch", "signals"];

/** Every problem the coverage check finds: a lens missing a field, a cell naming an unknown institution or function, an institution that no lens serves, a spec that does not list the lenses it serves, or one that lists the wrong ones. */
export function coverageProblems(d: LensData, readSpec: (path: string) => string | undefined): string[] {
  const out: string[] = [];
  if (d.lenses.length < 6) out.push(`only ${d.lenses.length} lenses: at least six are written`);
  const ids = new Set(d.lenses.map((l) => l.id));
  if (ids.size !== d.lenses.length) out.push("a lens id is used twice");
  for (const l of d.lenses) {
    for (const k of REQUIRED) { const v = l[k]; if (v === undefined || v === "" || (Array.isArray(v) && k !== "assets" && k !== "signals" && !v.length)) out.push(`${l.id}: ${k} is empty`); }
    for (const s of l.sources) if (!s.cite || !s.claim) out.push(`${l.id}: a source lacks its citation or its claim`);
    for (const c of l.cells) {
      if (!d.institutions.some((i) => i.id === c.institution)) out.push(`${l.id}: cell names an unknown institution ${c.institution}`);
      if (!d.functions.includes(c.function)) out.push(`${l.id}: cell names an unknown function ${c.function}`);
      if (!c.hook) out.push(`${l.id}: a cell in ${c.institution} has no hook`);
    }
    for (const a of l.assets) if (!a.licence) out.push(`${l.id}: asset ${a.name} has no licence statement`);
  }
  for (const inst of d.institutions) {
    const serves = d.lenses.filter((l) => l.cells.some((c) => c.institution === inst.id)).map((l) => l.id);
    if (!serves.length) { out.push(`${inst.id}: no lens is served by this institution`); continue; }
    const spec = readSpec(inst.spec);
    if (spec === undefined) { out.push(`${inst.id}: the spec ${inst.spec} does not exist`); continue; }
    const line = /^\*\*Lenses served:\*\*\s*(.+)$/m.exec(spec)?.[1];
    if (!line) { out.push(`${inst.id}: ${inst.spec} does not say which lenses it serves (a "**Lenses served:** ..." line)`); continue; }
    const listed = line.split(/[,;]/).map((x) => x.trim().replace(/\.$/, "").split(" ")[0]).filter(Boolean);
    for (const id of listed) if (!ids.has(id)) out.push(`${inst.id}: ${inst.spec} names ${id}, which is not a lens`);
    for (const id of serves) if (!listed.includes(id)) out.push(`${inst.id}: ${inst.spec} does not list ${id}, which the matrix says it serves`);
    for (const id of listed) if (ids.has(id) && !serves.includes(id)) out.push(`${inst.id}: ${inst.spec} lists ${id}, but the lens has no cell here`);
  }
  return out;
}

export const loadLenses = (): LensData => JSON.parse(readFileSync(join(ROOT, "docs/lenses/lenses.json"), "utf8")) as LensData;
export const readSpecFile = (p: string): string | undefined => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return undefined; } };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const d = loadLenses();
  const problems = coverageProblems(d, readSpecFile);
  writeFileSync(join(ROOT, "docs/lenses/matrix.md"), matrixOf(d));
  console.log(`wrote docs/lenses/matrix.md (${d.lenses.length} lenses, ${d.institutions.length} institutions)`);
  if (problems.length) { for (const p of problems) console.error(`  ${p}`); process.exitCode = 1; }
}
