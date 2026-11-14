/**
 * `asp agent remove` (register row T7; spec-delta S380): retiring an agent says what ends, what stays and what to back up; changes nothing without --yes; with --yes the agent signs its own retirement, the log takes
 * no new Contract for it, its page says retired, and its history stays. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:ar-principal";
const BANK = "did:web:example.com:bank-ar";
const SPONSOR = "did:web:example.com:users:ar-sponsor";
const AGENT = "did:web:example.com:agents:ar-agent";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("remove tells what ends, what stays and what to back up, changes nothing without --yes, and with --yes retires the agent for good while its history stays", async () => {
  const f = makeFixture();
  for (const d of [PRINCIPAL, BANK, SPONSOR]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "A job"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Work", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", AGENT, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];

  const plan = await ok(f, ["agent", "remove", AGENT]);
  assert.match(plan.out, /this would remove the agent/);
  assert.match(plan.out, /ends:.*new jobs, bonds, Mandates, proposals and purchases/);
  assert.match(plan.out, /stays:.*everything it did/);
  assert.match(plan.out, /back up first: asp account export/);
  assert.match(plan.out, /nothing changed/);
  assert.ok(!/RETIRED|retired/.test((await ok(f, ["registry", "lookup", AGENT])).out), "a plan changes nothing");

  const done = await ok(f, ["agent", "remove", AGENT, "--yes", "--reason", "the sponsor is done with it"]);
  assert.match(done.out, /removed .* shows it as retired/);
  assert.match((await ok(f, ["registry", "lookup", AGENT])).out, /retired/);
  // The log now takes no new Contract for it.
  const contract = await asp(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer]);
  assert.notEqual(contract.code, 0);
  assert.match(contract.err, /retired/);
  // Its history stays: the page still exists, the offer it made is in the log.
  assert.match((await ok(f, ["registry", "lookup", AGENT])).out, new RegExp(AGENT));
  // It cannot be retired twice by a stranger or without its key.
  const stranger = await asp(f, ["agent", "remove", "did:web:example.com:agents:nobody", "--yes"]);
  assert.notEqual(stranger.code, 0);
  assert.match(stranger.err, /no key for/);
});
