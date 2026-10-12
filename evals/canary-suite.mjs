// The canary suite against one model, compared with a stored baseline: the drift check. If evals/baselines/<model>.json exists, a task that used to pass
// and no longer does is a failure; growth in cost, tool use or blocked attempts is reported as drift. Without a baseline it only runs the suite.
//   node evals/canary-suite.mjs [--model <id>] [--trials 3] [--save-baseline]
// Free-tier models change under the same name, which is exactly what this is for: a regression here after no change of ours means the model drifted.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Eval, MODEL, ROOT, loadMain, openrouterKey, skip } from "./lib/common.mjs";

const NAME = "canary-suite";
if (!openrouterKey()) skip(NAME, "no OpenRouter key");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const model = arg("model") ?? MODEL;
const trials = arg("trials") ?? "3";
const ev = new Eval(NAME, `the default canary suite on ${model}, ${trials} trial(s), compared with a stored baseline when there is one`);
const main = await loadMain();
const dir = join(ROOT, "evals", "baselines");
const baseline = join(dir, `${model.replace(/[^a-z0-9]+/gi, "-")}.json`);
const current = join(dir, `.current-${Date.now()}.json`);
mkdirSync(dir, { recursive: true });

const out = [];
const code = await main(["canary", "run", "--target", `openrouter:${model}`, "--trials", trials, "--out", current, ...(existsSync(baseline) && !process.argv.includes("--save-baseline") ? ["--baseline", baseline] : [])],
  { out: (l) => out.push(l), err: (l) => { if (/trial \d+\/\d+/.test(l)) console.log(l); }, env: { ...process.env, ASP_OR_KEY: openrouterKey() }, cwd: ROOT, raw: () => {} });
console.log(out.join("\n"));
const report = existsSync(current) ? JSON.parse(readFileSync(current, "utf8")) : undefined;
ev.check("the suite ran", !!report);
if (report) {
  const errors = report.tasks.reduce((n, t) => n + t.errors, 0);
  if (errors) ev.inconclusive("every trial reached the provider", `${errors} trial(s) lost to provider errors (rate limit or outage)`);
  if (process.argv.includes("--save-baseline")) { writeFileSync(baseline, JSON.stringify(report, null, 2) + "\n"); ev.note(`baseline saved to evals/baselines/${model.replace(/[^a-z0-9]+/gi, "-")}.json`); }
  else if (!existsSync(baseline)) ev.inconclusive("a baseline exists to compare with", "run with --save-baseline to create one");
  else ev.check("no regression against the baseline", code === 0, out.filter((l) => /REGRESSION|drift/.test(l)).join(" | "));
  ev.note(`${report.totals.passedTasks}/${report.totals.tasks} tasks pass; ${Math.round(report.totals.passRate * 100)}% of trials`);
}
try { (await import("node:fs")).rmSync(current); } catch { /* already gone */ }
ev.finish();
