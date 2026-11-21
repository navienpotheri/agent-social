/**
 * Anti-farming in the log (register row DK1357; spec-delta S1410): a signed `common_control` record makes sponsors one controller for independence (a job between their agents stops counting, with the label
 * `common_control`), clusters merge and lift, the report finds a ring in a real log, and the Clinic's cohort freeze applies to the flagged cluster. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DAY, clinic, jump, kit, mk, nowIso, operator, party, refusedBy, tick, type Party } from "./society-kit.ts";
import { farmingFreezeBody, controlMapOf } from "../src/index.ts";
import { partyFactsOf } from "../src/journey.ts";

const control = (by: Party, sponsors: string[], over: Record<string, unknown> = {}) =>
  mk("common_control", by, { cluster: [...sponsors].sort()[0], sponsors, basis: ["payment"], detected_at: nowIso(), ...over }, null);

async function world() {
  const k = await kit();
  await k.withPrices();
  const sponsors = [await k.person("fm-a", 10), await k.person("fm-b", 10), await k.person("fm-c", 10), await k.person("fm-d", 10)];
  const agents = [] as Party[];
  for (const [i, s] of sponsors.entries()) agents.push(await k.agent(`fm-agent-${i}`, s, { funds: 300 }));
  return { ...k, sponsors, agents };
}

describe("a signed finding of common control", () => {
  test("only the operator or the watcher signs it, for sponsors the log knows, with the right cluster id; only the operator lifts it", async () => {
    const w = await world();
    const [a, b] = w.sponsors;
    const stranger = await w.person("fm-stranger");
    assert.equal(await refusedBy(w.log.append(control(stranger, [a.did, b.did]))), "common_control_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(control(operator, [a.did, b.did], { cluster: b.did }))), "common_control_cluster_id");
    assert.equal(await refusedBy(w.log.append(control(operator, [a.did, "did:web:example.com:users:ghost"]))), "common_control_unknown_sponsor");
    await w.log.append(control(operator, [a.did, b.did]));
    assert.equal(await w.log.controlClusterOf(b.did), [a.did, b.did].sort()[0]);
    await w.log.append(control(operator, [a.did, b.did], { lift: true }));
    assert.equal(await w.log.controlClusterOf(a.did), undefined, "lifted");
    assert.equal((await w.log.verify()).ok, true);
  });

  test("clusters merge when findings overlap and shrink when a sponsor is lifted; the journey view reads the same map as the log", async () => {
    const w = await world();
    const [a, b, c, d] = w.sponsors.map((s) => s.did);
    await w.log.append(control(operator, [c, d]));
    await w.log.append(control(operator, [b, c]));
    const canon = [b, c, d].sort()[0];
    for (const s of [b, c, d]) assert.equal(await w.log.controlClusterOf(s), canon, "three sponsors in one cluster after two overlapping findings");
    assert.equal(await w.log.controlClusterOf(a), undefined);
    await w.log.append(control(operator, [d, c], { lift: true }));
    const stored = await w.log.recordsOfTypes(["common_control"]);
    const map = controlMapOf(stored);
    for (const s of [a, b, c, d]) assert.equal(map.get(s), (await w.log.controlClusterOf(s)) ?? undefined, `the record-only map agrees with the log for ${s}`);
  });
});

describe("what common control changes", () => {
  test("a job between agents of two sponsors under common control stops counting for standing, and is labelled; before the finding it counted", async () => {
    const w = await world();
    const [a0, a1] = w.agents, [s0, s1] = w.sponsors;
    const before = await w.runJob(a0, a1, 60);
    assert.ok(before.contract);
    assert.equal((await w.log.reputationOf(a1.did))?.qualifyingJobs, 1, "independent sponsors: the job counts");
    await w.log.append(control(operator, [s0.did, s1.did]));
    await w.runJob(a0, a1, 60);
    assert.equal((await w.log.reputationOf(a1.did))?.qualifyingJobs, 1, "after the finding, a second job between them does not count");
    const facts = await w.log.recordsOfTypes(["passport", "common_control"]);
    const stored = facts.map((r, i) => ({ seq: i, id: r.id, record: r })) as Parameters<typeof partyFactsOf>[0];
    const f = partyFactsOf(stored);
    assert.equal(f.get(a1.did)!.sponsor, f.get(a0.did)!.sponsor, "the journey view reads them as one sponsor");
    assert.notEqual(f.get(a1.did)!.rawSponsor, f.get(a0.did)!.rawSponsor);
    // a lift gives independence back for later jobs
    await w.log.append(control(operator, [s0.did, s1.did], { lift: true }));
    const extra = await w.agent("fm-extra", s1, { funds: 300 }); // a new performer under the lifted sponsor: no loop rule, no counterparty cap in the way
    await w.runJob(a0, extra, 60);
    assert.equal((await w.log.reputationOf(extra.did))?.qualifyingJobs, 1, "after the lift a job between the two sponsors counts again");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
  });
});

describe("the report and the Clinic's freeze on a flagged cluster", () => {
  test("a ring of three sponsors in a real log is found; the Clinic freezes their agents after an upheld report; a cluster of fewer than three sponsors is refused as one operator's", async () => {
    const w = await world();
    const [a, b, c] = w.agents;
    for (let round = 0; round < 3; round++) { await w.runJob(a, b, 60); await w.runJob(b, c, 60); await w.runJob(c, a, 60); jump(DAY); }
    const rep = await w.log.farmingReport({ at: nowIso() });
    const ring = rep.findings.find((f) => (f.kind === "ring" || f.kind === "closed_circle") && f.level !== "watch");
    assert.ok(ring, `a ring is found: ${JSON.stringify(rep.findings.map((f) => [f.kind, f.level]))}`);
    assert.deepEqual(ring!.sponsors.sort(), w.sponsors.slice(0, 3).map((s) => s.did).sort());
    assert.ok(!rep.flaggedSponsors.includes(w.sponsors[3].did), "the fourth sponsor, who did nothing, is not flagged");
    // the Clinic's cohort freeze needs an upheld report; the report's own ruling path is tested in report.test.ts, so the row is put in the store here
    const members = await w.log.agentsOfSponsors(ring!.sponsors);
    assert.equal(members.length, 3);
    const upheld = "sha256:" + "a".repeat(64);
    await (w.log as unknown as { store: { transaction: <T>(f: (tx: { putReport: (r: unknown) => Promise<void> }) => Promise<T>) => Promise<T> } }).store.transaction(async (tx) => tx.putReport({ id: upheld, contract: "sha256:" + "b".repeat(64), reporter: w.sponsors[3].did, accused: a.did, deposit: 0, status: "upheld" }));
    const at = nowIso();
    const body = farmingFreezeBody({ members, report: upheld, cluster: ring!.sponsors[0], level: "halt", days: 3, at, sponsors: ring!.sponsors.length });
    assert.match(body.reason, /upheld report/);
    assert.equal(Date.parse(body.effective_from) - Date.parse(at), DAY, "the record is the notice: 24 hours");
    // fewer than three sponsors is one operator's pattern, refused
    assert.equal(await refusedBy(w.log.append(mk("quarantine", clinic, { ...body, members: members.slice(0, 2) }, null))), "quarantine_cohort_too_few_sponsors");
    await w.log.append(mk("quarantine", clinic, body, null));
    jump(DAY + 120_000);
    assert.equal(await refusedBy(w.openMandate(a)), "agent_quarantined", "the frozen agent is refused a new Mandate");
    assert.equal(await refusedBy(w.openMandate(w.agents[3])), undefined, "an agent outside the cluster is untouched");
    // (no replay check here: the upheld report was put in the store directly, and its ruling path is tested in report.test.ts)
    void tick;
  });
});
