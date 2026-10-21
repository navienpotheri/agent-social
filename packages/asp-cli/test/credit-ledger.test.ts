import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, type Fixture } from "./fixture.ts";
import { conservation, deltas, formatTable, meteredUse, snapshot, type Entity, type Snapshot } from "../src/ledger.ts";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const must = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.slice(0, 3).join(" ")}: ${r.err}${r.out}`); return r.out; };
const grab = (re: RegExp, text: string) => { const m = re.exec(text); assert.ok(m, `no match for ${re} in ${text.slice(0, 200)}`); return m![1]; };

// The credit flow of a job, entity by entity, step by step. Found while building it: `settle --basis accepted` with no amounts paid the performer nothing (the escrow went back to the payer); it now pays the
// price and returns the bond. Credits are accounting entries; every number below is what the log's own ledger holds.
test("the job lifecycle's credits, by entity: bonded, accepted and paid; rejected, ruled and slashed; every credit accounted for at every step", { timeout: 120_000 }, async () => {
  const f = makeFixture();
  const D = (n: string) => `did:web:example.com:${n}`;
  const [ALICE, BANK, AGENT] = [D("users:alice"), D("bank"), D("agents:coder")];
  const JURORS = [1, 2, 3].map((n) => D(`users:juror-${n}`));
  for (const d of [ALICE, BANK, ...JURORS]) await must(f, ["identity", "new", "--kind", "human", "--did", d, "--no-recovery"]);
  await must(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", ALICE, "--purpose", "Test"]);
  let granted = 0;
  const grant = async (d: string, n: number) => { await must(f, ["credits", "grant", "--to", d, "--amount", String(n)]); granted += n; };
  await grant(ALICE, 400); await grant(AGENT, 600);
  for (const j of JURORS) { await grant(j, 100); await must(f, ["market", "juror", "register", "--by", j, "--stake", "50"]); }

  const entities: Entity[] = [{ name: "principal", did: ALICE }, { name: "agent", did: AGENT }, { name: "bank", did: BANK }];
  const jurors: Entity[] = JURORS.map((did, i) => ({ name: `juror${i + 1}`, did }));
  const names = [...entities, ...jurors].map((e) => e.name);
  const contracts: string[] = [];
  const snaps: Snapshot[] = [];
  const snap = async (label: string) => { const s = await snapshot((a) => asp(f, a), { entities, jurors, contracts, granted, label }); snaps.push(s); return s; };

  const start = await snap("start");
  assert.deepEqual([start.balances.principal, start.balances.agent, start.stakes.juror1, start.held], [400, 600, 50, 0]);
  assert.equal(start.total, 1300);

  const job = async (price: number, bond: number, purpose: string) => {
    const intent = grab(/^intent (\S+)/, await must(f, ["market", "intent", "--by", ALICE, "--purpose", purpose, "--budget", String(price + 10), "--deadline", "2099-01-01T00:00:00Z", "--verification", "principal", "--review-deadline", "2098-01-01T00:00:00Z"]));
    const offer = grab(/^offer (\S+)/, await must(f, ["market", "offer", "--by", AGENT, "--intent", intent, "--price", String(price), "--plan", "do it", "--eta", "2098-01-01T00:00:00Z", "--bond-offered", String(bond)]));
    const c = grab(/^contract (\S+):/, await must(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer]));
    contracts.push(c);
    return c;
  };

  // Job 1: a 40-credit job with a 20-credit bond, done and accepted.
  const c1 = await job(40, 20, "Summarise the folder in five lines");
  await must(f, ["market", "bond", "--contract", c1, "--backer", AGENT, "--amount", "20", "--escrow-payer", ALICE, "--escrow-amount", "40"]);
  const bonded = await snap("1 bonded");
  assert.equal(bonded.escrow, 40); assert.equal(bonded.bond, 20);
  assert.equal(bonded.held, 2, "a court-fee reserve (5% of the price) is held by the protocol while the job is open");
  assert.deepEqual([bonded.balances.principal, bonded.balances.agent], [359, 579]);
  // On request, a person sees their own credits in a few lines (credits are never shown while an agent runs).
  writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ tenant: "alice", identities: { me: ALICE, agent: AGENT, bank: BANK } }));
  const view = await must(f, ["credits"]);
  assert.match(view, /you \(alice\)\s+359/); assert.match(view, /coder\s+579/);
  assert.match(view, /locked in open jobs: 40 in escrow, 20 as bond/);
  assert.match(view, /total\s+998/);
  await must(f, ["market", "mandate", "--contract", c1, "--principal", ALICE, "--performer", AGENT, "--scopes", "repo.read"]);
  await must(f, ["market", "action", "--contract", c1, "--by", AGENT, "--scopes-used", "repo.read", "--metrics", JSON.stringify({ requests: 5, tool_calls: 3, tokens_in: 4000, tokens_out: 900 }), "--summary", "work"]);
  await must(f, ["market", "deliver", "--contract", c1, "--by", AGENT, "--summary", "done", "--claim", "five lines::measured"]);
  await must(f, ["market", "accept", "--contract", c1, "--by", ALICE]);
  await must(f, ["market", "settle", "--contract", c1, "--bank", BANK, "--basis", "accepted"]);
  const paid = await snap("1 accepted");
  assert.deepEqual([paid.balances.principal, paid.balances.agent, paid.escrow, paid.bond, paid.held], [360, 640, 0, 0, 0], "the principal paid the 40 and the agent earned it; bond and reserve returned");
  assert.deepEqual(deltas(start, paid), { principal: -40, agent: 40, bank: 0, juror1: 0, juror2: 0, juror3: 0 });
  assert.ok(conservation(paid).ok);
  const viewPaid = await must(f, ["credits"]);
  assert.match(viewPaid, /you \(alice\)\s+360/); assert.match(viewPaid, /coder\s+640/); assert.match(viewPaid, /locked in open jobs: 0 in escrow, 0 as bond/);

  // Job 2: a 40-credit job, delivered badly, rejected, ruled for the principal: the bond is slashed.
  const c2 = await job(40, 20, "Summarise the second folder in five lines");
  await must(f, ["market", "bond", "--contract", c2, "--backer", AGENT, "--amount", "20", "--escrow-payer", ALICE, "--escrow-amount", "40"]);
  await must(f, ["market", "mandate", "--contract", c2, "--principal", ALICE, "--performer", AGENT, "--scopes", "repo.read"]);
  await must(f, ["market", "deliver", "--contract", c2, "--by", AGENT, "--summary", "one line", "--claim", "five lines::measured"]);
  await must(f, ["market", "reject", "--contract", c2, "--by", ALICE, "--reasons", "one line, not five"]);
  const disputed = await snap("2 disputed");
  assert.equal(disputed.held, 2); assert.equal(disputed.escrow, 40); assert.equal(disputed.bond, 20);
  const panel = (await must(f, ["market", "panel", "draw", "--contract", c2])).match(/did:web:\S+/g)!.map((d) => d.replace(/,$/, ""));
  assert.equal(panel.length, 3, "three jurors, none a party");
  assert.ok(!panel.includes(ALICE) && !panel.includes(AGENT) && !panel.includes(BANK));
  await must(f, ["market", "rule", "--contract", c2, "--by", JURORS[0], "--cosign-by", JURORS[1], "--verdict", "for_principal", "--fault", `${AGENT}=1000`]);
  await must(f, ["market", "settle", "--contract", c2, "--bank", BANK, "--basis", "ruling"]);
  const slashed = await snap("2 ruled");
  assert.deepEqual(deltas(paid, slashed), { principal: 19, agent: -21, bank: 0, juror1: 1, juror2: 1, juror3: 0 }, "the principal gets the 20 bond less her share of the fee; the agent loses the bond and its share; two jurors who ruled are paid");
  assert.deepEqual([slashed.escrow, slashed.bond, slashed.held, slashed.total], [0, 0, 0, 1300]);
  assert.ok(conservation(slashed).ok, conservation(slashed).note);

  // The table a person reads while a long run goes on.
  const table = formatTable(snaps, names);
  assert.match(table, /step\s+principal\s+agent\s+bank\s+juror1\s+juror2\s+juror3\s+escrow\s+bond\s+held\s+total/);
  assert.match(table, /1 accepted\s+360\s+640/);
  assert.match(table, /2 ruled\s+379\s+619/);
  // Metering: tokens used by sessions are an estimate in credits, never a charge.
  assert.deepEqual(meteredUse(f.aspHome, "2000-01-01T00:00:00Z", 1), { sessions: 0, tokens: 0, estimate: 0 }, "no sessions in this home");
});

// Found in the owner's overnight run: balances that could not be read were printed as nothing and the check said OK ("every credit is accounted for", a total of 0) for hours.
test("a reading with a balance that could not be read is a PROBLEM that says why, never OK", async () => {
  const run = async (a: string[]) => a[0] === "credits" ? { code: 1, out: "", err: "error: the log service refused the token (HTTP 401)" } : { code: 0, out: "", err: "" };
  const e: Entity[] = [{ name: "principal", did: "did:web:x:u:a" }, { name: "agent", did: "did:web:x:a:a:b" }];
  const s = await snapshot(run, { entities: e, label: "t0" });
  assert.deepEqual(s.unreadable?.names, ["principal", "agent"]);
  const c = conservation(s, 1);
  assert.equal(c.ok, false);
  assert.match(c.note, /could not read the balance of principal, agent: error: the log service refused the token \(HTTP 401\)/);
  assert.match(c.note, /ASP_LOG_TOKEN/);
});
