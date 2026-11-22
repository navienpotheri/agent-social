/**
 * Swap, try and compare in the mechanism registry (register rows DK1758 and DK89): two mechanisms run on the same simulated society and are compared by a rule fixed before any run; swapping one for another leaves
 * the other's decision exactly as it was; a mechanism that needs white-box models is deferred and not run. Simulations: they show the registry can swap, try and compare, never that a paper's claim holds.
 */
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPARISON_RULE, compareMechanisms, comparisonRuleHash, runMechanism, type MechanismEntry } from "@agent-social/asp-log";
import { PIPELINE_SEED, loadMechanisms } from "../../../conformance/generate-pipeline-decisions.ts";

const [ace, forgetting, swat] = (() => { const ms = loadMechanisms(); const by = (id: string) => ms.find((m) => m.id === id)!; return [by("ace-append-lessons"), by("scheduled-forgetting"), by("swat-latent-channel")]; })();
const variant = (id: string, boost: number): MechanismEntry => ({ ...ace, id, flag: `mechanism.${id.replace(/-/g, "_")}`, simulation: { ...ace.simulation, skill_boost: boost } });

test("DK1758: two memory mechanisms on one society: each decision equals its own standalone run, the winner follows the rule, and the order of the arguments changes nothing", () => {
  const c = compareMechanisms(ace, forgetting, PIPELINE_SEED);
  assert.deepEqual(c.a, runMechanism(ace, PIPELINE_SEED), "the first mechanism's decision is what it gets alone");
  assert.deepEqual(c.b, runMechanism(forgetting, PIPELINE_SEED), "the second's too");
  assert.equal(c.simulated, true);
  assert.equal(c.agents, 120);
  assert.equal(c.seed, PIPELINE_SEED);
  assert.equal(c.rule_sha256, comparisonRuleHash());
  assert.equal(c.rule, COMPARISON_RULE);
  const swapped = compareMechanisms(forgetting, ace, PIPELINE_SEED);
  assert.equal(swapped.winner, c.winner, "the order of the arguments is not the rule");
  assert.deepEqual(compareMechanisms(ace, forgetting, PIPELINE_SEED), c, "the same inputs give the same comparison");
  const adopted = [c.a, c.b].filter((d) => d.decision === "adopt");
  if (adopted.length === 2) assert.equal(c.winner, c.a.measures!.delta! > c.b.measures!.delta! ? ace.id : c.a.measures!.delta! < c.b.measures!.delta! ? forgetting.id : null);
  if (adopted.length === 1) assert.equal(c.winner, adopted[0].mechanism);
  if (adopted.length === 0) assert.equal(c.winner, null);
});

test("DK1758: swapping the second mechanism leaves the first's decision unchanged, and the rule's hash is fixed", () => {
  const withForgetting = compareMechanisms(ace, forgetting, PIPELINE_SEED);
  const withVariant = compareMechanisms(ace, variant("ace-twin", 0.01), PIPELINE_SEED);
  assert.deepEqual(withForgetting.a, withVariant.a, "ace's decision is the same whichever mechanism sits beside it");
  assert.match(comparisonRuleHash(), /^sha256:[0-9a-f]{64}$/);
  assert.equal(comparisonRuleHash(), "sha256:" + createHash("sha256").update('{"adopt_first":true,"deferred_never_wins":true,"id":"head-to-head-v1","larger_delta_wins":true,"tie_is_a_tie":true}').digest("hex"), "the hash is of the rule as written, with its keys in order: changing the rule changes it");
  assert.equal(COMPARISON_RULE.deferred_never_wins, true);
});

test("DK1758: the rule on synthetic entries: adopted beats tuned and killed, the larger of two adopted wins, neither adopted is no winner", () => {
  const big = variant("ace-big", 0.3), mid = variant("ace-mid", 0.1), none = variant("ace-none", 0), bad = variant("ace-bad", -0.3);
  const decisions = [big, mid, none, bad].map((m) => runMechanism(m, PIPELINE_SEED).decision);
  assert.deepEqual(decisions, ["adopt", "adopt", "tune", "kill"], "the fixtures say what they should");
  assert.equal(compareMechanisms(big, none, PIPELINE_SEED).winner, "ace-big", "adopted beats tuned");
  assert.equal(compareMechanisms(none, big, PIPELINE_SEED).winner, "ace-big");
  assert.equal(compareMechanisms(mid, bad, PIPELINE_SEED).winner, "ace-mid", "adopted beats killed");
  const both = compareMechanisms(big, mid, PIPELINE_SEED);
  const [bx, by] = [both.a.measures!.delta!, both.b.measures!.delta!];
  assert.equal(both.winner, bx > by ? "ace-big" : bx < by ? "ace-mid" : null, "the larger measured difference wins");
  assert.notEqual(bx, by, "the two adopted fixtures measure different differences");
  assert.equal(compareMechanisms(none, bad, PIPELINE_SEED).winner, null, "neither adopted: no winner");
  assert.match(compareMechanisms(none, bad, PIPELINE_SEED).reason, /neither is adopted/);
  assert.throws(() => compareMechanisms(big, big, PIPELINE_SEED), /not compared with itself/);
});

test("DK1758: a mechanism that needs white-box models is deferred, not run, and never wins", () => {
  const c = compareMechanisms(ace, swat, PIPELINE_SEED);
  assert.equal(c.b.decision, "deferred");
  assert.equal(c.b.measures, null, "no experiment was run for it");
  assert.match(c.b.reason, /white-box/);
  assert.equal(c.winner, c.a.decision === "adopt" ? ace.id : null);
  const open = { ...ace, id: "ace-open", requires: { runtime: "open-weight" as const } };
  const strong = variant("ace-strong", 0.3);
  const d = compareMechanisms(open, strong, PIPELINE_SEED);
  assert.equal(d.a.decision, "deferred");
  assert.equal(d.winner, "ace-strong", "the deferred one is not the winner even when it comes first");
  assert.equal(compareMechanisms(open, swat, PIPELINE_SEED).winner, null, "two deferred: no winner");
});
