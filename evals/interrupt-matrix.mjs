// One program for the interruption cases (docs/testing-map.md section 24): runs every automated case for a session being interrupted and prints the flow table
// (stage of the session x action of the person or the agent) with what passed. The live cases (the real tool) are listed as to-do; run them by hand and put the date in the map.
//
//   node evals/interrupt-matrix.mjs
import { spawnSync } from "node:child_process";

const FILES = ["packages/asp-cli/test/run-interrupt.test.ts", "packages/asp-cli/test/run-interrupt-approval.test.ts"];
const CELLS = [
  ["agent working or running a command", "Ctrl-C", "run-interrupt.test.ts", /Ctrl-C in the middle of a session/],
  ["agent working or running a command", "process killed outright (reads as interrupted)", "run-interrupt.test.ts", /Ctrl-C in the middle of a session/],
  ["a call held for approval", "Ctrl-C, terminal closed (SIGHUP), SIGTERM", "run-interrupt-approval.test.ts", /held for approval/],
];
const r = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...FILES], { encoding: "utf8" });
const out = (r.stdout ?? "") + (r.stderr ?? "");
console.log("Stage of the session".padEnd(38) + "Action".padEnd(50) + "Result");
for (const [stage, action, , pat] of CELLS) {
  const line = out.split("\n").find((l) => /^[✔✖]/.test(l) && pat.test(l));
  console.log(stage.padEnd(38) + action.padEnd(50) + (line ? (line.startsWith("✔") ? "pass" : "FAIL") : "not run"));
}
console.log("\nNot yet automated or live (see the map): starting, hooked runtimes, interactive sessions, two terminals, macOS and Linux.");
process.exit(r.status === 0 ? 0 : 1);
