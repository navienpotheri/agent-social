// G2: assigned groups of three. Agents 1 to 3, 4 to 6 and so on; the introduction and the agenda say who the group is and what needs three; one house message names the others; the group's progress is in its open items; the report counts the groups that finished.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupHandles, renderGroups } from "../src/cohort/groups.ts";
import { introFor, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("groups are assigned by number; the last may be short", () => {
  assert.deepEqual(groupHandles(7, 0), ["agent-01", "agent-02", "agent-03"]);
  assert.deepEqual(groupHandles(7, 4), ["agent-04", "agent-05", "agent-06"]);
  assert.deepEqual(groupHandles(7, 6), ["agent-07"]);
});
test("the introduction and the agenda name the group and what needs three, one house message names the others, progress shows in open items, the report counts finished groups", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-g3-")), groups: 4, desert: 4 });
  try {
    const ag = [] as Awaited<ReturnType<typeof w.enrol>>[];
    for (let i = 0; i < 4; i++) { const a = await w.enrol(i, `agent-0${i + 1}`); await w.api.market!.enrolStandalone(a); ag.push(a); }
    const call = (i: number, n: string, inp: Record<string, unknown> = {}) => runTool(w.api, ag[i]!, all, n, inp);
    assert.match(introFor(w.api, 1), /Your group \(assigned by number.*\): agent-02, agent-01, agent-03\. What needs more than one of you: the desert crossing needs three of you to light the three beacons \(desert_look\); partner jobs need two of you/);
    const first = (await call(0, "look_map")).text;
    assert.match(first, /What needs more than one of you/);
    const inbox = (await call(0, "my_inbox")).text;
    assert.match(inbox, /You are in a group of three with agent-02 and agent-03: send_message to either reaches them/);
    assert.match((await call(0, "my_agenda")).text, /Your group \(assigned by number/);
    await call(0, "desert_light", { beacon: "north" });
    assert.match((await call(0, "my_balance")).text, /your group has lit 1 of 3 desert beacons \(desert_look\)/);
    await call(1, "desert_light", { beacon: "east" }); await call(2, "desert_light", { beacon: "west" });
    assert.match((await call(0, "my_balance")).text, /your group has crossed the desert/);
    assert.match(renderGroups(w.api), /4 agents in 2 groups \(1 of three, one of 1\), assigned by number\.\nGroups that finished the desert crossing: 1 of 1\./);
    assert.match((await call(3, "my_inbox")).text, /./, "a lone agent has no group message and no failure");
  } finally { await w.close(); }
});
