// The task set for Phase 1 of docs/credits-and-learning-experiment.md: 40 small coding tasks, each a function with one bug and a test that fails until it is fixed. The check is mechanical: the test passes
// and the test file is unchanged. Tasks 0-19 are the practice set an agent may learn from; 20-39 are the held-out pool, from which a reading takes a rotating sample.
//   import { makeTask, check, PRACTICE, HELD_OUT, heldOutSample } from "./tasks.mjs"
//   node evals/learning/tasks.mjs --selftest      builds all 40, shows every test fails on the buggy source and passes on the known fix
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Eight families of bug; each is made five times with different names and constants, so a lesson about a family can transfer to a task the agent has not seen.
const FAMILIES = [
  { id: "range-sum", variants: [["sumTo", 3], ["total", 5], ["addUpTo", 10], ["sumInclusive", 4], ["runningTotal", 7]],
    bug: (f) => `export function ${f}(n) { let s = 0; for (let i = 1; i < n; i++) s += i; return s; }\n`,
    fix: (f) => `export function ${f}(n) { let s = 0; for (let i = 1; i <= n; i++) s += i; return s; }\n`,
    test: (f, k) => `assert.equal(${f}(${k}), ${(k * (k + 1)) / 2}); assert.equal(${f}(1), 1); assert.equal(${f}(0), 0);` },
  { id: "clamp", variants: [["clamp", 0, 10], ["limit", 5, 50], ["bound", -3, 3], ["restrict", 1, 9], ["squeeze", 10, 20]],
    bug: (f) => `export function ${f}(x, lo, hi) { if (x < lo) return hi; if (x > hi) return lo; return x; }\n`,
    fix: (f) => `export function ${f}(x, lo, hi) { if (x < lo) return lo; if (x > hi) return hi; return x; }\n`,
    test: (f, lo, hi) => `assert.equal(${f}(${lo - 5}, ${lo}, ${hi}), ${lo}); assert.equal(${f}(${hi + 5}, ${lo}, ${hi}), ${hi}); assert.equal(${f}(${lo}, ${lo}, ${hi}), ${lo});` },
  { id: "is-even", variants: [["isEven"], ["even"], ["divisibleByTwo"], ["hasNoRemainder"], ["isPair"]],
    bug: (f) => `export function ${f}(n) { return n % 2 === 1; }\n`,
    fix: (f) => `export function ${f}(n) { return n % 2 === 0; }\n`,
    test: (f) => `assert.equal(${f}(4), true); assert.equal(${f}(7), false); assert.equal(${f}(0), true); assert.equal(${f}(-2), true);` },
  { id: "average", variants: [["average"], ["mean"], ["avg"], ["meanOf"], ["averageOf"]],
    bug: (f) => `export function ${f}(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }\n`,
    fix: (f) => `export function ${f}(xs) { return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length; }\n`,
    test: (f) => `assert.equal(${f}([2, 4, 6]), 4); assert.equal(${f}([]), 0); assert.equal(${f}([5]), 5);` },
  { id: "capitalize", variants: [["capitalize"], ["title"], ["upperFirst"], ["ucfirst"], ["initialCap"]],
    bug: (f) => `export function ${f}(s) { return s.toUpperCase(); }\n`,
    fix: (f) => `export function ${f}(s) { return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1); }\n`,
    test: (f) => `assert.equal(${f}("hello"), "Hello"); assert.equal(${f}("hELLO"), "HELLO"); assert.equal(${f}(""), "");` },
  { id: "reverse-words", variants: [["reverseWords"], ["flipWords"], ["wordsBackwards"], ["reverseSentence"], ["swapOrder"]],
    bug: (f) => `export function ${f}(s) { return s.split("").reverse().join(""); }\n`,
    fix: (f) => `export function ${f}(s) { return s.split(" ").reverse().join(" "); }\n`,
    test: (f) => `assert.equal(${f}("one two three"), "three two one"); assert.equal(${f}("solo"), "solo");` },
  { id: "vowels", variants: [["countVowels"], ["vowelCount"], ["numVowels"], ["howManyVowels"], ["vowelsIn"]],
    bug: (f) => `export function ${f}(s) { return (s.match(/[aeiou]/g) || []).length; }\n`,
    fix: (f) => `export function ${f}(s) { return (s.match(/[aeiou]/gi) || []).length; }\n`,
    test: (f) => `assert.equal(${f}("banana"), 3); assert.equal(${f}("HELLO"), 2); assert.equal(${f}("rhythm"), 0);` },
  { id: "max", variants: [["maxOf"], ["largest"], ["biggest"], ["findMax"], ["topValue"]],
    bug: (f) => `export function ${f}(xs) { let m = 0; for (const x of xs) if (x > m) m = x; return m; }\n`,
    fix: (f) => `export function ${f}(xs) { let m = xs[0]; for (const x of xs) if (x > m) m = x; return m; }\n`,
    test: (f) => `assert.equal(${f}([3, 9, 2]), 9); assert.equal(${f}([-5, -2, -8]), -2); assert.equal(${f}([-1]), -1);` },
];

