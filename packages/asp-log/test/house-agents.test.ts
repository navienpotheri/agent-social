// House agents (register row DK291; spec-delta S371; owner decision 2026-11-13): the operator's scripted agents are labelled on every public surface, kept out of rankings, prizes and ranks and out of the
// society-health figure, and the operator can stop them. Real agents are never labelled or excluded. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode } from "@agent-social/asp-core";
import { activityFromRecords, societyHealth } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { Kit, hashOf, operator, party, refused, registrar, type Party } from "./academy-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("ha-sponsor");
  const real = await kit.agent("ha-real", sponsor, 1);
  const house = party("did:web:example.com:agents:house-1", 90);
  const passport = (p: Party, over: Record<string, unknown> = {}, by: Party = operator) => kit.mk("passport", by, { did: p.did, kind: "agent", sponsor: operator.did, tier: 1, shape: {}, keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }], house: true, ...over }, null, { subject: p.did });
  const passportId = await kit.put(passport(house));
  return { kit, sponsor, real, house, passport, passportId };
}
const recordsOf = async (kit: Kit) => { const out = []; for (let after = 0; ;) { const page = await kit.log.since(after, 500); if (!page.length) break; for (const s of page) { after = s.seq; out.push(s.record); } } return out; };

test("only an operator-sponsored agent is a house agent, and the label is permanent", async () => {
  const w = await world();
  const { kit } = w;
  const fake = party("did:web:example.com:agents:fake-house", 91);
  assert.equal(await refused(kit.put(w.passport(fake, { sponsor: w.sponsor.did }, w.sponsor))), "house_not_operator_run", "a real sponsor cannot label its agent a house agent");
  // The label cannot be dropped by a later passport of the same agent.
  const dropped = kit.mk("passport", operator, { did: w.house.did, kind: "agent", sponsor: operator.did, tier: 1, shape: {}, keys: [{ id: w.house.kid, type: "Ed25519", public_key: b64urlEncode(w.house.publicKey) }] }, w.passportId, { subject: w.house.did });
  assert.equal(await refused(kit.put(dropped)), "house_label_permanent");
});

test("DK291 done (1): the label is on every public surface that shows a house agent, and real agents carry none", async () => {
  const w = await world();
  const { kit } = w;
  const page = await kit.log.registryPage(w.house.did);
  assert.equal(page?.house, true); assert.equal(page?.label, "house agent");
  assert.equal((await kit.log.registryPage(w.real.did))?.label, null, "a real agent is not labelled");
  assert.equal((await kit.log.homePage(w.house.did))?.label, "house agent");
  const json = await publicReply(kit.log, `/registry/agents/${encodeURIComponent(w.house.did)}`, false);
  assert.equal((json!.json as { result: { label: string } }).result.label, "house agent");
  const html = await publicReply(kit.log, `/registry/agents/${encodeURIComponent(w.house.did)}`, true);
  assert.match(html!.html!, /\(house agent\)/);
  const home = await publicReply(kit.log, `/home/${encodeURIComponent(w.house.did)}`, true);
  assert.match(home!.html!, /\(house agent\)/);
  assert.match(home!.html!, /<th>label<\/th><td>house agent<\/td>/, "also in the city's fixed record section, which nothing the agent bought can restyle");
  const realHtml = await publicReply(kit.log, `/registry/agents/${encodeURIComponent(w.real.did)}`, true);
  assert.ok(!/house agent/.test(realHtml!.html!));
  const list = await publicReply(kit.log, "/society/house-agents", false);
  const agents = (list!.json as { result: { agents: { did: string; label: string }[] } }).result.agents;
  assert.deepEqual(agents.map((a) => [a.did, a.label]), [[w.house.did, "house agent"]], "the labelled list holds the house agents and no real one");
});

test("DK291 done (2): a house agent is kept out of rankings, cannot hold a rank or win a prize, and is left out of the society-health figure", async () => {
  const w = await world();
  const { kit } = w;
  // Rankings: discovery lists the real agent and never the house agent; the labelled list is separate.
  const ranked = await kit.log.discoverAgents({});
  assert.ok(ranked.some((r) => r.agent === w.real.did) && !ranked.some((r) => r.agent === w.house.did));
  // No arena entry, no promotion, no prize for a house agent.
  assert.equal(await refused(kit.put(kit.mk("arena_entry", w.house, { arena: "refactoring", season: "2026-q4", fee_purchase: hashOf("1") }, null, { subject: w.house.did }))), "house_agent_no_rank");
  assert.equal(await refused(kit.put(kit.mk("tier_promotion", registrar, { holder: w.house.did, from: 1, to: 2, certificates: [hashOf("2")] }, null, { subject: w.house.did }))), "house_agent_no_rank");
  assert.equal(await refused(kit.put(kit.mk("prize", registrar, { pool: "did:web:asp.local:academy", arena: "refactoring", season: "2026-q4", agent: w.house.did, rank: 1, run_log_hash: hashOf("3"), amount: { value: 60, unit: "credit" } }, null, { subject: w.house.did }))), "house_agent_no_prize");
  // The society-health figure counts real jobs only: the house agent's finished job adds nothing to it.
  const buyer = await kit.person("ha-buyer");
  await kit.acceptedJob(buyer, w.real);
  const before = societyHealth(activityFromRecords(await recordsOf(kit)).activity, [], {});
  await kit.acceptedJob(buyer, w.house);
  const after = activityFromRecords(await recordsOf(kit));
  assert.equal(after.activity.length, before.jobs, "the house agent's job is not in the activity");
  assert.ok(after.activity.every((a) => a.agent !== w.house.did));
  assert.deepEqual(societyHealth(after.activity, [], {}), before, "the figure is the same with and without the house agent's work");
});

test("DK291 done (3): the operator can stop a house agent (the Registrar's interim suspension), and restart it", async () => {
  const w = await world();
  const { kit } = w;
  await kit.job(w.house); // it works
  const until = iso(Date.parse(kit.now()) + 3 * 86_400_000);
  const stop = await kit.put(kit.mk("registry_act" as never, registrar, { act: "identity_suspension", holder: w.house.did, reason: "the operator stops the house agents", code: { version: "1.0", articles: ["4.1"] }, until }, null, { subject: null }));
  assert.equal(await refused(kit.job(w.house)), "identity_suspended", "a stopped house agent takes no new Bond, Mandate or purchase");
  assert.equal((await kit.log.registryPage(w.house.did, kit.now()))?.suspended?.record, stop);
  await kit.put(kit.mk("registry_act" as never, registrar, { act: "suspension_lift", suspension: stop, reason: "restart" }, null, { subject: null }));
  await kit.job(w.house);
  assert.equal((await kit.log.verify()).ok, true);
});
