/**
 * The project guard for a runtime's pre-call hook script (gaps BM6, BM16). The hooks are plain scripts that run in the run directory, and the guard's one source is gateway/paths.ts, so
 * it is copied there with its types removed (asp-guard.mjs), and the hook loads that. One source means the gateway and the hooks cannot drift apart.
 */
import { stripTypeScriptTypes } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("../gateway/paths.ts", import.meta.url));

/** The guard as plain JavaScript. */
export function guardSource(): string {
  // Node prints an "experimental" warning for stripTypeScriptTypes on every call; a person starting a run does not need to see it.
  const emit = process.emitWarning;
  process.emitWarning = ((w: unknown, ...rest: unknown[]) => {
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
    if (type === "ExperimentalWarning" || (w as { name?: string })?.name === "ExperimentalWarning") return;
    return (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try { return stripTypeScriptTypes(readFileSync(SOURCE, "utf8")); } finally { process.emitWarning = emit; }
}

export function writeGuard(dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, guardSource());
}
