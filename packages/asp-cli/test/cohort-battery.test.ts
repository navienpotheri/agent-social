// Row ENG75, the in-society battery: four held-out house jobs with fixed checks, the same for every agent; each agent's first delivery on one is recorded (first try passed or not) and the report compares agents that had read a
// lesson before the attempt (access) with the others; `asp society cohort repeat` carries the pass rates and the gap with their spread and reads the gap against it. Scripted only; the house's own check, not the gateway battery.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderBattery } from "../src/cohort/battery.ts";
import { BATTERY_JOBS } from "../src/cohort/hard-jobs.ts";
import { batteryFigures, headlineOf, renderRepeat, repeatReport } from "../src/cohort/repeat.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const b = (agent: string, firstTry: boolean, access: boolean) => ({ t: "battery", at: "2026-11-24T10:00:00.000Z", agent, job: "j", firstTry, access });

test("the four battery jobs have fixed checks that name what is missing, and the first try on each contract is recorded once", async () => {
  assert.equal(BATTERY_JOBS.length, 4);
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-bat-")), battery: true });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const open = await hall.openJobList(a, 100);
    const job = (tag: string) => open.find((j) => j.purpose.startsWith(`[battery] ${tag}`))!;
    const take = async (tag: string): Promise<string> => /contract is (sha256:[0-9a-f]+)/.exec((await call("offer_on_job", { job: job(tag).job, price: 10, plan: "I will answer" })).text)![1]!;
    const c1 = await take("Say the most mock credits");
    assert.match((await call("deliver_job", { contract: c1, summary: "A lot of them, I think, perhaps one hundred." })).text, /give the number \(a job budget is 5 to 50 credits\)/);
    assert.equal((await call("deliver_job", { contract: c1, summary: "The most is 50 mock credits." })).ok, true);
    const c2 = await take("Name three of the twelve places");
    assert.equal((await call("deliver_job", { contract: c2, summary: "The registry, the market and the forum." })).ok, true);
    assert.deepEqual(hall.takeBattery().map((x) => [x.handle, x.firstTry]), [["agent-01", false], ["agent-01", true]], "the second try on c1 is not a first try; c2 passed first time");
    assert.deepEqual(hall.takeBattery(), [], "taken once");
    assert.equal(hall.batteryLog.length, 2);
  } finally { await w.close(); }
});

test("the report compares agents with access to a lesson with the others, and says what it is not", () => {
  const ev = [b("agent-01", true, true), b("agent-01", true, true), b("agent-02", false, false), b("agent-02", true, false), b("agent-03", false, false)] as never[];
  assert.deepEqual(batteryFigures(ev), { batteryAccess: 1, batteryOthers: 0.3333, batteryGap: 0.6667 });
  assert.match(renderBattery(ev, 4), /^## The in-society battery \(held-out jobs\)\n\n3 of 4 agents attempted 5 held-out battery jobs .*First-try passes: agents that had read a lesson before the attempt \(access\) 2 of 2, the others 1 of 3\. .*not the held-out battery through the agent's gateway/s);
});

test("the repeat report carries the battery figures with their spread and reads the gap against it", () => {
  const run = (a: boolean[], o: boolean[]) => headlineOf([...a.map((x, i) => b(`a${i}`, x, true)), ...o.map((x, i) => b(`o${i}`, x, false))] as never[]);
  const big = repeatReport([run([true, true], [false, false]), run([true, true], [false, false]), run([true, true], [false, false])]);
  assert.deepEqual(big.figures["batteryGap"]!.spread!.values, [1, 1, 1]);
  assert.match(renderRepeat(big), /The battery gap \(agents with access minus the others\) averaged 1 over the runs, and its spread between runs is 0: the gap is larger than the spread/);
  const noisy = repeatReport([run([true, true], [false, false]), run([false, false], [true, true]), run([true, true], [false, false])]);
  assert.match(renderRepeat(noisy), /the gap is not larger than the spread, so it is not called a difference\./);
  const missing = repeatReport([run([true], [false]), headlineOf([])]);
  assert.match(renderRepeat(missing), /The battery gap could not be compared with a spread: not every run had attempts on both sides\./);
});

test("a run with --battery has the jobs and the section; without it nothing", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-bat2-out-")), home: mkdtempSync(join(tmpdir(), "asp-bat2-home-")), agents: 1, model: "stand-in", provider: standInProvider(() => "silent", { latencyMs: 4 }), staggerMs: 0, budgetUsd: 2, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 10, io: { out: () => undefined }, battery: true } as CohortOptions;
  assert.match(readFileSync((await runCohort(o)).markdownPath, "utf8"), /## The in-society battery \(held-out jobs\)\n\n0 of 1 agents attempted 0 held-out battery jobs/);
  assert.doesNotMatch(readFileSync((await runCohort({ ...o, battery: false })).markdownPath, "utf8"), /## The in-society battery/);
});
