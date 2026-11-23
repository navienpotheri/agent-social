// Rows DK1315, DK1314, DK1309, DK1310 (built with stand-ins, partial until a real run reads them): a world model per agent in versions that differ exactly where the agent learned or was corrected; a role and standing
// profile with the evidence for each named role; the load of the context on each turn against a budget rule; a check that the society's feedback did not make an agent worse, against a control. Seeded traces; no model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_BUDGET_TOKENS, contextLoad, diffModels, harmCheck, modelAt, modelVersions, profileOf, renderContextLoad, renderHarmCheck, renderProfiles, renderWorldModels } from "../src/cohort/agent-models.ts";

const at = (n: number): string => `2026-11-24T10:00:${String(n).padStart(2, "0")}.000Z`;
const t = (agent: string, turn: number, tool: string, input: Record<string, unknown>, ok = true, extra: Record<string, unknown> = {}) => ({ t: "tool", at: at(turn), agent, turn, tool, input, ok, ...(ok ? {} : { refused: "bad_input" }), chars: 10, institution: "x", scope: tool.startsWith("forum") ? "write.forum" : "read.x", writes: tool.startsWith("forum"), ms: 0, ...extra });
const mdl = (agent: string, turn: number, input: number, usd = 0.001) => ({ t: "model", at: at(turn), agent, turn, input, output: 50, cacheWrite: 0, usd });

// A seeded agent: it reads the board, is refused on a post that is too long, then posts a short one and looks at a place.
const SEED = [
  t("agent-01", 1, "look_jobs", {}), t("agent-01", 2, "look_jobs", {}), t("agent-01", 3, "forum_post", { title: "x".repeat(130), text: "too long a title" }, false), t("agent-01", 4, "look_jobs", {}), t("agent-01", 5, "look_jobs", {}),
  t("agent-01", 7, "forum_post", { title: "Counting jobs", text: "I count the open jobs by their poster." }), t("agent-01", 8, "inspect", { place: "registry" }), t("agent-01", 10, "look_jobs", {}),
] as never[];

