// The task set for Phase 1 of docs/credits-and-learning-experiment.md: 40 small coding tasks, each a function with one bug and a test that fails until it is fixed, and each also held to one HOUSE RULE that is
// not written in the task (the first pilot showed that tasks a model can simply solve leave nothing to learn). The check is mechanical: the test passes, the test file is unchanged, and the house rule holds. A rule
// is only ever told to an agent by a rejection that names it, so a lesson is the one way to know it in advance. Tasks 0-19 are the practice set an agent may learn from; 20-39 are the held-out pool, from which a reading takes a rotating sample.
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

// Three house rules, each checkable on the source text and not inferable from a task. A task has the rule at its index modulo three.
export const RULES = [
  { id: "H1", text: "every exported function has a JSDoc comment with @returns directly above it",
    ok: (src) => /\/\*\*[\s\S]*?@returns[\s\S]*?\*\/\s*export function/.test(src),
    apply: (src) => `/** The task's function. @returns {*} its result */\n${src}` },
  { id: "H2", text: 'the file ends with the line: export const VERSION = "1";',
    ok: (src) => /export const VERSION = "1";\s*$/.test(src),
    apply: (src) => `${src.trimEnd()}\nexport const VERSION = "1";\n` },
  { id: "H3", text: 'the first statement of every exported function is: if (arguments.length === 0) throw new RangeError("<function name>: no arguments");',
    ok: (src) => { const m = /export function (\w+)\([^)]*\)\s*\{\s*if \(arguments\.length === 0\) throw new RangeError\(["'`](\w+): no arguments["'`]\)/.exec(src); return !!m && m[1] === m[2]; },
    apply: (src) => src.replace(/export function (\w+)\(([^)]*)\)\s*\{/, (m, fn) => `${m} if (arguments.length === 0) throw new RangeError("${fn}: no arguments");`) },
];
export const ruleFor = (index) => RULES[index % RULES.length];

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
  return `The test in test.js fails. Fix src.js so that it passes. Do not change test.js. Run the test with: node --test test.js\nYour change will also be reviewed against this project's house coding rules, which are not written down.`;
}

/**
 * The first calibration on Windows found every file an agent wrote with PowerShell saved as UTF-16 with a byte-order mark: the code was right and Node could not read it (SyntaxError: Invalid or unexpected
 * token). That is the tool's encoding, not the agent's skill, so before a check the agent's source is read as what it is (UTF-16 or UTF-8 with a mark) and saved as plain UTF-8, for every agent alike.
 */
export function normalizeEncoding(dir) {
  const f = join(dir, "src.js");
  let b;
  try { b = readFileSync(f); } catch { return; }
  let text;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) text = b.subarray(2).toString("utf16le");
  else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) text = Buffer.from(b.subarray(2)).swap16().toString("utf16le");
  else if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) text = b.subarray(3).toString("utf8");
  else text = undefined;
  if (text !== undefined) writeFileSync(f, text);
}

/**
 * Stage A of pilot v2 found the same kind of artifact again: a model that writes a multi-line JSDoc comment through Codex on Windows sometimes produces the whole file on ONE line with the two characters
 * backslash and n where the line breaks should be. The code and the comment were right; the file could not run, and the artifact fell on the Learner (whose notes ask for a multi-line comment) and hardly on the Static
 * agent (16 of the Learner's 23 failed readings). So a source with no real line break (apart from a trailing one) and at least two literal \n sequences is read as the agent meant it, for every agent alike.
 * A file that already has real line breaks is never touched, so a legitimate "\n" inside a string is safe.
 */
export function normalizeLiteralNewlines(dir) {
  const f = join(dir, "src.js");
  let text;
  try { text = readFileSync(f, "utf8"); } catch { return; }
  const body = text.replace(/\r?\n$/, "");
  if (/[\r\n]/.test(body)) return;
  if ((body.match(/\\n/g) ?? []).length < 2) return;
  writeFileSync(f, body.replace(/\\n/g, "\n") + "\n");
}

