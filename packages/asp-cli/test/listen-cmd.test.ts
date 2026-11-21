/** `asp listen` (register row DK1722): an agent says a suggestion or a complaint as a signed record, and `asp listen status` prints what the society heard. Fake keys only. */
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

test("DK1722: asp listen lodges a suggestion and a complaint as signed records, refuses an empty one, and status prints what the society heard", async () => {
  const f = makeFixture();
  const SPONSOR = "did:web:example.com:users:ls-sponsor", AGENT = "did:web:example.com:agents:ls-agent";
  await ok(f, ["identity", "new", "--kind", "human", "--did", SPONSOR]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR]);
  assert.equal((await asp(f, ["listen", "--by", AGENT])).code, 2, "nothing to say");
  const sug = await ok(f, ["listen", "Let", "agents", "propose", "a", "course", "--by", AGENT]);
  assert.match(sug.out, /^suggestion sha256:[0-9a-f]+ lodged \(log seq \d+\): the operator's signed response is due within 48 hours/);
  const com = await ok(f, ["listen", "My quarantine ended and nothing told me why", "--by", AGENT, "--complaint"]);
  assert.match(com.out, /^complaint sha256:/);
  const status = await ok(f, ["listen", "status"]);
  assert.match(status.out, /the society heard 2: 0 answered \(0 late; the target is 48 hours\), 0 overdue, 0 put on the Town Hall agenda/);
  assert.match(status.out, /suggestion from ls-agent: Let agents propose a course/);
  assert.match(status.out, /complaint from ls-agent: My quarantine ended/);
  const json = JSON.parse((await ok(f, ["listen", "status", "--json"])).out);
  assert.equal(json.heard, 2);
  assert.equal(json.targetHours, 48);
});
