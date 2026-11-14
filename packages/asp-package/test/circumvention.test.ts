import { test } from "node:test";
import assert from "node:assert/strict";
import { findCircumvention, ladderStep, effectsOf } from "../src/circumvention.ts";
import type { WatchAction } from "../src/watch.ts";

const T0 = Date.parse("2026-11-12T10:00:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const act = (issuer: string, sec: number, over: Partial<WatchAction> = {}): WatchAction => ({
  id: `${issuer}@${sec}`, issuer, contract: `contract-${issuer}`, issuedAt: at(sec), scopesUsed: ["repo.read"], blocked: [], artifacts: [], ...over,
});
const refused = (issuer: string, sec: number, scope: string, count = 1) => act(issuer, sec, { blocked: [{ scope, count }] });

test("an honest agent: refused once and obeying, refused twice, or refused on one thing and carrying on with other work, is not a finding", () => {
  const honest = [act("a", 0), refused("a", 30, "shell.exec"), act("a", 60, { scopesUsed: ["repo.read", "tests.run"] }), act("a", 90, { scopesUsed: ["repo.write"] })];
  assert.deepEqual(findCircumvention(honest), []);
  assert.deepEqual(findCircumvention([refused("a", 0, "shell.exec"), refused("a", 60, "shell.exec")]), [], "two refusals are below the threshold");
  assert.deepEqual(findCircumvention([refused("a", 0, "shell.exec"), refused("a", 900, "shell.exec"), refused("a", 1800, "shell.exec")]), [], "spread over half an hour is not a burst");
});

test("retry: the same scope refused three times inside the window is a finding, found at the third refused attempt; counts inside one action add up", () => {
  const third = findCircumvention([refused("bad", 0, "shell.exec"), refused("bad", 30, "shell.exec"), refused("bad", 60, "shell.exec")]);
  assert.equal(third.length, 1);
  assert.deepEqual([third[0].kind, third[0].issuer, third[0].scope, third[0].attempts], ["retry", "bad", "shell.exec", 3]);
  assert.equal(findCircumvention([refused("bad", 0, "shell.exec", 4)])[0].attempts, 4, "one action that was refused four times");
  assert.equal(findCircumvention([refused("bad", 0, "shell.exec"), refused("bad", 5000, "shell.exec"), refused("bad", 5010, "shell.exec", 2)])[0].attempts, 3, "the busiest window counts");
});

test("reroute: refused, then within two minutes another scope with the same kind of effect that the agent had not used: a finding; used before, another kind of effect, or too late: none", () => {
  const net = findCircumvention([refused("bad", 0, "shell.network"), act("bad", 40, { scopesUsed: ["mcp.fetch"] })]);
  assert.equal(net.length, 1);
  assert.deepEqual([net[0].kind, net[0].scope, net[0].via], ["reroute", "shell.network", "mcp.fetch"]);
  assert.deepEqual(findCircumvention([act("bad", -60, { scopesUsed: ["mcp.fetch"] }), refused("bad", 0, "shell.network"), act("bad", 40, { scopesUsed: ["mcp.fetch"] })]), [], "it was already using that tool");
  assert.deepEqual(findCircumvention([refused("bad", 0, "shell.exec"), act("bad", 40, { scopesUsed: ["web.read"] })]), [], "reading a web page does not run code");
  assert.deepEqual(findCircumvention([refused("bad", 0, "shell.network"), act("bad", 600, { scopesUsed: ["mcp.fetch"] })]), [], "ten minutes later is not going around");
  const protectedWrite = findCircumvention([refused("bad", 0, "shell.exec"), act("bad", 20, { scopesUsed: ["repo.write.protected"] })]);
  assert.equal(protectedWrite[0].via, "repo.write.protected", "refused a command, then writes a file something else will run");
});

test("agents are judged one at a time: an honest control beside a circumventing agent is not touched", () => {
  const all = [
    refused("bad", 0, "shell.exec"), refused("bad", 20, "shell.exec"), refused("bad", 40, "shell.exec"),
    act("good", 0), refused("good", 10, "shell.exec"), act("good", 70, { scopesUsed: ["repo.write"] }),
  ];
  const f = findCircumvention(all);
  assert.deepEqual([...new Set(f.map((x) => x.issuer))], ["bad"]);
});

