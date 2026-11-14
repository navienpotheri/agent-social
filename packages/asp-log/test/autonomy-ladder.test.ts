// The autonomy ladder (register row DK5; spec-delta S457): standing sets how much an agent may be trusted with. A tier 1 agent is refused a Mandate whose institution_spend is above its limit, with the reason; after
// a recorded promotion the same Mandate is allowed; and a promotion needs what the Academy's rules ask (a certificate and independent accepted jobs), so the ladder cannot be climbed by asking. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Kit, refused } from "./academy-kit.ts";

test("DK5: a tier 1 agent is refused a Mandate above its limit with a reason; the same Mandate is allowed after a recorded promotion to tier 2; the tier 2 limit is a limit too", async () => {
  const k = new Kit();
  const a = await k.agent("ladder-agent");
  assert.equal((await k.log.reputationOf(a.did))?.tier, 1);
  // 100 is the tier 1 limit: a Mandate at the limit is allowed, one credit over is refused with the rule and the number.
  await k.job(a, 100);
  const why = await refused(k.job(a, 101));
  assert.equal(why, "tier_limit_exceeded");
  const f = await k.job(a, 500).then(() => "allowed", (e) => String((e as { message?: string }).message ?? e));
  assert.match(f, /tier 1|may not exceed 100/, `the reason names the tier and the limit: ${f}`);

  // The promotion is earned and recorded: a Foundations certificate and independent accepted jobs, then the Registrar's tier_promotion.
  const [p1, p2] = [await k.person("ladder-p1"), await k.person("ladder-p2")];
  const cert = await k.certify(a, "foundations", 1);
  for (const p of [p1, p2, p1]) await k.acceptedJob(p, a);
  await k.log.append(k.promote(a, 1, 2, [cert]));
  assert.equal((await k.log.reputationOf(a.did))?.tier, 2);

  // The same Mandate that was refused is allowed now; the tier 2 limit (1000) stops the next step up.
  await k.job(a, 500);
  await k.job(a, 1000);
  assert.equal(await refused(k.job(a, 1001)), "tier_limit_exceeded", "tier 2 has a limit too");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});

test("DK5: a promotion cannot be asked for: without the certificate, without independent jobs, or from the wrong tier it is refused, and the tier stays", async () => {
  const k = new Kit();
  const a = await k.agent("ladder-ask");
  const cert = await k.certify(a, "foundations", 1);
  const noJobs = await refused(k.log.append(k.promote(a, 1, 2, [cert])));
  assert.ok(noJobs, "no accepted independent jobs: refused");
  assert.equal((await k.log.reputationOf(a.did))?.tier, 1, "the tier did not move");
  const unknown = await refused(k.log.append(k.promote(a, 1, 2, ["sha256:" + "4".repeat(64)])));
  assert.equal(unknown, "promotion_certificate_unknown");
  const wrongFrom = await refused(k.log.append(k.promote(a, 2, 3, [cert])));
  assert.ok(wrongFrom, "from a tier the agent is not at: refused");
  assert.equal((await k.log.reputationOf(a.did))?.tier, 1);
});
