// asp fleet update --association, attest and record (DK1358, S1411) through the real commands: the enterprise chooses how its fleet takes part in the society, the related-party record is read, and an attestation of a run that is not there is refused. The rules are tested in packages/asp-log/test/related-party.test.ts.
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
const ORG = "did:web:example.com:orgs:rp-cmd-co";

test("an enterprise chooses its association, reads a member's related-party record and cannot attest a run that does not exist", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ORG])).code, 0);
    const FLEET = `${ORG}:fleets:all`;
    assert.equal((await asp(f, ["fleet", "declare", "--org", ORG, "--name", "All", "--purpose", "every agent"])).code, 0);
    assert.match((await asp(f, ["fleet", "show", FLEET])).out, /association with the society: full/);
    assert.notEqual((await asp(f, ["fleet", "update", FLEET, "--association", "secret"])).code, 0);
    assert.equal((await asp(f, ["fleet", "update", FLEET, "--association", "related-party-only"])).code, 0);
    assert.match((await asp(f, ["fleet", "show", FLEET])).out, /association with the society: related-party-only \(its agents offer only to their own sponsor, fleet or controller; standing is computed the same way/);
    assert.equal((await asp(f, ["fleet", "update", FLEET, "--association", "private"])).code, 0);
    assert.match((await asp(f, ["fleet", "show", FLEET])).out, /private.*not shown in discovery/);
    const A = "did:web:example.com:agents:rp-cmd-a";
    assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", A, "--sponsor", ORG, "--fleet", FLEET])).code, 0);
    const rec = await asp(f, ["fleet", "record", "--member", A]);
    assert.equal(rec.code, 0, rec.err);
    assert.match(rec.out, /0 clean attested run\(s\) since the start, 0 job\(s\) at 10 runs a job; association private\. Labelled related-party; never mixed with independent jobs; no credit reward/);
    assert.equal(JSON.parse((await asp(f, ["fleet", "record", "--member", A, "--json"])).out).label, "related-party");
    const bad = await asp(f, ["fleet", "attest", "--member", A, "--action", "sha256:" + "a".repeat(64)]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.err + bad.out, /is not an Action in this log/);
    assert.notEqual((await asp(f, ["fleet", "attest"])).code, 0, "a usage line");
    const st = await asp(f, ["fleet", "standing", "--member", A]);
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /fleet All \(single\), persona none, node root, association private/);
    assert.match(st.out, /same template in this fleet: 1 agent\(s\), 0 counted job\(s\), 0 slash\(es\), 0 strike\(s\)/);
    assert.equal(JSON.parse((await asp(f, ["fleet", "standing", "--member", A, "--json"])).out).kind, "single");
    assert.equal((await asp(f, ["fleet", "standing", "--member", ORG])).code, 1, "not in a fleet");
  } finally { setClock(undefined); }
});
