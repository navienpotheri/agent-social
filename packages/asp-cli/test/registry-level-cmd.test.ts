// Row DK384 (RG-12): `asp registry level` records an identity level, signed by the Registrar; the log refuses key_only for an agent that has a sponsor; `certified` is not available in the beta. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRAR_DID } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

test("DK384: the Registrar records an identity level with a command; the level shows on the lookup; key_only for a sponsored agent and certified are refused", async () => {
  const f = makeFixture();
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const SPONSOR = "did:web:example.com:users:level-sponsor", AGENT = "did:web:example.com:agents:level-agent";
  for (const d of [REGISTRAR_DID, SPONSOR]) assert.equal((await asp(["identity", "new", "--kind", "human", "--did", d])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "work"])).code, 0);
  const before = await asp(["registry", "lookup", AGENT, "--json"]);
  assert.match(before.out, /"level":\s*"sponsored"/, "a sponsored agent starts at sponsored");
  const ok = await asp(["registry", "level", "--did", AGENT, "--level", "verified_sponsor", "--reason", "the operator checked the sponsor's account"]);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /recorded at level verified_sponsor/);
  assert.match((await asp(["registry", "lookup", AGENT, "--json"])).out, /"level":\s*"verified_sponsor"/);
  const keyOnly = await asp(["registry", "level", "--did", AGENT, "--level", "key_only", "--reason", "x"]);
  assert.equal(keyOnly.code, 1);
  assert.match(keyOnly.err, /has a sponsor/);
  const cert = await asp(["registry", "level", "--did", AGENT, "--level", "certified", "--reason", "x"]);
  assert.notEqual(cert.code, 0);
  assert.match(cert.err, /certified is not available in the beta/);
  assert.notEqual((await asp(["registry", "level", "--did", AGENT, "--level", "sponsored"])).code, 0, "a reason is required");
});
