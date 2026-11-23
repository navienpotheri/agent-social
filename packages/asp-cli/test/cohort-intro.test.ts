// Owner decision (A): the introduction is clear in the first two turns: the first observation and the first agenda say, in plain lines with the tool names, what this run's society has; only what the run turned on; under 1,200 characters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { introFor, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("the first look and the first agenda carry the introduction, naming only what the run has; it is under 1,200 characters", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-intro-")), games: true, lessons: true } as never);
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    const intro = introFor(w.api, a.n);
    console.log(`introduction: ${intro.length} characters`);
    assert.ok(intro.length < 1200, `${intro.length}`);
    for (const k of ["game_list", "game_enter", "lesson_publish", "assess_list", "post_job", "look_courses"]) assert.ok(intro.includes(k), k);
    assert.match((await runTool(w.api, a, all, "look_map", {})).text, /What this society has, all of it optional/);
    assert.match((await runTool(w.api, a, all, "my_agenda", {})).text, /What this society has, all of it optional/);
    assert.doesNotMatch((await runTool(w.api, a, all, "my_agenda", {})).text, /What this society has/, "said once");
    const bare = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-intro2-")) });
    try { assert.doesNotMatch(introFor(bare.api, 0), /game_list|lesson_publish|research-commons/, "only what the run has"); } finally { await bare.close(); }
  } finally { await w.close(); }
});
