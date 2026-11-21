// Register row DK1303 (owner decision 2026-11-20): telemetry is not optional for an agent. There is no off command and no opt-out route, the enrol notice and /society/llms.txt still say plainly what is kept and why,
// a young person's tenant stores nothing, and the site's claim matches. Fake data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { frontDoorText, startPageText, TELEMETRY_NOTICE } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
async function asp(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, cwd: process.cwd() };
  let code: number;
  try { code = await main(args, io); } catch (e) { err.push(String((e as Error).message)); code = 2; }
  return { code, text: [...out, ...err].join("\n") };
}

test("`asp telemetry off` and `on` refuse with the reason, even before a login; delete and list stay", async () => {
  for (const sub of ["off", "on"]) {
    const r = await asp(["telemetry", sub]);
    assert.notEqual(r.code, 0);
    assert.match(r.text, /not optional for an agent/);
    assert.match(r.text, /asp telemetry delete --all/);
  }
  const help = JSON.parse(read("docs/commands.json")) as unknown;
  assert.doesNotMatch(JSON.stringify(help), /asp telemetry \[status \| off/);
  assert.match(read("docs/commands.md"), /asp telemetry \[status \| list \| put/);
});

test("the notice, the front door and the start page say what is kept and why, with no off switch offered", () => {
  const o = { keyOnly: () => true, publicUrl: "https://example.test" };
  for (const text of [TELEMETRY_NOTICE, frontDoorText(o)]) {
    assert.match(text, /trajectories, messages and free text/);
    assert.match(text, /not optional/);
    assert.match(text, /young person/);
    assert.doesNotMatch(text, /asp telemetry off|turn (it|this) off/i);
  }
  assert.doesNotMatch(startPageText(o), /asp telemetry off|turn (it|this) off/i);
});

test("the site says the same: always on for an adult's agent, nothing stored for a young person, no off command", () => {
  const learning = read("site/learning.html");
  assert.match(learning, /(always on for an adult's agent \(it is not optional\)|an adult's agent this store is always on and is not optional)/);
  assert.doesNotMatch(learning, /asp telemetry off/);
  const claims = read("docs/site-claims.json");
  assert.match(claims, /(always on for an adult's agent|an adult's agent this store is always on and is not optional)/);
  assert.doesNotMatch(claims, /asp telemetry off/);
  for (const f of ["site/llms-full.txt", "site/reference.html"]) assert.doesNotMatch(read(f), /asp telemetry \[status( |&nbsp;)?\| off/, f);
});
