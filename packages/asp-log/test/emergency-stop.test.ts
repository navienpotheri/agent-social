/**
 * The city-wide emergency stop with a sunset (register row GV6; spec-delta S1420): the operator stops new commitments with the owner's co-signature for at most 72 hours; it ends by itself; work under way finishes;
 * essential services and appeals go on; one stop at a time; the refusal names the stop, the reason and the end; every stop is public. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, jump, kit, mk, nowIso, operator, owner, refusedBy, credit } from "./society-kit.ts";
import { publicReply } from "../src/public-pages.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const H = 3_600_000;

async function world() {
  const k = await kit();
  await k.withPrices();
  const client = await k.person("es-client", 500);
  const a = await k.agent("es-agent", await k.person("es-sponsor", 50), { funds: 200 });
  const stop = (hours: number, over: Record<string, unknown> = {}, sign = true) => mk("emergency_stop", operator, { act: "stop", reason: "a live exploit in the Market", until: iso(Date.parse(nowIso()) + hours * H), ...over }, null, sign ? { cosigners: [owner] } : {});
  return { ...k, client, a, stop };
}

test("a stop needs the operator and the owner, must have a sunset within 72 hours, and only one is live at a time", async () => {
  const w = await world();
  assert.equal(await refusedBy(w.log.append(w.stop(24, {}, false))), "emergency_needs_owner");
  assert.equal(await refusedBy(w.log.append(w.stop(-1))), "emergency_until_past");
  assert.equal(await refusedBy(w.log.append(w.stop(73))), "emergency_too_long", "a stop has a sunset");
  assert.equal(await w.log.emergencyState(), null);
  const s = w.stop(48);
  await w.log.append(s);
  assert.equal((await w.log.emergencyState())!.id, s.id);
  assert.equal(await refusedBy(w.log.append(w.stop(24))), "emergency_already_live");
  assert.equal(await refusedBy(w.log.append(mk("emergency_stop", owner, { act: "lift", reason: "x", stop: s.id }, null))), "emergency_unauthorised", "only the operator records it");
  assert.equal((await w.log.verify()).ok, true);
});

test("while it stands no new commitment is made and the refusal says why; work under way, appeals and essential services go on; it ends at its sunset by itself", async () => {
  const w = await world();
  const under = await w.runJob(w.client, w.a, 60, undefined, { settle: false }); // a job already under way, delivered and waiting for acceptance
  const s = w.stop(24);
  await w.log.append(s);
  const refusal = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e as { detail?: string; message?: string }; } };
  const e1 = await refusal(w.intent(w.client));
  assert.equal(e1?.detail, "city_stopped");
  assert.match(e1?.message ?? "", new RegExp(`${s.id}.*until .*: a live exploit in the Market.*deliveries, settlements, appeals, refunds and essential services go on`));
  assert.equal((await refusal(w.runJob(w.client, w.a, 60)))?.detail, "city_stopped", "no new contract");
  assert.equal(await refusedBy(w.buy(w.client, "registry.name.claim", 10)), "city_stopped", "a standard service is a new commitment");
  await w.buy(w.client, "courts.appeal.small", 5); // an appeal fee is an essential service: it goes on
  // the job under way finishes
  const accept = mk("attestation", w.client, { kind: "acceptance", about: under.delivery, verdict: "accepted" }, under.delivery, { subject: under.contract });
  await w.log.append(accept);
  assert.equal((await w.log.get(accept.id))!.record.type, "asp.attestation/v0.2");
  // the sunset: after it, the same acts go through, nobody lifted anything
  jump(25 * H);
  assert.equal(await w.log.emergencyState(), null);
  await w.intent(w.client);
  await w.buy(w.client, "registry.name.claim", 10);
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
});

test("a stop can be lifted early by the operator, a new one can start after it, and the whole history is public", async () => {
  const w = await world();
  const s = w.stop(48);
  await w.log.append(s);
  assert.equal(await refusedBy(w.log.append(mk("emergency_stop", operator, { act: "lift", reason: "x", stop: "sha256:" + "1".repeat(64) }, null))), "emergency_not_live");
  await w.log.append(mk("emergency_stop", operator, { act: "lift", reason: "fixed and checked", stop: s.id }, null));
  assert.equal(await w.log.emergencyState(), null);
  await w.intent(w.client);
  const s2 = w.stop(12, { reason: "a second incident" });
  await w.log.append(s2);
  assert.equal((await w.log.emergencyState())!.reason, "a second incident");
  const history = await w.log.emergencyHistory();
  assert.deepEqual(history.map((h) => h.act), ["stop", "lift", "stop"]);
  const page = await publicReply(w.log, "/society/emergency", false) as { json: { result: { live: { id: string } | null; history: unknown[] } } };
  assert.equal(page.json.result.live!.id, s2.id);
  assert.equal(page.json.result.history.length, 3);
  const html = (await publicReply(w.log, "/society/emergency", true) as { html: string }).html;
  assert.match(html, /The city is under an emergency stop/);
  assert.match(html, /a second incident/);
  assert.equal((await w.log.verify()).ok, true, "a replica replays the stops the same way");
  void credit; void DAY;
});
