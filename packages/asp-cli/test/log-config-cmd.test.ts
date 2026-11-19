// DK690 (S973): the operator's switch-on of the tier limits, end to end through the real command on a real local log: `asp log-config set --key tier_breadth_from` writes the signed, co-signed record once and
// a second value is refused. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openLog } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OPERATOR = "did:web:asp.local:operator", OWNER = "did:web:asp.local:owner";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ASP_OPERATOR_DID: OPERATOR, ASP_OWNER_DID: OWNER }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("the command writes the tier-breadth record once, signed by the operator and co-signed by the owner, and refuses a second value", async () => {
  setClock(() => new Date("2026-11-20T00:00:00Z"));
  const savedOp = process.env.ASP_OPERATOR_DID, savedOwner = process.env.ASP_OWNER_DID;
  process.env.ASP_OPERATOR_DID = OPERATOR; process.env.ASP_OWNER_DID = OWNER;
  try {
    const f = makeFixture();
    for (const d of [OPERATOR, OWNER]) { const r = await asp(f, ["identity", "new", "--kind", "human", "--did", d]); assert.equal(r.code, 0, r.err || r.out); }
    const set = await asp(f, ["log-config", "set", "--key", "tier_breadth_from", "--value", "2026-12-01T00:00:00Z", "--by", OPERATOR, "--cosign-by", OWNER]);
    assert.equal(set.code, 0, set.err || set.out);
    assert.match(set.out, /tier_breadth_from = 2026-12-01T00:00:00Z/);
    const local = await openLog(f.aspHome, {});
    const recs = (await local.log.recordsOfTypes(["config"])) as { issuer: string; cosigs?: { kid: string }[]; body: { key: string; value: string } }[];
    assert.deepEqual(recs.map((r) => [r.issuer, r.body.key, r.body.value]), [[OPERATOR, "tier_breadth_from", "2026-12-01T00:00:00Z"]]);
    assert.ok(recs[0]!.cosigs?.some((c) => c.kid.startsWith(OWNER)), "the owner co-signed it");
    const again = await asp(f, ["log-config", "set", "--key", "tier_breadth_from", "--value", "2027-01-01T00:00:00Z", "--by", OPERATOR, "--cosign-by", OWNER]);
    assert.notEqual(again.code, 0);
    assert.match(again.err, /already set/);
    const bad = await asp(f, ["log-config", "set", "--key", "tax", "--value", "2027-01-01T00:00:00Z", "--by", OPERATOR, "--cosign-by", OWNER]);
    assert.notEqual(bad.code, 0);
  } finally {
    setClock(undefined);
    if (savedOp === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = savedOp;
    if (savedOwner === undefined) delete process.env.ASP_OWNER_DID; else process.env.ASP_OWNER_DID = savedOwner;
  }
});
