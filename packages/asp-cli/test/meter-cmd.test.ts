// asp meter report|plan|statement|check (DK1379, S1414) through the real command on a real local log: the report counts a fleet's usage from the log, a statement needs a plan, and the usage errors are plain. The pricing and the rules are tested in packages/asp-log/test/metering.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ORG = "did:web:example.com:orgs:meter-cmd-co";

test("asp meter reports a fleet's usage from the log, and refuses a statement without a plan or a bad month", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ORG])).code, 0);
    const FLEET = `${ORG}:fleets:all`;
    assert.equal((await asp(f, ["fleet", "declare", "--org", ORG, "--name", "All", "--purpose", "every agent"])).code, 0);
    const A = "did:web:example.com:agents:meter-cmd-a";
    assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", A, "--sponsor", ORG, "--fleet", FLEET])).code, 0);
    const r = await asp(f, ["meter", "report", "--fleet", FLEET, "--month", "2026-11"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /usage of .* in 2026-11: 0 active agent\(s\), 0 write\(s\), 0 action\(s\), 0 token\(s\).*reads counted by the service, not the log/);
    const j = JSON.parse((await asp(f, ["meter", "report", "--org", ORG, "--month", "2026-11", "--json"])).out);
    assert.equal(j.usage.activeAgents, 0);
    assert.equal(j.perAgent.length, 1);
    assert.notEqual((await asp(f, ["meter", "report"])).code, 0, "a scope is needed");
    assert.notEqual((await asp(f, ["meter", "report", "--fleet", FLEET, "--month", "2026-13"])).code, 0, "a bad month");
    const st = await asp(f, ["meter", "statement", "--holder", ORG, "--month", "2026-11", "--plan", "nope", "--by", ORG]);
    assert.notEqual(st.code, 0);
    assert.match(st.err + st.out, /nope is not a plan in this log/);
    assert.notEqual((await asp(f, ["meter", "plan"])).code, 0, "a usage line");
    assert.notEqual((await asp(f, ["meter", "check"])).code, 0, "a usage line");
    assert.equal((await asp(f, ["meter", "check", "sha256:" + "0".repeat(64)])).code, 1, "not a statement");
  } finally { setClock(undefined); }
});
