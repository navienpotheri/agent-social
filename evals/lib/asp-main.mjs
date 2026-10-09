// One asp command per process (the CLI keeps per-call state at module level, so concurrent callers must not share a process).
import { loadMain } from "./common.mjs";
const main = await loadMain();
process.exitCode = await main(process.argv.slice(2), {
  out: (l) => process.stdout.write(l + "\n"),
  err: (l) => process.stderr.write(l + "\n"),
  env: process.env,
  cwd: process.env.ASP_CWD ?? process.cwd(),
});
