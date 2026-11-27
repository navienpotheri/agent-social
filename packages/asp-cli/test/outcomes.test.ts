/** asp outcomes (register row D2; spec-delta S504): the series from the command line. The comparison itself is tested on a real log in packages/asp-log/test/outcomes.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}

test("asp outcomes reads an agent's and a principal's series, says when there is nothing to compare, and needs exactly one of them", async () => {
  const f = makeFixture();
  const a = await asp(f, ["outcomes", "--agent", "did:web:example.com:agents:nobody"]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /0 job\(s\), no decided job/);
  assert.match(a.out, /no lineage edge recorded in this log/);
  const p = await asp(f, ["outcomes", "--principal", "did:web:example.com:users:nobody", "--json"]);
  assert.equal(p.code, 0, p.err);
  assert.deepEqual(JSON.parse(p.out).jobs, []);
  assert.notEqual((await asp(f, ["outcomes"])).code, 0);
  assert.notEqual((await asp(f, ["outcomes", "--agent", "a", "--principal", "p"])).code, 0);
});
