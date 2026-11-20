/**
 * The attribution stage of the lesson gate (register row DK810; spec-delta S1206): before a lesson from a failed episode is accepted, the gate re-runs the episode with the suspected outside factor held fixed and records
 * "strategy fault" or "world fault". A world-fault failure may not rewrite a strategy, only leave a note about the world; a lesson that blames the world for a strategy failure is rejected. A scripted market with a hidden
 * price shock. Both outcomes are in the signed lineage record. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { admitToMemory, listLessons, readRejected, verifyPackage, type LessonCandidate } from "@agent-social/asp-package";
import { agentPackage } from "./lens-course-kit.ts";

/** A scripted market: prices on four days, a hidden fair value of 12 (8 after a shock). A strategy buys at any price at or under its limit and sells at the fair value. */
const PRICES = [8, 10, 15, 18];
const profit = (limit: number, fair: number) => PRICES.filter((p) => p <= limit).reduce((n, p) => n + (fair - p), 0);
const RUN = "sha256:" + "a".repeat(64);
const heldOut = [1, 2, 3].map((i) => ({ id: `h${i}`, run: () => true }));
const base = { evidence: [{ kind: "run" as const, ref: RUN }], source: "run" as const };
const opts = (signer: Awaited<ReturnType<typeof agentPackage>>["signer"]) => ({ signer, existing: [], heldOut, isOwnRun: (id: string) => id === RUN });
/** The probe: the episode again with the shock removed (fair value 12). */
const probeOf = (limit: number, id: string) => ({ id, rerunNeutral: () => profit(limit, 12) > 0 });

test("the scripted market behaves as described: a limit of 10 earns without the shock and loses with it; a limit of 20 loses either way", () => {
  assert.deepEqual([profit(10, 12), profit(10, 8), profit(20, 12), profit(20, 8)], [6, -2, -3, -19]);
});

test("an agent that blames the world for a strategy failure has its lesson rejected, and the signed record says so even though nothing was admitted", async () => {
  const { pkg, signer } = await agentPackage();
  const blame: LessonCandidate = { ...base, id: "blames-the-market", text: "The market was unlucky on day three; nothing about my buying rule needs to change.", target: "world_note", episode: probeOf(20, "ep-badstrategy") };
  const [v] = await admitToMemory(pkg, [blame], opts(signer));
  assert.equal(v.admitted, false);
  assert.deepEqual(v.attribution, { episode: "ep-badstrategy", fault: "strategy", target: "world_note" });
  assert.ok(v.reasons.some((r) => r.rule === "attribution_strategy_fault"), JSON.stringify(v.reasons));
  const row = readRejected(pkg).at(-1)!;
  assert.equal(row.attribution!.fault, "strategy");
  assert.match(row.reasons.map((r) => r.reason).join(), /the fault was the agent's strategy/);
  const signed = listLessons(pkg).at(-1)!.description;
  assert.match(signed, /the audit gate admitted no lesson/);
  assert.match(signed, /blames-the-market \[strategy fault, wanted world_note\]: attribution_strategy_fault/);
  assert.equal((await verifyPackage(pkg)).ok, true, "the record is a signed lineage update");
});

test("an agent whose strategy was fine but lost to a hidden shock keeps its strategy: a lesson that rewrites it is rejected, a note about the world is admitted, and the signed record carries both", async () => {
  const { pkg, signer } = await agentPackage();
  const probe = probeOf(10, "ep-shock");
  const rewrite: LessonCandidate = { ...base, id: "rewrite-the-buying-rule", text: "Lower the buying limit to 5, because day two lost money.", target: "strategy", episode: probe };
  const note: LessonCandidate = { ...base, id: "note-price-shock", text: "On day two a price shock cut the fair value; this is a fact about the market, not about the buying rule.", target: "world_note", episode: probe };
  const [vr, vn] = await admitToMemory(pkg, [rewrite, note], opts(signer));
  assert.equal(vr.admitted, false);
  assert.deepEqual(vr.attribution, { episode: "ep-shock", fault: "world", target: "strategy" });
  assert.ok(vr.reasons.some((r) => r.rule === "attribution_world_fault"));
  assert.equal(vn.admitted, true, JSON.stringify(vn.reasons));
  assert.equal(vn.attribution!.fault, "world");
  assert.match(readFileSync(join(pkg, "memory", "lessons", "note-price-shock.md"), "utf8"), /attribution world fault, world_note/);
});

test("the signed record names the admitted note with its attribution and the rejected rewrite with its rule", async () => {
  const { pkg, signer } = await agentPackage();
  const probe = probeOf(10, "ep-shock-2");
  await admitToMemory(pkg, [
    { ...base, id: "rewrite-the-limit", text: "Lower the buying limit to 5 after the loss.", target: "strategy", episode: probe },
    { ...base, id: "note-the-shock", text: "A price shock on day two cut the fair value for that day.", target: "world_note", episode: probe },
  ], opts(signer));
  const signed = listLessons(pkg).at(-1)!.description;
  assert.match(signed, /note-the-shock \[world fault, world_note\]/);
  assert.match(signed, /1 rejected, kept with reasons; attribution: rewrite-the-limit \[world fault, wanted strategy\]: attribution_world_fault/);
  assert.equal((await verifyPackage(pkg)).ok, true);
});

test("a strategy lesson for a strategy failure is admitted with its attribution; a lesson with no episode is judged as before, with no attribution", async () => {
  const { pkg, signer } = await agentPackage();
  const [fix] = await admitToMemory(pkg, [{ ...base, id: "fix-the-limit", text: "Lower the buying limit to 10: at 20 the rule buys above fair value.", target: "strategy", episode: probeOf(20, "ep-fix") }], opts(signer));
  assert.equal(fix.admitted, true, JSON.stringify(fix.reasons));
  assert.deepEqual(fix.attribution, { episode: "ep-fix", fault: "strategy", target: "strategy" });
  assert.match(listLessons(pkg).at(-1)!.description, /fix-the-limit \[strategy fault, strategy\]/);
  const plain = await agentPackage();
  const [old] = await admitToMemory(plain.pkg, [{ ...base, id: "plain-lesson", text: "Check the order size before sending it." }], opts(plain.signer));
  assert.equal(old.admitted, true);
  assert.equal(old.attribution, undefined, "no episode, no attribution stage");
});
