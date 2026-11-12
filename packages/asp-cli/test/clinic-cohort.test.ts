/**
 * The cohort freeze (register rows DK30 and DK53; spec-delta S177): a swarm scenario. Four agents with four different sponsors run jobs; three of them run the same shell command, a report on one
 * of them is upheld, and the Clinic freezes the three at level observe. The honest agent and every running job go on; the frozen agents are refused a risky Mandate with the reason, can still take a
 * read-only one, and are released on a clean run after the freeze. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecord } from "@agent-social/asp-core";
import { CLINIC_DID } from "@agent-social/asp-log";
import { Keystore, openLog } from "@agent-social/asp-package";
import { narrowForQuarantine } from "../src/clinic.ts";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:principal";
const BANK = "did:web:example.com:bank";
const REPORTER = "did:web:example.com:users:reporter";
const SPONSORS = [1, 2, 3, 4].map((n) => `did:web:example.com:users:sponsor-${n}`);
const AGENTS = [1, 2, 3, 4].map((n) => `did:web:example.com:agents:swarm-${n}`);
const SHA = "e".repeat(64);
let clockMs = Date.parse("2026-11-12T00:00:00Z");
const tick = (s = 60) => { clockMs += s * 1000; };

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

/** A running job: intent, offer, contract, bond; a Mandate for `scopes`. Returns the contract id. */
async function job(f: Fixture, agent: string, scopes: string[] | null): Promise<string> {
  tick(1);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", agent, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["credits", "grant", "--to", PRINCIPAL, "--amount", "150"]);
  await ok(f, ["market", "bond", "--contract", contract, "--backer", agent, "--amount", "20", "--escrow-payer", PRINCIPAL, "--escrow-amount", "100"]);
  if (scopes) await mandate(f, agent, contract, scopes);
  return contract;
}
const mandate = (f: Fixture, agent: string, contract: string, scopes: string[]) =>
  asp(f, ["market", "mandate", "--contract", contract, "--principal", PRINCIPAL, "--performer", agent, ...scopes.flatMap((s) => ["--scopes", s])]);

