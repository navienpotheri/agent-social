import { test } from "node:test";
import assert from "node:assert/strict";
import { allowScopes, inferScopes } from "../src/index.ts";

// Gap BM17: a task gets the permissions it seems to need.
const FULL = ["repo.read", "repo.write", "shell.exec", "tests.run"];
const infer = (p?: string, allow: string[] = []) => inferScopes(p, FULL, allow);

test("no task: the usual set, nothing narrowed", () => {
  const r = infer(undefined);
  assert.deepEqual(r.scopes, FULL);
  assert.equal(r.narrowed, false);
  assert.deepEqual(infer("   ").scopes, FULL);
});

test("a question or a review reads and nothing else", () => {
  for (const p of ["Explain how the gateway decides", "Review src/ for security problems", "Find where the Mandate is signed", "What does judge.ts do?", "Summarize the open gaps"]) {
    assert.deepEqual(infer(p).scopes, ["repo.read"], p);
    assert.equal(infer(p).narrowed, true);
  }
});

test("a change task may write and run tests, not arbitrary commands", () => {
  assert.deepEqual(infer("Fix the failing date parser").scopes, ["repo.read", "repo.write", "tests.run"]);
  assert.deepEqual(infer("Add a unit test for the throttle").scopes, ["repo.read", "repo.write", "tests.run"]);
});

test("a task that says to run or build also gets commands", () => {
  assert.deepEqual(infer("Implement the feature and build it").scopes, FULL);
  assert.deepEqual(infer("Run the benchmark and tell me the result").scopes, ["repo.read", "shell.exec"]);
  assert.deepEqual(infer("Run the tests").scopes, ["repo.read", "tests.run"], "running the tests is the tests scope, not a general command");
});

test("words are not commands: nouns, build output, and a workflow that runs the tests", () => {
  assert.deepEqual(infer("Write a script that converts the CSV files to JSON").scopes, ["repo.read", "repo.write"], "a script to write is not a command to run");
  assert.deepEqual(infer("Delete the old build artifacts in dist/").scopes, ["repo.read", "repo.write"]);
  assert.deepEqual(infer("Check whether the README is out of date compared with the commands").scopes, ["repo.read"]);
  assert.deepEqual(infer("Set up a GitHub Actions workflow that runs the tests").scopes, ["repo.read", "repo.write", "tests.run"]);
  assert.deepEqual(infer("Format the code with prettier").scopes, ["repo.read", "shell.exec"], "the formatter edits the files itself");
  assert.deepEqual(infer("Debug why the build is slow").scopes, ["repo.read", "repo.write", "shell.exec"]);
});

test("a change to words is not checked by tests, a change to code is", () => {
  assert.deepEqual(infer("Translate the README into Spanish").scopes, ["repo.read", "repo.write"]);
  assert.deepEqual(infer("Update the changelog for this release").scopes, ["repo.read", "repo.write"]);
  assert.deepEqual(infer("Rename the function parseDate to parseIsoDate everywhere").scopes, ["repo.read", "repo.write", "tests.run"]);
  assert.deepEqual(infer("Refactor the forum module into smaller files").scopes, ["repo.read", "repo.write", "tests.run"]);
});

test("--allow widens, and the line says how", () => {
  const r = infer("Explain the gateway", allowScopes("writes", FULL));
  assert.deepEqual(r.scopes, ["repo.read", "repo.write"]);
  assert.deepEqual(infer("Explain the gateway", allowScopes("all", FULL)).scopes, FULL);
  assert.match(infer("Explain the gateway").why, /--allow writes,commands,tests/);
});

test("allowScopes names", () => {
  assert.deepEqual(allowScopes("writes,commands", FULL), ["repo.write", "shell.exec", "tests.run"]);
  assert.deepEqual(allowScopes("protected", FULL), ["repo.write.protected"]);
  assert.deepEqual(allowScopes(undefined, FULL), []);
  assert.deepEqual(inferScopes("Explain", FULL, ["repo.write.protected"]).scopes, ["repo.read", "repo.write.protected"], "a scope outside the usual set is kept when named");
});

test("the widen value is what was left out", () => {
  assert.equal(infer("Explain the gateway").widen, "writes,commands,tests");
  assert.equal(infer("Fix the date parser").widen, "commands");
  assert.equal(infer(undefined).widen, "");
});

test("presets: review reads, develop reads writes and tests, full is the usual set", async () => {
  const { presetScopes, isPreset } = await import("../src/index.ts");
  assert.deepEqual(presetScopes("review", FULL).scopes, ["repo.read"]);
  assert.deepEqual(presetScopes("develop", FULL).scopes, ["repo.read", "repo.write", "tests.run"]);
  assert.equal(presetScopes("develop", FULL).widen, "commands");
  assert.deepEqual(presetScopes("full", FULL).scopes, FULL);
  assert.equal(presetScopes("full", FULL).narrowed, false);
  assert.deepEqual(presetScopes("review", FULL, ["repo.write"]).scopes, ["repo.read", "repo.write"]);
  assert.equal(isPreset("develop"), true);
  assert.equal(isPreset("everything"), false);
});