test("DK1315: two versions of an agent's model differ exactly where it was corrected or learned, and nowhere else", () => {
  const v = modelVersions(SEED, "agent-01");
  assert.deepEqual(v.map((x) => [x.version, x.upToTick]), [[1, 5], [2, 10]]);
  assert.equal(v[0]!.model["tool:forum_post"], "refused 1, never yet managed");
  assert.equal(v[0]!.model["corrected:forum_post:bad_input"], "was refused (bad_input)");
  assert.equal(v[1]!.model["tool:forum_post"], "ok 1, refused 1, learned: managed it after a refusal");
  const d = diffModels(v[0]!.model, v[1]!.model);
  assert.deepEqual(d.added, ["belief:forum_post:7", "place:registry", "tool:inspect"]);
  assert.deepEqual(d.changed, ["tool:forum_post", "tool:look_jobs"], "look_jobs changed only because it was used once more; the correction itself is unchanged");
  assert.deepEqual(d.removed, []);
  assert.equal(v[1]!.model["belief:forum_post:7"], "I count the open jobs by their poster.");
  assert.deepEqual(modelAt(SEED, "agent-01", 5), v[0]!.model, "a version is the model at its tick");
  assert.match(renderWorldModels(SEED, ["agent-01", "agent-02"]), /^## A world model for each agent, in versions\n\n2 versions of 2 agents' models were kept .*1 agents' models changed between versions; 1 corrections \(a refused act\) and 1 cases of managing an act after a refusal were recorded\./s);
});

test("DK1314: roles are named only with their evidence, from what the trace shows, for seeded agents", () => {
  const ev = [
    t("w", 1, "deliver_job", { contract: "c1" }), t("w", 2, "deliver_job", { contract: "c2" }), t("w", 3, "post_job", {}), t("w", 4, "inspect", { place: "market" }), t("w", 5, "inspect", { place: "forum" }),
    t("tk", 1, "send_message", { to: "w", text: "hello" }), t("tk", 2, "send_message", { to: "house-greeter", text: "thanks" }),
    t("rd", 1, "look_map", {}), t("rd", 2, "look_jobs", {}),
  ] as never[];
  const w = profileOf(ev, "w"), tk = profileOf(ev, "tk"), rd = profileOf(ev, "rd");
  assert.deepEqual(w.roles.map((r) => r.role), ["worker", "poster", "explorer"]);
  assert.deepEqual(w.roles.map((r) => r.evidence), ["2 deliveries accepted", "1 jobs posted", "2 places looked at"]);
  assert.deepEqual(tk.roles.map((r) => [r.role, r.evidence]), [["talker", "wrote to w; 2 messages"]]);
  assert.deepEqual(tk.talksTo, ["w"], "the house greeter is not a peer");
  assert.deepEqual(rd.roles.map((r) => r.role), ["reader"]);
  assert.equal(w.heldOut, "first-try acceptance 1 of 1 then 1 of 1 (level)");
  assert.equal(rd.heldOut, "too few deliveries to say");
  assert.match(renderProfiles(ev, ["w", "tk", "rd"]), /Roles are named only where the trace gives evidence: .*reader 1.*A role is a description of what was done in one run, not a rank and not a promise\./s);
});

test("DK1309: the context load is read from the model turns: mean, largest, turns over the budget rule, growth, cost", () => {
  const ev = [...[1, 2, 3, 4, 5, 6].map((i) => mdl("a", i, 500 * i * i)), ...[1, 2, 3].map((i) => mdl("b", i, 800))] as never[];
  const c = contextLoad(ev, ["a", "b"]);
  assert.equal(c.turns, 9);
  assert.equal(c.maxInput, 18000);
  assert.equal(c.over, [500, 2000, 4500, 8000, 12500, 18000].filter((x) => x > CONTEXT_BUDGET_TOKENS).length, "turns over the rule");
  assert.equal(c.grew, 1, "agent a's context more than doubled");
  assert.match(renderContextLoad(ev, ["a", "b"]), /^## The load on each turn \(context and cost\)\n\n9 model turns by 2 agents: the context fed to a turn averaged [0-9]+ tokens \(largest 18000\), and each turn cost \$0\.001 on average\. 4 turns were over the budget rule of 4000 tokens, and 1 agent's context more than doubled/);
});

test("DK1310: the check against a control says too few, or no drop, or a drop, and says what it is not", () => {
  const d = (agent: string, turn: number, c: string, ok: boolean) => t(agent, turn, "deliver_job", { contract: c }, ok);
  const rd = (agent: string, turn: number) => t(agent, turn, "lesson_read", { id: "lesson-001" });
  const none = [d("a", 1, "x", true)] as never[];
  assert.equal(harmCheck(none, ["a"]).verdict, "no agent read a lesson, so there was no feedback to check");
  const few = [d("a", 1, "x", true), rd("a", 2), d("a", 3, "y", true), d("b", 4, "z", true)] as never[];
  assert.match(harmCheck(few, ["a", "b"]).verdict, /^too few deliveries/);
  const mk = (readersAfter: boolean): never[] => [
    ...[1, 2, 3].map((i) => d("r", i, `r${i}`, true)), ...[1, 2, 3].map((i) => d("c", i + 10, `c${i}`, true)), rd("r", 4),
    ...[5, 6, 7].map((i) => d("r", i, `r${i}`, readersAfter)), ...[5, 6, 7].map((i) => d("c", i + 10, `c${i + 5}`, true)),
  ] as never[];
  assert.match(harmCheck(mk(true), ["r", "c"]).verdict, /^no drop beyond a quarter against the control was seen/);
  assert.match(harmCheck(mk(false), ["r", "c"]).verdict, /^the readers got worse than the control by more than a quarter: look at it/);
  assert.match(renderHarmCheck(mk(true), ["r", "c"]), /Readers \(1\): 3 of 3 before, 3 of 3 after\. Control \(1\): .*in-society battery only .*\(ENG75\) is not wired, and one run has no spread \(ENG72\)\./s);
});