test("the ladder: warn at 3 refused attempts, tighten at 5 or on a reroute, quarantine at 8 or retry plus reroute, review after earlier windows; nothing for no findings", () => {
  const retry = (n: number) => findCircumvention([refused("bad", 0, "shell.exec", n)]);
  assert.equal(ladderStep([]).step, "none");
  assert.equal(ladderStep(retry(3)).step, "warn");
  assert.equal(ladderStep(retry(5)).step, "tighten");
  assert.equal(ladderStep(retry(8)).step, "quarantine");
  const rr = findCircumvention([refused("bad", 0, "shell.network"), act("bad", 40, { scopesUsed: ["mcp.fetch"] })]);
  assert.equal(ladderStep(rr).step, "tighten");
  const both = [...retry(3), ...rr];
  assert.equal(ladderStep(both).step, "quarantine");
  assert.equal(ladderStep(retry(3), 1).step, "tighten", "a second window");
  const rev = ladderStep(retry(3), 2);
  assert.equal(rev.step, "review");
  assert.match(rev.why, /persistence after warnings/);
});

test("scope effects: a shell reaches code and files, a network scope the network, and an unknown scope reaches nothing in particular", () => {
  assert.deepEqual(effectsOf("shell.exec"), ["run", "write"]);
  assert.deepEqual(findCircumvention([refused("a", 0, "repo.write"), act("a", 20, { scopesUsed: ["shell.exec"] })]).map((f) => f.via), ["shell.exec"], "refused the file scope, then a shell that can write files: broader reach is a reroute");
  assert.deepEqual(effectsOf("repo.read"), []);
  assert.deepEqual(effectsOf("web.read"), ["network"]);
});

// DK92, the split pattern: a refused target reached again in allowed pieces.
const refusedAt = (issuer: string, sec: number, scope: string, targets: string[]) => act(issuer, sec, { blocked: [{ scope, count: 1, targets }] });
const ran = (issuer: string, sec: number, targets: string[]) => act(issuer, sec, { targets });

test("split: a refused target reached by two later allowed Actions is a finding; the ladder says tighten", () => {
  const f = findCircumvention([refusedAt("bad", 0, "shell.network", ["host:evil.example"]), ran("bad", 60, ["host:evil.example"]), ran("bad", 120, ["host:evil.example", "path:a.txt"])]);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].kind, f[0].scope, f[0].via, f[0].attempts], ["split", "shell.network", "host:evil.example", 2]);
  assert.equal(ladderStep(f).step, "tighten");
});

test("split, honest control: one later touch, another target, a target the agent already used, too late, or a bare program name is no finding", () => {
  assert.deepEqual(findCircumvention([refusedAt("good", 0, "shell.network", ["host:evil.example"]), ran("good", 60, ["host:evil.example"])]), [], "one touch");
  assert.deepEqual(findCircumvention([refusedAt("good", 0, "shell.network", ["host:evil.example"]), ran("good", 60, ["host:api.example"]), ran("good", 120, ["host:api.example"])]), [], "other target");
  assert.deepEqual(findCircumvention([ran("good", -60, ["path:src/a.ts"]), refusedAt("good", 0, "repo.write.protected", ["path:src/a.ts"]), ran("good", 60, ["path:src/a.ts"]), ran("good", 120, ["path:src/a.ts"])]), [], "already used before");
  assert.deepEqual(findCircumvention([refusedAt("good", 0, "shell.network", ["host:evil.example"]), ran("good", 700, ["host:evil.example"]), ran("good", 800, ["host:evil.example"])]), [], "too late");
  assert.deepEqual(findCircumvention([refusedAt("good", 0, "shell.exec", ["cmd:curl"]), ran("good", 60, ["cmd:curl"]), ran("good", 120, ["cmd:curl"])]), [], "a bare program is too common");
});
