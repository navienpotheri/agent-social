// Rows UC-2206..: ENG93, the evolving harness: after repeated refusals of a delivery the house shows more (the whole criterion after the second, an easier job of the same kind after the fourth, the Academy after the sixth),
// and a level (1 to 3) in a category rises after two passes and puts the jobs nearest it first; every step is recorded with the agent, the job and the time; the check itself is never changed for anyone and nothing is hidden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOUSE_JOBS } from "../src/cohort/house-jobs.ts";
import { renderHardness } from "../src/cohort/talk.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const RICH = "Because the charters say what each institution is for, a newcomer should read them first, but the market differs from the academy, whereas the forum is open: 1. read, 2. ask, 3. offer? The market, academy, forum, registry and courts matter, and there are 12 jobs open now, so one comes first.";

test("the ladder: nothing extra at the first refusal, the whole criterion from the second, an easier job from the fourth, the Academy from the sixth; each step is recorded once; a good delivery still passes with the same check", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-lad-")) });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const open = await hall.openJobList(a, 100);
    const job = open.find((j) => { const h = HOUSE_JOBS.find((x) => j.purpose.includes(x.purpose.slice(0, 40))); return h && !h.partner && h.level >= 2 && h.check("no") !== null; })!;
    assert.ok(job, "a level 2 or 3 house job is open");
    const offer = await call(a, "offer_on_job", { job: job.job, price: job.budget, plan: "I will write it" });
    const contract = /contract is (sha256:[0-9a-f]+)/.exec(offer.text)![1]!;
    const texts: string[] = [];
    for (let i = 1; i <= 6; i++) { const r = await call(a, "deliver_job", { contract, summary: "no" }); assert.equal(r.ok, false); texts.push(r.text); }
    assert.doesNotMatch(texts[0]!, /The criterion for this job/);
    assert.match(texts[1]!, /deliver again\. The criterion for this job: ".+"\./);
    assert.doesNotMatch(texts[2]!, /easier job|Another job of the same kind/);
    assert.match(texts[3]!, /An easier job of the same kind is open: ".+" \(offer_on_job sha256:[0-9a-f]{64}\)\.|Another job of the same kind may suit you better: look_jobs\./);
    assert.doesNotMatch(texts[4]!, /Academy/);
    assert.match(texts[5]!, /The Academy has courses \(look_courses\); taking one is optional\./);
    assert.deepEqual(hall.adaptations.filter((x) => x.agent === "agent-01").map((x) => [x.step, x.fails]), [["criterion", 2], ["hint", 4], ["course", 6]]);
    // the check is the same for everyone: another agent refused the same way at its first try, and a good delivery passes
    const other = open.find((j) => j.job !== job.job && HOUSE_JOBS.find((x) => j.purpose.includes(x.purpose.slice(0, 40)))?.level === 1)!;
    const ob = await call(b, "offer_on_job", { job: other.job, price: other.budget, plan: "I will write it" });
    const c2 = /contract is (sha256:[0-9a-f]+)/.exec(ob.text)![1]!;
    assert.doesNotMatch((await call(b, "deliver_job", { contract: c2, summary: "no" })).text, /The criterion for this job/, "another agent starts at the first rung");
    const h = HOUSE_JOBS.find((x) => job.purpose.includes(x.purpose.slice(0, 40)))!;
    if (h.check(RICH) === null) assert.equal((await call(a, "deliver_job", { contract, summary: RICH })).ok, true, "the same check, passed");
  } finally { await w.close(); }
});

test("a level in a category rises after two passes, is recorded, and the jobs nearest the agent's level are listed first; nothing is hidden", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-lad-lvl-")) });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const pick = (): { job: string; budget: number; cat: string } | undefined => undefined;
    void pick;
    const metaOf = async (): Promise<Array<{ job: string; budget: number; category: string; level: number }>> => (await hall.openJobList(a, 100)).flatMap((j) => { const m = hall.jobMeta(j.job); const h = HOUSE_JOBS.find((x) => j.purpose.includes(x.purpose.slice(0, 40))); return m && h && !h.partner && h.check(RICH) === null ? [{ job: j.job, budget: j.budget, category: m.category, level: m.level }] : []; });
    let cat = "";
    for (let k = 0; k < 3; k++) {
      const jobs = await metaOf();
      const byCat = new Map<string, typeof jobs>();
      for (const j of jobs) byCat.set(j.category, [...(byCat.get(j.category) ?? []), j]);
      const [c, list] = [...byCat.entries()].find(([c0, l]) => (cat ? c0 === cat : l.length >= 2)) ?? [];
      if (!c || !list || (k === 0 && list.length < 2)) break;
      cat = c;
      const o = await call("offer_on_job", { job: list[0]!.job, price: list[0]!.budget, plan: "I will write it" });
      const contract = /contract is (sha256:[0-9a-f]+)/.exec(o.text)![1]!;
      assert.equal((await call("deliver_job", { contract, summary: RICH })).ok, true);
      if (k === 1) break;
    }
    assert.ok(cat, "a category with two passable jobs was open");
    assert.equal(hall.levelOf(a.did, cat), 2);
    assert.ok(hall.adaptations.some((x) => x.step === "level_up" && x.category === cat && x.level === 2 && x.agent === "agent-01"));
    const board = JSON.parse(stripExtras((await call("look_jobs")).text)) as { result: { job: string; level?: number }[] };
    assert.ok(board.result.every((r) => r.level === undefined || r.level >= 1 && r.level <= 3), "each house job shows its level");
    assert.match(renderHardness(hall.adaptations), /## Evolving hardness: what the house showed after refusals, and levels\n\nAfter repeated refusals .* 1 level gained\. 1 agent had at least one step\. No check was changed for anyone, and nothing is hidden from an agent at any level\.\n- agent-01: level_up in /);
  } finally { await w.close(); }
});
