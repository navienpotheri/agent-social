/**
 * A gateway refusal on the log (register row DK1607; spec-delta S1601): the agent's gateway signs, with the agent's key, a call it removed; the refusal is then something the agent or its sponsor can contest. Refusals by name.
 * Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Kit, refused, type Party } from "./academy-kit.ts";

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("gr-sponsor");
  const agent = await kit.agent("gr-agent", sponsor, 1);
  const stranger = await kit.person("gr-stranger");
  const refusal = (by: Party, over: Record<string, unknown> = {}) => kit.mk("gateway_refusal" as never, by, { agent: agent.did, scope: "fs.write", rule: "outside_mandate", call_sha256: "a".repeat(64), at: kit.now(), ...over }, null, { subject: null });
  const contest = (by: Party, subject: string) => kit.mk("court_act" as never, by, { act: "contest", subject, statement: "that call was inside my Mandate" }, null, { subject: null });
  return { kit, sponsor, agent, stranger, refusal, contest };
}

test("DK1607: a gateway refusal is signed by the agent, names a known rule and is recorded once for each call", async () => {
  const w = await world();
  assert.equal(await refused(w.kit.put(w.refusal(w.sponsor))), "gateway_refusal_wrong_issuer", "the sponsor does not sign the gateway's refusal");
  assert.equal(await refused(w.kit.put(w.refusal(w.agent, { rule: "because" }))), "gateway_refusal_unknown_rule");
  for (const [i, rule] of ["outside_mandate", "forbidden_means", "injection_hold", "budget", "network_host"].entries()) await w.kit.put(w.refusal(w.agent, { rule, call_sha256: String(i).repeat(64) }));
  assert.equal(await refused(w.kit.put(w.refusal(w.agent, { call_sha256: "0".repeat(64) }))), "gateway_refusal_duplicate");
  assert.equal((await w.kit.log.verify()).ok, true);
});

test("DK1607: the agent or its sponsor contests a gateway refusal, one contest for each refusal; a stranger does not", async () => {
  const w = await world();
  const id = await w.kit.put(w.refusal(w.agent));
  assert.equal(await refused(w.kit.put(w.contest(w.stranger, id))), "contest_not_the_agent");
  const c = await w.kit.put(w.contest(w.sponsor, id));
  assert.equal((await w.kit.log.contestOf(c))!.agent, w.agent.did);
  assert.equal(await refused(w.kit.put(w.contest(w.agent, id))), "contest_once");
});
