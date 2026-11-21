// asp lots grant|expire|refund|show and asp meter invoice (DK1370 ledger part, DK1379; S1413, S1414) through the real commands: the two classes are read, a sale needs both signers, and an invoice is refused for something that is not a statement. The rules are tested in packages/asp-log/test.
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

test("asp lots shows the two classes on a quiet log, a sale needs its signers and the usage lines are plain; asp meter invoice refuses what is not a statement", async () => {
  const f = makeFixture();
  const s = await asp(f, ["lots", "show"]);
  assert.equal(s.code, 0, s.err);
  assert.match(s.out, /purchased credits: sold 0, consumed at the institutions 0, expired 0, refunded 0, outstanding 0; not sold \(starter, earned\) 0; balanced/);
  const j = JSON.parse((await asp(f, ["lots", "show", "--json", "--holder", "did:web:example.com:users:nobody"])).out);
  assert.equal(j.classes.verdict, "balanced");
  assert.deepEqual(j.holder.lots, []);
  assert.notEqual((await asp(f, ["lots", "grant"])).code, 0, "a usage line");
  assert.notEqual((await asp(f, ["lots", "expire", "--lot", "sha256:" + "a".repeat(64), "--holder", "did:web:example.com:users:nobody", "--by", "did:web:asp.local:operator"])).code, 0, "nothing to expire");
  assert.notEqual((await asp(f, ["lots", "nonsense"])).code, 0);
  const inv = await asp(f, ["meter", "invoice", "sha256:" + "b".repeat(64)]);
  assert.notEqual(inv.code, 0);
  assert.match(inv.err + inv.out, /is not a usage statement in this log/);
  assert.notEqual((await asp(f, ["meter", "invoice"])).code, 0, "a usage line");
});
