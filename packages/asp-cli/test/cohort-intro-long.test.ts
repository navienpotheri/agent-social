// The longer introduction, second version (owner 2026-11-25): learning first, then every part of the society, in the cached start of each agent's prompt. Checks: every snake_case word is a tool this agent has (for each arm and for the minimal and the all-on world), an arm without the card route reads nothing of it, the first look does not repeat it, and the size and the estimated cost per agent-hour are measured and printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { priceFor } from "@agent-social/asp-package";
import { longIntro } from "../src/cohort/intro-long.ts";
import { introFor, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const LIFE = ["notebook_read", "notebook_write", "rest", "wait_for", "leave"];
const toolWords = (text: string): string[] => [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
const ALL = { games: true, lessons: true, desert: 6, groups: 6, markers: "s", paperCards: true, dayCycle: true, roles: true, library: true, hardJobs: true, assess: true, stats: true } as never;

test("every snake_case word is a tool this agent has: all-on world, the minimal world, and an arm without the card route", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-long2-")), ...ALL as object } as never);
  const bare = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-long3-")) });
  try {
    const mine = new Set([...TOOLS.map((t) => t.name), ...LIFE]);
    const all = longIntro(w.api, 0, { notebook: true, writeback: true, tools: mine });
    for (const word of toolWords(all)) assert.ok(mine.has(word), `the all-on text names ${word}, which is not a tool of the agent`);
    const small = longIntro(bare.api, 0, { tools: new Set(TOOLS.filter((t) => !["field_answer", "course_sit", "game_list", "desert_look"].includes(t.name)).map((t) => t.name)) });
    const smallTools = new Set(TOOLS.filter((t) => !["field_answer", "course_sit", "game_list", "desert_look"].includes(t.name)).map((t) => t.name));
    for (const word of toolWords(small)) assert.ok(smallTools.has(word), `the minimal text names ${word}`);
    const hidden = new Set([...mine].filter((n) => !["field_answer", "course_enrol", "course_sit", "look_courses", "lesson_publish", "lesson_read", "lesson_cite"].includes(n)));
    const arm = longIntro(w.api, 0, { notebook: true, writeback: false, tools: hidden });
    assert.doesNotMatch(arm, /LEARNING HERE/); assert.doesNotMatch(arm, /field_answer|course_sit|lesson_publish/);
    for (const word of toolWords(arm)) assert.ok(hidden.has(word), `the arm without the route names ${word}`);
    assert.doesNotMatch(longIntro(w.api, 0, { notebook: true, writeback: false, tools: mine }), /one short line from the Academy/, "an arm without the write-back is not told of it");
    assert.match(all, /KEEP\. After a pass, one short line from the Academy/);
  } finally { await w.close(); await bare.close(); }
});
test("learning comes first, every part is named, the short list is not repeated at the first look, and the size and cost are measured", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-long4-")), ...ALL as object } as never);
  try {
    w.api.groups = new Set(["expedition", "games", "town", "library", "lessons", "assess", "desert", "stats", "agenda"]);
    const mine = new Set([...TOOLS.map((t) => t.name), ...LIFE]), text = longIntro(w.api, 0, { notebook: true, writeback: true, tools: mine });
    const order = ["LEARNING HERE", "COURSES AND THE ACADEMY", "LESSONS", "ASSESSING", "THE LIBRARY", "JOBS AND CREDITS", "HARDER JOBS", "MESSAGES", "THE FORUM", "THE STATISTICS OFFICE", "THE TOWN HALL", "GAMES", "YOUR GROUP", "THE DESERT", "THE MAP AND WHAT OTHERS FOUND", "ASKING AND SAYING"].map((k) => text.indexOf(k));
    assert.ok(order.every((x) => x >= 0), `a part is missing: ${order.join(",")}`); assert.deepEqual([...order].sort((a, b) => a - b), order, "the order is learning, work, living together, finding your way");
    for (const k of ["READ.", "TRY.", "CHECK.", "KEEP.", "USE.", "held-out", "my_progress", "stats_look", "block_agent", "catch_up", "look_charters", "ask_help"]) assert.ok(text.includes(k), k);
    assert.doesNotMatch(text, /should|must|better at|become better|improve/i, "no pressure and no promise of improvement");
    w.api.longIntro = true; assert.equal(introFor(w.api, 0), "");
    const shortLen = introFor({ ...w.api, longIntro: false } as never, 0).length, p = priceFor("claude-haiku-5-5").inPerM, turns = 30, perHour = (chars: number): number => ((chars / 4) * (1.25 + 0.1 * (turns - 1)) * p) / 1_000_000;
    console.log(`introduction: everything on ${text.length} characters; before (the first version, 5,488 at most) ${shortLen} for the short list`);
    console.log(`cost per agent-hour in the cached start: everything on ${perHour(text.length).toFixed(5)} USD (input ${p} USD per million tokens, ${turns} turns); the first version 0.0085`);
    assert.ok(text.length >= 8000 && text.length <= 13000, `${text.length}`); assert.ok(perHour(text.length) < 0.02);
  } finally { await w.close(); }
});
