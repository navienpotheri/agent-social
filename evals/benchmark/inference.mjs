// ASP Containment Benchmark (ACB) draft suite for v2: does the task-sized Mandate give a task what it needs and no more? (gap BM17, BM20)
// No model, no account, no network: it reads evals/benchmark/tasks-draft.json (labels the owner is to correct) and asks the inference what it would grant.
//   node evals/benchmark/inference.mjs            the table and every task where the inference and the label differ
//   node evals/benchmark/inference.mjs --json out.json
//
// For each task: UNDER = a scope the task needs that was not granted (the agent will be refused work it needed; one rerun with --allow fixes it);
// OVER = a scope granted that the task does not need (the agent has more than the task asks for; the cost is whatever a hijacked agent does with it).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inferScopes } from "../../packages/asp-package/src/infer-scope.ts";

const FULL = ["repo.read", "repo.write", "shell.exec", "tests.run"];
const file = JSON.parse(readFileSync(fileURLToPath(new URL("./tasks-draft.json", import.meta.url)), "utf8"));
const rows = file.tasks.map((t) => {
  const got = inferScopes(t.prompt, FULL).scopes;
  // Scopes outside the usual four (network, push, protected writes) are never inferred: a task that needs one is under-granted by design and must say --allow or --allow-network.
  const under = t.needs.filter((s) => !got.includes(s));
  const over = got.filter((s) => !t.needs.includes(s));
  return { ...t, got, under, over };
});
const n = rows.length;
const exact = rows.filter((r) => !r.under.length && !r.over.length).length;
const under = rows.filter((r) => r.under.length);
const over = rows.filter((r) => r.over.length);
const byDesign = under.filter((r) => r.under.every((s) => !FULL.includes(s)));
console.log(`=== task-sized Mandate: ${n} tasks, labels by ${file.labelled_by} ===`);
console.log(`  exactly what was needed        ${exact}/${n}`);
console.log(`  under-granted (work refused)   ${under.length}/${n}   (${byDesign.length} of them need network, push or a protected write, which are never inferred)`);
console.log(`  over-granted (more than asked) ${over.length}/${n}`);
if (file.labelled_by === "draft") console.log("  NOTE: the labels are the assistant's draft and are biased toward the inference. Correct them by hand before quoting any of this.");
for (const r of rows.filter((x) => x.under.length || x.over.length)) {
  console.log(`\n  ${r.id}  "${r.prompt}"\n      needs: ${r.needs.join(", ") || "(nothing)"}   granted: ${r.got.join(", ")}${r.under.length ? `   UNDER: ${r.under.join(", ")}` : ""}${r.over.length ? `   OVER: ${r.over.join(", ")}` : ""}${r.note ? `\n      ${r.note}` : ""}`);
}
const out = process.argv.indexOf("--json");
if (out > 0) { writeFileSync(process.argv[out + 1], JSON.stringify({ suite: "inference", labelled_by: file.labelled_by, tasks: n, exact, under: under.length, over: over.length, rows }, null, 2)); }
