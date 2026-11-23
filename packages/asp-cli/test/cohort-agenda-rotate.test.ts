// Diagnosis fix 4 (section 57): the agenda's rotating line: each time an agent asks, one thing it has not tried is named as a true fact with its payoff and effort (a game, a lesson card, an assessment, a job it could post,
// the field guide), a different one each time, and a thing the agent has used is not named again. Nothing asks for it. Seeded world; scripted calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, TOOLS, untouched } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("one untouched capability is named at each ask, rotating, and a used one is not named again", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-rot-")), expedition: true, games: true, lessons: true });
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    w.api.groups = new Set(["games", "lessons", "expedition", "agenda"]);
    w.api.fieldGuide = { guide: { entries: [], source: "x", refusals: 0, agents: 0, omitted: [] }, offered: () => true } as never;
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const line = async (): Promise<string> => { const raw = (await call("my_agenda")).text; return /something you have not tried: ([^\n]*)/.exec(raw)?.[1] ?? ""; };
    assert.deepEqual(untouched(w.api, a.did).map((x) => x.key), ["games", "lessons", "posting", "guide"], "assess is not named: the run has no assess group");
    const l1 = await line(), l2 = await line(), l3 = await line();
    assert.match(l1, /^a game: four small games .* \(game_list\)$/);
    assert.match(l2, /^a lesson card: .* lesson_read/);
    assert.match(l3, /^a job you could post: the first job you post is free .* \(post_job\)$/);
    assert.equal(new Set([l1, l2, l3]).size, 3, "a different one each time");
    assert.doesNotMatch(l1 + l2 + l3, /you (must|should)|hurry|don't miss/i, "no pressure");
    // what the agent has used is not named again
    await call("game_list");
    await call("lesson_read");
    assert.deepEqual(untouched(w.api, a.did).map((x) => x.key), ["posting", "guide"]);
    await call("inspect", { place: "research-commons" });
    assert.deepEqual(untouched(w.api, a.did).map((x) => x.key), ["posting"]);
    await call("post_job", { purpose: "Count the open jobs on the board and tell me the number", budget: 10, criterion: "a number" });
    assert.deepEqual(untouched(w.api, a.did), []);
    assert.equal(await line(), "", "nothing left to name: no line");
  } finally { await w.close(); }
});
