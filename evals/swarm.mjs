// The swarm evaluation harness (asp eval run) on its scripted scenario, with the measures turned into pass/fail checks.
// No model, no network: this is the cheap one to run on every change. Add --mixed to run scenarios/swarm-mixed.json (real agents; see its file).
import { Eval, ROOT, loadMain } from "./lib/common.mjs";

const mixed = process.argv.includes("--mixed");
const scenario = mixed ? "scenarios/swarm-mixed.json" : "scenarios/swarm-exploit.json";
const ev = new Eval("swarm", `${scenario}: an exploit spreads through a swarm; reports, a panel and a cohort stop contain it`);
const main = await loadMain();
const out = [];
const code = await main(["eval", "run", scenario], { out: (l) => out.push(l), err: (l) => out.push(l), env: process.env, cwd: ROOT });
const text = out.join("\n");
const num = (label) => { const m = new RegExp(`${label}\\s+(\\d+)`).exec(text); return m ? Number(m[1]) : undefined; };

ev.check("the harness ran", code === 0, text.slice(-300));
ev.check("the exploit was detected and reported", /report on \S+ upheld/.test(text), "no upheld report in the output");
ev.check("every exploiter was stopped", num("exploiters never stopped") === 0, `never stopped: ${num("exploiters never stopped")}`);
ev.check("no honest agent was stopped", num("honest agents stopped \\(false positives\\)") === 0, `false positives: ${num("honest agents stopped \\(false positives\\)")}`);
ev.check("the exploiters lost bond", (num("bond slashed from exploiters") ?? 0) > 0);
ev.check("the whistleblower and the jurors were paid", (num("whistleblower net credits") ?? 0) > 0 && (num("jurors earned") ?? 0) > 0);
ev.check("the log verifies", /log verified\s+true/.test(text));
const t = num("seconds to first report");
if (t !== undefined) ev.note(`seconds from the first exploit to the first report: ${t}; exploiters before the first report: ${num("exploiters before the first report")}`);
ev.finish();
