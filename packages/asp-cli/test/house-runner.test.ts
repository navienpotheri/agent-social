/**
 * The house-agent runner (register row DK270): a labelled house agent drives jobs through the Market on the test ledger (post, offer, contract, bond, Mandate, deliver, accept, settle) with the command line's own commands; the
 * stop switch (`asp house stop`, DK291) halts it mid-run because the log refuses the house agent's next Mandate; the operator's own pause halts it between steps; the society view lists the agent labelled. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecord } from "@agent-social/asp-core";
import { REGISTRAR_DID, societyMap } from "@agent-social/asp-log";
import { Keystore, openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { runHouse, type Asp } from "../src/house-runner.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OPERATOR = "did:web:example.com:users:house-op", HOUSE = "did:web:example.com:agents:house-runner", SPONSOR = "did:web:example.com:users:real-sp", PERFORMER = "did:web:example.com:agents:real-worker", BANK = "did:web:example.com:bank";
process.env.ASP_OPERATOR_DID = OPERATOR; // this test file is its own process
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function aspFor(f: Fixture): Asp {
  return async (args) => { const out: string[] = [], err: string[] = []; const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root }; const code = await main(args, io); return { code, out: out.join("\n"), err: err.join("\n") }; };
}
async function setup() {
  const f = makeFixture(), asp = aspFor(f);
  for (const d of [OPERATOR, SPONSOR, BANK, REGISTRAR_DID]) assert.equal((await asp(["identity", "new", "--kind", "human", "--did", d])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", HOUSE, "--sponsor", OPERATOR, "--purpose", "Keep the board busy"])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", PERFORMER, "--sponsor", SPONSOR, "--purpose", "Do small jobs"])).code, 0);
  const log = await openLog(f.aspHome, {});
  const head = (await log.log.passport(HOUSE))!.head;
  await log.append(createRecord({ type: "passport", issuer: OPERATOR, subject: HOUSE, prev: head, body: { ...((await log.log.get(head))!.record.body as Record<string, unknown>), house: true }, issued_at: nowIso() }, new Keystore(f.aspHome).forDid(OPERATOR)!));
  for (const [to, n] of [[HOUSE, 2000], [PERFORMER, 500]] as const) { const g = await asp(["credits", "grant", "--to", to, "--amount", String(n), "--by", OPERATOR, "--reason", "bootstrap"]); assert.equal(g.code, 0, g.err); }
  return { f, asp };
}
const JOBS = [{ purpose: "Summarise one page", criteria: "a summary of 5 lines", price: 100, bond: 20 }, { purpose: "List three open questions", criteria: "three questions", price: 80, bond: 10 }];
const script = { house: HOUSE, performer: PERFORMER, bank: BANK, jobs: JOBS, deadline: "2099-01-01T00:00:00Z", eta: "2098-12-01T00:00:00Z" };

test("DK270 runner: a house agent drives two jobs from post to settlement on the test ledger; the money moves as for any agent", async () => {
  const { asp } = await setup();
  const run = await runHouse(asp, script);
  assert.equal(run.halted, undefined, JSON.stringify(run.halted));
  assert.equal(run.settled, 2);
  assert.deepEqual(run.steps.slice(0, 8).map((s) => s.step), ["intent", "offer", "contract", "bond", "mandate", "deliver", "accept", "settle"]);
  assert.ok(run.steps.every((s) => s.ok));
  assert.match((await asp(["credits", "balance", PERFORMER])).out, /680 credits/, "500 plus the two prices, bonds back");
  assert.match((await asp(["credits", "balance", HOUSE])).out, /1820 credits/, "2000 less the two prices");
});

test("DK270 runner: the society view lists the house agent, labelled, and the runner's jobs appear as flows", async () => {
  const { f, asp } = await setup();
  await runHouse(asp, { ...script, jobs: [JOBS[0]!] });
  const k = await openLog(f.aspHome, {});
  const h = await k.log.head();
  const feed = societyMap({ stored: (await k.log.since(0, 100000)) as never, head: { seq: h.seq, hash: h.logHash }, now: nowIso(), rep: new Map(), operator: OPERATOR });
  const house = feed.agents.find((a) => a.name.includes("house-runner"));
  assert.ok(house, "the house agent is on the map");
  assert.equal(house!.house, true, "labelled");
  assert.equal(feed.agents.find((a) => a.name.includes("real-worker"))!.house, false, "the real worker is not");
  assert.ok(feed.flows.length > 0, "the jobs show as flows");
});

test("DK270 runner: the stop switch halts it mid-run: the job under way finishes, the log refuses the house agent's next contract, and nothing of the second job goes further", async () => {
  const { asp } = await setup();
  let stopped = false;
  const withStop: Asp = async (args) => {
    if (args[1] === "mandate" && !stopped) { stopped = true; const r = await asp(["house", "stop", "--agent", HOUSE, "--reason", "test of the stop switch"]); assert.equal(r.code, 0, r.err); }
    return asp(args);
  };
  const run = await runHouse(withStop, script, {});
  assert.equal(run.settled, 1, "the job under way was finished");
  assert.equal(run.halted?.reason, "stopped", run.halted?.says);
  assert.equal(run.halted?.job, 1);
  assert.equal(run.halted?.step, "contract");
  assert.ok(!run.steps.some((s) => s.job === 1 && ["bond", "mandate", "deliver", "accept", "settle"].includes(s.step)), "nothing after the refusal");
  const list = await asp(["house", "list"]);
  assert.ok(list.out.includes(HOUSE));
});

test("DK270 runner: the operator's own pause halts it between steps, and it can be run again for the rest", async () => {
  const { asp } = await setup();
  let n = 0;
  const first = await runHouse(asp, script, { abort: () => ++n > 10 });
  assert.equal(first.halted?.reason, "aborted");
  assert.equal(first.settled, 1, "the first job finished (8 steps), the second was paused at step 3");
  assert.equal(first.halted?.job, 1);
  const rest = await runHouse(asp, { ...script, jobs: [JOBS[1]!] });
  assert.equal(rest.settled, 1);
});

test("DK270 runner: `asp house run` runs the jobs from the command line, refuses a real agent, and reports the stop switch", async () => {
  const { asp } = await setup();
  const real = await asp(["house", "run", "--agent", PERFORMER, "--performer", PERFORMER, "--bank", BANK]);
  assert.notEqual(real.code, 0);
  assert.match(real.err, /is not a house agent/);
  const ok = await asp(["house", "run", "--agent", HOUSE, "--performer", PERFORMER, "--bank", BANK, "--count", "2"]);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /2 of 2 job\(s\) settled/);
  assert.equal((await asp(["house", "stop", "--agent", HOUSE, "--reason", "test"])).code, 0);
  const again = await asp(["house", "run", "--agent", HOUSE, "--performer", PERFORMER, "--bank", BANK]);
  assert.equal(again.code, 1);
  assert.match(again.out, /0 of 1 job\(s\) settled; stopped at job 1, contract/);
  assert.match(again.out, /asp house start --suspension/);
});
