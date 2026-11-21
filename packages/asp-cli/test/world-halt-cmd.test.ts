// DK76 (S1402): the world's kill-switch through the real commands on a real local log: `asp world halt` (the operator's own key) stops the daily tick, `asp world resume` ends it (after 24 hours with the owner's
// co-signature), and `asp world invariants` reads what must hold. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OPERATOR = "did:web:asp.local:operator", OWNER = "did:web:asp.local:owner";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ASP_OPERATOR_DID: OPERATOR, ASP_OWNER_DID: OWNER }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("halt stops the tick and the world state, resume ends it; a resume a day later needs the owner; the invariants hold", async () => {
  const savedOp = process.env.ASP_OPERATOR_DID, savedOwner = process.env.ASP_OWNER_DID;
  process.env.ASP_OPERATOR_DID = OPERATOR; process.env.ASP_OWNER_DID = OWNER;
  try {
    const f = makeFixture();
    for (const d of [OPERATOR, OWNER]) { const r = await asp(f, ["identity", "new", "--kind", "human", "--did", d]); assert.equal(r.code, 0, r.err || r.out); }
    setClock(() => new Date("2026-11-20T10:00:00Z"));
    const tick1 = await asp(f, ["world", "tick", "--seed", "cmd-halt-seed", "--day", "2026-11-18", "--days", "2"]);
    assert.equal(tick1.code, 0, tick1.err || tick1.out);
    assert.match(tick1.out, /2 day\(s\) written/);
    const inv = await asp(f, ["world", "invariants"]);
    assert.equal(inv.code, 0, inv.out);
    assert.match(inv.out, /invariants hold: 2 day record\(s\)/);

    assert.notEqual((await asp(f, ["world", "halt", "--reason", "x"])).code, 0, "a halt names the operator");
    assert.match((await asp(f, ["world", "halt", "--by", OPERATOR])).err, /says why/);
    const halted = await asp(f, ["world", "halt", "--by", OPERATOR, "--reason", "a shock is hurting newcomers"]);
    assert.equal(halted.code, 0, halted.err || halted.out);
    assert.match(halted.out, /halted:/);
    assert.notEqual((await asp(f, ["world", "halt", "--by", OPERATOR, "--reason", "again"])).code, 0, "already halted");
    const stopped = await asp(f, ["world", "tick", "--day", "2026-11-20"]);
    assert.equal(stopped.code, 1);
    assert.match(stopped.out, /the world is halted since .*a shock is hurting newcomers/);
    const today = await asp(f, ["world", "today", "--json"]);
    assert.equal(JSON.parse(today.out).state.halted.reason, "a shock is hurting newcomers");

    // a day later: the operator alone is refused, with the owner it works
    setClock(() => new Date("2026-11-21T11:00:00Z"));
    const alone = await asp(f, ["world", "resume", "--by", OPERATOR, "--reason", "a day later"]);
    assert.notEqual(alone.code, 0);
    assert.match(alone.err, /owner's co-signature/);
    const withOwner = await asp(f, ["world", "resume", "--by", OPERATOR, "--reason", "reviewed with the owner", "--cosign-by", OWNER]);
    assert.equal(withOwner.code, 0, withOwner.err || withOwner.out);
    assert.match(withOwner.out, /resumed:/);
    assert.equal(JSON.parse((await asp(f, ["world", "today", "--json"])).out).state.halted, null);
    assert.equal((await asp(f, ["world", "resume", "--by", OPERATOR, "--reason", "nothing open"])).code, 1);
    const again = await asp(f, ["world", "tick", "--day", "2026-11-20"]);
    assert.equal(again.code, 0, again.err || again.out);
  } finally {
    setClock(undefined);
    if (savedOp === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = savedOp;
    if (savedOwner === undefined) delete process.env.ASP_OWNER_DID; else process.env.ASP_OWNER_DID = savedOwner;
  }
});
