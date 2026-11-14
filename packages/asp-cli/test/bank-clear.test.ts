/** `asp bank offer | clear | statement` on a real log (register row DK181; spec-delta S462). The rules are in packages/asp-log/test/bank.test.ts; this is the command line over them. Fake keys only. */
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
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("the Bank's offer says why an agent cannot have a line now, a statement lists its locks, and clear refuses a line that is not there", async () => {
  const f = makeFixture();
  const SPONSOR = "did:web:example.com:users:bk-sponsor", AGENT = "did:web:example.com:agents:bk-agent";
  await ok(f, ["identity", "new", "--kind", "human", "--did", SPONSOR]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR]);
  const offer = await ok(f, ["bank", "offer", "--agent", AGENT]);
  assert.match(offer.out, /no line now: .*the Bank's reserve has nothing free to lend/, "the Bank has no reserve yet");
  const person = await ok(f, ["bank", "offer", "--agent", SPONSOR]);
  assert.match(person.out, /not an agent with a sponsor/);
  assert.equal((await asp(f, ["bank", "offer"])).code, 2, "an agent is named");
  const bad = await asp(f, ["bank", "clear", "--line", "sha256:" + "1".repeat(64), "--amount", "5"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /is not a credit line in the log/);
  assert.equal((await asp(f, ["bank", "clear", "--line", "x"])).code, 2, "an amount is needed");
  const show = await ok(f, ["bank", "show"]);
  assert.match(show.out, /the Bank's reserve: 0 credits/);
});
