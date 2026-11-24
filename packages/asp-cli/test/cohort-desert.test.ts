// Exploration idea 6 (small): the desert crossing for groups of three. Deterministic: the group is the agent's number over three; three different agents light the three beacons; the house referee pays each once; a group of fewer than three cannot cross, and says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESERT_PAY } from "../src/cohort/desert.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("three agents of a group light the three beacons and are paid once each; refusals say why; a short group cannot cross", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-desert-")), desert: 4 });
  try {
    const ag = [] as Awaited<ReturnType<typeof w.enrol>>[];
    for (let i = 0; i < 4; i++) { const a = await w.enrol(i, `agent-0${i + 1}`); await w.api.market!.enrolStandalone(a); ag.push(a); }
    const call = (i: number, n: string, inp: Record<string, unknown> = {}) => runTool(w.api, ag[i]!, all, n, inp);
    assert.match((await call(0, "desert_look")).text, /Your group is 1 \(3 agents in this run\)\. Beacons: north: not lit; east: not lit; west: not lit\./);
    const before = await w.api.market!.balance(ag[0]!);
    assert.match((await call(0, "desert_light", { beacon: "north" })).text, /2 of your group's beacons are not lit yet/);
    assert.equal((await call(0, "desert_light", { beacon: "east" })).ok, false, "one beacon each");
    assert.equal((await call(1, "desert_light", { beacon: "north" })).ok, false, "already lit");
    assert.equal((await call(1, "desert_light", { beacon: "south" })).ok, false);
    await call(1, "desert_light", { beacon: "east" });
    assert.match((await call(2, "desert_light", { beacon: "west" })).text, /Your group has crossed/);
    assert.equal(await w.api.market!.balance(ag[0]!), before + DESERT_PAY, "paid once");
    assert.match((await call(0, "desert_look")).text, /Your group has crossed\./);
    assert.match((await call(3, "desert_look")).text, /Your group is 2 \(1 agent in this run\)\. .* This group has fewer than three agents, so it cannot cross\./, "another group is separate and short");
    assert.equal(w.api.desert!.crossed(), 1);
  } finally { await w.close(); }
});

import { seenLines } from "../src/cohort/seen.ts";
test("F2: a door at the back of the town hall leads to the desert: shown once on the first look at the town hall, recorded as a find, never required (the desert tools work without it)", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-desert-door-")), desert: 3, expedition: true });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    assert.match((await call(b, "desert_look")).text, /The desert crossing/, "reachable without the door");
    const r = (await call(a, "inspect", { place: "town-hall" })).text;
    assert.match(r, /A door at the back of the town hall leads out to the desert crossing, a small place for groups of three \(desert_look\); nothing here is asked of you\./);
    assert.ok(seenLines(r).some((s) => s.kind === "desert-door"));
    assert.doesNotMatch((await call(a, "inspect", { place: "town-hall" })).text, /A door at the back of the town hall/, "once");
    assert.match((await call(b, "my_balance")).text, /Since you last looked, others found .*agent-01 found a door at town-hall/);
  } finally { await w.close(); }
});
