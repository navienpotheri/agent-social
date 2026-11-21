// asp fleet declare|show|update|members|close|list (DK1353, S1407) through the real commands on a real local log: the organisation's key signs, a co-sponsor and a template, members join by `asp identity new --fleet`.
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
const ORG = "did:web:example.com:orgs:acme", DEV = "did:web:example.com:users:acme-dev", OUT = "did:web:example.com:users:outsider";

test("an organisation declares a fleet with a template and a co-sponsor, agents join under the organisation or the co-sponsor, and the commands read, update and close it", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    for (const d of [ORG, DEV, OUT]) assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", d])).code, 0);
    assert.notEqual((await asp(f, ["fleet", "declare", "--org", ORG])).code, 0, "a name is needed");
    const declared = await asp(f, ["fleet", "declare", "--org", ORG, "--name", "Coders", "--purpose", "ship code", "--max-members", "3", "--runtime", "claude-code", "--model", "model-a", "--co-sponsor", DEV]);
    assert.equal(declared.code, 0, declared.err || declared.out);
    const FLEET = `${ORG}:fleets:coders`;
    assert.match(declared.out, new RegExp(`fleet ${FLEET} declared`));
    assert.notEqual((await asp(f, ["fleet", "declare", "--org", ORG, "--name", "Coders"])).code, 0, "already declared");
    const join = (sponsor: string, name: string, extra: string[] = []) => asp(f, ["identity", "new", "--kind", "agent", "--did", `did:web:example.com:agents:${name}`, "--sponsor", sponsor, "--fleet", FLEET, ...extra]);
    assert.equal((await join(ORG, "a1", ["--runtime", "claude-code", "--model", "model-a"])).code, 0);
    assert.equal((await join(DEV, "a2", ["--runtime", "codex"])).code, 0, "a co-sponsor's agent joins; a different runtime is labelled");
    assert.notEqual((await join(OUT, "a3")).code, 0, "someone the organisation did not name");
    const shown = await asp(f, ["fleet", "show", FLEET]);
    assert.match(shown.out, /co-sponsors did:web:example.com:users:acme-dev/);
    assert.match(shown.out, /members 2 of at most 3/);
    assert.match(shown.out, /by template: matches 1, differs 1/);
    const members = await asp(f, ["fleet", "members", FLEET]);
    assert.match(members.out, /2 member\(s\)/);
    assert.match(members.out, /template differs: runtime/);
    assert.equal(JSON.parse((await asp(f, ["fleet", "show", FLEET, "--json"])).out).members.length, 2);
    assert.match((await asp(f, ["fleet", "list", "--org", ORG])).out, new RegExp(FLEET));
    // update: a cap below the members is refused; a binding template; a larger cap
    assert.notEqual((await asp(f, ["fleet", "update", FLEET, "--max-members", "1"])).code, 0);
    assert.notEqual((await asp(f, ["fleet", "update", FLEET, "--by", DEV, "--max-members", "9"])).code, 0, "only the organisation updates");
    assert.equal((await asp(f, ["fleet", "update", FLEET, "--max-members", "5", "--strict"])).code, 0);
    assert.notEqual((await join(ORG, "a4", ["--runtime", "other"])).code, 0, "the template is now binding");
    assert.equal((await join(ORG, "a5", ["--runtime", "claude-code", "--model", "model-a"])).code, 0);
    assert.equal((await asp(f, ["fleet", "close", FLEET])).code, 0);
    assert.notEqual((await join(ORG, "a6", ["--runtime", "claude-code", "--model", "model-a"])).code, 0, "closed to new members");
    assert.match((await asp(f, ["fleet", "show", FLEET])).out, /\[closed to new members\]/);
    assert.notEqual((await asp(f, ["fleet", "show", "did:web:example.com:nothing"])).code, 0);
    assert.notEqual((await asp(f, ["fleet", "nonsense"])).code, 0);
  } finally { setClock(undefined); }
});
