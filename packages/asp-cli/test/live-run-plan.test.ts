// The owner's runbook for the live run of tonight, 2026-11-22 (docs/live-run-plan.md): every command it tells the owner to type is a documented command (the preflight, still to be built, is the one named exception),
// every file it links exists, every row it names is a register row, and it keeps the key out of the repository and states the cost cap, the stop command and the results template.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const plan = read("docs/live-run-plan.md");

test("every command in the plan is documented, (the preflight and the report included)", () => {
  const commands = read("docs/commands.md");
  const typed = [...plan.matchAll(/npm run asp -- ([a-z]+(?: [a-z]+)?)/g)].map((m) => m[1]!);
  assert.ok(typed.length >= 10);
  const pending = new Set<string>();
  for (const c of new Set(typed)) {
    if (pending.has(c)) continue;
    const first = c.split(" ")[0]!;
    assert.ok(commands.includes(`\`asp ${first}`) || commands.includes(`asp ${c}`), `asp ${c} is a documented command`);
  }
});

test("the links exist, the rows are register rows, and the safety statements are there", () => {
  for (const m of plan.matchAll(/\]\(([^)#]+)\)/g)) { const t = m[1]!; if (!/^https?:/.test(t)) assert.ok(existsSync(new URL(`docs/${t}`, root)), `${t} exists`); }
  const register = read("docs/gaps-register.md");
  for (const id of ["T15", "T22", "DK650", "P21", "E5", "DK1364", "DK1600", "DK1602", "DK1604", "T2", "T3", "T4", "DK1342", "DK1347"]) assert.match(register, new RegExp(`^\| ${id} \|`, "m"), `${id} is a register row`);
  assert.match(plan, /never written to the repository, never sent to the service/);
  assert.match(plan, /USD 5 an agent for each run/);
  assert.match(plan, /asp -- stop --all/);
  assert.match(plan, /results template/i);
  assert.match(plan, /Credits are mock accounting entries, not money/);
  assert.doesNotMatch(plan, /sk-[A-Za-z0-9]{20,}/, "no key is written in the plan");
});

test("every flag the runbook tells the owner to type exists in the CLI's own help (`asp help all`)", async () => {
  const { main } = await import("../src/cli.ts");
  const out: string[] = [];
  await main(["help", "all"], { out: (l: string) => out.push(l), err() {}, env: {}, cwd: process.cwd() } as never);
  const help = out.join("\n") + "\n" + read("docs/commands.md") + "\n" + read("docs/run-cost.md");
  const missing: string[] = [];
  for (const line of plan.split("\n")) {
    for (const m of line.matchAll(/npm run asp -- ([^`\n]+)/g)) {
      const cmd = m[1]!.split("#")[0]!;
      for (const f of cmd.matchAll(/(?:^|\s)(--[a-z][a-z-]*)/g)) if (!help.includes(f[1]!)) missing.push(`${f[1]} in: asp ${cmd.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("every flag in the runbook is an option that the command line parser knows", () => {
  const src = read("packages/asp-cli/src/cli.ts");
  const unknown: string[] = [];
  for (const m of plan.matchAll(/npm run asp -- ([^`\n]+)/g)) {
    for (const f of m[1]!.split("#")[0]!.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) {
      const name = f[1]!;
      const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      if (!(src.includes(`"${name}": {`) || src.includes(`  ${name}: {`) || src.includes(`  ${camel}: {`))) unknown.push(name);
    }
  }
  assert.deepEqual([...new Set(unknown)], []);
});

test("the plan makes the rehearsal script the first step and the script exists", () => {
  assert.match(plan, /First step of the evening: the rehearsal/);
  assert.match(plan, /evening-rehearsal\.ps1/);
  assert.match(plan, /Green looks like/);
  assert.ok(existsSync(new URL("scripts/evening-rehearsal.ps1", root)));
});
