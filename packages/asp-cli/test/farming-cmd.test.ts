// asp farming report|flag|freeze (DK1357, S1410) through the real command on a real local log: an empty society has no finding, flagging needs a signer, and a freeze needs an upheld report. The detector and the freeze rules are tested in packages/asp-log/test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp farming reports no finding on a quiet log, flagging needs a signer and a freeze needs an upheld report", async () => {
  const f = makeFixture();
  const r = await asp(f, ["farming", "report"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /0 cluster\(s\) under common control, 0 finding\(s\): leads for the Clinic, never a penalty by themselves/);
  const j = JSON.parse((await asp(f, ["farming", "report", "--json"])).out);
  assert.deepEqual([j.clusters, j.findings, j.flaggedSponsors], [[], [], []]);
  assert.notEqual((await asp(f, ["farming", "flag"])).code, 0, "flag needs --by");
  const none = await asp(f, ["farming", "flag", "--by", "did:web:asp.local:operator"]);
  assert.equal(none.code, 0);
  assert.match(none.out, /no cluster under common control to record/);
  const freeze = await asp(f, ["farming", "freeze", "--report", "sha256:" + "a".repeat(64), "--cluster", "did:web:example.com:users:x"]);
  assert.notEqual(freeze.code, 0);
  assert.match(freeze.err + freeze.out, /is not a report in the log/);
  assert.notEqual((await asp(f, ["farming", "freeze"])).code, 0, "a usage line");
  assert.notEqual((await asp(f, ["farming", "nonsense"])).code, 0);
});
