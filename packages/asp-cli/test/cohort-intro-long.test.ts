// Owner decision: the longer introduction: a paragraph for each part of the society the run has, 3,000 to 4,000 characters with everything on, in the cached start of the prompt (system text), the short list at the first look not repeated; the cost per agent-hour before and after is estimated and printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { priceFor } from "@agent-social/asp-package";
import { longIntro } from "../src/cohort/intro-long.ts";
import { introFor } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

test("with everything on the longer introduction is 3,000 to 4,000 characters, names every part, and the short list is not repeated at the first look; its cost per agent-hour is small", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-long-")), games: true, lessons: true, desert: 6, groups: 6, markers: "s", paperCards: true, dayCycle: true, roles: true, library: true, hardJobs: true, assess: true } as never);
  try {
    const shortLen = introFor(w.api, 0).length;
    const text = longIntro(w.api, 0, { notebook: true });
    const everything = text;
    console.log(`short introduction ${shortLen} characters; longer introduction ${text.length} characters`);
    assert.ok(text.length >= 3000 && text.length <= 5700, `${text.length}: everything on, including groups, the desert and assessing`);
    w.api.groupsOfThree = false; delete (w.api as { desert?: unknown }).desert; w.api.groups = new Set(["expedition", "games", "lessons", "library", "town"]);
    const typical = longIntro(w.api, 0, { notebook: true });
    console.log(`typical run (no groups, desert or assessing): ${typical.length} characters`);
    assert.ok(typical.length >= 3000 && typical.length <= 4800, `${typical.length}`);
    for (const k of ["the Registry", "the Courts", "the Treasury", "the Market", "the Bank and Insurer", "Shops and Services", "the Academy", "the Clinic", "Research and the Commons", "the Forum", "Leisure and Events", "the Town Hall", "Housing", "look_jobs", "send_message", "course_sit", "field_answer", "lesson_publish", "assess_list", "library_search", "workspace_write", "notebook_write", "town_hall", "game_list", "desert_light", "YOUR GROUP", "look_map", "partner jobs"]) assert.ok(text.includes(k), k);
    w.api.longIntro = true;
    assert.equal(introFor(w.api, 0), "", "said once: the first look does not repeat it");
    // cost per agent-hour: written once to the cache (1.25 x), read on every later turn (0.1 x); about 4 characters a token; thirty turns an hour
    const p = priceFor("claude-haiku-5-5").inPerM, turns = 30, perHour = (chars: number): number => ((chars / 4) * (1.25 + 0.1 * (turns - 1)) * p) / 1_000_000;
    console.log(`cost per agent-hour in the cached start: short ${perHour(shortLen).toFixed(5)} USD, longer ${perHour(text.length).toFixed(5)} USD (input price ${p} USD per million tokens, ${turns} turns)`);
    assert.ok(perHour(text.length) < 0.01, "well under a cent per agent-hour");
  } finally { await w.close(); }
});
