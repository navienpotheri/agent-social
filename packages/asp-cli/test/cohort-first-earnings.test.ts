// Row DK1323: the first-earnings trajectory: for each agent that joins, the time and the turn of its first credit earned, first job, first message to another agent and first card, with the median and how many never got there.
// Seeded traces; a stand-in run shows the section.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTrajectory, trajectory } from "../src/cohort/first-earnings.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const at = (s: number): string => new Date(Date.UTC(2026, 10, 24, 10, 0, s)).toISOString();
const ag = (agent: string, s: number) => ({ t: "agent", at: at(s), agent, did: "did:" + agent, handle: agent, kind: "sponsored" });
const tool = (agent: string, s: number, turn: number, name: string, input: Record<string, unknown> = {}, ok = true) => ({ t: "tool", at: at(s), agent, turn, tool: name, input, ok, chars: 1, institution: "x", scope: "x", writes: false, ms: 0 });

test("the time since arrival and the turn of each first, the median over the agents that got there, and the number that never did", () => {
  const ev = [
    ag("a", 0), ag("b", 10), ag("c", 20),
    tool("a", 4, 2, "inspect", { place: "market" }), tool("a", 30, 5, "deliver_job"), tool("a", 40, 6, "send_message", { to: "b" }), tool("a", 50, 7, "send_message", { to: "house-greeter" }),
    tool("b", 70, 4, "deliver_job"), tool("b", 71, 5, "field_answer"),
    tool("c", 25, 1, "send_message", { to: "house-greeter" }), tool("c", 26, 2, "deliver_job", {}, false),
  ] as never[];
  const t = trajectory(ev);
  const by = (k: string) => t.rows.find((r) => r.key === k)!;
  assert.deepEqual([by("credit").reached, by("credit").medianSeconds, by("credit").medianTurn], [2, 32, 3], "a: 4 s turn 2 (a first look pays); b: 60 s turn 4; medians 32 and 3");
  assert.deepEqual([by("job").reached, by("job").medianSeconds, by("job").medianTurn], [2, 45, 4.5]);
  assert.deepEqual([by("message").reached, by("message").medianSeconds], [1, 40], "a message to the house is not a message to another agent; a failed delivery is not a job");
  assert.deepEqual([by("card").reached, by("card").medianSeconds], [1, 61]);
  const md = renderTrajectory(ev);
  assert.match(md, /^## Time to first earnings, first job, first message, first card\n\nFor each of 3 agents, the time from its arrival \(wall clock of the run\) and the turn at which it first reached each point:\n- first credit earned: 2 of 3 agents, median 32 s and turn 3; 1 never got there in this run\.\n- first job delivered: 2 of 3 agents, median 45 s and turn 4\.5; 1 never got there in this run\.\n- first message to another agent: 1 of 3 agents, median 40 s and turn 6; 2 never got there in this run\./);
  assert.match(md, /No target is set, and the run's own length bounds what an agent could reach\./);
  assert.match(renderTrajectory([] as never[]), /For each of 0 agents/);
});

test("a stand-in run has the section with its own counts", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-fe-out-")), home: mkdtempSync(join(tmpdir(), "asp-fe-home-")), agents: 2, model: "stand-in", provider: standInProvider((i) => ["guided", "silent"][i]!, { latencyMs: 4 }), staggerMs: 200, budgetUsd: 2, totalUsd: 4, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 30, io: { out: () => undefined }, expedition: true } as CohortOptions;
  const md = readFileSync((await runCohort(o)).markdownPath, "utf8");
  assert.match(md, /## Time to first earnings, first job, first message, first card\n\nFor each of 2 agents[^\n]*\n- first credit earned: [12] of 2 agents/);
});
