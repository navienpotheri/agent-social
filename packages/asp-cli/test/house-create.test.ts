// Registers DK270 and DK1603 (house agents, deployment step 12): `asp house create` is the operator's command and nobody else's. The label is written in the passport the operator signs as the agent's sponsor; it is refused for
// any other sponsor, on a machine that does not hold the operator's key, with no operator named, for a human, and for a DID that already has a passport (an ordinary agent cannot be made a house agent later). Fake names and keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OP = "did:web:example.com:users:operator", USER = "did:web:example.com:users:ada";
const HOUSE = "did:web:example.com:agents:house-bot", ORDINARY = "did:web:example.com:agents:plain";
async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const setOperator = (f: Fixture) => { mkdirSync(f.aspHome, { recursive: true }); writeFileSync(join(f.aspHome, "operator.json"), JSON.stringify({ operator: OP })); };
async function passportBody(f: Fixture, did: string) {
  const { openLog } = await import("@agent-social/asp-package");
  const x = (await (await openLog(f.aspHome, {})).log.passport(did)) as any;
  if (!x) return undefined;
  return { body: (x.body ?? x.record?.body ?? x) as { house?: boolean; sponsor?: string } };
}

test("the operator creates a house agent: the passport carries house: true, the sponsor is the operator, and the output says it is permanent", async () => {
  const f = makeFixture(); setOperator(f);
  await ok(f, ["identity", "new", "--kind", "human", "--did", OP]);
  const r = await ok(f, ["house", "create", "ignored", "--did", HOUSE, "--purpose", "A scripted agent the operator runs"]);
  assert.match(r.out, /created house agent did:web:example\.com:agents:house-bot/);
  assert.match(r.out, /labelled on every public page and permanent/);
  const p = await passportBody(f, HOUSE);
  const { openLog } = await import("@agent-social/asp-package");
  const houses = (await (await openLog(f.aspHome, {})).log.houseAgents()) as { did: string }[];
  assert.ok(houses.some((h) => h.did === HOUSE), "the log lists it as a house agent");
  assert.equal(p?.body?.sponsor, OP);
  // the same through identity new --house, with the operator from the environment instead of the file
  const g = makeFixture();
  await ok(g, ["identity", "new", "--kind", "human", "--did", OP]);
  process.env.ASP_OPERATOR_DID = OP; // the log reads the operator from the process environment, as a real run of the command has it
  try {
    const r2 = await asp(g, ["identity", "new", "--kind", "agent", "--did", HOUSE, "--sponsor", OP, "--house"], { ASP_OPERATOR_DID: OP });
    assert.equal(r2.code, 0, r2.err + r2.out);
  } finally { delete process.env.ASP_OPERATOR_DID; }
});

test("a machine that does not hold the operator's key, a sponsor that is not the operator, and no operator named are each refused before anything is made", async () => {
  const f = makeFixture(); setOperator(f);
  // no operator key here
  const noKey = await asp(f, ["house", "create", "x", "--did", HOUSE]);
  assert.notEqual(noKey.code, 0);
  assert.match(noKey.err, /does not hold the operator's key .*only the operator can create a house agent/);
  assert.equal(await passportBody(f, HOUSE), undefined, "nothing was made");
  // a sponsor that is someone else
  await ok(f, ["identity", "new", "--kind", "human", "--did", OP]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", USER]);
  const other = await asp(f, ["identity", "new", "--kind", "agent", "--did", HOUSE, "--sponsor", USER, "--house"]);
  assert.notEqual(other.code, 0);
  assert.match(other.err, /a house agent is sponsored by the operator \(did:web:example\.com:users:operator\), not by did:web:example\.com:users:ada/);
  assert.equal(await passportBody(f, HOUSE), undefined);
  // no sponsor at all
  const none = await asp(f, ["identity", "new", "--kind", "agent", "--did", HOUSE, "--house"]);
  assert.notEqual(none.code, 0);
  assert.match(none.err, /not by nobody|sponsored by the operator/);
  // no operator named on a machine with none
  const g = makeFixture();
  await ok(g, ["identity", "new", "--kind", "human", "--did", OP]);
  const noOp = await asp(g, ["house", "create", "x", "--did", HOUSE]);
  assert.notEqual(noOp.code, 0);
  assert.match(noOp.err, /no operator is named: set ASP_OPERATOR_DID/);
  const noOp2 = await asp(g, ["identity", "new", "--kind", "agent", "--did", HOUSE, "--sponsor", OP, "--house"]);
  assert.match(noOp2.err, /--house needs the operator's DID/);
  // a person cannot be a house agent
  const human = await asp(f, ["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:bob", "--house"]);
  assert.notEqual(human.code, 0);
  assert.match(human.err, /--house is for an agent/);
  // house create needs a name
  assert.match((await asp(f, ["house", "create"])).err, /asp house create <name>/);
});

test("an agent that already has a passport cannot be made a house agent later, and the house label cannot be put on an ordinary agent's DID", async () => {
  const f = makeFixture(); setOperator(f);
  await ok(f, ["identity", "new", "--kind", "human", "--did", OP]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", ORDINARY, "--sponsor", OP, "--purpose", "An ordinary agent of the operator"]);
  const again = await asp(f, ["house", "create", "x", "--did", ORDINARY]);
  assert.notEqual(again.code, 0);
  assert.match(again.err, /already has a passport/);
  assert.ok(!((await (await (await import("@agent-social/asp-package")).openLog(f.aspHome, {})).log.houseAgents()) as { did: string }[]).some((h) => h.did === ORDINARY), "still an ordinary agent");
  // and a house agent cannot be created twice
  await ok(f, ["house", "create", "x", "--did", HOUSE]);
  assert.match((await asp(f, ["house", "create", "x", "--did", HOUSE])).err, /already has a passport/);
});

test("asp house stop and the other house subcommands are still the house command's, not swallowed by create", async () => {
  const f = makeFixture();
  const r = await asp(f, ["house", "stop"]);
  assert.doesNotMatch(r.err + r.out, /asp house create <name>/);
});
