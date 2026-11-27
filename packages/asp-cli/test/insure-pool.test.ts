// asp insure pool-open|pool-return|pool-close (BI-14, DK185): the usage line and the refusals through the real command; the rules are tested in packages/asp-log/test/insurer-mutual.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

async function asp(f: ReturnType<typeof makeFixture>, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp insure pool-open says what it needs, and refuses an organisation it has no key for", async () => {
  const f = makeFixture();
  const usage = await asp(f, ["insure", "pool-open"]);
  assert.notEqual(usage.code, 0);
  assert.match(usage.err + usage.out, /pool-open\|pool-return\|pool-close --fleet/);
  const noKey = await asp(f, ["insure", "pool-open", "--fleet", "did:web:example.com:orgs:acme:fleets:x", "--by", "did:web:example.com:orgs:nokey"]);
  assert.notEqual(noKey.code, 0);
  assert.match(noKey.err + noKey.out, /no key|not a fleet|unknown/i);
});
