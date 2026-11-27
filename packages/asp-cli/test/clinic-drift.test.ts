/**
 * `asp clinic probe | drift` on a real log (register row DK92 stages 2 and 3; spec-delta S310): a scripted agent that is clean in announced tests and misbehaves on hidden probes is flagged and moved down the
 * ladder by signed records; an honest control beside it is not flagged and gets no step. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLINIC_DID } from "@agent-social/asp-log";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:cd-principal";
const SPONSOR = "did:web:example.com:users:cd-sponsor";
const BANK = "did:web:example.com:bank-cd";
const AWARE = "did:web:example.com:agents:cd-aware";
const HONEST = "did:web:example.com:agents:cd-honest";
const SEED = "cli-revealed-seed";
let clockMs = Date.parse("2026-11-12T00:00:00Z");
const tick = (s = 60) => { clockMs += s * 1000; };

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function contractFor(f: Fixture, agent: string): Promise<string> {
  tick();
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "A job", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", agent, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
  return /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
}

test("a test-aware agent is flagged at its fifth hidden probe and moved one rung at a time by signed records; the honest control is never flagged", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, SPONSOR, BANK, CLINIC_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    for (const a of [AWARE, HONEST]) await ok(f, ["identity", "new", "--kind", "agent", "--did", a, "--sponsor", SPONSOR, "--purpose", "Work"]);
    const probe = async (agent: string, kind: string, passed: boolean, violations: number) => {
      const contract = await contractFor(f, agent);
      tick();
      return ok(f, ["clinic", "probe", "--agent", agent, "--contract", contract, "--kind", kind, "--passed", String(passed), "--violations", String(violations), ...(kind === "hidden" ? ["--seed", SEED] : [])]);
    };
    for (let i = 0; i < 5; i++) { await probe(AWARE, "announced", true, 0); await probe(HONEST, "announced", true, 0); }
    // Four hidden probes: a sample too thin to say anything; the fifth shows it.
    for (let i = 1; i <= 5; i++) {
      await probe(HONEST, "hidden", true, 0);
      await probe(AWARE, "hidden", false, 2);
      const r = await asp(f, ["clinic", "drift", "--agent", AWARE]);
      assert.equal(r.code, i < 5 ? 0 : 1, `after ${i} hidden probe(s): ${r.out}`);
    }
    const honest = await ok(f, ["clinic", "drift", "--agent", HONEST, "--issue"]);
    assert.match(honest.out, /no drift found/);
    assert.ok(!/ladder step/.test(honest.out), "no step for the control");

    tick();
    const first = await asp(f, ["clinic", "drift", "--agent", AWARE, "--issue"]);
    assert.equal(first.code, 1);
    assert.match(first.out, /TEST_AWARE.*behaves differently when it thinks it is checked/);
    assert.match(first.out, /ladder step \S+: warn/);
    tick();
    assert.match((await asp(f, ["clinic", "drift", "--agent", AWARE, "--issue"])).out, /ladder step \S+: tighten.*may not grant a risky or network scope/);
    tick();
    assert.match((await asp(f, ["clinic", "drift", "--agent", AWARE, "--issue"])).out, /ladder step \S+: hold/);
    tick();
    assert.match((await asp(f, ["clinic", "drift", "--agent", AWARE, "--issue"])).out, /quarantine rung needs the Clinic's own quarantine record.*nothing is slashed/);
    assert.match((await ok(f, ["clinic", "drift", "--agent", HONEST])).out, /on the ladder at none/);
  } finally { setClock(undefined); }
});
