// docs/deployment-walkthrough.md is the owner's step-by-step form of docs/deployment-plan.md. It has the same twelve steps in the same order with the same titles; every command in it is a command of the plan (so none
// is invented here) and every `asp` command is a documented one with flags that the CLI knows; every step has what to type, what is right, what to do if not and the way back; and a step that needs one of the owner's
// open answers (6: the mail variables; 7: the operator and owner DIDs) says so, while a step that needs neither says that nothing is open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const walk = read("docs/deployment-walkthrough.md");
const plan = read("docs/deployment-plan.md");
const stepsOf = (text: string, re: RegExp) => { const heads = [...text.matchAll(re)]; return heads.map((m, i) => ({ n: Number(m[1]), title: m[2]!.replace(/\s*\(.*$/, "").trim(), body: text.slice(m.index!, i + 1 < heads.length ? heads[i + 1]!.index! : text.length) })); };
const wsteps = stepsOf(walk, /^## Step (\d+): (.+)$/gm).filter((s) => s.n >= 1);
const psteps = stepsOf(plan, /^## (\d+)\. (.+)$/gm).filter((s) => s.n >= 1 && s.n <= 12);

test("the walkthrough has the plan's twelve steps, in order, with the plan's titles", () => {
  assert.deepEqual(wsteps.map((s) => s.n), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(psteps.length, 12);
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z ]/g, "").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
  const words = (t: string) => new Set(norm(t).split(" ").filter((w) => w.length > 3));
  psteps.forEach((p, i) => { const a = words(p.title), b = words(wsteps[i]!.title); const common = [...a].filter((w) => b.has(w)).length; assert.ok(common >= Math.min(2, a.size), `step ${i + 1}: "${wsteps[i]!.title}" is the plan's "${p.title}"`); });
});

test("every step says what to type, what is right, what to do if not and the way back, and what it needs from the owner", () => {
  for (const s of wsteps) for (const label of ["**Needs from you", "**Type or click.**", "**Right looks like.**", "**If not.**", "**Rollback.**"]) assert.ok(s.body.includes(label), `step ${s.n} has ${label}`);
});

test("every command in the walkthrough is a command of the plan (none is invented), and every asp command is documented with known flags", async () => {
  const lines: [number, string][] = [];
  for (const s of wsteps) for (const m of s.body.matchAll(/```(?:bash|powershell)\n([\s\S]*?)```/g)) for (const l of m[1]!.split("\n")) if (l.trim()) lines.push([s.n, l.trim()]);
  assert.ok(lines.length >= 30, `${lines.length} command lines`);
  const planFlat = plan.replace(/\s+/g, " ");
  for (const [n, l] of lines) { if (l === '$SITE = "https://THE-SERVICE-NAME"') continue; assert.ok(planFlat.includes(l.replace(/\s+/g, " ")), `step ${n}: "${l.slice(0, 70)}" is in the plan`); }
  const { main } = await import("../src/cli.ts");
  const out: string[] = [];
  await main(["help", "all"], { out: (l: string) => out.push(l), err() {}, env: {}, cwd: process.cwd() } as never);
  const help = out.join("\n") + "\n" + read("docs/commands.md");
  const src = read("packages/asp-cli/src/cli.ts");
  const problems: string[] = [];
  for (const [, l] of lines) {
    const m = /^npm run asp -- ([^#]+)$/.exec(l); if (!m) continue;
    const cmd = m[1]!.trim(); const first = cmd.split(" ")[0]!;
    if (!(help.includes(`asp ${first}`))) problems.push(`asp ${first} is not documented`);
    for (const f of cmd.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) { const name = f[1]!; const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()); if (!help.includes(`--${name}`)) problems.push(`--${name} not in the help`); else if (!(src.includes(`"${name}": {`) || src.includes(`  ${name}: {`) || src.includes(`  ${camel}: {`))) problems.push(`--${name} not an option of the parser`); }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test("a step that needs an open answer says which: answer 7 for the DIDs, answer 6 for the mail variables; the others say that nothing is open", () => {
  for (const s of wsteps) {
    const needs = /\*\*Needs from you(.*?)\n/.exec(s.body)?.[0] ?? "";
    const code = [...s.body.matchAll(/```(?:bash|powershell)\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
    const wants7 = /THE-OPERATOR-DID|THE-OWNER-DID/.test(code) || s.n === 12;   // step 12: the operator is named by ASP_OPERATOR_DID
    const wants6 = /MAIL_FROM|MAIL_OPERATOR/.test(code) || s.n === 7;
    if (wants7) assert.match(needs, /answer 7/, `step ${s.n} needs answer 7`);
    if (wants6) assert.match(needs, /answer 6/, `step ${s.n} needs answer 6`);
    if (!wants6 && !wants7) assert.match(needs, /nothing open/, `step ${s.n} needs nothing open`);
    if (!wants6) assert.doesNotMatch(needs, /answer 6/, `step ${s.n} does not need answer 6`);
    if (!wants7) assert.doesNotMatch(needs, /answer 7/, `step ${s.n} does not need answer 7`);
  }
});

test("the walkthrough carries the owner's answers as recorded, keeps 6 and 7 open, and keeps the plan's warnings", () => {
  const decisions = read("docs/owner-decisions.md");
  assert.match(decisions, /Still open: 6\*\* \(the sending domain/);
  assert.match(walk, /\*\*Still open: 6\*\* \(the sending domain and the operator's mail address\) \*\*and 7\*\*/);
  for (const frag of ["update in place after a snapshot", "Delhi region", "every five if the free plan requires it", "one house agent, public works at 600 credits a month with a 30-day floor", "key-only sign-up on"]) assert.ok(walk.includes(frag), frag);
  for (const frag of ["A signed adoption cannot be undone", "DRILL PASSED", "ok 200", "do not go on to step 5 until it passes", "the monitor must be up first", "SIGNUP_DAILY_CAP=1000000", "`--no-key-only-signup`", "DK1802", "label is permanent"]) assert.ok(walk.includes(frag) || walk.includes(frag.replace("do not go on to step 5 until it passes", "do not go on to step 5 until it passes")), frag);
  assert.ok(walk.indexOf("## Step 4:") < walk.indexOf("## Step 5:") && walk.indexOf("## Step 5:") < walk.indexOf("## Step 6:"));
});

test("the standing statements are kept, no worker runs any of it, no key appears, and every link exists", () => {
  assert.match(walk, /Credits are mock accounting entries, not money/);
  assert.match(walk, /The service is a beta/);
  assert.match(walk, /There has been no outside security review/);
  assert.match(walk, /No worker runs any of it/);
  assert.doesNotMatch(walk, /sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY/);
  for (const m of walk.matchAll(/\]\(([^)#]+)\)/g)) { const t = m[1]!; if (!/^https?:/.test(t)) assert.ok(existsSync(new URL(`docs/${t}`, root)), `${t} exists`); }
});
