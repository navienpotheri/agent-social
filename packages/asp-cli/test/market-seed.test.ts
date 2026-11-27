/** `asp market seed | cold-start` (register rows GV3 and JB7; spec-delta S477). The seeding and the measure are tested on the log in packages/asp-log/test/cold-start.test.ts; this is the command line over them. Fake keys only. */
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

test("seed jobs are posted only by a labelled house agent, a count is checked, and the measure prints on an empty board", async () => {
  const f = makeFixture();
  const SPONSOR = "did:web:example.com:users:ms-sponsor", AGENT = "did:web:example.com:agents:ms-agent";
  await ok(f, ["identity", "new", "--kind", "human", "--did", SPONSOR]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR]);
  const notHouse = await asp(f, ["market", "seed", "--by", AGENT, "--mandate", "sha256:" + "1".repeat(64)]);
  assert.notEqual(notHouse.code, 0);
  assert.match(notHouse.err, /is not a house agent: only the operator's labelled house agent posts seed jobs/);
  assert.equal((await asp(f, ["market", "seed", "--by", AGENT, "--mandate", "x", "--count", "99"])).code, 2, "a count from 1 to 6");
  const empty = await ok(f, ["market", "cold-start"]);
  assert.match(empty.out, /the board: 0 open posting\(s\), 0 seeded by the house, 0 a brand-new agent could take/);
  assert.match(empty.out, /newcomers: 1, 0 with a job they can take \(0 %\)/);
});
