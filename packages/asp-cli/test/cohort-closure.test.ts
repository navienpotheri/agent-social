// The closure reader: `asp society cohort closure <run-dir>` prints one table, row | condition | measured | baseline | verdict | why. MET only with its number and only when better than the baseline; a flag that was off, a number that
// cannot be read, or a missing baseline is NOT MEASURABLE with the reason. Tested on a stand-in run folder and on seeded folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closureCmd, closureRows, renderClosure } from "../src/cohort/closure.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const seed = (events: unknown[], extra: Record<string, string> = {}): string => {
  const d = mkdtempSync(join(tmpdir(), "asp-clo-")); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "trace.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  for (const [f, t] of Object.entries(extra)) writeFileSync(join(d, f), t);
  return d;
};
const tool = (agent: string, name: string, input: Record<string, unknown> = {}, ok = true, extra: Record<string, unknown> = {}) => ({ t: "tool", agent, turn: 1, tool: name, input, ok, chars: 100, institution: "market", scope: "x", writes: false, ms: 0, ...(ok ? {} : { refused: "market_refused" }), ...extra });
const row = (rows: ReturnType<typeof closureRows>, id: string) => rows.find((r) => r.row === id)!;

test("a seeded run: MET only with its number and when better than the baseline; NOT MET when it is not; NOT MEASURABLE when a flag was off or there is no baseline", () => {
  const ev = [
    { t: "start", agents: 4, toolGroups: ["expedition"] },
    tool("a1", "inspect", { place: "market" }), tool("a2", "inspect", { place: "forum" }), tool("a1", "post_job"), tool("a3", "send_message", { to: "house-greeter" }), tool("a2", "send_message", { to: "a1" }),
    tool("a1", "offer_on_job", {}, false), tool("a2", "offer_on_job", {}, true), { t: "end", agent: "a1", reason: "stopped" }, { t: "end", agent: "a2", reason: "provider_error: x" },
  ];
  const rows = closureRows(seed(ev, { "refusal-counts.json": JSON.stringify({ counts: { bad_input: 1, market_refused: 3 }, agents: 4 }) }));
  assert.deepEqual([row(rows, "ENG88").verdict, row(rows, "ENG88").measured], ["MET", "2 of 4 agents called inspect"]);
  assert.deepEqual([row(rows, "ENG82").verdict, row(rows, "ENG82").measured], ["MET", "1 of 4 agents posted a job"]);
  assert.equal(row(rows, "ENG81").measured, "1 messages from one agent to another", "the message to the house is not counted");
  assert.equal(row(rows, "ENG85").verdict, "MET"); assert.match(row(rows, "ENG85").measured, /1 of 4 refusals \(0\.25\)/);
  assert.equal(row(rows, "ENG77").verdict, "MET"); assert.match(row(rows, "ENG77").measured, /1 offers refused \(2 offers made\)/);
  assert.equal(row(rows, "ENG45").verdict, "NOT MET", "one of four agents ended with provider_error: worse than the baseline");
  assert.deepEqual([row(rows, "ENG80").verdict, row(rows, "ENG80").measured], ["NOT MEASURABLE", "n/a"]);
  assert.match(row(rows, "ENG80").reason, /the lessons flag was off in this run/);
  assert.match(row(rows, "ENG58").reason, /the games flag was off/);
  assert.equal(row(rows, "ENG86").verdict, "NOT MEASURABLE");
  for (const r of rows) if (r.verdict === "MET") assert.ok(r.measured !== "n/a" && /\d/.test(r.measured), `${r.row}: MET always carries its number`);
});

test("a number that equals the baseline is NOT MET; no trace is refused; the table has one line for each row and a total", () => {
  const ev = [{ t: "start", agents: 2, toolGroups: [] }, tool("a1", "look_jobs")];
  const rows = closureRows(seed(ev));
  assert.equal(row(rows, "ENG82").verdict, "NOT MET", "0 posted against a baseline of 0 is not better");
  assert.throws(() => closureRows(mkdtempSync(join(tmpdir(), "asp-clo-empty-"))), /no trace\.jsonl/);
  const md = renderClosure(rows, "x");
  assert.match(md, /^# Closure reader: x\n\n\| Row \| Close condition \| Measured in this run \| Baseline \| Verdict \| Why \|\n\|---\|/);
  assert.equal(md.split("\n").filter((l) => /^\| (ENG|DK)/.test(l)).length, rows.length);
  assert.match(md, /[0-9]+ MET, [0-9]+ NOT MET, [0-9]+ NOT MEASURABLE\. MET means the number in this one run is better than the baseline; it is not a claim about an effect/);
});

test("the command runs on a stand-in run folder and prints the table; a missing folder exits 2", async () => {
  const o = { out: mkdtempSync(join(tmpdir(), "asp-clo-out-")), home: mkdtempSync(join(tmpdir(), "asp-clo-home-")), agents: 3, model: "stand-in", provider: standInProvider((i) => ["guided", "clumsy", "silent"][i]!, { latencyMs: 4 }), staggerMs: 100, budgetUsd: 2, totalUsd: 6, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 30, io: { out: () => undefined }, expedition: true, markers: "seed-c" } as CohortOptions;
  const r = await runCohort(o);
  const lines: string[] = [];
  assert.equal(closureCmd(r.dir, { out: (l) => lines.push(l) }), 0);
  const md = lines.join("\n");
  assert.match(md, /\| ENG88 \| agents look closely at places \| [0-9]+ of 3 agents called inspect \| 0 of 25 agents called inspect \| (MET|NOT MET) \|/);
  assert.match(md, /\| ENG113 \| Town Hall sessions run by themselves \| [0-9]+ sessions by the house roles \| 0 sessions \(nothing ran it\) \| (MET|NOT MET) \|/);
  assert.match(md, /\| ENG80 \| lesson cards published and used \| n\/a \| .* \| NOT MEASURABLE \|/);
  assert.equal(closureCmd(undefined, { out: () => undefined }), 2);
  assert.equal(closureCmd(join(tmpdir(), "no-such-run-folder"), { out: () => undefined }), 2);
});
