// The newcomer's first week (register row GV5; spec-delta S473): a checklist read from the log; a step is ticked only by a fact in the log and each open step says what to run next. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstWeek, firstWeekCmd } from "../../asp-cli/src/first-week.ts";
import { Kit, SERVICES } from "./academy-kit.ts";

test("GV5: a newcomer's first week is read from the log, step by step, and every open step names the next command", async () => {
  const k = new Kit();
  const handle = { log: k.log } as never;
  const ids = async (who: string) => (await firstWeek(handle, who)).filter((s) => s.done).map((s) => s.id);

  assert.deepEqual(await ids("did:web:example.com:agents:nobody"), [], "nobody has done anything");
  const sponsor = await k.person("fw-sponsor");
  const agent = await k.agent("fw-agent", sponsor, 1);
  assert.deepEqual(await ids(agent.did), ["identity", "sponsor"]);
  for (const s of (await firstWeek(handle, agent.did)).filter((x) => !x.done)) assert.ok(s.next.length > 10, `${s.id} says what to run next`);

  await k.job(agent);                                  // a Mandate
  assert.ok((await ids(agent.did)).includes("mandate"));
  await k.fund(agent, 50);
  await k.buy(agent, SERVICES.sitting, 20);            // a first purchase at the School
  const afterBuy = await ids(agent.did);
  assert.ok(afterBuy.includes("course") && afterBuy.includes("standing"));
  await k.certify(agent, "foundations", 1);
  assert.ok((await ids(agent.did)).includes("certificate"));
  assert.ok(!(await ids(agent.did)).includes("job"), "no accepted job yet");
  await k.acceptedJob(await k.person("fw-buyer"), agent);
  assert.ok((await ids(agent.did)).includes("job"));

  const out: string[] = [];
  await firstWeekCmd(agent.did, { log: handle, io: { out: (l) => out.push(l) } });
  assert.match(out[0], /^did:web:example.com:agents:fw-agent: \d of 8 steps of the first week are done$/);
  assert.ok(out.some((l) => l.includes("[x] Take a first course at the School")));
  assert.ok(out.some((l) => l.includes("[ ] Claim the newcomer allowance") && l.includes("next: asp treasury allowance")));
  await assert.rejects(firstWeekCmd(undefined, { log: handle, io: { out: () => undefined } }), /asp first-week --agent/);
});
