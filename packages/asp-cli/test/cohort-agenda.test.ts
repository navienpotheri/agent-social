// Rows UC-2208..: ENG92, the agenda aid (--agenda): a compact list of what is open now (a job, a course, a place to look at, a thread, a peer's message) with what each pays and how much effort it takes, the ones near the agent's
// interests first, labelled an aid and not an order; the report counts who asked and what they called next. Scripted only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { renderAgendaUse } from "../src/cohort/talk.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("the agenda lists a job, a course, a place, a thread and a peer's message with payoff and effort, calls itself an aid, ranks what is near the agent's interests first, and a message from the house is not counted as a peer's", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-agd-")), expedition: true });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    await call(b, "send_message", { to: "agent-01", text: "Would you compare notes on counting jobs?", kind: "question" });
    await call(b, "forum_post", { title: "How do you count the open jobs?", text: "I would like to know how others count the jobs on the board.", tags: [] });
    const raw = (await call(a, "my_agenda")).text; const t = raw.slice(raw.indexOf("What is open")).split("\n\n")[0]!;
    assert.match(t, /^What is open for you now, the ones close to your interests \(.+\) first\. This is an aid, not an order: you may use none of it\.\n1\. /);
    assert.match(t, /\d\. a message from agent-02 waits \(my_inbox\): a reply pays nothing and takes one call/);
    assert.match(t, /\d\. a job: ".+" pays [0-9]+ mock credits and takes one short text \(offer_on_job sha256:[0-9a-f]{64}\)/);
    assert.match(t, /\d\. a course: .+ mock credits to enrol; what it taught shows in my_progress \(course_enrol /);
    assert.match(t, /\d\. a place to look at: the .+; a first look pays a small mock credit and takes one call \(inspect [a-z-]+\)/);
    assert.match(t, /\d\. a thread nobody has answered: ".+" by [a-z0-9-]+; an answer pays nothing and takes one comment \(forum_read_post sha256:[0-9a-f]{64}\)/);
    assert.ok(t.split("\n")[1]!.includes("a message from agent-02"), "a peer's message is first");
    assert.doesNotMatch(t, /you (must|should)|goal|win/i);
    // once the place has been looked at, the next place is offered
    await call(a, "inspect", { place: "registry" });
    assert.doesNotMatch((await call(a, "my_agenda")).text, /inspect registry/);
  } finally { await w.close(); }
});

test("the report counts the agents that asked for the agenda and what they called next; the tool exists only with --agenda", async () => {
  const ev = [{ t: "tool", agent: "agent-01", tool: "my_agenda", input: {}, ok: true }, { t: "tool", agent: "agent-01", tool: "look_jobs", input: {}, ok: true }, { t: "tool", agent: "agent-02", tool: "my_agenda", input: {}, ok: true }] as never[];
  assert.match(renderAgendaUse(ev, 3), /^## The agenda aid\n\n2 of 3 agents asked for the agenda \(2 calls\)\. What they called next: look_jobs 1, nothing more 1\. It is an aid and not an order/);
  const o = { out: mkdtempSync(join(tmpdir(), "asp-agd-out-")), home: mkdtempSync(join(tmpdir(), "asp-agd-home-")), agents: 1, model: "stand-in", provider: standInProvider(() => "silent", { latencyMs: 4 }), staggerMs: 0, budgetUsd: 2, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 20, io: { out: () => undefined } } as CohortOptions;
  assert.doesNotMatch(readFileSync((await runCohort(o)).markdownPath, "utf8"), /## The agenda aid/);
  assert.match(readFileSync((await runCohort({ ...o, agenda: true })).markdownPath, "utf8"), /## The agenda aid\n\n0 of 1 agent asked for the agenda/);
});
