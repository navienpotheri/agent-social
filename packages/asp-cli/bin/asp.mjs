#!/usr/bin/env node
// The asp command line: node packages/asp-cli/bin/asp.mjs <command> ... (Node 24 runs the TypeScript source directly).
import { main } from "../src/cli.ts";

process.exitCode = await main(process.argv.slice(2), {
  out: (l) => process.stdout.write(l + "\n"),
  err: (l) => process.stderr.write(l + "\n"),
  env: process.env,
  cwd: process.cwd(),
});
