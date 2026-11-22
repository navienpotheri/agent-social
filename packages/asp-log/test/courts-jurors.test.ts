/**
 * The Courts' jurors page and the view behind it (DK123, courts.md CT-20; GET /courts/jurors): each registered, staked juror with its stake and the open cases whose drawn panel it sits on, and the totals; it equals the
 * log, a case that is ruled no longer counts as open, and a juror with no stake is not listed. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { publicReply } from "../src/public-pages.ts";
import { credit, kit, mk, type Party } from "./society-kit.ts";

async function world(n: number) {
  const k = await kit();
  await k.withPrices();
  const jurors: Party[] = [];
  for (let i = 0; i < n; i++) { const j = await k.person(`cj-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: credit(100 + i) }, null)); jurors.push(j); }
  const principal = await k.person("cj-claimant", 20_000);
  const sponsor = await k.person("cj-sponsor", 50);
  const performer = await k.agent("cj-performer", sponsor, { funds: 2000 });
  const dispute = async () => {
    const job = await k.runJob(principal, performer, 40, undefined, { settle: false });
    await k.log.append(mk("attestation", principal, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["not good enough"] }, job.delivery, { subject: job.contract }));
    return job.contract;
  };
  return { k, jurors, dispute };
}

test("DK123: the view lists each staked juror with its stake and its open cases, and the totals equal the docket", async () => {
  const w = await world(5);
  const none = await w.k.log.courtJurors();
  assert.equal(none.jurors.length, 5);
  assert.equal(none.openCases, 0);
  assert.deepEqual(none.jurors.map((j) => j.openCases), [0, 0, 0, 0, 0]);
  assert.equal(none.staked, 100 + 101 + 102 + 103 + 104);
  const c1 = await w.dispute(), c2 = await w.dispute();
  const v = await w.k.log.courtJurors();
  assert.equal(v.openCases, 2);
  const docket = (await w.k.log.courtDocket()).filter((d) => !d.ruled);
  for (const j of v.jurors) assert.equal(j.openCases, docket.filter((d) => d.panel.includes(j.did)).length, "each count equals the panels in the docket");
  assert.equal(v.jurors.reduce((n, j) => n + j.openCases, 0), docket.reduce((n, d) => n + d.panel.length, 0), "every drawn seat is counted once");
  assert.ok(v.jurors.some((j) => j.openCases > 0));
  void c1; void c2;
});

test("DK123: GET /courts/jurors serves the view without a token, a juror with no stake is not listed", async () => {
  const w = await world(3);
  const r = await publicReply(w.k.log, "/courts/jurors", false) as { status: number; json: { ok: boolean; result: { jurors: { did: string }[]; openCases: number; staked: number } } };
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.result.jurors.map((j) => j.did), w.jurors.map((j) => j.did).sort());
  assert.equal(r.json.result.openCases, 0);
  const idle = await w.k.person("cj-idle", 500);
  await w.k.log.append(mk("juror", idle, { did: idle.did, stake: credit(0) }, null)).catch(() => undefined);
  const again = await publicReply(w.k.log, "/courts/jurors", false) as { json: { result: { jurors: { did: string }[] } } };
  assert.ok(!again.json.result.jurors.some((j) => j.did === idle.did), "no stake, not listed");
});

test("DK123: a case that has been ruled is no longer open, and its jurors drop it from their counts", async () => {
  const w = await world(5);
  const contract = await w.dispute();
  const before = await w.k.log.courtJurors();
  assert.equal(before.openCases, 1);
  const panel = await w.k.log.drawPanel(contract);
  assert.ok(before.jurors.filter((j) => j.openCases === 1).map((j) => j.did).sort().join() === [...panel].sort().join(), "the jurors with a case are the drawn panel");
  const byDid = new Map(w.jurors.map((j) => [j.did, j]));
  const rej = (await w.k.log.recordsOfTypes(["attestation"])).filter((r) => r.subject === contract).at(-1)!;
  const [first, ...others] = panel.slice(0, Math.ceil(panel.length / 2)).map((d) => byDid.get(d)!);
  let r = mk("attestation", first, { kind: "ruling", about: contract, verdict: "for_principal", fault: { [(await w.k.log.courtDocket())[0].performer]: 1000 }, reasons: ["decided on the record"], code: { version: "1.0", articles: ["4.1"] } }, rej.id, { subject: contract });
  for (const s of others) r = cosign(r, s as Signer);
  await w.k.log.append(r);
  const after = await w.k.log.courtJurors();
  assert.equal(after.openCases, 0);
  assert.ok(after.jurors.every((j) => j.openCases === 0));
});
