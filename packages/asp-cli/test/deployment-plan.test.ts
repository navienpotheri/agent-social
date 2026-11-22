// docs/deployment-plan.md is the owner's ordered plan for deploying the hosted service after the live run. Its commands are checked like the other kits (every `npm run asp --` and `asp.mjs` command is a documented command and
// every flag is one the CLI knows), the files, scripts, units and flags that it names exist in the repository, every one of the 19 owner-only rows of the launch bar is settled by a step that exists, every step
// has its check and its way back, the decisions come first with a default each, and the standing statements are kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const plan = read("docs/deployment-plan.md");

test("every asp command in the plan is a documented command, and every flag is in the CLI's help and its parser", async () => {
  const { main } = await import("../src/cli.ts");
  const out: string[] = [];
  await main(["help", "all"], { out: (l: string) => out.push(l), err() {}, env: {}, cwd: process.cwd() } as never);
  const help = out.join("\n") + "\n" + read("docs/commands.md");
  const src = read("packages/asp-cli/src/cli.ts");
  const commands: string[] = [];
  for (const m of plan.matchAll(/(?:npm run asp -- |asp\.mjs )([^`\n]+)/g)) commands.push(m[1]!.split("#")[0]!.trim());
  assert.ok(commands.length >= 20, `${commands.length} commands`);
  const problems: string[] = [];
  for (const cmd of commands) {
    const first = cmd.split(" ")[0]!;
    if (!first || first.startsWith("<") || first.startsWith("-") || first === "...") continue;
    if (!(help.includes(`asp ${first}`) || help.includes(`\`asp ${first}`))) problems.push(`asp ${first} is not documented`);
    for (const f of cmd.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) {
      const name = f[1]!;
      const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      if (!help.includes(`--${name}`)) problems.push(`--${name} (in: ${cmd.slice(0, 50)}) is not in the help`);
      else if (!(src.includes(`"${name}": {`) || src.includes(`  ${name}: {`) || src.includes(`  ${camel}: {`))) problems.push(`--${name} is not an option of the parser`);
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test("the files, scripts, units and flags that the plan names exist", () => {
  for (const m of plan.matchAll(/\]\(([^)#]+)\)/g)) { const t = m[1]!; if (!/^https?:/.test(t)) assert.ok(existsSync(new URL(`docs/${t}`, root)), `${t} exists`); }
  assert.ok(existsSync(new URL("scripts/smoke-serve.mjs", root)));
  // Every script that a command in the plan runs is a file of the repository (on the server the repository is at /opt/asp).
  const scripts = [...plan.matchAll(/(?:node|bash) (?:\/opt\/asp\/)?((?:scripts|docs\/deploy)\/[A-Za-z0-9_./-]+)/g)].map((m) => m[1]!);
  assert.ok(scripts.length >= 3, `${scripts.length} scripts named`);
  for (const s of new Set(scripts)) assert.ok(existsSync(new URL(s, root)), `${s} exists`);
  const setup = read("docs/deploy/setup-server.sh");
  for (const piece of ["asp-log.service", "asp-monitor.service", "/usr/local/bin/asp-backup", "$ETC/deployed-commit", "--forum-open", "BRANCH", "DOMAIN", "asp.env", "is-active asp-log asp-monitor postgresql caddy"]) assert.ok(setup.includes(piece), `setup-server.sh has ${piece}`);
  assert.ok(existsSync(new URL("docs/deploy/restore-drill.sh", root)));
  // The traps of step 5 are real variables of the script, and the drill takes a file as its argument.
  for (const v of ["SIGNUP_DAILY_CAP", "MAIL_FROM", "MAIL_OPERATOR", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "DOMAIN", "BRANCH"]) { assert.ok(setup.includes(v), `setup-server.sh has ${v}`); assert.ok(plan.includes(v), `the plan names ${v}`); }
  assert.match(setup, /SIGNUP_DAILY_CAP:-100/, "the script's default cap is the 100 that the plan warns about");
  assert.match(read("docs/deploy/restore-drill.sh"), /restore-drill\.sh \[backup-file\]/);
  assert.match(plan, /restore-drill\.sh \/root\/asp-/);
  assert.match(read("docs/deploy/restore-drill.sh"), /DRILL PASSED/);
  assert.match(read("docs/deploy/README.md"), /sending through Resend/);
  assert.match(read("docs/live-check-kit.md"), /asp-run-v0\.1/);
});

test("every owner-only row of the launch bar is settled by a step that exists, once", () => {
  const bar = JSON.parse(read("docs/launch-bar.json")) as { entries: { id: string; bucket: string; flags: string }[] };
  const ids = bar.entries.filter((e) => e.bucket === "must" && e.flags.includes("O")).map((e) => e.id).sort();
  const section = plan.slice(plan.indexOf("## 14."), plan.indexOf("## 15."));
  const cells = [...section.matchAll(/([A-Z]+\d+) \| (\d+)/g)].map((m) => [m[1]!, Number(m[2])] as const);
  const mapped = cells.map((c) => c[0]).sort();
  assert.deepEqual(mapped, ids, "the table lists exactly the owner-only rows of the launch bar");
  for (const [id, step] of cells) assert.ok(step >= 1 && step <= 13, `${id}: step ${step} exists`);
});

test("every step has its way in, its check and its way back; the steps run from 1 to 13 in order; the decisions come first with a default each", () => {
  const heads = [...plan.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(heads, Array.from({ length: 16 }, (_, i) => i), "the sections are numbered in order, from 0 to 15");
  const steps = plan.slice(plan.indexOf("## 1. "), plan.indexOf("## 14."));
  for (let n = 1; n <= 12; n++) {
    const start = steps.indexOf(`## ${n}. `);
    const body = steps.slice(start, steps.indexOf(`## ${n + 1}. `, start + 5));
    for (const label of ["**Do.**", "**Right.**", "**If not.**", "**Rollback.**", "*Settles:*"]) assert.ok(body.includes(label), `step ${n} has ${label}`);
  }
  const decisions = plan.slice(plan.indexOf("## 0. "), plan.indexOf("## 1. "));
  assert.equal([...decisions.matchAll(/^\| \d+ \| /gm)].length, 9, "nine decisions");
  assert.match(decisions, /\| Decision \| Default \|/);
  assert.ok(plan.indexOf("## 0. ") < plan.indexOf("## 1. "));
});

test("the order protects the service: the restore point, the encryption check, the backup drill and the monitor come before the update, which comes before the first record is written", () => {
  const at = (h: string) => plan.indexOf(h);
  assert.ok(at("## 1. A restore point") < at("## 2. ") && at("## 3. The backup bucket") < at("## 4. The outside monitor") && at("## 4. The outside monitor") < at("## 5. Update the code") && at("## 5. Update the code") < at("## 6. The operator"));
  assert.match(plan, /A signed adoption cannot be undone/);
  assert.match(plan, /do not go on to step 5 until it passes/);
  assert.match(plan, /the monitor must be up first/);
});

test("the plan keeps the standing statements and no worker touches the live service", () => {
  assert.match(plan, /Credits are mock accounting entries, not money/);
  assert.match(plan, /The service is a beta/);
  assert.match(plan, /There has been no outside security review/);
  assert.match(plan, /No worker runs any of it, touches the live service, holds a key or creates an account/);
  assert.doesNotMatch(plan, /sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY/);
});

test("the decisions are also questions for the owner, with the plan named as the source", () => {
  const questions = read("docs/owner-questions-all.md").split("## Answered, no action")[0]!;
  assert.match(questions, /Deployment: nine decisions[\s\S]*deployment-plan\.md/);
});

test("step 12 makes the house agent with the command that exists, and says who may make one", () => {
  const step = plan.slice(plan.indexOf("## 12. "), plan.indexOf("## 13. "));
  assert.ok(step.includes('npm run asp -- house create house-one --purpose'), "the command");
  assert.match(step, /signed by the operator's key as sponsor/);
  assert.match(step, /label is permanent/);
  assert.doesNotMatch(step, /No command marks an identity as a house agent/);
  assert.match(read("docs/commands.md"), /`asp house create <name>/);
});
