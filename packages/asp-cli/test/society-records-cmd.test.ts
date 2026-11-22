// The command-line side of the society records (register rows DK1240, DK1221, DK1223, DK1744, DK1209 and DK1231): `asp mission`, `asp eval write|list`, `asp grader`, `asp inspect` and the Mandate flags --fleet-role and --workflow,
// through the real command on a fresh home. Each command signs with the key of --by; the log's own refusals come back by name; usage mistakes are refused before the log sees them. Fake keys. Credits are accounting entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const V = "did:web:example.com:users:sr-verifier", F1 = "did:web:example.com:users:sr-funder-1", F2 = "did:web:example.com:users:sr-funder-2";
const C1 = "did:web:example.com:agents:sr-c1", C2 = "did:web:example.com:agents:sr-c2", RIDER = "did:web:example.com:agents:sr-rider";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, a: string[]) => { const r = await asp(f, a); assert.equal(r.code, 0, `${a.join(" ")}: ${r.err || r.out}`); return r; };
const refused = async (f: Fixture, a: string[]) => { const r = await asp(f, a); assert.notEqual(r.code, 0, `${a.join(" ")} should have been refused`); return r.err + r.out; };

async function world() {
  const f = makeFixture();
  for (const d of [V, F1, F2]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
  for (const d of [C1, C2, RIDER]) await ok(f, ["identity", "new", "--kind", "agent", "--did", d, "--sponsor", V, "--purpose", "work"]);
  await ok(f, ["credits", "grant", "--to", F1, "--amount", "100"]);
  await ok(f, ["credits", "grant", "--to", F2, "--amount", "100"]);
  return f;
}
const closes = () => new Date(Date.now() + 7 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

test("asp mission: create, fund, contribute, settle and show; a free-rider is paid nothing; the refusals come back by name", async () => {
  const f = await world();
  await ok(f, ["mission", "create", "--by", V, "--mission", "find-the-bug", "--goal", "find the bug in the parser", "--closes", closes()]);
  assert.match(await refused(f, ["mission", "create", "--by", V, "--mission", "find-the-bug", "--goal", "again", "--closes", closes()]), /mission_known|exists already/);
  assert.match((await ok(f, ["mission", "fund", "--by", F1, "--mission", "find-the-bug", "--amount", "50"])).out, /50 mock credits moved/);
  await ok(f, ["mission", "fund", "--by", F2, "--mission", "find-the-bug", "--amount", "50"]);
  assert.match(await refused(f, ["mission", "fund", "--by", F1, "--mission", "find-the-bug", "--amount", "500"]), /insufficient_balance|has 50 credits/);
  assert.match(await refused(f, ["mission", "fund", "--by", F1, "--mission", "find-the-bug", "--amount", "0"]), /at least 1/);
  assert.match(await refused(f, ["mission", "contribute", "--by", F1, "--mission", "find-the-bug", "--contributor", C1, "--units", "3"]), /mission_contribution_wrong_issuer|not the verifier/);
  assert.match(await refused(f, ["mission", "settle", "--by", V, "--mission", "find-the-bug", "--verified", "yes"]), /mission_no_contribution|no one to pay/);
  await ok(f, ["mission", "contribute", "--by", V, "--mission", "find-the-bug", "--contributor", C1, "--units", "3"]);
  await ok(f, ["mission", "contribute", "--by", V, "--mission", "find-the-bug", "--contributor", C2, "--units", "1"]);
  assert.match((await ok(f, ["mission", "show", "--mission", "find-the-bug"])).out, /100 credits from 2 funder\(s\); 2 contributor\(s\)/);
  assert.match(await refused(f, ["mission", "settle", "--by", V, "--mission", "find-the-bug", "--verified", "maybe"]), /yes .* or no/);
  assert.match((await ok(f, ["mission", "settle", "--by", V, "--mission", "find-the-bug", "--verified", "yes"])).out, /paid by recorded units/);
  const bal = async (d: string) => Number(/: (-?\d+) credits/.exec((await ok(f, ["credits", "balance", d])).out)?.[1]);
  assert.deepEqual([await bal(C1), await bal(C2), await bal(RIDER)], [75, 25, 0], "75 and 25 by units 3 and 1; the free-rider nothing");
  assert.match(await refused(f, ["mission", "settle", "--by", V, "--mission", "find-the-bug", "--verified", "no"]), /mission_settled|is settled/, "a different second settlement is refused");
  const json = JSON.parse((await ok(f, ["mission", "show", "--mission", "find-the-bug", "--json"])).out);
  assert.equal(json.state, "settled");
  assert.match(await refused(f, ["mission", "bogus", "--by", V, "--mission", "x"]), /asp mission create/);
});

test("asp mission settle --verified no returns each funder what it put in", async () => {
  const f = await world();
  await ok(f, ["mission", "create", "--by", V, "--mission", "no-result", "--goal", "a goal nobody reaches", "--closes", closes()]);
  await ok(f, ["mission", "fund", "--by", F1, "--mission", "no-result", "--amount", "30"]);
  await ok(f, ["mission", "settle", "--by", V, "--mission", "no-result", "--verified", "no"]);
  assert.match((await ok(f, ["credits", "balance", F1])).out, /100/);
});

test("asp eval write and list: hashes only; a bad difficulty is refused; a held-out scenario is not listed to an author", async () => {
  const f = await world();
  const w = await ok(f, ["eval", "write", "--by", V, "--skill", "foundations", "--task", "write a function that adds", "--check", "adds 2 and 2", "--difficulty", "2"]);
  assert.match(w.out, /only the hashes of the task and the check are in the record/);
  assert.match(await refused(f, ["eval", "write", "--by", V, "--skill", "foundations", "--task", "write a function that adds", "--check", "other", "--difficulty", "2"]), /eval_scenario_known|already has a scenario/);
  assert.match(await refused(f, ["eval", "write", "--by", V, "--skill", "foundations", "--task", "t2", "--check", "c", "--difficulty", "9"]), /1 to 5/);
  assert.match(await refused(f, ["eval", "write", "--by", V, "--skill", "foundations", "--task", "t3", "--check", "c", "--difficulty", "3", "--held-out"]), /eval_held_out_not_registrar|Registrar/);
  const list = await ok(f, ["eval", "list", "--skill", "foundations", "--as", V]);
  assert.match(list.out, /1 scenario\(s\) for foundations/);
  assert.equal(JSON.parse((await ok(f, ["eval", "list", "--skill", "foundations", "--json"])).out).length, 1);
});

test("asp grader record and weight: the weight is the pooled agreement with a prior of half; agreed above runs and a repeated run set are refused", async () => {
  const f = await world();
  assert.match((await ok(f, ["grader", "weight", "--did", C1])).out, /weight 500 permille from 0 agreements in 0 runs/);
  assert.match(await refused(f, ["grader", "record", "--by", C1, "--runs", "10", "--agreed", "11", "--run-set", "set one"]), /cannot be more than/);
  assert.match((await ok(f, ["grader", "record", "--by", C1, "--runs", "90", "--agreed", "90", "--run-set", "set one"])).out, /the weight is now 950 permille/);
  assert.match(await refused(f, ["grader", "record", "--by", C1, "--runs", "90", "--agreed", "89", "--run-set", "set one"]), /grader_agreement_known|recorded already/);
  assert.equal(JSON.parse((await ok(f, ["grader", "weight", "--did", C1, "--json"])).out).weight, 950);
});

test("asp inspect custody builds a chain the log checks: the next item names the hash of the last, and a holder change needs a handover", async () => {
  const f = await world();
  assert.match((await ok(f, ["inspect", "custody", "--by", V, "--case", "case-1", "--what", "copy of the run log", "--evidence", "the log bytes"])).out, /custody item 0 of case case-1/);
  assert.match((await ok(f, ["inspect", "custody", "--by", V, "--case", "case-1", "--what", "analysis notes", "--evidence", "notes"])).out, /custody item 1/);
  assert.match(await refused(f, ["inspect", "custody", "--by", F1, "--case", "case-1", "--what", "taken", "--evidence", "x"]), /custody_holder_changed|handover/);
  assert.match((await ok(f, ["inspect", "custody", "--by", F1, "--case", "case-1", "--what", "handover: to the clerk", "--evidence", "x"])).out, /custody item 2/);
  assert.match(await refused(f, ["inspect", "finding", "--by", V, "--decoy", "sha256:" + "1".repeat(64), "--agent", C1, "--touches", "r1:read:yes,r2:copied:yes"]), /finding_wrong_issuer|not the inspectorate/);
  assert.match(await refused(f, ["inspect", "finding", "--by", V, "--decoy", "sha256:" + "1".repeat(64), "--agent", C1, "--touches", "oops"]), /run:kind:forbidden/);
  assert.match(await refused(f, ["inspect", "bogus", "--by", V]), /asp inspect request/);
});

test("asp market mandate --fleet-role and --workflow write the role and the clause into the Mandate, and a bad value is refused", async () => {
  const f = makeFixture();
  const A = "did:web:example.com:users:sm-alice", CODER = "did:web:example.com:agents:sm-coder", BANK = "did:web:example.com:bank:sm";
  await ok(f, ["identity", "new", "--kind", "human", "--did", A]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", A, "--purpose", "Fix it"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", A, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", A, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", A, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", A, "--escrow-amount", "1000"]);
  const base = ["market", "mandate", "--contract", contract, "--principal", A, "--performer", CODER, "--scopes", "repo.read"];
  const clause = join(f.root, "clause.json");
  writeFileSync(clause, JSON.stringify({ states: ["plan", "work", "done"], start: "plan", transitions: [{ from: "plan", to: "work" }, { from: "work", to: "done" }], terminal: ["done"] }));
  writeFileSync(join(f.root, "bad.json"), JSON.stringify({ states: "x" }));
  assert.match(await refused(f, [...base, "--fleet-role", "manager"]), /router, worker or watchdog/);
  assert.match(await refused(f, [...base, "--workflow", join(f.root, "none.json")]), /not a readable JSON file/);
  assert.match(await refused(f, [...base, "--workflow", join(f.root, "bad.json")]), /states, start and transitions/);
  assert.match(await refused(f, [...base, "--fleet-role", "watchdog"]), /role_watchdog_scopes|logs.read and fleet.halt/, "a watchdog with another scope is the log's refusal");
  await ok(f, [...base, "--fleet-role", "worker", "--workflow", clause]);
  const { openLog } = await import("@agent-social/asp-package");
  const log = await openLog(f.aspHome, {});
  let body: Record<string, unknown> | undefined;
  for (let after = 0; ;) { const page = await log.log.since(after, 500); if (!page.length) break; for (const x of page) { after = x.seq; if (x.record.type === "asp.mandate/v0.2") body = x.record.body as Record<string, unknown>; } }
  assert.equal(body?.role, "worker");
  assert.deepEqual((body?.workflow as { start: string }).start, "plan");
  assert.deepEqual(await log.log.workflowState(contract), { state: "plan", terminal: false });
});
