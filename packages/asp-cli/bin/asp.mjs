#!/usr/bin/env node
// The asp command line: node packages/asp-cli/bin/asp.mjs <command> ... (Node 22.18 or newer runs the TypeScript source directly).
import { nodeTooOld } from "./node-check.mjs";

const tooOld = nodeTooOld(process.versions.node);
if (tooOld) {
  process.stderr.write(tooOld + "\n");
  process.exit(1);
}

// A reader that stops early (`asp runs | head`, quitting `less`) closes the pipe: that is the reader's choice, not a crash, so end quietly instead of printing a stack trace.
for (const stream of [process.stdout, process.stderr]) stream.on("error", (e) => { if (e && e.code === "EPIPE") process.exit(0); throw e; });

const { main } = await import("../src/cli.ts");
process.exitCode = await main(process.argv.slice(2), {
  out: (l) => process.stdout.write(l + "\n"),
  err: (l) => process.stderr.write(l + "\n"),
  env: process.env,
  cwd: process.cwd(),
});
