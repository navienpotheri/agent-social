/**
 * Review, attribution, multi-runtime regression and pruning of learned changes (register rows DK803 to DK806; spec-deltas S1221 to S1224). Scripted agents, runtimes and scenarios; no real model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomSeed, publicKeyFromSeed } from "@agent-social/asp-core";
import { Trail, admit, applyChange, attribute, checkRuntimes, promote, prune, revertChange, split, validateChange, type Change, type Edit, type Gate, type Memory, type Review } from "../src/change-review.ts";

const edit = (id: string, cause: string, key: string, before: string | undefined, after: string | undefined, role: Edit["role"] = "fix"): Edit => ({ id, cause, key, before, after, role });
const change = (over: Partial<Change> = {}): Change => ({ id: "c1", author: "did:agent:author", authorSponsor: "did:user:sponsor-a", scope: "general", scenario: "sc-1", edits: [edit("e1", "stale-price", "pricing", "use list price", "use today's price")], ...over });
const memory: Memory = { pricing: "use list price", greeting: "say hello" };

// ---- DK804 ----
test("DK804: a multi-cause change is refused or split, one cause with one fix and one scenario is whole, and a change without its scenario is refused", () => {
  const mixed = change({ edits: [edit("e1", "stale-price", "pricing", "a", "b"), edit("e2", "rude-tone", "greeting", "say hello", "say hello politely")] });
  const r = validateChange(mixed)!;
  assert.equal(r.code, "MULTIPLE_CAUSES"); assert.match(r.message, /rude-tone|stale-price/);
  const parts = split(mixed, { "stale-price": "sc-a", "rude-tone": "sc-b" });
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => validateChange(p) === null), "each part has one cause, one fix and its scenario");
  assert.deepEqual(parts.map((p) => p.scenario).sort(), ["sc-a", "sc-b"]);
  assert.equal(new Set(parts.map((p) => p.id)).size, 2);
  assert.equal(validateChange(change()), null);
  assert.equal(validateChange(change({ scenario: "" }))!.code, "NEEDS_SCENARIO");
  assert.equal(validateChange(change({ edits: [edit("e1", "x", "k", "a", "b", "support")] }))!.code, "NEEDS_ONE_FIX");
  assert.equal(validateChange(change({ edits: [edit("e1", "x", "k", "a", "b"), edit("e2", "x", "k2", "a", "b")] }))!.code, "NEEDS_ONE_FIX", "two fixes");
});

test("DK804: the lift is attributed to the single change and recorded in the lineage edge; a change that regresses is reverted and the previous behaviour is restored exactly", () => {
  // a scripted suite: 10 scenarios; the price fix passes 3 more, the tone edit breaks 2
  const score = (m: Memory) => 1000 * (4 + (m.pricing === "use today's price" ? 3 : 0) - (m.greeting === "be blunt" ? 2 : 0)) / 10;
  const price = change();
  const blunt = change({ id: "c2", scenario: "sc-2", edits: [edit("e9", "rude-tone", "greeting", "say hello", "be blunt")] });
  const e1 = attribute(price, score, memory), e2 = attribute(blunt, score, memory);
  assert.deepEqual([e1.before_permille, e1.after_permille, e1.lift_permille, e1.regressed], [400, 700, 300, false]);
  assert.deepEqual([e2.lift_permille, e2.regressed], [-200, true]);
  assert.equal(e1.change, "c1"); assert.equal(e1.cause, "stale-price"); assert.equal(e1.scenario, "sc-1");
  const after = applyChange(memory, blunt);
  assert.deepEqual(revertChange(after, blunt), memory, "the revert restores the previous behaviour exactly");
  const added = change({ id: "c3", edits: [edit("e3", "new-fact", "hours", undefined, "open at nine")] });
  assert.deepEqual(revertChange(applyChange(memory, added), added), memory, "a key the change added is removed again");
  const removed = change({ id: "c4", edits: [edit("e4", "old", "greeting", "say hello", undefined)] });
  assert.deepEqual(revertChange(applyChange(memory, removed), removed), memory, "a key the change removed comes back");
});

// ---- DK803 ----
const clean = (reviewer = "did:agent:reviewer", sponsor = "did:user:sponsor-b"): Review => ({ reviewer, reviewerSponsor: sponsor, findings: [{ id: "f1", status: "fixed", test: "test-f1" }] });
const gate = (over: Partial<Gate> = {}): Gate => ({ reviews: [clean()], rerun: () => true, action: "none", ...over });

test("DK803: a change with an open finding is refused, a fixed finding needs a test, the reviewer is independent of the author and its sponsor, and a review is required", () => {
  const seed = randomSeed();
  const t = () => new Trail(seed);
  assert.equal((admit(change(), gate({ reviews: [] }), t()) as { code: string }).code, "NEEDS_REVIEW");
  assert.equal((admit(change(), gate({ reviews: [{ ...clean(), findings: [{ id: "f2", status: "open" }] }] }), t()) as { code: string }).code, "OPEN_FINDING");
  assert.equal((admit(change(), gate({ reviews: [{ ...clean(), findings: [{ id: "f3", status: "fixed" }] }] }), t()) as { code: string }).code, "FIX_NEEDS_TEST");
  assert.equal((admit(change(), gate({ reviews: [clean("did:agent:author")] }), t()) as { code: string }).code, "REVIEWER_NOT_INDEPENDENT", "the author does not review itself");
  assert.equal((admit(change(), gate({ reviews: [clean("did:agent:friend", "did:user:sponsor-a")] }), t()) as { code: string }).code, "REVIEWER_NOT_INDEPENDENT", "nor an agent of its sponsor");
  assert.equal((admit(change(), gate({ rerun: () => false }), t()) as { code: string }).code, "SCENARIOS_FAIL", "the scenarios are rerun and must pass");
  assert.equal((admit(change({ scenario: "" }), gate(), t()) as { code: string }).code, "NEEDS_SCENARIO");
  assert.deepEqual(admit(change(), gate({ reviews: [{ reviewer: "did:agent:r", reviewerSponsor: "did:user:s", findings: [] }] }), t()), { ok: true }, "a review with no findings passes");
  assert.deepEqual(admit(change(), gate(), t()), { ok: true });
});

test("DK803: the sponsor's gate stays for merge and deploy, and the whole trail is signed and chained and fails to verify if it is altered or checked with another key", () => {
  const seed = randomSeed();
  const t = new Trail(seed);
  assert.equal((admit(change(), gate({ action: "merge" }), t) as { code: string }).code, "SPONSOR_GATE", "no approval, no merge");
  assert.equal((admit(change(), gate({ action: "merge", approval: { sponsor: "did:user:other", action: "merge" } }), t) as { code: string }).code, "SPONSOR_GATE", "another person's approval is not the author's sponsor's");
  assert.equal((admit(change(), gate({ action: "deploy", approval: { sponsor: "did:user:sponsor-a", action: "merge" } }), t) as { code: string }).code, "SPONSOR_GATE", "an approval for merge is not one for deploy");
  const ok = new Trail(seed);
  assert.deepEqual(admit(change(), gate({ action: "deploy", approval: { sponsor: "did:user:sponsor-a", action: "deploy" } }), ok), { ok: true });
  assert.deepEqual(ok.entries.map((e) => e.step), ["reviewed", "findings_closed", "scenarios_rerun", "admitted"]);
  assert.equal(Trail.verify(ok.entries, publicKeyFromSeed(seed)), true);
  assert.equal(Trail.verify(ok.entries, publicKeyFromSeed(randomSeed())), false);
  const tampered = ok.entries.map((e) => ({ ...e })); tampered[1].detail = "0";
  assert.equal(Trail.verify(tampered, publicKeyFromSeed(seed)), false);
  assert.equal(Trail.verify(t.entries, publicKeyFromSeed(seed)), true, "a refusal is on the trail too");
  assert.ok(t.entries.every((e) => e.step === "refused" || ["reviewed", "findings_closed", "scenarios_rerun"].includes(e.step)));
});

// ---- DK805 ----
test("DK805: a change that passes on one runtime and fails on another is refused, the per-runtime results are recorded, and an agent on one runtime is checked on that runtime only", () => {
  const scenarios = ["s1", "s2", "s3"];
  const codex = (s: string) => s !== "s3";                              // fails one scenario
  const claude = () => true;
  const both = checkRuntimes(change(), ["claude-code", "codex"], { "claude-code": claude, codex }, scenarios);
  assert.equal(both.ok, false);
  assert.equal((both as { code: string }).code, "RUNTIME_FAILS");
  assert.deepEqual(both.results, { "claude-code": { passed: 3, total: 3 }, codex: { passed: 2, total: 3 } }, "both results are kept for the lineage edge");
  const one = checkRuntimes(change(), ["claude-code"], { "claude-code": claude, codex }, scenarios);
  assert.deepEqual(one, { ok: true, results: { "claude-code": { passed: 3, total: 3 } } }, "codex's failure is no concern of an agent that does not run there");
  const missing = checkRuntimes(change(), ["claude-code", "goose"], { "claude-code": claude }, scenarios);
  assert.equal((missing as { code: string }).code, "RUNTIME_NOT_CHECKED");
  const edge = { ...attribute(change(), () => 500, memory), runtimes: one.results };
  assert.deepEqual(edge.runtimes, one.results);
});

// ---- DK806 ----
test("DK806: a change with no measured gain after the stated number of runs is pruned, an agent-specific tweak is not promoted to the commons, and a general lesson with gain is kept and promoted", () => {
  const general = { change: change({ id: "g" }), lifts: [50, 80, 30] };
  const noGain = { change: change({ id: "n" }), lifts: [0, -10, 5, 0] };
  const tooSoon = { change: change({ id: "t" }), lifts: [0, 0] };
  const tweak = { change: change({ id: "a", scope: "agent" as const }), lifts: [100, 120, 90] };
  const r = prune([general, noGain, tooSoon, tweak], 3);
  assert.deepEqual(r.pruned.map((x) => x.change.id), ["n"], "no gain after four runs");
  assert.deepEqual(r.kept.map((x) => x.change.id).sort(), ["a", "g", "t"], "too few runs to judge is kept");
  assert.deepEqual(promote(general), { ok: true, to: "commons" });
  assert.equal((promote(tweak) as { code: string }).code, "AGENT_SPECIFIC", "an agent-specific tweak stays in the agent's own configuration, gain or not");
  assert.equal((promote(noGain) as { code: string }).code, "NO_GAIN");
  assert.equal((promote({ change: change(), lifts: [] }) as { code: string }).code, "NO_GAIN");
});
