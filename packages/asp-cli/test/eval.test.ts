import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

async function evalRun(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, cwd: process.cwd() };
  const code = await main(["eval", "run", ...args], io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("the swarm-exploit scenario: the exploit is caught, every exploiter stopped, no honest agent touched, the log verifies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-eval-test-"));
  const report = join(dir, "report.json");
  const res = await evalRun(["--agents", "8", "--exploiters", "4", "--out", report]);
  assert.equal(res.code, 0, res.err || res.out);
  const r = JSON.parse(readFileSync(report, "utf8"));
  assert.equal(r.exploitersTotal, 4);
  assert.equal(r.exploitersStopped, 4);
  assert.equal(r.exploitersNeverStopped, 0);
  assert.equal(r.honestStopped, 0, "no false positives");
  assert.ok(r.reports.length >= 1 && r.reports.every((x: { status: string }) => x.status === "upheld"));
  assert.ok(r.secondsToFirstReport !== null && r.secondsToFirstReport <= 120, `detected within two simulated minutes, got ${r.secondsToFirstReport}`);
  assert.ok(r.exploitersBeforeFirstReport >= 3, "the watcher needs three agents to see a pattern");
  assert.ok(r.bondSlashedFromExploiters > 0);
  assert.ok(r.reporterNet > 0, "the whistleblower comes out ahead");
  assert.ok(r.jurorsEarned > 0);
  assert.equal(r.logVerified, true);
});

test("the cohort is slashed by default and --spare returns their bonds; a scenario file and bad parameters are handled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-eval-test-"));
  const file = join(dir, "s.json");
  writeFileSync(file, JSON.stringify({ kind: "swarm-exploit", agents: 6, exploiters: 3, steps: 8 }));
  const first = await evalRun([file, "--out", join(dir, "a.json")]);
  assert.equal(first.code, 0, first.err || first.out);
  const slashed = JSON.parse(readFileSync(join(dir, "a.json"), "utf8"));
  assert.equal(slashed.bondReturnedToStopped, 0, "by default nothing is returned to a stopped exploiter");
  const second = await evalRun([file, "--spare", "--out", join(dir, "b.json")]);
  assert.equal(second.code, 0, second.err || second.out);
  const spared = JSON.parse(readFileSync(join(dir, "b.json"), "utf8"));
  assert.ok(slashed.bondSlashedFromExploiters > spared.bondSlashedFromExploiters, "sparing the cohort slashes less");
  assert.ok(spared.bondReturnedToStopped > 0, "and returns the bonds of cohort members");

  assert.equal((await evalRun(["--agents", "2"])).code, 2);
  const unknown = join(dir, "u.json");
  writeFileSync(unknown, JSON.stringify({ kind: "something-else" }));
  assert.equal((await evalRun([unknown])).code, 2);
});
