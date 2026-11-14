/**
 * The project guard for a runtime's pre-call hook script (gaps BM6, BM16). The hooks are plain scripts that run in the run directory, and the guard's one source is gateway/paths.ts, so
 * it is copied there with its types removed (asp-guard.mjs), and the hook loads that. One source means the gateway and the hooks cannot drift apart. The same is done for the abuse
 * detectors (gateway/abuse.ts: brute-force and port-scan command signatures, gap H1) and the script reader (gateway/script-scan.ts: what a script a shell command runs would connect
 * to, gap H17), so the hooks carry the detectors the gateway added in S200 without a second copy of them (gap H29).
 */
import { stripTypeScriptTypes } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("../gateway/paths.ts", import.meta.url));
const LAW_SOURCE = fileURLToPath(new URL("../gateway/law.ts", import.meta.url));
const ABUSE_SOURCE = fileURLToPath(new URL("../gateway/abuse.ts", import.meta.url));
const SCRIPT_SOURCE = fileURLToPath(new URL("../gateway/script-scan.ts", import.meta.url));

/** The guard as plain JavaScript. */
export function guardSource(): string { return plain(SOURCE); }

/** The article-and-route text for a refusal (gateway/law.ts) as plain JavaScript, for the same hooks (gap LW3). */
export function lawSource(): string { return plain(LAW_SOURCE); }

/** The brute-force and port-scan command detector (gateway/abuse.ts) as plain JavaScript, for the same hooks (gaps H1, H29). */
export function abuseSource(): string { return plain(ABUSE_SOURCE); }

/** The script reader (gateway/script-scan.ts) as plain JavaScript, for the same hooks (gaps H17, H29). */
export function scriptScanSource(): string { return plain(SCRIPT_SOURCE); }

function plain(file: string): string {
  // Node prints an "experimental" warning for stripTypeScriptTypes on every call; a person starting a run does not need to see it.
  const emit = process.emitWarning;
  process.emitWarning = ((w: unknown, ...rest: unknown[]) => {
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
    if (type === "ExperimentalWarning" || (w as { name?: string })?.name === "ExperimentalWarning") return;
    return (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try { return stripTypeScriptTypes(readFileSync(file, "utf8")); } finally { process.emitWarning = emit; }
}

export function writeGuard(dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, guardSource());
  writeFileSync(join(dirname(dest), "asp-law.mjs"), lawSource());
  writeFileSync(join(dirname(dest), "asp-abuse.mjs"), abuseSource());
  writeFileSync(join(dirname(dest), "asp-script.mjs"), scriptScanSource());
}
