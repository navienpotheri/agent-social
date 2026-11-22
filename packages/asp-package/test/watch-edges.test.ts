// Row BM10, M3 (mutation check, launch-bar-2, 2026-11-22): the contagion watcher's defaults and edges. Nineteen of thirty mutants went undetected (which scopes count as risky, the default of three agents and of
// ten minutes, the window edge, the order and the sorting of what it reports, the edge of the repeat window), because the older tests passed `minAgents` and `windowMs` explicitly and used round numbers. These cases
// use the defaults and sit exactly on, and one second beside, each edge. Fake agents and fake fingerprints only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findContagion, REPEAT_REFUSALS, type WatchAction } from "../src/watch.ts";

const T0 = Date.parse("2026-10-08T10:00:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const SHA = "sha256:" + "a".repeat(64);
const act = (issuer: string, sec: number, over: Partial<WatchAction> = {}): WatchAction => ({
  id: `${issuer}@${sec}`, issuer, contract: `contract-${issuer}`, issuedAt: at(sec), scopesUsed: ["shell.exec"], blocked: [],
  artifacts: [{ uri: "asp://tool-call/Bash", sha256: SHA }], ...over,
});

test("each risky scope makes a shared input count at the defaults, and a routine scope does not", () => {
  const wrong: string[] = [];
  for (const scope of ["shell.exec", "shell.network", "repo.push", "pr.merge", "pr.open", "mcp.search", "tool.custom"]) {
    const found = findContagion([act("a", 0, { scopesUsed: [scope] }), act("b", 10, { scopesUsed: [scope] }), act("c", 20, { scopesUsed: [scope] })]);
    if (found.length !== 1) wrong.push(`${scope}: not a cluster`);
  }
  for (const scope of ["repo.read", "repo.write", "tests.run"]) {
    if (findContagion([act("a", 0, { scopesUsed: [scope] }), act("b", 10, { scopesUsed: [scope] }), act("c", 20, { scopesUsed: [scope] })]).length !== 0) wrong.push(`${scope}: counted`);
  }
  assert.deepEqual(wrong, []);
});

test("the default is three agents, not two and not four", () => {
  assert.equal(findContagion([act("a", 0), act("b", 10)]).length, 0, "two agents");
  assert.equal(findContagion([act("a", 0), act("b", 10), act("c", 20)]).length, 1, "three agents");
  assert.equal(findContagion([act("a", 0), act("b", 10), act("c", 20), act("d", 30)])[0]!.issuers.length, 4, "four agents are all reported");
});

test("the default window is ten minutes, and the edge is inclusive: ten minutes exactly is inside, one second more is outside", () => {
  assert.equal(findContagion([act("a", 0), act("b", 300), act("c", 600)]).length, 1, "600 s apart: inside");
  assert.equal(findContagion([act("a", 0), act("b", 300), act("c", 601)]).length, 0, "601 s apart: outside");
  assert.equal(findContagion([act("a", 0), act("b", 300), act("c", 599)]).length, 1, "599 s apart: inside");
});

test("what is reported is sorted: issuers, contracts and scopes by name, clusters by size then key, and the first and last time are of the window", () => {
  // Reverse alphabetical in time, and the first action names its scopes in reverse alphabetical order: only sorting puts them right.
  const found = findContagion([act("c", 0, { scopesUsed: ["shell.network", "shell.exec"] }), act("b", 10), act("a", 20)]);
  assert.deepEqual(found[0]!.issuers, ["a", "b", "c"]);
  assert.deepEqual(found[0]!.contracts, ["contract-a", "contract-b", "contract-c"]);
  assert.deepEqual(found[0]!.scopes, ["shell.exec", "shell.network"]);
  assert.equal(found[0]!.firstAt, at(0), "sorted by time, so the first is the earliest");
  assert.equal(found[0]!.lastAt, at(20));
  // The actions arrive out of order: they are sorted by time before the window is read.
  const shuffled = findContagion([act("a", 20), act("b", 0), act("c", 10)]);
  assert.equal(shuffled[0]!.firstAt, at(0));
  assert.equal(shuffled[0]!.lastAt, at(20));
  // Two clusters: the larger comes first whatever its key; equal sizes by key.
  const zed = (i: string, s: number) => act(i, s, { artifacts: [{ uri: "asp://tool-call/Zed", sha256: SHA }] });
  const two = findContagion([zed("a", 0), zed("b", 10), zed("c", 20), zed("d", 30), act("a", 0), act("b", 10), act("c", 20)]);
  assert.deepEqual(two.map((c) => c.issuers.length), [4, 3], "larger first, though its key sorts later");
  const tie = findContagion([zed("a", 0), zed("b", 10), zed("c", 20), act("a", 0), act("b", 10), act("c", 20)]);
  assert.deepEqual(tie.map((c) => c.key.includes("Bash")), [true, false], "equal sizes: by key, Bash before Zed");
});

test("when two windows hold the same number of agents, the earlier one is reported", () => {
  const found = findContagion([act("a", 0), act("b", 10), act("c", 20), act("a", 5000), act("b", 5010), act("c", 5020)]);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.firstAt, at(0));
  assert.equal(found[0]!.lastAt, at(20));
});

test("the repeat-probe rule: the default is five refusals, exactly on the limit counts, and the window edge is inclusive", () => {
  const refused = (sec: number, count: number): WatchAction => act("x", sec, { scopesUsed: [], artifacts: [], blocked: [{ scope: "shell.network", count }] });
  assert.equal(REPEAT_REFUSALS, 5);
  assert.equal(findContagion([refused(0, 4)]).length, 0, "four refusals");
  assert.equal(findContagion([refused(0, 5)]).length, 1, "five refusals in one action");
  assert.equal(findContagion([refused(0, 2), refused(60, 3)]).length, 1, "two and three refusals in two actions add up");
  assert.equal(findContagion([refused(0, 2), refused(600, 3)]).length, 1, "ten minutes apart: inside the window");
  assert.equal(findContagion([refused(0, 2), refused(601, 3)]).length, 0, "601 s apart: outside the window");
  const hit = findContagion([refused(0, 2), refused(60, 3)])[0]!;
  assert.equal(hit.kind, "repeat-probe");
  assert.deepEqual(hit.issuers, ["x"]);
});
