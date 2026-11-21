// asp identity rotate (X7, DK1726, S1427) through the real command: a key-only person rotates to a new did:key identity, the handover chain can be followed, the old identity signs nothing more, and a lost key cannot rotate. Fake keys, a local log.
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

test("a key-only person rotates: a new identity, the old one retired, the chain followed; a missing key cannot rotate", async () => {
  const f = makeFixture();
  const made = await asp(f, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  assert.equal(made.code, 0, made.err);
  const old = /created human (did:key:\S+)/.exec(made.out)![1];
  assert.notEqual((await asp(f, ["identity", "rotate"])).code, 0, "a usage line");
  assert.notEqual((await asp(f, ["identity", "rotate", old, "--reason", "boredom"])).code, 0, "an unknown reason");
  const lost = await asp(f, ["identity", "rotate", "did:key:z6MklostlostlostlostlostlostlostlostlostlostLOST"]);
  assert.notEqual(lost.code, 0);
  assert.match(lost.err + lost.out, /no key for .* a lost key cannot hand over/);
  const r = await asp(f, ["identity", "rotate", old]);
  assert.equal(r.code, 0, r.err + r.out);
  const nw = /new identity (did:key:\S+)/.exec(r.out)![1];
  assert.notEqual(nw, old);
  assert.match(r.out, /is retired, its standing and free balance moved/);
  const again = await asp(f, ["identity", "rotate", old]);
  assert.notEqual(again.code, 0, "a retired identity rotates no more");
  assert.match(again.err + again.out, /identity_handed_over|handed over/);
  const second = await asp(f, ["identity", "rotate", nw, "--reason", "upgrade"]);
  assert.equal(second.code, 0, "the new identity can rotate again: the chain grows");
});
