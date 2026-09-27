/**
 * A package is normally a directory. For sending it as one file — the whole point of "package" —
 * it can also be a gzipped tar archive (conventionally named *.aspkg.tgz or *.aspkg.tar.gz, but any
 * file, as opposed to a directory, is treated as one). These helpers convert between the two forms.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, extract } from "tar";

/** Packs every entry of `dir` into a gzipped tar file at `archivePath` (portable: no owner/mtime noise). */
export async function packDirectory(dir: string, archivePath: string): Promise<void> {
  await create({ gzip: true, file: archivePath, cwd: dir, portable: true, noMtime: true }, readdirSync(dir));
}

/** Extracts a gzipped tar file into a freshly created temp directory and returns its path. */
export async function unpackToTemp(archivePath: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "asp-pkg-"));
  await extract({ file: archivePath, cwd: dir });
  return dir;
}

export interface ResolvedPackage {
  /** A real directory holding the package's files — the original path, or a temp extraction of the archive. */
  dir: string;
  /** Set when `pkgPath` was an archive, so the resolver knows to repack (or just clean up) afterward. */
  archivePath?: string;
}

/** Resolves a package argument that may be a directory or a single archive file. */
export async function resolvePackage(pkgPath: string): Promise<ResolvedPackage> {
  if (!existsSync(pkgPath)) throw new Error(`no such package: ${pkgPath}`);
  if (statSync(pkgPath).isDirectory()) return { dir: pkgPath };
  return { dir: await unpackToTemp(pkgPath), archivePath: pkgPath };
}

/**
 * Cleans up after `resolvePackage`. `mutated` says whether the resolved directory may have changed
 * (e.g. a signed write-back): if so, and it came from an archive, the archive is rewritten in place
 * before the temp directory is removed. `verify` (which never mutates) can pass `false`.
 */
export async function finishPackage(resolved: ResolvedPackage, mutated: boolean): Promise<void> {
  if (!resolved.archivePath) return;
  if (mutated) await packDirectory(resolved.dir, resolved.archivePath);
  rmSync(resolved.dir, { recursive: true, force: true });
}