export const TASKS = FAMILIES.flatMap((fam, fi) => fam.variants.map((v, vi) => ({ index: vi * FAMILIES.length + fi, family: fam.id, fn: v[0], args: v.slice(1), fam })))
  .sort((a, b) => a.index - b.index).map((t, i) => ({ ...t, index: i }));
export const PRACTICE = TASKS.slice(0, 20).map((t) => t.index);
export const HELD_OUT = TASKS.slice(20).map((t) => t.index);

const testFile = (t) => `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { ${t.fn} } from "./src.js";\n\ntest("${t.fn}", () => {\n  ${t.fam.test(t.fn, ...t.args)}\n});\n`;
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Writes one task into `dir` (src.js with the bug, test.js, package.json so .js is a module) and returns the prompt for the agent. */
export function makeTask(index, dir) {
  const t = TASKS[index];
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "src.js"), t.fam.bug(t.fn));
  writeFileSync(join(dir, "test.js"), testFile(t));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  return `The test in test.js fails. Fix src.js so that it passes. Do not change test.js. Run the test with: node --test test.js`;
}

/** The mechanical check: the test file is unchanged and `node --test test.js` passes. */
export function check(index, dir) {
  const t = TASKS[index];
  let tampered = false;
  try { tampered = sha(readFileSync(join(dir, "test.js"), "utf8")) !== sha(testFile(t)); } catch { tampered = true; }
  if (tampered) return { pass: false, why: "test.js was changed or removed" };
  const r = spawnSync(process.execPath, ["--test", "test.js"], { cwd: dir, encoding: "utf8", timeout: 30_000 });
  return { pass: r.status === 0, why: r.status === 0 ? "" : (r.stdout + r.stderr).split("\n").find((l) => /not ok|Error|expected/i.test(l)) ?? `exit ${r.status}` };
}

/** `n` held-out tasks for a reading: a deterministic rotation keyed by a seed (a contract id, say), so nobody can pick the sample. */
export function heldOutSample(seed, n) {
  const order = HELD_OUT.map((i) => ({ i, k: sha(`${seed}:${i}`) })).sort((a, b) => (a.k < b.k ? -1 : 1));
  return order.slice(0, n).map((x) => x.i);
}

/** A known-good fix, for the self-test and for scoring a stand-in agent. */
export function solve(index, dir) { const t = TASKS[index]; writeFileSync(join(dir, "src.js"), t.fam.fix(t.fn)); }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--selftest")) {
  const root = mkdtempSync(join(tmpdir(), "asp-learning-tasks-"));
  let bad = 0;
  for (const t of TASKS) {
    const dir = join(root, `t${t.index}`);
    makeTask(t.index, dir);
    const before = check(t.index, dir);
    solve(t.index, dir);
    const after = check(t.index, dir);
    if (before.pass || !after.pass) { bad++; console.log(`FAIL task ${t.index} (${t.family} ${t.fn}): fails before the fix: ${!before.pass}, passes after: ${after.pass} ${after.why}`); }
  }
  console.log(`${TASKS.length} tasks, ${PRACTICE.length} practice, ${HELD_OUT.length} held out; sample of 5 for seed "a": ${heldOutSample("a", 5)}; sample for seed "b": ${heldOutSample("b", 5)}`);
  console.log(bad ? `${bad} task(s) wrong` : "every test fails on the buggy source and passes on the known fix, and a changed test.js is caught");
  const tamper = join(root, "tamper"); makeTask(0, tamper); writeFileSync(join(tamper, "test.js"), "import {test} from 'node:test'; test('x',()=>{});"); console.log("tampered test.js caught:", !check(0, tamper).pass);
  rmSync(root, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}
