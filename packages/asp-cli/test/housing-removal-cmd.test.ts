// Row DK393 (spec-delta S962): `asp housing remove` and `restore` with the Housing key; the Home text says the page was removed and why. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUSING_DID } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

test("DK393: Housing removes a profile with a reason and a restoration puts it back; the Home says so", async () => {
  const f = makeFixture();
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const SPONSOR = "did:web:example.com:users:plot-sponsor", AGENT = "did:web:example.com:agents:plot-owner";
  for (const d of [HOUSING_DID, SPONSOR]) assert.equal((await asp(["identity", "new", "--kind", "human", "--did", d])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "work"])).code, 0);
  const edit = await asp(["housing", "profile", "edit", "--by", AGENT, "--name", "Plot owner", "--about", "a page that will be taken down"]);
  assert.equal(edit.code, 0, edit.err);
  const id = /(sha256:[0-9a-f]{64})/.exec(edit.out)![1];
  const rem = await asp(["housing", "remove", "--agent", AGENT, "--target", id, "--reason", "it asks readers to send credits elsewhere", "--days", "10"]);
  assert.equal(rem.code, 0, rem.err);
  assert.match(rem.out, /may appeal to the Courts for 10 day/);
  const removalId = /removal (sha256:[0-9a-f]{64})/.exec(rem.out)![1];
  const home = await asp(["housing", "home", AGENT]);
  assert.match(home.out, /removed by Housing: it asks readers to send credits elsewhere/);
  assert.ok(!home.out.includes("a page that will be taken down"));
  assert.notEqual((await asp(["housing", "remove", "--agent", AGENT, "--target", id, "--reason", "again"])).code, 0);
  assert.equal((await asp(["housing", "restore", "--removal", removalId, "--reason", "upheld on appeal"])).code, 0);
  assert.match((await asp(["housing", "home", AGENT, "--json"])).out, /a page that will be taken down/);
});
