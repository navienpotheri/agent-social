/**
 * The Mandate workflow clause (register row DK841; spec-delta S1209): states, allowed transitions, the actions each state allows, a deterministic checker before "done", and an approval that waits days and resumes
 * without repeating a side effect; the trail is hash-chained and signed. Scripted agents on a simulated clock; no real model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomSeed, publicKeyFromSeed, signBytes } from "@agent-social/asp-core";
import { Workflow, defaultClause, verifyTrail, type Clause } from "../src/workflow.ts";

const DAY = 86_400_000;
const approverSeed = randomSeed(), agentSeed = randomSeed();
const clause = (): Clause => defaultClause({ did: "did:web:example.com:users:approver", publicKey: publicKeyFromSeed(approverSeed) }, (artifact) => artifact === "report with 3 sections");
const clockOf = (t: { ms: number }) => () => new Date(t.ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const approval = (w: Workflow, seed = approverSeed) => signBytes(new TextEncoder().encode(Workflow.approvalMessage(w.head())), seed);
const fresh = () => { const t = { ms: Date.parse("2026-12-01T09:00:00Z") }; return { t, w: new Workflow(clause(), agentSeed, clockOf(t)) }; };

test("a scripted agent that claims done before the checker passes is refused, and one whose artifact passes the checker gets there; skipping states is refused", () => {
  const { w } = fresh();
  assert.equal((w.move("done") as { code: string }).code, "TRANSITION_NOT_ALLOWED", "draft cannot jump to done");
  assert.equal(w.act("plan", "plan-1").ok, true);
  assert.equal(w.move("awaiting_approval").ok, true);
  assert.equal(w.approve(approval(w)).ok, true);
  assert.equal(w.act("reserve", "r1").ok, true);
  assert.equal(w.move("validating").ok, true);
  const early = w.move("done", "a half-finished report");
  assert.equal((early as { code: string }).code, "CHECKER_NOT_PASSED", "claiming done does not make it done");
  assert.equal(w.state, "validating", "a refused call changes nothing");
  assert.equal((w.move("done") as { code: string }).code, "CHECKER_NOT_PASSED", "no artifact is no pass");
  assert.equal(w.move("done", "report with 3 sections").ok, true);
  assert.equal(w.state, "done");
  assert.equal((w.act("send", "late") as { code: string }).code, "ALREADY_DONE");
});

test("an agent that acts in the wrong state is refused; the allowed actions are the state's own; leaving the approval state needs the approver's signature", () => {
  const { w } = fresh();
  assert.equal((w.act("charge", "c1") as { code: string }).code, "ACTION_NOT_ALLOWED_IN_STATE", "charging in draft");
  w.act("plan", "p"); w.move("awaiting_approval");
  assert.equal((w.act("reserve", "r") as { code: string }).code, "ACTION_NOT_ALLOWED_IN_STATE", "nothing is done while awaiting approval");
  assert.equal((w.move("executing") as { code: string }).code, "APPROVAL_NEEDED", "the agent cannot approve itself");
  assert.equal((w.approve(approval(w, randomSeed())) as { code: string }).code, "BAD_APPROVAL", "a signature that is not the approver's");
  assert.equal(w.state, "awaiting_approval");
  assert.equal(w.approve(approval(w)).ok, true);
  assert.equal((w.act("submit", "s") as { code: string }).code, "ACTION_NOT_ALLOWED_IN_STATE", "submit belongs to validating");
});

test("an approval pending three simulated days resumes from serialised state without repeating a side effect, and the trail verifies", () => {
  const { t, w } = fresh();
  w.act("plan", "plan-1"); w.move("awaiting_approval");
  // the approval waits; the process is gone; the state is kept
  const kept = JSON.parse(JSON.stringify(w.serialise()));
  assert.equal(kept.waitingSince, "2026-12-01T09:00:00Z");
  t.ms += 3 * DAY;
  const back = Workflow.resume(clause(), agentSeed, clockOf(t), kept);
  assert.ok(back instanceof Workflow, JSON.stringify(back));
  assert.equal(back.state, "awaiting_approval");
  assert.equal(back.approve(approval(back)).ok, true);
  assert.equal(back.trail.at(-1)!.at, "2026-12-04T09:00:00Z", "the approval is stamped three days later");
  assert.equal(back.act("reserve", "reserve-hotel").ok, true);
  const before = back.effects.size;
  // the agent runs its script again from the top after the restart: the side effects are not repeated
  const again = back.act("reserve", "reserve-hotel");
  assert.deepEqual(again, { ok: true, note: "already done: the side effect is not repeated" });
  assert.equal(back.effects.size, before);
  assert.equal(back.trail.filter((e) => e.kind === "action" && e.detail === "reserve:reserve-hotel").length, 1, "one entry, one side effect");
  // an effect done before the wait stays done after it
  const early = new Workflow(clause(), agentSeed, clockOf(t));
  early.act("plan", "plan-1"); early.move("awaiting_approval");
  const resumed = Workflow.resume(clause(), agentSeed, clockOf(t), early.serialise()) as Workflow;
  assert.equal(resumed.effects.has("plan-1"), true);
  assert.equal(verifyTrail(back.trail, publicKeyFromSeed(agentSeed)), true, "the trail is a chain from the genesis and every entry is the agent's");
});

test("the trail is checked: a tampered entry, a reordered chain and a state whose hash does not match are refused, and a trail signed by another key does not verify", () => {
  const { t, w } = fresh();
  w.act("plan", "p"); w.move("awaiting_approval"); w.approve(approval(w)); w.act("reserve", "r");
  const s = JSON.parse(JSON.stringify(w.serialise()));
  const bad = (f: (x: typeof s) => void) => { const c = JSON.parse(JSON.stringify(s)); f(c); return Workflow.resume(clause(), agentSeed, clockOf(t), c); };
  assert.equal((bad((c) => { c.trail[1].detail = "edited"; }) as { code: string }).code, "BAD_STATE", "the hash no longer matches");
  assert.equal(verifyTrail(w.trail, publicKeyFromSeed(randomSeed())), false, "another key's trail");
  const swapped = [...w.trail]; [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.equal(verifyTrail(swapped, publicKeyFromSeed(agentSeed)), false, "a reordered chain");
  assert.equal(verifyTrail(w.trail, publicKeyFromSeed(agentSeed)), true);
  assert.ok(Workflow.resume(clause(), agentSeed, clockOf(t), s) instanceof Workflow, "the untouched state resumes");
  assert.equal(w.trail.length, 4);
});

test("it never moves itself: nothing happens without a call, a refused call leaves the state and the trail as they were, and nothing here holds the approver's key", () => {
  const { w } = fresh();
  const before = JSON.stringify(w.serialise());
  w.move("done"); w.act("charge", "x"); w.approve(approval(w, randomSeed()));
  assert.equal(JSON.stringify(w.serialise()), before);
  assert.equal(Object.keys(w).some((k) => /approver.*seed|approverSeed/i.test(k)), false);
});
