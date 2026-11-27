/** `asp town` (register rows DK1720 and DK1724): the agenda from the command line, and the log's own refusals shown as they are: an agent with no standing cannot propose or vote, and a reserved matter is refused. Fake keys only. */
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

test("DK1720: asp town lists the agenda, needs its flags, and the log's refusals are printed: no standing, no proposal", async () => {
  const f = makeFixture();
  const SPONSOR = "did:web:example.com:users:tw-sponsor", AGENT = "did:web:example.com:agents:tw-agent";
  await ok(f, ["identity", "new", "--kind", "human", "--did", SPONSOR]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR]);
  const empty = await ok(f, ["town", "list"]);
  assert.match(empty.out, /the Town Hall: 0 proposal\(s\); votable: policy, course, learning_path, institution, setting, rule_change; reserved: code_article, safety_floor, money_creation, legal; a quorum is 5 controllers/);
  assert.equal((await asp(f, ["town", "propose", "--by", AGENT])).code, 2, "flags are required");
  assert.equal((await asp(f, ["town", "vote", "--by", AGENT])).code, 2);
  assert.equal((await asp(f, ["town", "propose", "--by", AGENT, "--title", "Two study hours", "--kind", "setting", "--key", "academy.study_hours", "--value", "{bad"])).code, 2, "the value is JSON");
  const noStanding = await asp(f, ["town", "propose", "--by", AGENT, "--title", "Two study hours", "--kind", "setting", "--key", "academy.study_hours", "--value", "2"]);
  assert.notEqual(noStanding.code, 0);
  assert.match(noStanding.err + noStanding.out, /a proposer needs a passport and standing \(a counted job\)/);
  const reserved = await asp(f, ["town", "propose", "--by", AGENT, "--title", "Change the Code", "--kind", "code_article", "--key", "code.3.7", "--value", "1"]);
  assert.match(reserved.err + reserved.out, /code_article is reserved|reserved/);
  assert.match((await ok(f, ["town", "offerings"])).out, /^0 course proposal\(s\) through the Town Hall/);
  const json = JSON.parse((await ok(f, ["town", "list", "--json"])).out);
  assert.deepEqual(json.proposals, []);
});
