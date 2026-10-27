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
  assert.deepEqual(infer("Run the benchmark and tell me the result").scopes, ["repo.read", "shell.exec", "tests.run"]);
  assert.deepEqual(infer("Run the tests").scopes, ["repo.read", "shell.exec", "tests.run"]);
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
