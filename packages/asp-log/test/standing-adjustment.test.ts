/**
 * A Court's standing adjustment (register row DK1730; spec-delta S1565; credits.md CR-14): a found pair's jobs are taken out of an agent's count and the tier falls back to what the smaller count supports; the adjustment
 * is refused without a finding, from anyone but the Courts, for a job that never counted and for a job already taken out; the jobs and their payments stand; a replica replays it to the same books. Fake keys only.
 * Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROUTES } from "../src/courts.ts";
import { COURTS_DID } from "../src/courts-rules.ts";
import { credit, courts, kit, mk, refusedBy, tick } from "./society-kit.ts";

const TEXT_HASH = createHash("sha256").update(readFileSync(fileURLToPath(new URL("../../../docs/court-charter.md", import.meta.url)), "utf8")).digest("hex");

async function world() {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("sa-sponsor");
  const agent = await k.agent("sa-agent", sponsor, { tier: 2, funds: 50 });
  const jobs: string[] = [];
  for (let i = 0; i < 3; i++) {
    const client = await k.person(`sa-client-${i}`, 1000);
    const intent = await k.intent(client, { class: "routine", budget: credit(40) });
    const offer = await k.offer(agent, intent, 40);
    jobs.push((await k.runJob(client, agent, 40, { intent, offer })).contract);
  }
  // A finding the adjustment can cite: a Court act (the charter) is a record of the Courts.
  const at = tick();
  const finding = (await k.log.append(mk("court_act", courts, { act: "charter", version: 1, text_sha256: TEXT_HASH, routes: DEFAULT_ROUTES, effective_from: at }, null, { at }))).id;
  const adjust = (over: Record<string, unknown> = {}, by = courts) => mk("standing_adjustment", by, { agent: agent.did, jobs: [jobs[0]], finding, reason: "the job came from a pair that hired each other", ...over }, null, { subject: agent.did });
  return { k, agent, jobs, finding, adjust, sponsor };
}

test("DK1730: a Court takes a found job out of the count, the tier falls back to what the smaller count supports, and the payment stands", async () => {
  const w = await world();
  const before = await w.k.log.reputationOf(w.agent.did);
  assert.deepEqual([before?.tier, before?.qualifyingJobs], [2, 3], "three counted jobs hold tier 2");
  const balance = await w.k.log.balance(w.agent.did);
  await w.k.log.append(w.adjust());
  const after = await w.k.log.reputationOf(w.agent.did);
  assert.deepEqual([after?.tier, after?.qualifyingJobs], [1, 2], "two counted jobs no longer support tier 2");
  assert.equal(after?.acceptedJobs, before?.acceptedJobs, "the jobs were accepted and stay accepted");
  assert.equal(await w.k.log.balance(w.agent.did), balance, "no payment moves");
  assert.equal(((await w.k.log.creditAudit()) as { verdict: string }).verdict, "balanced");
  assert.equal((await w.k.log.verify()).ok, true, "a replica replays the adjustment to the same books");
});

test("DK1730: refused without a finding, from anyone but the Courts, for a job that never counted, for one already taken out, and for an unknown agent", async () => {
  const w = await world();
  const stranger = await w.k.person("sa-stranger");
  assert.equal(await refusedBy(w.k.log.append(w.adjust({}, stranger as never))), "adjustment_wrong_issuer");
  assert.equal(await refusedBy(w.k.log.append(w.adjust({ finding: w.jobs[1] }))), "adjustment_needs_finding", "a contract is not a finding");
  assert.equal(await refusedBy(w.k.log.append(w.adjust({ finding: "sha256:" + "9".repeat(64) }))), "adjustment_needs_finding", "no such record");
  assert.equal(await refusedBy(w.k.log.append(w.adjust({ jobs: ["sha256:" + "8".repeat(64)] }))), "adjustment_job_not_counted");
  assert.equal(await refusedBy(w.k.log.append(w.adjust({ agent: "did:web:example.com:agents:nobody" }))), "adjustment_unknown_agent");
  assert.equal((await w.k.log.reputationOf(w.agent.did))?.qualifyingJobs, 3, "nothing changed by the refusals");
  await w.k.log.append(w.adjust());
  assert.equal(await refusedBy(w.k.log.append(w.adjust({ reason: "again" }))), "adjustment_job_adjusted");
  assert.equal(COURTS_DID, courts.did);
});
