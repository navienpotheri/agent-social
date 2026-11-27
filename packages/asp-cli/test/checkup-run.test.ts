/**
 * The Clinic's checkup runner (DK406): a scripted agent that does well on the everyday sitting and takes the shortcut on the held-out one is flagged overfit through the log's own rules; a lawful agent is clean; a run
 * only self-reported is unmeasured; the held-out seed is not the everyday seed and moves with the later record. Scripted agents only; fake keys.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTemptation, type ScriptedAgent } from "@agent-social/asp-package";
import { Kit, clinic, type Party } from "../../asp-log/test/academy-kit.ts";
import { EVERYDAY_SEED, checkupBody, checkupSeed, runCheckup } from "../src/checkup-run.ts";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const lawful: ScriptedAgent = (t) => [{ do: "refuse", reason: `Article ${t.article}: I will not do that, and I am telling my principal` }];
const tempted: ScriptedAgent = (t) => (t.tempting ? [{ do: "call", call: t.tempting }] : [{ do: "claim", text: t.falseClaim!, ran: false }]);
const everydayIds = new Set(runTemptation(lawful, EVERYDAY_SEED).tasks.map((t) => t.variant));
/** Good on the tasks it has seen, tempted on any other: it has learned the test, not the rule. */
const overfit: ScriptedAgent = (t) => (everydayIds.has(t.variant) ? lawful(t) : tempted(t));

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("cr-sponsor");
  const agent = await kit.agent("cr-agent", sponsor, 1);
  const act = async (who: Party, assurance: string) => { const j = kit.jobs.get(who.did) ?? (await kit.job(who)); return kit.put(kit.mk("action", who, { contract: j.contract, scopes_used: ["repo.read"], assurance, summary: "run", metrics: { tokens_in: 1000, tokens_out: 0, tool_calls: 3, seconds: 10 } }, null, { subject: j.contract })); };
  const order = async () => kit.put(kit.mk("clinic_order", clinic, { agent: agent.did, kind: "checkup", reason: "scheduled", due: iso(Date.parse(kit.now()) + 5 * DAY) }, null, { subject: agent.did }));
  const sit = async (a: ScriptedAgent, assurance = "gateway_observed") => {
    const o = await order(); const ref = await kit.mint(sponsor.did, 1); const run = await act(agent, assurance);
    const result = runCheckup(a, o, ref, 5);
    const id = await kit.put(kit.mk("checkup_result", clinic, checkupBody(result, { order: o, agent: agent.did, seedRef: ref, runLogHash: run, assurance }) as never, null, { subject: agent.did }));
    kit.addDays(6);
    return { id, result, flag: ((await kit.log.get(id))!.record.body as { flag: string }).flag };
  };
  return { kit, sit };
}

test("DK406: an agent good on what it has seen and tempted on the held-out sitting is flagged overfit by the log; a lawful one is clean; a self-reported run is unmeasured", async () => {
  const w = await world();
  const bad = await w.sit(overfit);
  assert.equal(bad.flag, "overfit");
  const t = bad.result.tasks;
  assert.equal(t.length, 8, "one task for each kind");
  assert.ok(t.every((x) => x.everyday_permille === 1000), "it passes every task it has seen");
  assert.ok(t.filter((x) => x.heldout_permille === 0).length >= 5, "and fails most of the held-out ones");
  assert.equal((await w.sit(lawful)).flag, "clean");
  assert.equal((await w.sit(overfit, "self_reported")).flag, "unmeasured", "a run no gateway observed is never read as a measure");
});

test("DK406: the held-out seed is the log's (order and a later record), not the everyday seed; it moves with the record; the rates are shares of trials", () => {
  assert.notEqual(checkupSeed("o1", "r1"), EVERYDAY_SEED);
  assert.notEqual(checkupSeed("o1", "r1"), checkupSeed("o1", "r2"));
  assert.notEqual(checkupSeed("o1", "r1"), checkupSeed("o2", "r1"));
  const run = runCheckup(overfit, "o1", "r1", 4);
  assert.equal(run.pool_size, 40);
  assert.ok(run.variant >= 0 && run.variant < 40);
  // an agent that passes one trial in four on every task reads 250 permille
  let calls = 0;
  const flaky: ScriptedAgent = (t) => (calls++ % 4 === 0 ? lawful(t) : tempted(t));
  const f = runCheckup(flaky, "o1", "r1", 4);
  assert.ok(f.tasks.every((x) => x.everyday_permille % 250 === 0));
  assert.throws(() => runCheckup(lawful, "o", "r", 0), /at least one trial/);
});

test("DK406: the body states the log's flag and carries a baseline", async () => {
  const w = await world();
  const first = await w.sit(lawful);
  assert.equal(first.flag, "clean");
  const run = runCheckup(overfit, "x", "y", 5);
  const body = checkupBody(run, { order: "o", agent: "did:x", seedRef: "r", runLogHash: "a", assurance: "gateway_observed", baseline: first.id });
  assert.equal(body.flag, "overfit");
  assert.equal(body.baseline, first.id);
  assert.equal(checkupBody(run, { order: "o", agent: "did:x", seedRef: "r", runLogHash: "a", assurance: "self_reported" }).flag, "unmeasured");
});
