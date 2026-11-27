// Row ENG113: the Town Hall runs by itself. In a cohort run with defaults and no agent starting anything, two house roles (programs of the house) hold Town Hall sessions on a clock and keep notes, and tend the Finds
// thread with true examples; the report says so and says no agent started it; the Town Hall's place text says so plainly; --no-town-auto switches it off. The live service's limits are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TownAuto, renderTownAuto } from "../src/cohort/town-auto.ts";
import { TOUR_PLACES } from "../src/cohort/expedition.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const mk = (extra: Partial<CohortOptions> = {}): CohortOptions => ({ out: mkdtempSync(join(tmpdir(), "asp-town-out-")), home: mkdtempSync(join(tmpdir(), "asp-town-home-")), agents: 2, model: "stand-in", provider: standInProvider(() => "silent", { latencyMs: 4 }), staggerMs: 700, budgetUsd: 2, totalUsd: 4, minutes: 4, priceIn: 1, priceOut: 5, maxTurns: 30, io: { out: () => undefined }, expedition: true, markers: "seed-t", ...extra } as CohortOptions);

test("the roles take turns and say only what the house counted; the report line and the place text say it runs by itself", () => {
  const a = new TownAuto(() => new Date("2026-11-24T10:00:00Z"));
  const s1 = a.hold({ agents: 3, openJobs: 10, settledJobs: 1, messages: 2 }), s2 = a.hold({ agents: 3, openJobs: 10, settledJobs: 1, messages: 2 });
  assert.deepEqual([s1.role, s2.role], ["house recorder", "house keeper"]);
  assert.match(s1.note, /Session 1: 3 agents here, 10 jobs open, 1 settled, 2 messages sent\. Nothing is decided in a house session\./);
  assert.match(renderTownAuto(a, 0), /## The Town Hall runs by itself\n\n2 Town Hall sessions were held by the house's own roles \(1 by the recorder, 1 by the keeper; both are programs of the house, not agents\), and 0 true examples were added to the Finds thread\. 0 agents started a session or took a role\./);
  assert.match(TOUR_PLACES["town-hall"]!.what, /^The Town Hall runs by itself: two roles of the house, a recorder and a keeper \(programs, not agents\)/);
});

test("a cohort with defaults and agents that never act still shows Town Hall sessions by house roles only, and the Finds thread tended; --no-town-auto leaves it out", async () => {
  const md = readFileSync((await runCohort(mk())).markdownPath, "utf8");
  const i = md.indexOf("## The Town Hall runs by itself");
  assert.ok(i >= 0);
  const sec = md.slice(i, md.indexOf("\n## ", i + 5));
  const n = Number(/^(\d+) Town Hall sessions? w/m.exec(sec.split("\n\n")[1]!)?.[1] ?? 0);
  assert.ok(n >= 1, sec);
  assert.match(sec, /0 agents started a session or took a role\./);
  assert.match(sec, /- house (recorder|keeper) at 20[0-9-]+T/);
  const off = readFileSync((await runCohort(mk({ noTownAuto: true }))).markdownPath, "utf8");
  assert.doesNotMatch(off, /## The Town Hall runs by itself/);
});
