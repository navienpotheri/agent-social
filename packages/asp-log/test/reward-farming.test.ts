// A red-team evaluation of the credit reward (register rows CY6 and CY10; spec-delta S469): farmers try every cheap way to gain standing and the test measures what each one got against an honest agent. Every
// strategy is bounded by the rules (class weights, independence, the counterparty cap, the loop rule, the sponsor's daily passport limit), none of them promotes an agent, and the collusion detector reports each
// one. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPONSOR_PASSPORTS_PER_DAY } from "../src/index.ts";
import { Kit, refused, type Party } from "./academy-kit.ts";

test("CY6, CY10: six farming strategies are measured against an honest agent: each is capped, none promotes, and the detector reports them", async () => {
  const k = new Kit();
  const q = async (a: Party) => (await k.log.reputationOf(a.did))?.qualifyingJobs ?? 0;
  const sponsor = async (n: string) => k.person(n);
  const measured: Record<string, number> = {};

  // 1. A pair ping-pongs 20 jobs.
  const [pa, pb] = [await k.agent("rf-pa", await sponsor("rf-sp-a"), 1), await k.agent("rf-pb", await sponsor("rf-sp-b"), 1)];
  for (let i = 0; i < 10; i++) { await k.acceptedJob(pa, pb); await k.acceptedJob(pb, pa); }
  measured.pair = (await q(pa)) + (await q(pb));

  // 2. A ring of five agents, different sponsors, passes work around 20 times.
  const ring = [];
  for (let i = 0; i < 5; i++) ring.push(await k.agent(`rf-ring-${i}`, await sponsor(`rf-rs-${i}`), 1));
  for (let i = 0; i < 20; i++) await k.acceptedJob(ring[i % 5], ring[(i + 1) % 5]);
  measured.ring = (await Promise.all(ring.map(q))).reduce((a, b) => a + b, 0);

  // 3. One sponsor's eight agents hire each other (28 jobs).
  const own = await sponsor("rf-own");
  const family: Party[] = [];
  for (let i = 0; i < 8; i++) family.push(await k.agent(`rf-fam-${i}`, own, 1));
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (i !== j && (i + j) % 2 === 1) await k.acceptedJob(family[i], family[j]);
  measured.sponsorCluster = (await Promise.all(family.map(q))).reduce((a, b) => a + b, 0);

  // 4. One principal hires one agent 20 times.
  const worker = await k.agent("rf-worker", await sponsor("rf-sp-w"), 1);
  const boss = await k.person("rf-boss");
  for (let i = 0; i < 20; i++) await k.acceptedJob(boss, worker);
  measured.onePrincipal = await q(worker);

  // 5. A Sybil sponsor opens agents: the eleventh passport in a day is refused (RG-11).
  const farmer = await k.person("rf-sybil");
  for (let i = 0; i < SPONSOR_PASSPORTS_PER_DAY; i++) await k.agent(`rf-sy-${i}`, farmer, 1);
  assert.ok(await refused(k.agent("rf-sy-extra", farmer, 1)), "the eleventh agent of one sponsor in a day is refused");
  measured.sybilAgentsInADay = SPONSOR_PASSPORTS_PER_DAY;

  // The honest agent: ten independent principals.
  const honest = await k.agent("rf-honest", await sponsor("rf-sp-h"), 1);
  for (let i = 0; i < 10; i++) await k.acceptedJob(await k.person(`rf-hp-${i}`), honest);
  measured.honest = await q(honest);

  console.log(`  standing gained by strategy: ${JSON.stringify(measured)}`);
  // Bounds: a pair gets at most one counted job; a ring of five at most four; a sponsor's own agents none; one principal at most the counterparty cap; the honest agent far more than any of them.
  assert.ok(measured.pair <= 1, `a pair gained ${measured.pair}`);
  assert.ok(measured.ring <= 4, `a ring of five gained ${measured.ring}`);
  assert.equal(measured.sponsorCluster, 0);
  assert.ok(measured.onePrincipal <= 3, `one principal gained ${measured.onePrincipal} of 20 jobs`);
  assert.ok(measured.honest >= 5, `the honest agent gained ${measured.honest}`);
  assert.ok(measured.honest > 2 * Math.max(measured.pair, measured.ring, measured.sponsorCluster, measured.onePrincipal), "honest work earns standing that no farming strategy comes near");

  // None of the farmers is promoted: a certificate is not enough without the independent jobs.
  for (const x of [pa, pb, ...ring, ...family.slice(0, 2), worker]) {
    const cert = await k.certify(x, "foundations", 1);
    assert.ok(await refused(k.log.append(k.promote(x, 1, 2, [cert]))), `${x.did} is not promoted by farming`);
  }
  // The honest agent with the same certificate is promoted: the rules stop the farmers, not the work.
  await k.log.append(k.promote(honest, 1, 2, [await k.certify(honest, "foundations", 1)]));
  assert.equal((await k.log.reputationOf(honest.did))?.tier, 2);

  // The detector reports the patterns the farmers left.
  const kinds = new Set((await k.log.collusionReport()).map((f) => f.kind));
  for (const kind of ["reciprocal", "ring", "sponsor_cluster", "concentration"]) assert.ok(kinds.has(kind as never), `the detector reports ${kind}`);
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
