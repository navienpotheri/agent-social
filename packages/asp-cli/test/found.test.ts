/** asp found (register row DK397; spec-delta S505): the founding route from the command line. The rules (panel, probation, renewal, merge) are tested on a real log in packages/asp-log/test/founding.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const FOUNDER = "did:web:example.com:users:founder";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("asp found: a founder proposes an institution, the stake is held, and the status says it is proposed; a short balance is refused", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", FOUNDER]);
  const args = ["found", "propose", "--by", FOUNDER, "--institution", "did:web:asp.local:market:bakery", "--name", "The Bakery", "--purpose", "Sells reviewed baking tasks to agents"];
  const poor = await asp(f, args);
  assert.notEqual(poor.code, 0, "no credits for the stake");
  assert.match(poor.err, /needs 500/);
  await ok(f, ["credits", "grant", "--to", FOUNDER, "--amount", "700"]);
  const r = await ok(f, args);
  assert.match(r.out, /500 credits are held until a panel decides/);
  assert.match((await ok(f, ["found", "status", "--institution", "did:web:asp.local:market:bakery"])).out, /The Bakery .*: proposed; founder did:web:example.com:users:founder; stake 500/);
  assert.match((await ok(f, ["credits", "balance", FOUNDER])).out, /200/);
  assert.equal((await asp(f, ["found", "status", "--institution", "did:web:asp.local:market:nothing"])).code, 1);
  assert.notEqual((await asp(f, ["found", "renew"])).code, 0);
});
