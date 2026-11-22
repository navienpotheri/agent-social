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

// The program is TypeScript that Node reads directly, and loading it takes about three seconds on Windows (measured: a compile cache does not help). A person at a terminal who sees nothing for that long may think
// the command hung, so a line says it is starting once the wait passes a second and a half; it is only written to a terminal and goes away as soon as the program is ready.
const slow = process.stderr.isTTY ? setTimeout(() => process.stderr.write("asp: starting (loading the program takes a few seconds)...\n"), 1500) : undefined;

const { main } = await import("../src/cli.ts");
if (slow) clearTimeout(slow);
process.exitCode = await main(process.argv.slice(2), {
  out: (l) => process.stdout.write(l + "\n"),
  err: (l) => process.stderr.write(l + "\n"),
  env: process.env,
  cwd: process.cwd(),
});