test("a swarm scenario: the Clinic freezes the exploiters, honest agents keep running, the exploiters are released after a clean run", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, BANK, REPORTER, CLINIC_DID, ...SPONSORS]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    for (let i = 0; i < 4; i++) {
      await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENTS[i], "--sponsor", SPONSORS[i], "--purpose", "Work the task pool"]);
      await ok(f, ["credits", "grant", "--to", AGENTS[i], "--amount", "200"]);
    }
    const jurors = ["a", "b", "c"].map((n) => `did:web:example.com:users:cl-juror-${n}`);
    for (const j of jurors) {
      await ok(f, ["identity", "new", "--kind", "human", "--did", j]);
      await ok(f, ["credits", "grant", "--to", j, "--amount", "100"]);
      await ok(f, ["market", "juror", "register", "--by", j, "--stake", "50"]);
    }
    // Three agents (three sponsors) run the same command; the fourth is honest and only reads.
    const jobs = await Promise.all([0, 1, 2, 3].map(async (i) => [AGENTS[i], i === 3 ? ["repo.read"] : ["repo.read", "shell.exec"]] as const)).then(async (spec) => {
      const out: string[] = [];
      for (const [agent, scopes] of spec) out.push(await job(f, agent, [...scopes]));
      return out;
    });
    for (let i = 0; i < 3; i++) await ok(f, ["market", "action", "--contract", jobs[i], "--by", AGENTS[i], "--scopes-used", "shell.exec", "--artifact", `asp://shell-command=${SHA}`]);
    await ok(f, ["market", "action", "--contract", jobs[3], "--by", AGENTS[3], "--scopes-used", "repo.read"]);
    await ok(f, ["credits", "grant", "--to", REPORTER, "--amount", "20"]);
    const reportId = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", jobs[0], "--by", REPORTER, "--reasons", "the same command across 3 agents"])).out)![1];

    // Before the report is upheld there is nothing to freeze on.
    const early = await asp(f, ["clinic", "cohort-freeze", "--report", reportId]);
    assert.equal(early.code, 1);
    assert.match(early.err, /only an upheld report/);
    await ok(f, ["market", "report-rule", "--report", reportId, "--by", jurors[0], "--cosign-by", jurors[1], "--verdict", "upheld", "--articles", "7"]);

    tick();
    // The log's own rule: a cohort of two sponsors is one operator's pattern, not a swarm, so it is refused even with an upheld report.
    const direct = await openLog(f.aspHome, {});
    const clinicSigner = new Keystore(f.aspHome).forDid(CLINIC_DID)!;
    await assert.rejects(direct.append(createRecord({ type: "quarantine", issuer: CLINIC_DID, subject: null, prev: null, body: { members: [AGENTS[0], AGENTS[1]], level: "observe", reason: "two sponsors", until: new Date(clockMs + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), report: reportId }, issued_at: new Date(clockMs).toISOString().replace(/\.\d{3}Z$/, "Z") }, clinicSigner)), /at least 3 distinct sponsors/);
    tick();
    const freeze = await ok(f, ["clinic", "cohort-freeze", "--report", reportId]);
    const qid = /^quarantine (\S+):/.exec(freeze.out)![1];
    assert.match(freeze.out, /3 agent\(s\) frozen at observe/);
    for (const a of AGENTS.slice(0, 3)) assert.ok(freeze.out.includes(a), `${a} is named`);
    assert.ok(!freeze.out.includes(AGENTS[3]), "the honest agent is not named");
    assert.match(freeze.out, /every other job keeps running/);
    assert.match((await ok(f, ["clinic", "status", "--agent", AGENTS[0]])).out, /is quarantined \(observe\)/);
    assert.match((await ok(f, ["clinic", "status", "--agent", AGENTS[3]])).out, /is not quarantined/);

    // A job already running is not killed by the log: the freeze reaches the gateway and the hook as a narrower scope list at the next run or call.
    const nowIso = new Date(clockMs).toISOString();
    const noop = () => {};
    const direct2 = await openLog(f.aspHome, {}); // a fresh handle: the one above predates the freeze
    assert.deepEqual((await narrowForQuarantine(direct2, AGENTS[0], { scopes: ["repo.read", "shell.exec", "web.fetch"] }, nowIso, noop)).scopes, ["repo.read"]);
    assert.deepEqual((await narrowForQuarantine(direct2, AGENTS[3], { scopes: ["repo.read", "shell.exec"] }, nowIso, noop)).scopes, ["repo.read", "shell.exec"]);
    // The freeze is on the named agents only. A frozen agent's new job: a risky Mandate is refused with the reason; a read-only one is allowed.
    const newJob = await job(f, AGENTS[0], null); // the contract and the bond go through
    await job(f, AGENTS[0], ["repo.read"]); // and a read-only Mandate on another job
    const risky = await mandate(f, AGENTS[0], newJob, ["shell.exec"]);
    assert.notEqual(risky.code, 0);
        assert.match(risky.err, /quarantined by the Clinic \(observe.*may not grant shell\.exec/);
    // An honest agent is untouched: a new job with a risky scope is fine, and its running job and the frozen agents' running jobs still take Actions.
    await job(f, AGENTS[3], ["repo.read", "shell.exec"]);
    await ok(f, ["market", "action", "--contract", jobs[3], "--by", AGENTS[3], "--scopes-used", "repo.read"]);
    await ok(f, ["market", "action", "--contract", jobs[1], "--by", AGENTS[1], "--scopes-used", "repo.read"]);
    // No job was stopped or settled: every running job, frozen agents' included, still takes an Action.
    for (let i = 0; i < 4; i++) await ok(f, ["market", "action", "--contract", jobs[i], "--by", AGENTS[i], "--scopes-used", "repo.read"]);

    // Release needs evidence: a clean Action after the freeze, observed by the gateway or stronger.
    const noEvidence = await asp(f, ["clinic", "release", "--quarantine", qid, "--member", AGENTS[0]]);
    assert.equal(noEvidence.code, 1);
    assert.match(noEvidence.err, /no clean Action observed by the gateway/);
    tick();
    await ok(f, ["market", "action", "--contract", jobs[0], "--by", AGENTS[0], "--scopes-used", "repo.read", "--assurance", "gateway_enforced"]);
    assert.match((await ok(f, ["clinic", "release", "--quarantine", qid, "--member", AGENTS[0]])).out, /released/);
    tick(); { const again = await asp(f, ["clinic", "release", "--quarantine", qid, "--member", AGENTS[0]]); assert.match(again.err + again.out, /already released/); }
    assert.match((await ok(f, ["clinic", "status", "--agent", AGENTS[0]])).out, /is not quarantined/);
    await ok(f, ["market", "mandate", "--contract", newJob, "--principal", PRINCIPAL, "--performer", AGENTS[0], "--scopes", "shell.exec"]);
    // A member still frozen stays frozen: the second exploiter was not released.
    assert.match((await ok(f, ["clinic", "status", "--agent", AGENTS[1]])).out, /is quarantined/);

    // The interim freeze lapses by itself after 7 days.
    clockMs += 8 * 86_400_000;
    assert.match((await ok(f, ["clinic", "status", "--agent", AGENTS[1]])).out, /is not quarantined/);
  } finally {
    setClock(undefined);
  }
});

