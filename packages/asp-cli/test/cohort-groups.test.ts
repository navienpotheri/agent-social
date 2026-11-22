// Row ENG66: opt-in tool groups. The tool list is paid for on every turn, so the groups not every agent needs (the tour and markers, the games, the Town Hall, the library and workspace) are offered only when the run
// turns them on; the core is always offered; a tool that is not offered says so plainly; the report states the size of the list with each group on and off as a measured figure; and the list is fixed for the whole
// run, which keeps the cached prefix stable between turns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GROUP_FLAG, GROUP_OF, offeredTools, runTool, toolListChars, TOOLS } from "../src/cohort/tools.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const names = (g: string[]): string[] => offeredTools(new Set(g)).map((t) => t.name);

test("the core is always offered, each group adds exactly its own tools, and the sizes are measured", () => {
  const core = names([]);
  for (const t of ["forum_read", "forum_post", "look_jobs", "offer_on_job", "deliver_job", "course_enrol", "course_sit", "send_message", "my_inbox", "look_map", "my_balance", "unlock", "my_progress", "catch_up", "suggest", "stop_exploring"]) assert.ok(core.includes(t), `${t} is core`);
  assert.ok(core.every((n) => !GROUP_OF[n]), "no tool of a group is in the core");
  assert.deepEqual(Object.keys(GROUP_FLAG).sort(), ["expedition", "games", "library", "town"]);
  for (const g of Object.keys(GROUP_FLAG)) {
    const added = names([g]).filter((n) => !core.includes(n));
    assert.ok(added.length >= 3 || g === "expedition", `${g} adds tools`);
    assert.deepEqual(added.sort(), Object.entries(GROUP_OF).filter(([, v]) => v === g).map(([k]) => k).sort(), `${g} adds exactly its tools`);
  }
  assert.equal(offeredTools().length, TOOLS.length, "no groups given: every tool");
  const coreChars = toolListChars(offeredTools(new Set())), allChars = toolListChars(TOOLS);
  assert.ok(coreChars < allChars * 0.75, `the core is ${coreChars} of ${allChars} characters`);
  console.log(`tool list: core ${offeredTools(new Set()).length} tools ${coreChars} characters; all ${TOOLS.length} tools ${allChars} characters (${Math.round((1 - coreChars / allChars) * 100)} percent saved)`);
});

test("a tool of a group that is off says so plainly, names the switch and lists what the agent has; with the group on it works", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-groups-")) });
  try {
    const a = await w.enrol(0, "agent-01");
    await w.api.market!.enrolStandalone(a);
    w.api.groups = new Set<string>();
    const off = await runTool(w.api, a, all, "game_list", {});
    assert.equal(off.ok, false);
    assert.equal(off.refused, "tool_not_in_set");
    assert.match(off.text, /^Refused \(tool_not_in_set\): game_list is not offered in this run: the games tools are switched on by the people who run it \(--games\)\. The tools you have: /);
    assert.doesNotMatch(off.text, /game_enter|town_vote|library_read/, "the list is the core");
    assert.match((await runTool(w.api, a, all, "workspace_write", { name: "x", text: "y" })).text, /the library tools are switched on by the people who run it \(--library\)/);
    assert.equal((await runTool(w.api, a, all, "my_balance", {})).ok, true, "the core works");
    w.api.groups = new Set(["library"]);
    assert.equal((await runTool(w.api, a, all, "workspace_write", { name: "note", text: "y" })).ok, true, "the group is on");
    assert.equal((await runTool(w.api, a, all, "game_list", {})).refused, "tool_not_in_set", "the others stay off");
  } finally { await w.close(); }
});

const opts = (extra: Partial<CohortOptions>): CohortOptions => ({
  out: mkdtempSync(join(tmpdir(), "asp-groups-out-")), home: mkdtempSync(join(tmpdir(), "asp-groups-home-")), agents: 1, model: "stand-in",
  provider: standInProvider(() => "toured", { latencyMs: 3 }), budgetUsd: 2, totalUsd: 2, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 40, io: { out: () => undefined }, ...extra,
} as CohortOptions);

test("a run offers the groups its flags turn on, the trace and the report state the size of the list with each group on and off, and the same list is offered on every turn", async () => {
  const off = await runCohort(opts({}));
  const on = await runCohort(opts({ expedition: true, games: true }));
  const start = (r: { dir: string }) => JSON.parse(readFileSync(join(r.dir, "trace.jsonl"), "utf8").split("\n")[0]!) as { tools: string[]; toolGroups: string[]; toolChars: number; toolCharsCore: number; toolCharsAll: number };
  const s0 = start(off), s1 = start(on);
  assert.deepEqual(s0.toolGroups, []);
  assert.deepEqual(s1.toolGroups.sort(), ["expedition", "games"]);
  assert.ok(!s0.tools.includes("inspect") && !s0.tools.includes("game_list"), "off: not offered");
  assert.ok(s1.tools.includes("inspect") && s1.tools.includes("game_list") && !s1.tools.includes("town_hall"), "on: offered, and the others still not");
  assert.equal(s0.toolChars, s0.toolCharsCore);
  assert.ok(s1.toolChars > s0.toolChars && s1.toolChars < s1.toolCharsAll);
  const md = readFileSync(off.markdownPath, "utf8");
  assert.match(md, new RegExp(`The tool list: ${s0.tools.length} tools, ${s0.toolChars} characters, sent with every call and cached\\. The groups switched on: none\\. The core alone is ${s0.toolCharsCore} characters and every group ${s0.toolCharsAll}: a measured size of the list, not a promise about cost\\.`));
  assert.match(readFileSync(on.markdownPath, "utf8"), /The groups switched on: (expedition, games|games, expedition)\./);
  // the agent that walks the tour without the flag is told plainly, not left to guess
  const refused = readFileSync(join(off.dir, "trace.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t === "tool" && e.tool === "inspect");
  assert.ok(refused.length >= 1 && refused.every((e) => e.ok === false && e.refused === "tool_not_in_set"));
});
