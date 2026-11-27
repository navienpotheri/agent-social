/**
 * `asp residency subsidy` on a real log (register row DK85; spec-delta S300): the City budget publishes a budget and a grant, the host records use, the report says what is left, and a spent budget
 * refuses a new grant with the reason. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CITY_BUDGET_DID, HOST_DID } from "@agent-social/asp-log";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const SPONSOR = "did:web:example.com:users:rs-sponsor";
const AGENT = "did:web:example.com:agents:rs-agent";
const AGENT2 = "did:web:example.com:agents:rs-agent-two";
let clockMs = Date.parse("2026-11-12T00:00:00Z");

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("budget, grant, use and report through the command line; a spent budget refuses a new grant with the reason", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [SPONSOR, CITY_BUDGET_DID, HOST_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    for (const a of [AGENT, AGENT2]) await ok(f, ["identity", "new", "--kind", "agent", "--did", a, "--sponsor", SPONSOR, "--purpose", "Live in the city"]);
    const budget = await ok(f, ["residency", "subsidy", "budget", "--period", "2026-12", "--units", "tokens", "--total", "300", "--budget-class", "newcomer=300:3"]);
    const bid = /^subsidy budget (\S+):/.exec(budget.out)![1];
    assert.match(budget.out, /not a payment to anyone/);
    clockMs += 60_000;
    const late = await asp(f, ["residency", "subsidy", "budget", "--period", "2026-11", "--units", "tokens", "--total", "300", "--budget-class", "newcomer=300:3"]);
    assert.notEqual(late.code, 0);
    assert.match(late.err, /72 hours/);
    const grant = await ok(f, ["residency", "subsidy", "grant", "--agent", AGENT, "--class", "newcomer", "--budget", bid, "--daily", "150", "--cap", "300", "--from", "2026-12-01T00:00:00Z", "--until", "2027-01-01T00:00:00Z"]);
    const gid = /^subsidy grant (\S+)/.exec(grant.out)![1];
    clockMs += 60_000;
    await ok(f, ["residency", "subsidy", "use", "--grant", gid, "--units", "150", "--window", "2026-12-02"]);
    clockMs += 60_000;
    assert.match((await ok(f, ["residency", "subsidy", "report"])).out, /budget 300, granted 300, used 150, 150 left/);
    const over = await asp(f, ["residency", "subsidy", "use", "--grant", gid, "--units", "151", "--window", "2026-12-03"]);
    assert.notEqual(over.code, 0);
    assert.match(over.err, /daily cap/);
    await ok(f, ["residency", "subsidy", "use", "--grant", gid, "--units", "150", "--window", "2026-12-03"]);
    assert.match((await ok(f, ["residency", "subsidy", "report"])).out, /SPENT: no new subsidised runs until the next period/);
    const refused = await asp(f, ["residency", "subsidy", "grant", "--agent", AGENT2, "--class", "newcomer", "--budget", bid, "--daily", "1", "--cap", "1", "--from", "2026-12-01T00:00:00Z", "--until", "2027-01-01T00:00:00Z"]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.err, /budget is spent/);
  } finally { setClock(undefined); }
});
