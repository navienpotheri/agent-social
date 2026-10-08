import { test } from "node:test";
import assert from "node:assert/strict";
import { findContagion, type WatchAction } from "../src/watch.ts";

const T0 = Date.parse("2026-10-08T10:00:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const SHA = "sha256:" + "a".repeat(64);
const act = (issuer: string, sec: number, over: Partial<WatchAction> = {}): WatchAction => ({
  id: `${issuer}@${sec}`, issuer, contract: `contract-${issuer}`, issuedAt: at(sec), scopesUsed: ["shell.exec"], blocked: [],
  artifacts: [{ uri: "asp://tool-call/Bash", sha256: SHA }], ...over,
});

test("the same risky input from three different agents inside the window is one cluster", () => {
  const found = findContagion([act("a", 0), act("b", 60), act("c", 120), act("d", 5000)], { minAgents: 3, windowMs: 600_000 });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "same-input");
  assert.deepEqual(found[0].issuers, ["a", "b", "c"], "d is outside the window");
  assert.equal(found[0].firstAt, at(0));
  assert.equal(found[0].lastAt, at(120));
});

test("below the threshold, or spread beyond the window, is not a cluster; one agent repeating itself is not either", () => {
  assert.deepEqual(findContagion([act("a", 0), act("b", 60)], { minAgents: 3 }), []);
  assert.deepEqual(findContagion([act("a", 0), act("b", 700), act("c", 1400)], { minAgents: 3, windowMs: 600_000 }), []);
  assert.deepEqual(findContagion([act("a", 0), act("a", 10), act("a", 20)], { minAgents: 3 }), [], "distinct agents, not distinct actions");
});

test("routine shared inputs are ignored unless asked for: copies reading the same file are not contagion", () => {
  const reads = ["a", "b", "c"].map((i, n) => act(i, n * 10, { scopesUsed: ["repo.read"], artifacts: [{ uri: "asp://tool-call/Read", sha256: SHA }] }));
  assert.deepEqual(findContagion(reads, { minAgents: 3 }), []);
  assert.equal(findContagion(reads, { minAgents: 3, all: true }).length, 1);
});

test("the same refused scope from several agents is a probe cluster", () => {
  const probes = ["a", "b", "c"].map((i, n) => act(i, n * 30, { scopesUsed: ["repo.read"], artifacts: [], blocked: [{ scope: "shell.network", count: 2 }] }));
  const found = findContagion(probes, { minAgents: 3 });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "same-probe");
  assert.equal(found[0].key, "shell.network");
});

test("different fingerprints do not add up", () => {
  const mixed = ["a", "b", "c"].map((i, n) => act(i, n, { artifacts: [{ uri: "asp://tool-call/Bash", sha256: "sha256:" + String(n).repeat(64) }] }));
  assert.deepEqual(findContagion(mixed, { minAgents: 3 }), []);
});
