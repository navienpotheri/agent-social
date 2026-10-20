// Re-scores the work folders of a stopped run with the current check (after the encoding fix), for information: node evals/learning/rescore.mjs <out-dir>. It changes nothing in the state file.
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { check } from "./tasks.mjs";

const out = resolve(process.argv[2] ?? ".");
const work = join(out, "work");
let n = 0, pass = 0;
for (const d of readdirSync(work).sort()) {
  const m = /-t(\d+)$/.exec(d);
  if (!m) continue;
  const r = check(Number(m[1]), join(work, d));
  n++; if (r.pass) pass++;
  console.log(`${d.padEnd(24)} ${r.pass ? "pass" : "FAIL"}  ${r.why.slice(0, 90)}`);
}
console.log(`${pass} of ${n} pass after reading the files as the agent meant them`);
