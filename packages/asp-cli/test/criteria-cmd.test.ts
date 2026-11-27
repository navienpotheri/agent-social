// JO1: `asp market criteria` lists templates and checks criteria you wrote; `asp market intent` warns, never refuses, about a criterion that reads as a judgement. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("JO1: the templates are listed and one is printed as flags; a criterion you wrote is checked; an unknown template is an error", async () => {
  const f = makeFixture();
  const list = await asp(f, ["market", "criteria"]);
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /code-change: A code change that must pass its tests/);
  assert.match(list.out, /research: A question answered with evidence/);
  const one = await asp(f, ["market", "criteria", "--template", "code-change"]);
  assert.match(one.out, /--criteria "All existing tests pass"/);
  assert.doesNotMatch(one.out, /research:/);
  const missing = await asp(f, ["market", "criteria", "--template", "nope"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /no template nope: code-change/);
  const bad = await asp(f, ["market", "criteria", "--criterion", "make it nice", "--criterion", "All tests pass"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /#1 "make it nice": reads as a judgement/);
  assert.match(bad.out, /1 of 2 criteria to rewrite/);
  const good = await asp(f, ["market", "criteria", "--criterion", "All tests pass", "--criterion", "No new dependency is added"]);
  assert.equal(good.code, 0);
  assert.match(good.out, /all 2 criteria read as checks/);
});

test("JO1: a posted intent warns about a vague criterion and about the default (the purpose), and still posts; clean criteria warn nothing", async () => {
  const f = makeFixture();
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE])).code, 0);
  const post = (extra: string[]) => asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix the flaky date parser test", "--budget", "100", "--deadline", "2026-12-01T00:00:00Z", ...extra]);
  const vague = await post(["--criteria", "make the code clean and good"]);
  assert.equal(vague.code, 0, "advice never refuses");
  assert.match(vague.out, /^intent /);
  assert.match(vague.err, /criteria {2}#1 "make the code clean and good": reads as a judgement/);
  assert.match(vague.err, /asp market criteria lists templates/);
  const dflt = await post([]);
  assert.match(dflt.err, /purpose again/, "no criteria given: the purpose stands in, and the poster is told");
  const clean = await post(["--criteria", "All existing tests pass", "--criteria", "No new dependency is added"]);
  assert.equal(clean.code, 0);
  assert.doesNotMatch(clean.err, /criteria {2}#/);
});
