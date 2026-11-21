// asp emergency status|stop|lift (GV6, S1420) through the real command: a quiet city, the usage lines, and refusals when a key is missing. The rules are tested in packages/asp-log/test/emergency-stop.test.ts.
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

test("asp emergency says the city is not stopped, and the stop and lift commands refuse what is missing", async () => {
  const f = makeFixture();
  const s = await asp(f, ["emergency", "status"]);
  assert.equal(s.code, 0, s.err);
  assert.match(s.out, /no emergency stop is in force/);
  assert.equal(JSON.parse((await asp(f, ["emergency", "status", "--json"])).out).live, null);
  assert.notEqual((await asp(f, ["emergency", "stop"])).code, 0, "a usage line");
  assert.notEqual((await asp(f, ["emergency", "stop", "--reason", "x", "--hours", "100", "--by", "did:web:o", "--cosign", "did:web:w"])).code, 0, "more than 72 hours is not accepted");
  const noKey = await asp(f, ["emergency", "stop", "--reason", "x", "--hours", "24", "--by", "did:web:example.com:users:nokey", "--cosign", "did:web:example.com:users:nokey2"]);
  assert.notEqual(noKey.code, 0);
  assert.match(noKey.err + noKey.out, /no key for/);
  assert.notEqual((await asp(f, ["emergency", "lift"])).code, 0);
  assert.notEqual((await asp(f, ["emergency", "nonsense"])).code, 0);
});
