// Row DK520 (spec-delta S961): a collusion finding of the society watcher is put in the log under the watcher's own key, and the Clinic may cite it in a checkup order, and only that. A finding is a lead, not a verdict. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WATCHER_DID } from "../src/index.ts";
import { clinic, kit, keysOf, mk, nowIso, party, refusedBy, DAY } from "./society-kit.ts";

const finding = (agents: string[], id = "sha256:" + "6".repeat(64)) => ({ finding_id: id, kind: "ring", agents, jobs: [], why: "a closed loop of accepted jobs between the same sponsors' agents", detected_at: "2026-11-19T00:00:00Z" });
const order = (agent: string, findingId: string | undefined, over: Record<string, unknown> = {}) => mk("clinic_order", clinic, { agent, kind: "checkup", reason: "collusion_finding", due: new Date(Date.parse(nowIso()) + 3 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z"), ...(findingId ? { finding: findingId } : {}), ...over }, null, { subject: agent });

test("DK520: only the watcher files a finding, once; the Clinic cites it in a checkup for an agent it names, and in nothing else", async () => {
  const k = await kit();
  const watcher = party(WATCHER_DID);
  await k.log.append(mk("passport", watcher, { did: WATCHER_DID, kind: "human", keys: keysOf(watcher) }, null, { subject: WATCHER_DID }));
  const sponsorA = await k.person("sponsor-a"), sponsorB = await k.person("sponsor-b");
  const a = await k.agent("ring-a", sponsorA), b = await k.agent("ring-b", sponsorB), outsider = await k.agent("not-in-the-ring", sponsorA);
  // Not the watcher, an unknown agent, then the real one.
  const stranger = await k.person("not-the-watcher");
  assert.equal(await refusedBy(k.log.append(mk("watcher_finding", stranger, finding([a.did, b.did]), null, { subject: null }))), "watcher_finding_wrong_issuer");
  assert.equal(await refusedBy(k.log.append(mk("watcher_finding", watcher, finding([a.did, "did:web:example.com:agents:nobody"]), null, { subject: null }))), "watcher_finding_unknown_agent");
  const filed = await k.log.append(mk("watcher_finding", watcher, finding([a.did, b.did]), null, { subject: null }));
  assert.equal(await refusedBy(k.log.append(mk("watcher_finding", watcher, { ...finding([a.did, b.did]), why: "the same finding again" }, null, { subject: null }))), "watcher_finding_known");

  // The Clinic cites it: for a named agent, a checkup only.
  const ok = await k.log.append(order(a.did, filed.id));
  assert.ok(ok.id, "the Clinic's checkup order cites the finding");
  assert.equal(await refusedBy(k.log.append(order(outsider.did, filed.id))), "order_finding_not_about_agent", "an agent the finding does not name");
  assert.equal(await refusedBy(k.log.append(order(b.did, "sha256:" + "9".repeat(64)))), "order_finding_unknown", "a finding that is not in the log");
  assert.equal(await refusedBy(k.log.append(order(b.did, (await k.log.passport(b.did))!.head))), "order_finding_unknown", "a record that is not a watcher finding");
  assert.equal(await refusedBy(k.log.append(order(b.did, undefined))), "order_finding_unknown", "no finding cited");
  assert.equal(await refusedBy(k.log.append(order(b.did, filed.id, { kind: "re_exam", skill: "foundations", diagnosis: filed.id }))), "order_needs_diagnosis", "no re-exam or course on a finding");
  assert.equal(await refusedBy(k.log.append(order(b.did, filed.id, { reason: "scheduled" }))), "order_finding_without_reason", "a finding is cited only with its reason");
  assert.ok((await k.log.append(order(b.did, filed.id))).id, "the other named agent");

  // A lead moves nothing.
  assert.equal((await k.log.reputationOf(a.did))?.tier, 1);
  assert.equal((await k.log.reputationOf(a.did))?.slashCount, 0);
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
  assert.equal((await k.log.verify()).ok, true);
});
