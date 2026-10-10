// Stands in for the `codex` CLI in tests: records its arguments, then writes a note into the memory
// directory it was given with --add-dir, like an agent following its memory instructions.
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const mem = args[args.indexOf("--add-dir") + 1];
if (process.env.FAKE_CODEX_ARGS) writeFileSync(process.env.FAKE_CODEX_ARGS, JSON.stringify(args));
if (process.env.FAKE_CODEX_LEARN !== "0") {
  writeFileSync(join(mem, "auto", "codex-sandbox.md"), "---\nname: codex-sandbox\n---\nRun pnpm install before tests in the Codex sandbox.\n");
  appendFileSync(join(mem, "auto", "MEMORY.md"), "- [Codex sandbox](codex-sandbox.md) — install first\n");
}
process.exit(Number(process.env.FAKE_CODEX_EXIT ?? 0));
