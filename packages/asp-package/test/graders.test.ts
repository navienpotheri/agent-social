/**
 * Grader agents with a measured record (register row DK802; spec-delta S1220): on a simulated society a grader's weight follows its agreement with the deterministic end-state check, a grader that disagrees is
 * down-weighted, clusters are deterministic, a grader cannot grade its own work or its sponsor's agent, and no free text enters a grade. Scripted graders; no real judge model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GraderBook, clusters, type Grader, type RunFacts, type Verdict } from "../src/graders.ts";

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const graders: Grader[] = [{ id: "g-sharp", sponsor: "s1" }, { id: "g-coin", sponsor: "s2" }, { id: "g-wrong", sponsor: "s3" }, { id: "g-new", sponsor: "s4" }];
const runs = (n: number): RunFacts[] => { const r = rng(7); return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, agent: `a${i % 5}`, sponsor: `sp${i % 5}`, runtime: i % 3 === 0 ? "codex" : "claude-code", tool: i % 2 ? "book_slot" : "send_confirmation", check: i % 7 === 0 ? "state_mismatch" : "timeout", endStatePass: r() < 0.5 })); };
/** A scripted judge: says the truth with probability p, else the opposite. */
const judge = (p: number, seed: number) => { const r = rng(seed); return (run: RunFacts): Verdict => ((r() < p ? run.endStatePass : !run.endStatePass) ? "pass" : "fail"); };

test("a grader's weight follows its measured agreement with the deterministic check: a sharp grader counts for most, a coin for about half, one that disagrees is down-weighted, a new one starts at half", () => {
  const book = new GraderBook(graders);
  const all = runs(200);
  const j: Record<string, (r: RunFacts) => Verdict> = { "g-sharp": judge(0.95, 1), "g-coin": judge(0.5, 2), "g-wrong": judge(0.1, 3) };
  for (const run of all) for (const [id, f] of Object.entries(j)) book.measure(id, run, f(run));
  const w = Object.fromEntries(graders.map((g) => [g.id, book.weightPermille(g.id)]));
  assert.ok(w["g-sharp"] > 900, `sharp: ${w["g-sharp"]}`);
  assert.ok(w["g-coin"] > 400 && w["g-coin"] < 600, `coin: ${w["g-coin"]}`);
  assert.ok(w["g-wrong"] < 200, `wrong: ${w["g-wrong"]}`);
  assert.equal(w["g-new"], 500, "no record, half");
  assert.ok(w["g-sharp"] > w["g-coin"] && w["g-coin"] > w["g-wrong"] && w["g-wrong"] > 0 && w["g-sharp"] < 1000, "ordered, and never 0 or 1000");
  assert.deepEqual(book.agreement("g-sharp").graded, 200);
});

test("the combined grade follows the weights: one sharp grader outvotes two that disagree with the check, and the grades are enums and numbers with no free text", () => {
  const book = new GraderBook(graders);
  const all = runs(200);
  const j = { "g-sharp": judge(0.95, 1), "g-coin": judge(0.5, 2), "g-wrong": judge(0.1, 3) };
  for (const run of all) for (const [id, f] of Object.entries(j)) book.measure(id, run, f(run));
  const target: RunFacts = { id: "t", agent: "a-t", sponsor: "sp-t", runtime: "codex", tool: "book_slot", check: "state_mismatch", endStatePass: true };
  const out = book.combine(target, [{ grader: "g-sharp", verdict: "pass" }, { grader: "g-wrong", verdict: "fail" }, { grader: "g-coin", verdict: "fail" }]);
  assert.ok(!("ok" in out));
  if ("verdict" in out) {
    assert.equal(out.verdict, "pass", `sharp ${out.passWeight} against ${out.failWeight}`);
    for (const g of out.grades) assert.deepEqual(Object.keys(g).sort(), ["grader", "run", "verdict", "weightPermille"]);
    assert.ok(out.grades.every((g) => typeof g.weightPermille === "number" && ["pass", "fail"].includes(g.verdict)));
    assert.ok(!/[a-z]+ [a-z]+/.test(JSON.stringify(out.grades)), "no sentence in a grade");
  }
});

test("a grader cannot grade its own work or the work of an agent its sponsor sponsors, and an unknown grader is refused", () => {
  const book = new GraderBook([{ id: "agent-1", sponsor: "sp-A" }, { id: "agent-2", sponsor: "sp-B" }]);
  const own: RunFacts = { id: "r", agent: "agent-1", sponsor: "sp-A", runtime: "codex", tool: "t", check: "c", endStatePass: true };
  const sibling: RunFacts = { ...own, id: "r2", agent: "agent-9", sponsor: "sp-A" };
  const other: RunFacts = { ...own, id: "r3", agent: "agent-2", sponsor: "sp-B" };
  assert.deepEqual(book.eligible("agent-1", own), { ok: false, code: "GRADES_OWN_WORK" });
  assert.deepEqual(book.eligible("agent-1", sibling), { ok: false, code: "GRADES_SPONSORS_AGENT" });
  assert.equal(book.eligible("agent-1", other), true);
  assert.deepEqual(book.eligible("ghost", other), { ok: false, code: "UNKNOWN_GRADER" });
  assert.deepEqual(book.combine(own, [{ grader: "agent-1", verdict: "pass" }]), { ok: false, code: "GRADES_OWN_WORK" });
});

test("failures are clustered by runtime, tool and check deterministically: the same runs in any order give the same clusters, ordered by size, and passing runs are not in them", () => {
  const all = runs(120);
  const a = clusters(all), b = clusters([...all].reverse()), c = clusters([...all].sort((x, y) => x.tool.localeCompare(y.tool) || x.id.localeCompare(y.id)));
  assert.deepEqual(a, b); assert.deepEqual(b, c);
  assert.ok(a.length >= 3);
  assert.ok(a.every((cl, i) => i === 0 || a[i - 1].count >= cl.count), "largest first");
  assert.equal(a.reduce((n, cl) => n + cl.count, 0), all.filter((r) => !r.endStatePass).length, "every failure is in one cluster and nothing else is");
  assert.ok(a.every((cl) => cl.runs.every((id) => !all.find((r) => r.id === id)!.endStatePass)));
});
