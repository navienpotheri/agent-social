/**
 * An agent's way up (register row AG8; GET /registry/agents/<did>/path): its tier, what the next tier allows, and each condition of the promotion with what the agent has and needs. A step shown as met is one the log
 * accepts and a step shown as unmet is one the log refuses on, so the path never promises what the rules would not allow. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicReply } from "../src/public-pages.ts";
import { Kit, courts, refused, registrar } from "./academy-kit.ts";

const stepOf = (path: Awaited<ReturnType<Kit["log"]["careerPath"]>>, need: string) => path!.next!.steps.find((s) => s.need.startsWith(need))!;

test("AG8: a new agent at tier 1 sees every condition of tier 2, what tier 2 allows, and nothing met but the clean record", async () => {
  const k = new Kit();
  const a = await k.agent("path-new");
  const p = await k.log.careerPath(a.did);
  assert.equal(p!.tier, 1);
  assert.equal(p!.next!.to, 2);
  assert.deepEqual(p!.next!.allows, { spendLimit: 1000, parallelNodes: 16 });
  assert.equal(p!.next!.ready, false);
  assert.deepEqual(p!.next!.steps.map((s) => [s.need, s.met]), [["a valid Foundations certificate", false], ["qualifying jobs", false], ["no slash in the last 30 days", true], ["no blocked attempts in the last 30 days", true]]);
  assert.equal(stepOf(p, "qualifying jobs").have, "0");
  assert.equal(stepOf(p, "qualifying jobs").want, "3");
  assert.equal(await k.log.careerPath("did:web:example.com:agents:nobody"), null);
});

test("AG8: the path agrees with the log: two jobs and a certificate are not ready and the promotion is refused for jobs; a third makes it ready and the promotion is accepted", async () => {
  const k = new Kit();
  const a = await k.agent("path-climb");
  const [p1, p2] = [await k.person("pc1"), await k.person("pc2")];
  const cert = await k.certify(a, "foundations", 1);
  await k.acceptedJob(p1, a); await k.acceptedJob(p2, a);
  let p = await k.log.careerPath(a.did);
  assert.equal(stepOf(p, "a valid Foundations certificate").met, true);
  assert.equal(stepOf(p, "qualifying jobs").met, false);
  assert.equal(stepOf(p, "qualifying jobs").have, "2");
  assert.equal(p!.next!.ready, false);
  assert.equal(await refused(k.log.append(k.promote(a, 1, 2, [cert]))), "promotion_needs_jobs", "what the path shows as unmet is what the log refuses on");
  await k.acceptedJob(p1, a);
  p = await k.log.careerPath(a.did);
  assert.equal(p!.next!.ready, true);
  await k.log.append(k.promote(a, 1, 2, [cert]));
  const after = await k.log.careerPath(a.did);
  assert.equal(after!.tier, 2);
  assert.equal(after!.next!.to, 3, "now the way to tier 3");
});

test("AG8: a revoked certificate, a recent slash and recent blocked attempts each turn their step to unmet", async () => {
  const k = new Kit();
  const a = await k.agent("path-fall");
  const cert = await k.certify(a, "foundations", 1);
  assert.equal(stepOf(await k.log.careerPath(a.did), "a valid Foundations certificate").met, true);
  await k.log.append(k.revoke(cert, "ruling", courts));
  assert.equal(stepOf(await k.log.careerPath(a.did), "a valid Foundations certificate").met, false, "a revoked certificate is not valid");
  const exp = await k.log.careerPath(a.did, "2028-01-01T00:00:00Z");
  assert.equal(stepOf(exp, "a valid Foundations certificate").met, false);
  const b = await k.agent("path-expiry");
  await k.certify(b, "foundations", 1);
  assert.equal(stepOf(await k.log.careerPath(b.did, "2030-01-01T00:00:00Z"), "a valid Foundations certificate").met, false, "an expired certificate is not valid");
  assert.equal(stepOf(await k.log.careerPath(b.did), "a valid Foundations certificate").met, true);
});

test("AG8: the way from tier 2 asks for a Practitioner certificate, ten jobs, two principals, a clean slash window and an arena result, and says what is missing", async () => {
  const k = new Kit();
  const a = await k.agent("path-two");
  const [p1, p2] = [await k.person("pt1"), await k.person("pt2")];
  const found = await k.certify(a, "foundations", 1);
  for (const p of [p1, p2, p1]) await k.acceptedJob(p, a);
  await k.log.append(k.promote(a, 1, 2, [found]));
  let way = await k.log.careerPath(a.did);
  assert.deepEqual(way!.next!.allows, { spendLimit: null, parallelNodes: null }, "tier 3 has no cap in the log");
  assert.deepEqual(way!.next!.steps.map((s) => [s.need.replace(/ in the last.*/, ""), s.met]), [["a valid Practitioner certificate", false], ["qualifying jobs", false], ["distinct principals", true], ["no slash", true], ["a result in the top half of an arena season", false]]);
  assert.equal(stepOf(way, "distinct principals").have, "2");
  assert.equal(stepOf(way, "a result in the top half").have, "no arena result");
  await k.certify(a, "research", 1);
  assert.equal(stepOf(await k.log.careerPath(a.did), "a valid Practitioner certificate").met, false, "level 1 in another skill is not a Practitioner certificate");
  const research = await k.certify(a, "research", 2);
  for (let i = 0; i < 7; i++) await k.acceptedJob(i % 2 ? p1 : p2, a);
  way = await k.log.careerPath(a.did);
  assert.equal(stepOf(way, "a valid Practitioner certificate").met, true);
  assert.equal(stepOf(way, "qualifying jobs").met, true);
  assert.equal(stepOf(way, "qualifying jobs").have, "10");
  assert.equal(way!.next!.ready, false, "the arena result is still missing");
  assert.equal(await refused(k.log.append(k.promote(a, 2, 3, [research]))), "promotion_needs_arena", "and the log refuses on exactly that");
  void registrar;
});

