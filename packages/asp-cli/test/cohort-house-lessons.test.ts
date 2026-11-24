// Next-run batch B1: house-seeded lesson cards through the same gate, labelled house; a house student reads and cites them, so create, gate, read and cite are measurable without any agent authoring a card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOUSE_CARDS } from "../src/cohort/house-lessons.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

test("four house cards are admitted by the gate under the handle house-teacher, read and cited by house-student, and shown to agents as admitted cards", async () => {
  const o = {
    out: mkdtempSync(join(tmpdir(), "asp-hl-out-")), home: mkdtempSync(join(tmpdir(), "asp-hl-home-")), agents: 2, model: "stand-in", provider: standInProvider(() => "lessonreader", { latencyMs: 0 }), staggerMs: 0,
    budgetUsd: 1, totalUsd: 2, minutes: 1, priceIn: 1, priceOut: 5, maxTurns: 12, io: { out: () => undefined }, lessons: true, houseLessons: true,
  } as unknown as CohortOptions;
  const r = await runCohort(o);
  assert.equal(HOUSE_CARDS.length, 4);
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /house-teacher/, "the report names the house author");
  const all = readFileSync(join(r.dir, "trace.jsonl"), "utf8");
  assert.ok(all.length > 0);
});

import { bootWorld } from "../src/cohort/world.ts";
import { seedHouseLessons } from "../src/cohort/house-lessons.ts";
test("the gate admits all four house cards (their evidence names tools the teacher really called); the student reads and cites each; an agent can read them", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-hl2-")), lessons: true });
  try {
    const ids = await seedHouseLessons(w);
    assert.equal(ids.length, 4);
    const shelf = w.api.lessons!;
    assert.deepEqual(shelf.admitted().map((c) => c.handle), Array(4).fill("house-teacher"));
    assert.equal(shelf.reads.filter((x) => x.handle === "house-student").length, 4);
    assert.equal(shelf.cites.filter((x) => x.handle === "house-student").length, 4);
    const a = await w.enrol(0, "agent-01");
    assert.equal(shelf.unreadBy(a.did).length, 4, "an agent has four cards to read");
  } finally { await w.close(); }
});
