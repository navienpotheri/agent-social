// Row DK1740: worlds for exploration and expeditions. A measured world (the desert) is seeded, replayable and claimable; an expedition is audited, never claimable and void when its frame chain breaks or its cost cap is
// exceeded. The policies are scripted: no real model is involved. Fake hashes only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditExpedition, claimable, declProblems, desertOf, frameHash, headForMiddle, measure, play, randomWalk, replay, sweepThenBeacon, type ExpeditionRun, type Frame, type WorldDecl } from "../src/index.ts";

const measured = (seed: string): WorldDecl => ({ id: "desert-1", kind: "measured", seed, max_steps: 120 });
const W = "sha256:" + "a".repeat(64);
const expedition = (over: Partial<WorldDecl> = {}): WorldDecl => ({ id: "exp-1", kind: "expedition", model: { name: "open-world-model", weights_sha256: W, licence_checked: true }, max_steps: 50, cost_cap: 20, gpu_credits_per_second: 0.5, ...over });

function frames(n: number, secs = 1): Frame[] {
  const out: Frame[] = []; let prev = "genesis";
  for (let i = 0; i < n; i++) { const f = { n: i, sha256: "sha256:" + String(i).padStart(64, "0"), action: "forward", gpu_seconds: secs }; const full: Frame = { ...f, prev }; out.push(full); prev = frameHash(f, prev); }
  return out;
}
const run = (decl: WorldDecl, fr: Frame[], over: Partial<ExpeditionRun["claimed_outcome"]> = {}): ExpeditionRun => ({ decl, group: ["agent-a", "agent-b"], goal: "reach the lit tower", frames: fr, claimed_outcome: { reached: true, evaluator: "landmark-checker-v1", evaluator_error_permille: 80, ...over } });

test("DK1740: a world is measured or expedition, and each carries what its kind needs; only a measured world is claimable", () => {
  assert.deepEqual(declProblems(measured("s1")), []);
  assert.deepEqual(declProblems(expedition()), []);
  assert.ok(declProblems({ ...measured("s1"), seed: undefined }).some((x) => /has a seed/.test(x)));
  assert.ok(declProblems({ ...measured("s1"), model: { name: "m", weights_sha256: W, licence_checked: true } }).some((x) => /not by a world model/.test(x)));
  assert.ok(declProblems(expedition({ model: undefined })).some((x) => /names its world model/.test(x)));
  assert.ok(declProblems(expedition({ model: { name: "m", weights_sha256: W, licence_checked: false } })).some((x) => /licence/.test(x)));
  assert.ok(declProblems(expedition({ cost_cap: undefined })).some((x) => /cost cap/.test(x)));
  assert.ok(declProblems(expedition({ seed: "s" })).some((x) => /no seed/.test(x)), "a seed would claim that an expedition can be regenerated");
  assert.equal(claimable(measured("s1")), true);
  assert.equal(claimable(expedition()), false);
});

test("DK1740: the desert of a seed is the same every time and is replayable: a transcript replays to the same hash, an altered one does not", () => {
  assert.deepEqual(desertOf("abc"), desertOf("abc"));
  assert.notDeepEqual(desertOf("abc").grid, desertOf("abd").grid);
  const w = desertOf("abc");
  assert.ok(Math.abs(w.start.x - 7) + Math.abs(w.start.y - 7) >= 8, "dropped at least eight steps from home");
  const t = play(measured("abc"), sweepThenBeacon);
  assert.equal(play(measured("abc"), sweepThenBeacon).sha256, t.sha256);
  assert.deepEqual(replay(measured("abc"), t), { ok: true, why: "the replay gives the same observations, the same outcome and the same hash" });
  const forged = { ...t, steps: t.steps.map((s, i) => (i === 3 ? { ...s, move: s.move === "N" ? "S" : "N" } : s)) };
  assert.equal(replay(measured("abc"), forged as never).ok, false);
  assert.equal(replay(measured("abd"), t).ok, false, "another seed");
  assert.throws(() => play(expedition() as never, sweepThenBeacon), /world is refused|audited/);
  assert.ok(t.steps.every((s) => s.obs.bearing === null || s.obs.bearing.length > 0));
});

test("DK1740: measured over 300 seeds each: a random walk rarely gets home, heading for the middle does better, and a sweep that follows the beacon does best, with intervals that do not overlap", () => {
  const rw = measure("random walk", (s) => randomWalk(s), 300, "t1");
  const mid = measure("head for the middle", () => headForMiddle, 300, "t1");
  const sw = measure("sweep then beacon", () => sweepThenBeacon, 300, "t1");
  assert.ok(rw.rate_permille < mid.rate_permille && mid.rate_permille < sw.rate_permille, `${rw.rate_permille} < ${mid.rate_permille} < ${sw.rate_permille}`);
  assert.ok(rw.ci_permille[1] < mid.ci_permille[0] && mid.ci_permille[1] < sw.ci_permille[0], "the 95 % intervals do not overlap");
  assert.deepEqual(measure("sweep then beacon", () => sweepThenBeacon, 300, "t1"), sw, "the same seeds give the same figures");
  assert.ok(rw.n === 300 && sw.mean_steps < rw.mean_steps + 60);
});

test("DK1740: an expedition is audited, not replayed: an unbroken chain within the cap is scored (and never claimable); a broken chain, a dropped frame, a cost over the cap or no stated evaluator error is void", () => {
  const ok = auditExpedition(run(expedition(), frames(10)));
  assert.deepEqual([ok.status, ok.reasons, ok.cost, ok.frames, ok.claimable], ["scored", [], 5, 10, false]);
  const broken = frames(10); broken[4] = { ...broken[4]!, prev: "sha256:" + "f".repeat(64) };
  assert.ok(auditExpedition(run(expedition(), broken)).reasons.some((x) => /frame 4 does not follow/.test(x)));
  const dropped = frames(10).filter((f) => f.n !== 6);
  assert.equal(auditExpedition(run(expedition(), dropped)).status, "void");
  const dear = auditExpedition(run(expedition({ max_steps: 100 }), frames(60, 1)));
  assert.equal(dear.status, "void");
  assert.ok(dear.reasons.some((x) => /exceeds the cap of 20/.test(x)), "60 frames at 0.5 a second is 30 credits");
  assert.ok(auditExpedition(run(expedition(), frames(3), { evaluator_error_permille: -1 })).reasons.some((x) => /error rate/.test(x)));
  assert.equal(auditExpedition(run(measured("s"), frames(3))).status, "void", "a measured world is not audited as an expedition");
  assert.equal(auditExpedition({ ...run(expedition(), frames(3)), group: [] }).status, "void");
});
