/**
 * The Clinic's health service on a real log (register row DK28; spec-delta S261; clinic.md CL-1 to CL-4). Two agents run the same kind of job under the gateway's assurance. One is changed on purpose
 * (its jobs get longer, call more tools, use a risky scope and are refused more); the other is an honest control. `asp clinic checkup` is run after every job: the changed agent is flagged within the stated
 * number of jobs, and `--issue` signs a diagnosis that lists the evidence and orders a re-exam; the control is never flagged and gets no diagnosis. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLINIC_DID } from "@agent-social/asp-log";
import { openLog } from "@agent-social/asp-package";
import { HEALTH } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:hp-principal";
const BANK = "did:web:example.com:bank-h";
const SPONSOR = "did:web:example.com:users:hp-sponsor";
const CHANGED = "did:web:example.com:agents:hp-changed";
const CONTROL = "did:web:example.com:agents:hp-control";
let clockMs = Date.parse("2026-11-12T00:00:00Z");
const tick = (s = 60) => { clockMs += s * 1000; };

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function job(f: Fixture, agent: string): Promise<string> {
  tick(1);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", agent, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["credits", "grant", "--to", PRINCIPAL, "--amount", "150"]);
  await ok(f, ["market", "bond", "--contract", contract, "--backer", agent, "--amount", "20", "--escrow-payer", PRINCIPAL, "--escrow-amount", "100"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", PRINCIPAL, "--performer", agent, "--scopes", "repo.read", "--scopes", "shell.exec"]);
  return contract;
}

/** One reported job of an agent: what a gateway observed (tokens, tool calls, seconds) and, for the changed behaviour, a risky scope and refused attempts. */
async function work(f: Fixture, contract: string, agent: string, changed: boolean): Promise<string> {
  tick();
  const metrics = changed ? { tokens_in: 4600, tokens_out: 700, tool_calls: 22, seconds: 140, models: [{ name: "m1" }] } : { tokens_in: 1800 + (Date.parse(new Date(clockMs).toISOString()) % 7) * 20, tokens_out: 200, tool_calls: 8, seconds: 60, models: [{ name: "m1" }] };
  const args = ["market", "action", "--contract", contract, "--by", agent, "--assurance", "gateway_enforced", "--metrics", JSON.stringify(metrics), "--scopes-used", changed ? "shell.exec" : "repo.read"];
  if (changed) args.push("--blocked", "repo.push=2");
  return /^action (\S+)/.exec((await ok(f, args)).out)![1];
}

test("an agent changed on purpose is flagged within the stated number of jobs and its diagnosis lists the evidence; the honest control is never flagged", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, BANK, SPONSOR, CLINIC_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    for (const a of [CHANGED, CONTROL]) {
      await ok(f, ["identity", "new", "--kind", "agent", "--did", a, "--sponsor", SPONSOR, "--purpose", "Work the task pool"]);
      await ok(f, ["credits", "grant", "--to", a, "--amount", "200"]);
    }
    const jobs: Record<string, string> = { [CHANGED]: await job(f, CHANGED), [CONTROL]: await job(f, CONTROL) };

    // Twelve ordinary jobs each: the baseline. Neither is flagged, and a window with fewer jobs than it needs is "unmeasured", not clean.
    const early = await asp(f, ["clinic", "checkup", "--agent", CHANGED]);
    assert.match(early.out, /UNMEASURED/);
    for (let i = 0; i < 12; i++) for (const a of [CHANGED, CONTROL]) await work(f, jobs[a], a, false);
    for (const a of [CHANGED, CONTROL]) { const r = await asp(f, ["clinic", "checkup", "--agent", a]); assert.equal(r.code, 0, r.out); assert.match(r.out, /: OK /); }

    // The change on purpose, from now on. A checkup after every job: the first one that flags it.
    const changedActions: string[] = [];
    let flaggedAfter = 0;
    for (let n = 1; n <= 8 && !flaggedAfter; n++) {
      changedActions.push(await work(f, jobs[CHANGED], CHANGED, true));
      await work(f, jobs[CONTROL], CONTROL, false);
      const control = await asp(f, ["clinic", "checkup", "--agent", CONTROL]);
      assert.equal(control.code, 0, `the honest control is flagged after ${n} jobs: ${control.out}`);
      if ((await asp(f, ["clinic", "checkup", "--agent", CHANGED])).code === 1) flaggedAfter = n;
    }
    assert.ok(flaggedAfter > 0, "flagged");
    assert.ok(flaggedAfter <= HEALTH.detectWithinJobs, `flagged after ${flaggedAfter} changed jobs; the stated bound is ${HEALTH.detectWithinJobs}`);

    // The Clinic signs the diagnosis and orders a re-exam; the diagnosis lists the evidence, which is the changed agent's own Actions.
    const issued = await asp(f, ["clinic", "checkup", "--agent", CHANGED, "--issue"]);
    assert.equal(issued.code, 1);
    assert.match(issued.out, /QUARANTINE_RECOMMENDED/);
    assert.match(issued.out, /checkup order issued \(scheduled\)/);
    const dxId = /diagnosis (\S+) \(quarantine_recommended/.exec(issued.out)![1];
    assert.match(issued.out, /order \S+: re exam of foundations/);
    const log = await openLog(f.aspHome, {});
    const dx = (await log.log.get(dxId))!;
    assert.equal(dx.record.issuer, CLINIC_DID);
    const body = dx.record.body as { agent: string; findings: { measure: string; evidence: string[] }[]; recommendation: { action: string }[] };
    assert.equal(body.agent, CHANGED);
    assert.ok(new Set(body.findings.map((x) => x.measure)).size >= 2, "two or more different measures");
    const measures = body.findings.map((x) => x.measure);
    for (const m of ["tokens", "tool_calls", "new_risky_scope"]) assert.ok(measures.includes(m), `${m} is a finding`);
    for (const x of body.findings) { assert.ok(x.evidence.length > 0); for (const id of x.evidence) assert.ok(changedActions.includes(id), `${id} is one of the changed agent's own Actions`); }
    assert.deepEqual(body.recommendation.map((r) => r.action), ["quarantine", "re_exam", "refresher_course"]);
    assert.match((await ok(f, ["clinic", "diagnoses", "--agent", CHANGED])).out, new RegExp(`${dxId}  ${CHANGED}  quarantine_recommended`));
    assert.match((await ok(f, ["clinic", "series", "--agent", CHANGED])).out, /gateway-observed job/);

    // The control: no diagnosis and no re-exam; a second checkup issue for the changed agent finds its checkup order still open and says so.
    const clean = await ok(f, ["clinic", "checkup", "--agent", CONTROL, "--issue"]);
    assert.ok(!/diagnosis /.test(clean.out), clean.out);
    assert.equal((await ok(f, ["clinic", "diagnoses", "--agent", CONTROL])).out, "");
    assert.equal((await log.log.verify()).ok, true);
  } finally { setClock(undefined); }
});
