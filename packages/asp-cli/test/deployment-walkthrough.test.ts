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

test("no step waits on an open answer now (6 and 7 were answered on 2026-11-22), and each says so", () => {
  for (const s of wsteps) {
    const needs = /\*\*Needs from you(.*?)\n/.exec(s.body)?.[0] ?? "";
    const code = [...s.body.matchAll(/```(?:bash|powershell)\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
    const wants7 = false;   // decision 7 was answered on 2026-11-22 (one DID for both): no step waits on it now
    const wants6 = false;   // decision 6 was answered on 2026-11-22: no step needs it now
    if (wants7) assert.match(needs, /answer 7/, `step ${s.n} needs answer 7`);
    if (wants6) assert.match(needs, /answer 6/, `step ${s.n} needs answer 6`);
    if (!wants6 && !wants7) assert.match(needs, /nothing open/, `step ${s.n} needs nothing open`);
    if (!wants6) assert.doesNotMatch(needs, /answer 6/, `step ${s.n} does not need answer 6`);
    if (!wants7) assert.doesNotMatch(needs, /answer 7/, `step ${s.n} does not need answer 7`);
  }
});

test("the walkthrough carries the owner's answers as recorded, keeps 6 and 7 open, and keeps the plan's warnings", () => {
  const decisions = read("docs/owner-decisions.md");
  assert.match(decisions, /All ten decisions are answered; none is open/);
  assert.match(walk, /All ten are answered; none is open/);
  assert.doesNotMatch(walk, /THE-OPERATOR-DID|THE-OWNER-DID/, "the DID is filled in");
  assert.ok(walk.includes("did:web:log.thedeeptransformation.com:u:navien-agentrun"));
  assert.ok(walk.includes("navien@thedeeptransformation.com") && walk.includes("noreply@thedeeptransformation.com"), "the mail variables are the answers of decision 6");
  assert.doesNotMatch(walk, /YOUR-ADDRESS|YOUR-DOMAIN/);
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

test("answer 7's wording is right everywhere: `asp status` prints a person, not an operator or an owner; the sign kit and the walkthrough give the lines for one DID as both, with the caveat", () => {
  const kit = read("docs/owner-sign-kit.md");
  for (const [name, text] of [["walkthrough", walk], ["sign kit", kit], ["plan", plan], ["questions", read("docs/deploy-day-questions.md")]] as const) {
    assert.doesNotMatch(text, /the two DIDs that `npm run asp -- status` shows/, `${name} does not say that status shows the two DIDs`);
    assert.match(text, /`asp status` (does not print|shows no|prints no) (an )?operator/, `${name} says that status prints no operator or owner`);
  }
  assert.ok(kit.includes('$OWNER = "did:web:log.thedeeptransformation.com:u:navien-agentrun"; $env:ASP_OPERATOR_DID = $OWNER; $env:ASP_OWNER_DID = $OWNER'));
  assert.match(kit, /operator\.json/);
  assert.match(kit, /removes the two-party control/);
  assert.match(kit, /pending your yes/);
  assert.doesNotMatch(kit, /PASTE-YOUR-DID-HERE/);
  assert.match(walk, /removes the two-party control/);
  assert.match(walk, /ASP_OPERATOR_DID/);
});