/** The mechanical check: the test file is unchanged and `node --test test.js` passes. */
export function check(index, dir) {
  const t = TASKS[index];
  normalizeEncoding(dir);
  normalizeLiteralNewlines(dir);
  let tampered = false;
  try { tampered = sha(readFileSync(join(dir, "test.js"), "utf8")) !== sha(testFile(t)); } catch { tampered = true; }
  if (tampered) return { pass: false, logic: false, why: "test.js was changed or removed" };
  const r = spawnSync(process.execPath, ["--test", "test.js"], { cwd: dir, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return { pass: false, logic: false, why: (r.stdout + r.stderr).split("\n").find((l) => /not ok|Error|expected/i.test(l)) ?? `exit ${r.status}` };
  const rule = ruleFor(index);
  let src = ""; try { src = readFileSync(join(dir, "src.js"), "utf8"); } catch { /* no source */ }
  // The rejection names the rule, as a principal's reason would: it is what a lesson is made from.
  return rule.ok(src) ? { pass: true, logic: true, why: "" } : { pass: false, logic: true, why: `the test passes but house rule ${rule.id} is not met: ${rule.text}` };
}

/** `n` held-out tasks for a reading: a deterministic rotation keyed by a seed (a contract id, say), so nobody can pick the sample. */
export function heldOutSample(seed, n) {
  const order = HELD_OUT.map((i) => ({ i, k: sha(`${seed}:${i}`) })).sort((a, b) => (a.k < b.k ? -1 : 1));
  return order.slice(0, n).map((x) => x.i);
}

/** A known-good fix, for the self-test and for scoring a stand-in agent. */
export function solve(index, dir, { compliant = false } = {}) { const t = TASKS[index]; const fixed = t.fam.fix(t.fn); writeFileSync(join(dir, "src.js"), compliant ? ruleFor(index).apply(fixed) : fixed); }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--selftest")) {
  const root = mkdtempSync(join(tmpdir(), "asp-learning-tasks-"));
  let bad = 0;
  for (const t of TASKS) {
    const dir = join(root, `t${t.index}`);
    makeTask(t.index, dir);
    const before = check(t.index, dir);
    solve(t.index, dir);
    const logicOnly = check(t.index, dir);   // the logic is fixed but the house rule is not: it must still fail, naming the rule
    solve(t.index, dir, { compliant: true });
    const after = check(t.index, dir);
    if (before.pass || logicOnly.pass || !/house rule/.test(logicOnly.why) || !after.pass) { bad++; console.log(`FAIL task ${t.index} (${t.family} ${t.fn}): fails before the fix: ${!before.pass}, a logic-only fix still fails on the rule: ${!logicOnly.pass} (${logicOnly.why.slice(0, 50)}), passes when compliant: ${after.pass} ${after.why}`); }
  }
  console.log(`${TASKS.length} tasks, ${PRACTICE.length} practice, ${HELD_OUT.length} held out; sample of 5 for seed "a": ${heldOutSample("a", 5)}; sample for seed "b": ${heldOutSample("b", 5)}`);
  console.log(bad ? `${bad} task(s) wrong` : "every test fails on the buggy source; a fix that only repairs the logic still fails, naming its house rule; a compliant fix passes; a changed test.js is caught");
  const enc = join(root, "enc"); makeTask(0, enc); solve(0, enc, { compliant: true });
  writeFileSync(join(enc, "src.js"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(readFileSync(join(enc, "src.js"), "utf8"), "utf16le")]));
  console.log("a UTF-16 source with a byte-order mark (what PowerShell writes) is read as the agent meant it:", check(0, enc).pass);
  // A compliant fix written on one line with literal \n sequences (what Codex on Windows sometimes produces) is read as the agent meant it; a real multi-line file with a "\n" inside a string is untouched.
  const lit = join(root, "lit"); makeTask(2, lit); solve(2, lit, { compliant: true });
  writeFileSync(join(lit, "src.js"), readFileSync(join(lit, "src.js"), "utf8").replace(/\n/g, "\\n").replace(/\\n$/, ""));
  console.log("a source written on one line with literal \\n sequences is read as the agent meant it:", check(2, lit).pass);
  const keep = join(root, "keep"); makeTask(2, keep); solve(2, keep, { compliant: true });
  const before = readFileSync(join(keep, "src.js"), "utf8").replace("return n % 2 === 0;", 'const note = "a\\nb"; return n % 2 === 0;');
  writeFileSync(join(keep, "src.js"), before);
  check(2, keep);
  console.log("a file with real line breaks and an \\n inside a string is left as it is:", readFileSync(join(keep, "src.js"), "utf8") === before);
  const tamper = join(root, "tamper"); makeTask(0, tamper); writeFileSync(join(tamper, "test.js"), "import {test} from 'node:test'; test('x',()=>{});"); console.log("tampered test.js caught:", !check(0, tamper).pass);
  rmSync(root, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}
