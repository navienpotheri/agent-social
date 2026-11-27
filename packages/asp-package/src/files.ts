import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { canonicalBytes } from "@agent-social/asp-core";

export const toPosix = (p: string) => p.split(sep).join("/");

export function sha256File(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/** Every file under dir, as sorted POSIX paths relative to dir. Missing dir → []. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(toPosix(relative(dir, p)));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * sha256 over the canonical JSON list of [{path, sha256}] for every file under dir (or one file).
 * Stable across platforms: POSIX paths, sorted, content hashes only.
 */
export function treeHash(path: string): string {
  if (existsSync(path) && statSync(path).isFile()) return sha256File(path);
  // A memory folder's `private/` subfolder holds sealed private scopes (DK272, D12): they are written during a run, authenticated by their own encryption and never part of the signed manifest, so the
  // package still verifies after a private write. (Only a folder named `memory` is read this way.)
  const isMemory = basename(path.replace(/[\/]+$/, "")) === "memory";
  const entries = listFiles(path).filter((p) => !(isMemory && /^private[\/]/.test(p))).map((p) => ({ path: p, sha256: sha256File(join(path, p)) }));
  return `sha256:${createHash("sha256").update(canonicalBytes(entries)).digest("hex")}`;
}

export function copyInto(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/**
 * A text file a person may have written in Windows PowerShell 5.1, whose `>` and `Out-File` write UTF-16 with a byte-order mark and whose `-Encoding UTF8` writes UTF-8 with one: the mark is read and
 * removed, and UTF-16 is decoded, so a settings file, a TOML or YAML file or a manifest made that way is read, not refused as "unexpected token".
 */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString("utf16le"); }
  const t = buf.toString("utf8");
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}
export const readTextFile = (path: string): string => decodeText(readFileSync(path));

export function readJson<T = any>(path: string): T {
  return JSON.parse(readTextFile(path));
}

export function readJsonIfExists<T = any>(path: string): T | undefined {
  return existsSync(path) ? readJson<T>(path) : undefined;
}
