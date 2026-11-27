/**
 * `asp house list | stop | start` on a real log (register row DK291; spec-delta S371): the operator lists its house agents, stops one (the Registrar's interim suspension) and restarts it; a real agent is not in the
 * list and cannot be stopped this way. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecord } from "@agent-social/asp-core";
import { REGISTRAR_DID } from "@agent-social/asp-log";
import { Keystore, openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OPERATOR = "did:web:example.com:users:house-operator";
const HOUSE = "did:web:example.com:agents:house-bot";
const REAL = "did:web:example.com:agents:real-bot";
const SPONSOR = "did:web:example.com:users:real-sponsor";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("the operator lists, stops and restarts a house agent; a real agent is not a house agent", async () => {
  const f = makeFixture();
  const before = process.env.ASP_OPERATOR_DID;
  process.env.ASP_OPERATOR_DID = OPERATOR;
  try {
    for (const d of [OPERATOR, REGISTRAR_DID, SPONSOR]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", HOUSE, "--sponsor", OPERATOR, "--purpose", "Keep the society busy"]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", REAL, "--sponsor", SPONSOR, "--purpose", "Real work"]);
    assert.match((await ok(f, ["house", "list"])).out, /0 house agent/);
    // The operator marks its own agent as a house agent: a passport update that adds the label, signed by the sponsor.
    const log = await openLog(f.aspHome, {});
    const head = (await log.log.passport(HOUSE))!.head;
    const body = { ...((await log.log.get(head))!.record.body as Record<string, unknown>), house: true };
    await log.append(createRecord({ type: "passport", issuer: OPERATOR, subject: HOUSE, prev: head, body, issued_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }, new Keystore(f.aspHome).forDid(OPERATOR)!));
    const list = await ok(f, ["house", "list"]);
    assert.match(list.out, /1 house agent/);
    assert.ok(list.out.includes(HOUSE) && list.out.includes("[house agent]") && !list.out.includes(REAL));
    const wrong = await asp(f, ["house", "stop", "--agent", REAL, "--reason", "no"]);
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.err, /is not a house agent/);
    const stop = await ok(f, ["house", "stop", "--agent", HOUSE, "--reason", "the operator pauses the house agents", "--days", "2"]);
    assert.match(stop.out, /stopped .* until .*no new Bond, Mandate, Proposal or purchase/);
    const id = /\((sha256:[0-9a-f]+),/.exec(stop.out)![1];
    assert.match((await ok(f, ["registry", "lookup", HOUSE])).out, /SUSPENDED/);
    assert.match((await ok(f, ["house", "start", "--suspension", id])).out, /restarted/);
    assert.ok(!/SUSPENDED/.test((await ok(f, ["registry", "lookup", HOUSE])).out));
  } finally { if (before === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = before; }
});
