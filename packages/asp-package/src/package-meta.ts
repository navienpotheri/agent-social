/**
 * What a package says about its agent, without running it (gap U13): who it is for, which runtime and model it was captured from, how big its memory is
 * against the budget, how many skills it carries, and where its lineage stands. Read from the signed manifest and a count of the memory folder, so it
 * can be shown on a screen, and kept beside a package on the service so a listing does not have to unpack every archive.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { listFiles } from "./files.ts";
import { MANIFEST } from "./package.ts";
import { DEFAULT_MEMORY_BUDGET } from "./memory.ts";
import { unpackToTemp } from "./archive.ts";

export interface PackageMeta {
  agent: string;
  runtime?: { name: string; version?: string; model?: string };
  skills: number;
  memory: { files: number; bytes: number; indexLines: number; budget: { maxFiles: number; maxBytes: number; maxIndexLines: number } };
  lineageHead?: string;
  issuedAt?: string;
}

/** Reads the facts out of an unpacked package folder. Throws when it has no manifest. */
export function packageMeta(dir: string): PackageMeta {
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"));
  const b = manifest.body ?? {};
  const mem = join(dir, "memory");
  const files = listFiles(mem);
  const isIndex = (rel: string) => basename(rel) === "MEMORY.md";
  const topics = files.filter((f) => !isIndex(f));
  const bytes = files.reduce((n, f) => n + statSync(join(mem, f)).size, 0);
  const indexLines = Math.max(0, ...files.filter(isIndex).map((f) => readFileSync(join(mem, f), "utf8").split("\n").filter((l) => l.trim()).length));
  return {
    agent: String(b.agent ?? ""),
    ...(b.source_runtime ? { runtime: { name: b.source_runtime.name, ...(b.source_runtime.version ? { version: b.source_runtime.version } : {}), ...(b.source_runtime.model ? { model: b.source_runtime.model } : {}) } } : {}),
    skills: Array.isArray(b.skills) ? b.skills.length : 0,
    memory: { files: topics.length, bytes, indexLines, budget: { ...DEFAULT_MEMORY_BUDGET } },
    ...(b.lineage_head ? { lineageHead: String(b.lineage_head) } : {}),
    ...(manifest.issued_at ? { issuedAt: String(manifest.issued_at) } : {}),
  };
}

/** The meta of a package given as a folder or an archive. */
export async function packageMetaOf(pathToPackage: string): Promise<PackageMeta> {
  if (statSync(pathToPackage).isDirectory()) return packageMeta(pathToPackage);
  const dir = await unpackToTemp(pathToPackage);
  try { return packageMeta(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

export interface FoundPackage { name: string; path: string; updatedAt: string; bytes: number; meta: PackageMeta }

/** Packages in a folder: directories named *.aspkg and archives named *.aspkg.tgz or *.tar.gz. A package that cannot be read is skipped. */
export async function scanPackages(dir: string): Promise<FoundPackage[]> {
  if (!existsSync(dir)) return [];
  const out: FoundPackage[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const isDirPkg = e.isDirectory() && /\.aspkg$/i.test(e.name);
    const isArchive = e.isFile() && /(\.aspkg\.tgz|\.tar\.gz)$/i.test(e.name);
    if (!isDirPkg && !isArchive) continue;
    try {
      const st = statSync(p);
      out.push({ name: e.name.replace(/(\.aspkg\.tgz|\.tar\.gz|\.aspkg)$/i, ""), path: p, updatedAt: st.mtime.toISOString(), bytes: isDirPkg ? listFiles(p).reduce((n, f) => n + statSync(join(p, f)).size, 0) : st.size, meta: await packageMetaOf(p) });
    } catch { /* not a package we can read */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The sidecar the package service keeps beside a stored archive, so a listing needs no unpacking. */
export function writeMetaSidecar(file: string, etag: string, meta: PackageMeta): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file + ".meta.json", JSON.stringify({ etag, meta }));
}
export function readMetaSidecar(file: string, etag: string): PackageMeta | undefined {
  try {
    const s = JSON.parse(readFileSync(file + ".meta.json", "utf8")) as { etag: string; meta: PackageMeta };
    return s.etag === etag ? s.meta : undefined;
  } catch { return undefined; }
}
