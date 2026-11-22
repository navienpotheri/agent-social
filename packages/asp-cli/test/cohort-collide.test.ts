// Row ENG77: in the real 15-agent run 21 offers were refused because agents that start together all go for the same first jobs. The board shows how many offers a job has, a refused offer names two other open jobs the
// agent can do now, and the house keeps a board as big as the cohort. Fifteen scripted agents arriving together are refused for a taken job in at most 5 percent of their offers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("the board shows how many offers a job has, the house keeps a board as big as the cohort, and a refused offer names two other open jobs", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-coll-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    const hall = w.api.market!;
    for (const x of [a, b]) await hall.enrolStandalone(x);
    await hall.scaleFor(25);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    assert.equal((await hall.openJobList(a, 100)).length >= 25, true, "a board for 25 agents");
    const board = JSON.parse(stripExtras((await call(a, "look_jobs")).text)) as { result: { job: string; budget: number; offers: number }[] };
    assert.ok(board.result.every((j) => j.offers === 0), "each line shows its number of offers");
    const first = board.result[0]!;
    assert.equal((await call(a, "offer_on_job", { job: first.job, price: first.budget, plan: "I will write it" })).ok, true);
    const lost = await call(b, "offer_on_job", { job: first.job, price: first.budget, plan: "me too" });
    assert.equal(lost.ok, false);
    assert.match(lost.text, /already taken by another agent\. Two others open now that you can do: ".*" pays \d+ \(offer_on_job sha256:[0-9a-f]{64}\); ".*" pays \d+ \(offer_on_job sha256:[0-9a-f]{64}\)\.$/);
    const named = [...lost.text.matchAll(/offer_on_job (sha256:[0-9a-f]{64})/g)].map((m) => m[1]!);
    assert.equal(new Set(named).size, 2);
    assert.ok(!named.includes(first.job), "the taken job is not offered again");
    // a job that an agent posted shows its offers
    const post = await call(a, "post_job", { purpose: "Count the open jobs on the board", budget: 10, criterion: "a number" });
    const jobId = /sha256:[0-9a-f]+/.exec(post.text)![0];
    await call(b, "offer_on_job", { job: jobId, price: 10, plan: "I will count them" });
    const after = JSON.parse(stripExtras((await call(b, "look_jobs")).text)) as { result: { job: string; offers: number }[] };
    assert.equal(after.result.find((j) => j.job === jobId)!.offers, 1);
  } finally { await w.close(); }
});

test("fifteen scripted agents arriving together are refused for a taken job in at most 5 percent of their offers, and all of them end with a job", async () => {
  const r = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-coll-out-")), home: mkdtempSync(join(tmpdir(), "asp-coll-home-")), agents: 15, model: "stand-in", provider: standInProvider(() => "rusher", { latencyMs: 3 }), staggerMs: 0, budgetUsd: 2, totalUsd: 30, minutes: 5, priceIn: 1, priceOut: 5, maxTurns: 40, io: { out: () => undefined } } as CohortOptions);
  const ev = readFileSync(join(r.dir, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.t === "tool" && e.tool === "offer_on_job");
  const refused = ev.filter((e) => !e.ok && e.refused === "market_refused").length;
  console.log(`offers ${ev.length}, refused for a taken job ${refused}`);
  assert.ok(ev.length >= 15);
  assert.ok(refused / ev.length <= 0.05, `${refused} of ${ev.length} offers were refused for a taken job`);
  const done = ev.filter((e) => e.ok).length;
  assert.equal(done, 15, "every agent got a job");
});