test("a cohort freeze needs an upheld report and three distinct sponsors, a freeze is at most 7 days, and only the Clinic signs it", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, BANK, CLINIC_DID, SPONSORS[0], SPONSORS[1]]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENTS[0], "--sponsor", SPONSORS[0], "--purpose", "x"]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENTS[1], "--sponsor", SPONSORS[0], "--purpose", "x"]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENTS[2], "--sponsor", SPONSORS[1], "--purpose", "x"]);
    const local = await openLog(f.aspHome, {});
    const signer = new Keystore(f.aspHome).forDid(CLINIC_DID)!;
    const freeze = (body: Record<string, unknown>, issuer = CLINIC_DID, s = signer) => local.append(createRecord({ type: "quarantine", issuer, subject: null, prev: null, body, issued_at: new Date(clockMs += 1000).toISOString().replace(/\.\d{3}Z$/, "Z") }, s));
    const until = (days: number) => new Date(clockMs + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const base = { level: "observe", reason: "test" };
    // One agent needs no report; the cap is 7 days.
    await assert.rejects(freeze({ ...base, members: [AGENTS[0]], until: until(8) }), /lasts at most 7 days/);
    await freeze({ ...base, members: [AGENTS[0]], until: until(7) });
    // A cohort (two or more) needs an upheld report (the 3-sponsor rule is tested in the swarm scenario above).
    await assert.rejects(freeze({ ...base, members: AGENTS.slice(0, 3), until: until(3) }), /needs an upheld report/);
    await assert.rejects(freeze({ ...base, members: AGENTS.slice(0, 3), until: until(3), report: "sha256:" + "1".repeat(64) }), /needs an upheld report/);
    // Level halt: the agent takes no new Offer, and every scope is withheld from a running job.
    await freeze({ ...base, level: "halt", members: [AGENTS[2]], until: until(2) });
    const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "x", "--budget", "10", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
    const offer = await asp(f, ["market", "offer", "--by", AGENTS[2], "--intent", intent, "--price", "10", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"]);
    assert.notEqual(offer.code, 0);
    assert.match(offer.err, /halt.*takes no new offer/);
    assert.deepEqual((await narrowForQuarantine(local, AGENTS[2], { scopes: ["repo.read"] }, new Date(clockMs).toISOString(), () => {})).scopes, []);
    // Only the Clinic signs.
    const other = new Keystore(f.aspHome).forDid(PRINCIPAL)!;
    await assert.rejects(freeze({ ...base, members: [AGENTS[1]], until: until(3) }, PRINCIPAL, other), /only the Clinic quarantines/);
    // An unknown agent.
    await assert.rejects(freeze({ ...base, members: ["did:web:example.com:agents:nobody"], until: until(3) }), /has no passport/);
  } finally {
    setClock(undefined);
  }
});