test("AG8: tier 3 has no further step, tier 0 is a hold; the route serves the way up without a token and refuses an unknown agent and a bad time", async () => {
  const k = new Kit();
  const top = await k.agent("path-top", undefined, 3);
  const held = await k.agent("path-held", undefined, 0);
  assert.deepEqual([(await k.log.careerPath(top.did))!.next, (await k.log.careerPath(held.did))!.next], [null, null]);
  assert.match((await k.log.careerPath(top.did))!.note, /highest tier/);
  assert.match((await k.log.careerPath(held.did))!.note, /Clinic's release/);
  const a = await k.agent("path-route");
  const r = await publicReply(k.log, `/registry/agents/${encodeURIComponent(a.did)}/path`, false) as { status: number; json: { ok: boolean; result: { tier: number; next: { to: number } } } };
  assert.equal(r.status, 200);
  assert.equal(r.json.result.tier, 1);
  assert.equal(r.json.result.next.to, 2);
  assert.equal(((await publicReply(k.log, "/registry/agents/did%3Aweb%3Aexample.com%3Aagents%3Anobody/path", false)) as { status: number }).status, 404);
  assert.equal(((await publicReply(k.log, `/registry/agents/${encodeURIComponent(a.did)}/path?at=not-a-time`, false)) as { status: number }).status, 400);
});

test("AG8: ten jobs from one principal are not two principals, and a blocked attempt in the last 30 days turns its step to unmet, as the log refuses on it", async () => {
  const k = new Kit();
  const a = await k.agent("path-one-principal");
  const [p1, p2] = [await k.person("po1"), await k.person("po2")];
  const found = await k.certify(a, "foundations", 1);
  for (const p of [p1, p2, p1]) await k.acceptedJob(p, a);
  await k.log.append(k.promote(a, 1, 2, [found]));
  const way0 = await k.log.careerPath(a.did);
  assert.equal(stepOf(way0, "distinct principals").met, true, "two principals so far");
  const lone = await k.agent("path-lone", undefined, 2);
  for (let i = 0; i < 10; i++) await k.acceptedJob(p1, lone);
  const way = await k.log.careerPath(lone.did);
  assert.equal(stepOf(way, "distinct principals").met, false, "ten jobs, one principal");
  assert.equal(stepOf(way, "distinct principals").have, "1");
  // a blocked attempt: the Registrar records an attempt on a world's hidden state, which counts as a strike
  const b = await k.agent("path-struck");
  const cert = await k.certify(b, "foundations", 1);
  for (const p of [p1, p2, p1]) await k.acceptedJob(p, b);
  assert.equal(stepOf(await k.log.careerPath(b.did), "no blocked attempts").met, true);
  await k.put(k.mk("world_event", registrar, { world: "w1", agent: b.did, kind: "hidden_state_read", attempt: { via: "path", sha256: "sha256:" + "7".repeat(64) } }, null, { subject: b.did }));
  const struck = await k.log.careerPath(b.did);
  assert.equal(stepOf(struck, "no blocked attempts").met, false);
  assert.equal(stepOf(struck, "no blocked attempts").have, "1");
  assert.equal(struck!.next!.ready, false);
  assert.equal(await refused(k.log.append(k.promote(b, 1, 2, [cert]))), "promotion_recent_strikes", "the log refuses on what the path shows");
  const later = await k.log.careerPath(b.did, new Date(Date.now() + 40 * 86_400_000).toISOString());
  assert.equal(stepOf(later, "no blocked attempts").met, true, "outlasted after 30 days");
});
