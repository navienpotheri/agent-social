// DK1478 (S1422): near-repeat detection and its MEASURED false-halt rate. The corpus of legitimate calls is the 270 calls the benchmark's two blind sets say to allow (real shell, read and edit calls); sessions are sampled from it, two ways
// (uniform, and a habitual agent that repeats its favourites), and the breaker runs over each. The loops are three kinds of near-repeat an agent really falls into (a counter in a URL, a retry stamped with a time, an edit that moves one line number).
// The numbers are printed and asserted; they are for this corpus and sampling, not for live traffic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GatewayBreaker, normalizeCall, nearCount } from "../src/agent-guards.ts";

type Call = { name: string; args: Record<string, unknown> };
const load = (f: string) => (JSON.parse(readFileSync(new URL(`../../../evals/benchmark/${f}`, import.meta.url), "utf8")) as { call: Call; expect: string }[]).filter((c) => c.expect === "allow").map((c) => c.call);
const CORPUS = [...load("blind-cases.json"), ...load("blind2-cases.json")];
const rng = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** The call number at which the breaker halts a session, or null. */
function haltsAt(calls: Call[], limits: ConstructorParameters<typeof GatewayBreaker>[0]): number | null {
  const b = new GatewayBreaker(limits);
  for (const [i, c] of calls.entries()) if (b.check(c.name, c.args, 0)) return i + 1;
  return null;
}
const sessions = (n: number, len: number, pick: (r: () => number) => Call, seed: number) => { const r = rng(seed); return Array.from({ length: n }, () => Array.from({ length: len }, () => pick(r))); };
const uniform = (r: () => number) => CORPUS[Math.floor(r() * CORPUS.length)];
// a habitual agent: the k-th favourite is used with weight 1/(k+12) (a few calls dominate, without one swallowing the session)
const weights = CORPUS.map((_, k) => 1 / (k + 12)), total = weights.reduce((a, b) => a + b, 0);
const habitual = (r: () => number) => { let x = r() * total; for (const [k, w] of weights.entries()) { x -= w; if (x <= 0) return CORPUS[k]; } return CORPUS[0]; };

const LOOPS: Record<string, (i: number) => Call> = {
  "a counter in a URL": (i) => ({ name: "Bash", args: { command: `curl -s https://api.example.com/items/${1000 + i}/status` } }),
  "a retry stamped with the time": (i) => ({ name: "Bash", args: { command: `./deploy.sh --retry ${i} --at 2026-11-21T10:${String(10 + (i % 50)).padStart(2, "0")}:07Z` } }),
  "an edit that moves one line number": (i) => ({ name: "Edit", args: { file_path: "src/app.ts", old_string: `line ${40 + i}: fix`, new_string: `line ${40 + i}: fixed` } }),
};

test("the corpus is the benchmark's legitimate calls, and normalising keeps the tool and the shape but not the numbers", () => {
  assert.equal(CORPUS.length, 270);
  assert.equal(normalizeCall("Bash", { command: "curl  /items/12/status" }), normalizeCall("Bash", { command: "curl /items/9999/status" }));
  assert.notEqual(normalizeCall("Bash", { command: "curl /items/12/status" }), normalizeCall("Bash", { command: "curl /items/12/delete" }));
  assert.notEqual(normalizeCall("Read", { file_path: "a.ts" }), normalizeCall("Edit", { file_path: "a.ts" }));
  assert.equal(nearCount(["a", "b", "a", "a"], "a", 3), 3, "the window holds the newest and the two before it");
});

test("measured: how many legitimate sessions the near-repeat rule halts at each setting, and how fast it catches three kinds of near-repeat loop", () => {
  const N = 4000, LEN = 60;
  const uni = sessions(N, LEN, uniform, 7), hab = sessions(N, LEN, habitual, 11);
  const rows: string[] = [];
  const rate = (ss: Call[][], l: ConstructorParameters<typeof GatewayBreaker>[0]) => ss.filter((s) => haltsAt(s, l) !== null).length / ss.length;
  const exact = { equivalentCalls: 8 };
  const base = { uniform: rate(uni, exact), habitual: rate(hab, exact) };
  rows.push(`exact only (8 equal calls): uniform ${(base.uniform * 100).toFixed(2)} %, habitual ${(base.habitual * 100).toFixed(2)} % of sessions halted`);
  const measured: Record<number, { u: number; h: number }> = {};
  for (const near of [6, 8, 10, 12]) { measured[near] = { u: rate(uni, { ...exact, nearRepeats: near }), h: rate(hab, { ...exact, nearRepeats: near }) }; rows.push(`near-repeat ${near} of the last 24: uniform ${(measured[near].u * 100).toFixed(2)} %, habitual ${(measured[near].h * 100).toFixed(2)} % halted`); }
  const caught: string[] = [];
  for (const [name, mk] of Object.entries(LOOPS)) {
    const loop = Array.from({ length: 60 }, (_, i) => mk(i));
    const exactAt = haltsAt(loop, exact), nearAt = haltsAt(loop, { ...exact, nearRepeats: 12 });
    caught.push(`${name}: exact rule ${exactAt ?? "never"}, near rule at call ${nearAt ?? "never"}`);
    assert.equal(exactAt, null, `${name} escapes the exact rule`);
    assert.equal(nearAt, 12, `${name} is halted at the 12th call`);
  }
  console.log(["near-repeat measurement (corpus: 270 legitimate benchmark calls, 4,000 sessions of 60 calls each):", ...rows, ...caught].join("\n  "));
  // the bar for the default: at 12 of 24 the rule halts almost no legitimate session on this corpus
  assert.ok(measured[12].u <= 0.001, `uniform false-halt at 12: ${measured[12].u}`);
  assert.ok(measured[12].h - base.habitual <= 0.02, `the near rule at 12 adds ${(measured[12].h - base.habitual)} to the exact rule on the habitual agent`);
  assert.ok(measured[6].h > measured[12].h, "a lower limit halts more legitimate work: the trade-off is real");
  assert.ok(measured[12].u >= base.uniform, "the near rule adds false halts, never removes them");
});

test("legitimate bulk work that looks like a near-repeat is halted, and the test says so: reading twenty numbered files in a row", () => {
  const bulk = Array.from({ length: 20 }, (_, i): Call => ({ name: "Read", args: { file_path: `src/part-${i}.ts` } }));
  assert.equal(haltsAt(bulk, { equivalentCalls: 8, nearRepeats: 12 }), 12, "the 12th read of a numbered file is halted: a false halt the Mandate's own limit (nearRepeats) must be raised for, or the rule left off");
  assert.equal(haltsAt(bulk, { equivalentCalls: 8 }), null, "without the near rule bulk reading is fine");
});
